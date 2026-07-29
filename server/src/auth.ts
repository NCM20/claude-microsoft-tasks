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

export function authorizationServer(env: Env): string {
  return `${loginBase(env)}/${env.TENANT_ID}/v2.0`;
}

/**
 * RFC 9728 protected resource metadata. Points MCP clients at Entra ID as the
 * authorization server and tells them which Graph scopes to request.
 */
export function protectedResourceMetadata(requestUrl: URL, env: Env) {
  const resource = `${requestUrl.protocol}//${requestUrl.host}/mcp`;
  return {
    resource,
    authorization_servers: [authorizationServer(env)],
    scopes_supported: [...REQUIRED_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Microsoft Planner & To Do',
    resource_documentation: 'https://github.com/ncm/claude-ms-tasks#readme',
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
