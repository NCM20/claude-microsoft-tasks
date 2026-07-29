/**
 * Bearer token handling and OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * This server does not verify token signatures. That is deliberate, not an
 * oversight: the tokens it receives are audienced for Microsoft Graph, not for
 * this server, so we are not the intended validator. Every request is forwarded
 * to Graph, which rejects tokens that are expired, revoked, malformed, or
 * lacking scope. The claim parsing below is used only for cheap early rejects
 * and for log context, never to make an authorization decision.
 */

import { Env, REQUIRED_SCOPES } from './types';

export const DEFAULT_LOGIN_BASE = 'https://login.microsoftonline.com';
export const DEFAULT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface TokenClaims {
  tid?: string;
  oid?: string;
  upn?: string;
  preferred_username?: string;
  name?: string;
  scp?: string;
  aud?: string;
  exp?: number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly errorCode: 'invalid_token' | 'invalid_request' | 'insufficient_scope' = 'invalid_token',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function extractBearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new AuthError('Missing or malformed Authorization header', 'invalid_request');
  }
  return match[1].trim();
}

/** Decode a JWT payload without verifying it. Returns {} for opaque tokens. */
export function decodeClaims(token: string): TokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    // atob yields a binary string; decode it as UTF-8 so non-ASCII names survive.
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as TokenClaims;
  } catch {
    return {};
  }
}

/**
 * Reject tokens from tenants outside the allowlist before spending a Graph
 * round trip. A forged `tid` gets past this and is then rejected by Graph, so
 * this is a filter rather than a security boundary.
 */
export function assertTenantAllowed(claims: TokenClaims, env: Env): void {
  const allowed = (env.ALLOWED_TENANT_IDS ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return;
  const tid = claims.tid?.toLowerCase();
  if (!tid || !allowed.includes(tid)) {
    throw new AuthError('Token was issued by a tenant this server does not serve');
  }
}

export function loginBase(env: Env): string {
  return (env.LOGIN_BASE ?? DEFAULT_LOGIN_BASE).replace(/\/+$/, '');
}

/**
 * RFC 9728 protected resource metadata.
 *
 * `authorization_servers` points at this Worker rather than directly at Entra,
 * because Entra cannot be discovered the way MCP clients look. Two measured
 * problems, both confirmed against a live tenant:
 *
 *   1. Entra does not implement RFC 8414. Of the three well-known paths an MCP
 *      client probes, only `{issuer}/.well-known/openid-configuration` answers;
 *      both path-insertion forms return 404. A client that stops after the
 *      first probe never finds it.
 *   2. Entra's metadata omits `code_challenge_methods_supported`. It supports
 *      PKCE with S256 perfectly well, it simply does not advertise it, and a
 *      client that verifies PKCE support before proceeding will refuse to.
 *
 * So this Worker serves its own authorization server metadata, which is
 * discoverable at the plain RFC 8414 path and states S256 support explicitly.
 * The authorization and token endpoints in that document are Entra's, so users
 * still authenticate directly against Microsoft and no token ever passes
 * through here during the handshake.
 */
export function protectedResourceMetadata(requestUrl: URL, env: Env) {
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...REQUIRED_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Microsoft Planner & To Do',
    resource_documentation: 'https://github.com/NCM20/claude-microsoft-tasks#readme',
  };
}

interface EntraOpenIdConfiguration {
  authorization_endpoint?: string;
  token_endpoint?: string;
  response_modes_supported?: string[];
  end_session_endpoint?: string;
}

/**
 * RFC 8414 authorization server metadata, derived from Entra's own OpenID
 * configuration so that national clouds and any future endpoint changes are
 * picked up without a redeploy.
 *
 * `issuer` is this Worker's origin rather than Entra's, because RFC 8414
 * requires the issuer to match the location the document was fetched from.
 * Nothing downstream depends on it: this flow produces no ID token, and the
 * access token is opaque to the client.
 */
export async function authorizationServerMetadata(requestUrl: URL, env: Env) {
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  const tenant = `${loginBase(env)}/${env.TENANT_ID}`;

  let upstream: EntraOpenIdConfiguration = {};
  try {
    const response = await fetch(`${tenant}/v2.0/.well-known/openid-configuration`, {
      // Entra's discovery document is effectively static; cache it at the edge.
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);
    if (response.ok) upstream = (await response.json()) as EntraOpenIdConfiguration;
  } catch {
    // Fall through to the constructed endpoints below.
  }

  return {
    issuer: origin,
    authorization_endpoint: upstream.authorization_endpoint ?? `${tenant}/oauth2/v2.0/authorize`,
    token_endpoint: upstream.token_endpoint ?? `${tenant}/oauth2/v2.0/token`,
    scopes_supported: [...REQUIRED_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: upstream.response_modes_supported ?? ['query', 'fragment', 'form_post'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // The whole reason this document exists. Entra supports S256 but does not say so.
    code_challenge_methods_supported: ['S256'],
    // Public client: no secret is presented at the token endpoint.
    token_endpoint_auth_methods_supported: ['none'],
    // Deliberately no registration_endpoint. Entra has no dynamic client
    // registration, so clients must use the client ID configured in the plugin.
    service_documentation: 'https://github.com/NCM20/claude-microsoft-tasks#readme',
  };
}

/** Build a 401 that tells the client where to discover auth, per RFC 9728 §5.1. */
export function unauthorized(requestUrl: URL, env: Env, error: AuthError): Response {
  const metadataUrl = `${requestUrl.protocol}//${requestUrl.host}/.well-known/oauth-protected-resource/mcp`;
  const challenge = [
    'Bearer',
    `error="${error.errorCode}"`,
    `error_description="${error.message.replace(/"/g, "'")}"`,
    `resource_metadata="${metadataUrl}"`,
  ].join(' ');

  return new Response(
    JSON.stringify({ error: error.errorCode, error_description: error.message }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': challenge,
        ...corsHeaders(),
      },
    },
  );
}

export function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
    'access-control-expose-headers': 'www-authenticate, mcp-protocol-version, mcp-session-id',
    'access-control-max-age': '86400',
  };
}
