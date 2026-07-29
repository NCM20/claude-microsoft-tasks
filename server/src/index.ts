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
  corsHeaders,
  decodeClaims,
  extractBearer,
  protectedResourceMetadata,
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
      assertTenantAllowed(decodeClaims(token), env);
    } catch (error) {
      const authError = error instanceof AuthError ? error : new AuthError('Authentication failed');
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
