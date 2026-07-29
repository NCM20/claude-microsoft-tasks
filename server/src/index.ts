/**
 * Microsoft Planner & To Do MCP server, on Cloudflare Workers.
 *
 * Routes:
 *   POST   /mcp                                        MCP streamable HTTP
 *   GET    /.well-known/oauth-protected-resource[/mcp]  RFC 9728 discovery
 *   GET    /health                                      liveness probe
 */

import {
  AuthError,
  assertTenantAllowed,
  authorizationServerMetadata,
  corsHeaders,
  decodeClaims,
  extractBearer,
  handleAuthorize,
  handleToken,
  protectedResourceMetadata,
  readClientRegistration,
  registerClient,
  unauthorized,
} from './auth';
import { GraphClient } from './graph';
import { JSON_RPC_ERRORS, handleRpc, jsonRpcFailure, parseRpc } from './mcp';
import { allTools } from './tools';
import { Env, SERVER_INFO } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // RFC 9728 clients probe both the bare path and the resource-suffixed one.
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json(protectedResourceMetadata(url, env));
    }

    // RFC 8414, plus the OpenID Connect path some clients try instead. Both
    // serve the same document. See authorizationServerMetadata for why this
    // Worker publishes it rather than deferring to Entra.
    if (
      url.pathname.startsWith('/.well-known/oauth-authorization-server') ||
      url.pathname.startsWith('/.well-known/openid-configuration')
    ) {
      return json(await authorizationServerMetadata(url, env));
    }

    // The authorization server proper. These exist so that issuer,
    // authorization_endpoint, token_endpoint, and registration_endpoint are all
    // one origin, which is what makes the metadata conformant and believable.
    if (url.pathname === '/authorize') {
      return handleAuthorize(url, env);
    }

    if (url.pathname === '/token') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed', message: 'Use POST to exchange a code.' }, 405, {
          allow: 'POST, OPTIONS',
        });
      }
      return handleToken(request, env);
    }

    // RFC 7591. Answers with the one pre-registered public client; see
    // registerClient for why this exists at all.
    if (url.pathname === '/register') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed', message: 'Use POST to register.' }, 405, {
          allow: 'POST, OPTIONS',
        });
      }
      return registerClient(request, env);
    }

    // RFC 7592 read of a registration, so a client can confirm it still exists
    // rather than assuming it failed and registering again.
    if (url.pathname.startsWith('/register/')) {
      return readClientRegistration(request, env, url.pathname.slice('/register/'.length));
    }

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        server: SERVER_INFO.name,
        version: SERVER_INFO.version,
        tools: allTools.length,
        tenant: env.TENANT_ID,
      });
    }

    if (url.pathname !== '/mcp') {
      return json({ error: 'not_found', message: `No route for ${url.pathname}` }, 404);
    }

    // This server has no session to resume and opens no server-initiated
    // stream, so only POST is meaningful on /mcp.
    if (request.method === 'DELETE') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed', message: 'Use POST for MCP requests.' }, 405, {
        allow: 'POST, DELETE, OPTIONS',
      });
    }

    let token: string;
    try {
      token = extractBearer(request);
      const claims = decodeClaims(token);
      assertTenantAllowed(claims, env);

      // Log the token's shape, never its contents. The audience and scopes are
      // what determine whether Graph will accept it, and getting either wrong
      // produces an opaque 401 from Graph that is otherwise unattributable.
      console.log(
        JSON.stringify({
          event: 'mcp_request',
          aud: claims.aud,
          audience_is_graph:
            claims.aud === 'https://graph.microsoft.com' ||
            claims.aud === '00000003-0000-0000-c000-000000000000',
          scopes: claims.scp?.split(' ') ?? [],
          has_tasks_scope: (claims.scp ?? '').includes('Tasks.'),
          user: claims.upn ?? claims.preferred_username,
          tenant: claims.tid,
        }),
      );
    } catch (error) {
      const authError = error instanceof AuthError ? error : new AuthError('Authentication failed');
      // Log which headers arrived, and the *shape* of any Authorization header,
      // never its value. Distinguishing "absent" from "present but unparseable"
      // is the difference between a client that has no token and one that has
      // a token it is sending wrongly.
      const authHeader = request.headers.get('authorization');
      console.log(
        JSON.stringify({
          event: 'mcp_unauthorized',
          reason: authError.message,
          authorization_header: authHeader === null ? 'absent' : `present, ${authHeader.length} chars, starts "${authHeader.slice(0, 7)}"`,
          headers_received: [...request.headers.keys()].sort(),
        }),
      );
      return unauthorized(url, env, authError);
    }

    let rpc;
    try {
      rpc = parseRpc(await request.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Malformed request body.';
      return json(jsonRpcFailure(null, JSON_RPC_ERRORS.parse, message), 400);
    }

    const ctx = { graph: new GraphClient(token, env), env };

    try {
      console.log(JSON.stringify({ event: 'rpc', method: rpc.method }));
      const response = await handleRpc(rpc, ctx);
      // Notifications get an acknowledgement with no body.
      if (response === null) {
        return new Response(null, { status: 202, headers: corsHeaders() });
      }
      return json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unhandled server error.';
      return json(jsonRpcFailure(rpc.id ?? null, JSON_RPC_ERRORS.internal, message), 500);
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}
