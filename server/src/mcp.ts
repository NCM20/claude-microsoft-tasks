/**
 * MCP over streamable HTTP, stateless.
 *
 * The server holds no session state, so it implements the simplest conformant
 * shape of the transport: a JSON-RPC request arrives by POST and its response
 * comes straight back as JSON. There is no SSE stream, no session ID, and
 * nothing to resume, which is what lets the whole thing run on a Worker with no
 * Durable Object behind it.
 */

import { GraphError } from './graph';
import { toolManifest, toolsByName } from './tools';
import { ToolArgumentError } from './tools/util';
import {
  Env,
  JSON_RPC_ERRORS,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  ToolContext,
} from './types';

/** Guidance handed to the client at initialize time, ahead of any skill. */
const INSTRUCTIONS = `Tools for Microsoft Planner (shared team boards) and Microsoft To Do (personal task lists).

Routing: a task belonging to one person goes in To Do; a task on a team board, or one assigned to somebody else, goes in Planner. When the user does not say which, ask rather than guessing.

IDs are never guessable. Always list plans, buckets, or lists first to resolve a name the user spoke into the ID a tool needs, and re-resolve rather than reusing an ID from earlier in a long conversation.

Planner writes use optimistic concurrency, but the tools fetch the required ETag for you. If a write still fails with a stale-ETag error, re-read the item and retry once.

Confirm with the user before deleting anything, and before writing to a shared Planner board on their behalf.`;

export async function handleRpc(
  request: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  // Notifications carry no id and get no response body.
  if (request.id === undefined) {
    return null;
  }

  switch (request.method) {
    case 'initialize':
      return success(id, initialize(request.params));

    case 'ping':
      return success(id, {});

    case 'tools/list':
      return success(id, { tools: toolManifest() });

    case 'tools/call':
      return success(id, await callTool(request.params, ctx));

    // Declared unsupported rather than silently erroring, so clients that probe
    // for them get a clean answer.
    case 'resources/list':
      return success(id, { resources: [] });
    case 'prompts/list':
      return success(id, { prompts: [] });

    default:
      return failure(id, JSON_RPC_ERRORS.methodNotFound, `Unknown method: ${request.method}`);
  }
}

function initialize(params: Record<string, unknown> | undefined) {
  const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : undefined;
  const protocolVersion =
    requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0];

  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

async function callTool(params: Record<string, unknown> | undefined, ctx: ToolContext) {
  const name = typeof params?.name === 'string' ? params.name : undefined;
  if (!name) {
    return errorResult('The tools/call request did not name a tool.');
  }

  const tool = toolsByName.get(name);
  if (!tool) {
    return errorResult(`No such tool: ${name}. Call tools/list to see what is available.`);
  }

  const args = (params?.arguments ?? {}) as Record<string, unknown>;

  try {
    const result = await tool.handler(args, ctx);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return errorResult(describeError(error));
  }
}

/**
 * Tool failures are reported inside the result with `isError`, not as JSON-RPC
 * errors. That is what the spec asks for, and it matters in practice: the model
 * sees the message and can correct itself, where a transport-level error would
 * just abort the call.
 */
function errorResult(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown): string {
  if (error instanceof GraphError) {
    const context = error.requestId ? ` (Graph request ID ${error.requestId})` : '';
    return `Microsoft Graph returned ${error.status} ${error.code}: ${error.message}${context}\n\n${error.guidance}`;
  }
  if (error instanceof ToolArgumentError) {
    return `Invalid arguments: ${error.message}`;
  }
  if (error instanceof Error) {
    return `The tool failed: ${error.message}`;
  }
  return 'The tool failed for an unknown reason.';
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function parseRpc(body: unknown): JsonRpcRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SyntaxError('Expected a single JSON-RPC request object.');
  }
  const candidate = body as Partial<JsonRpcRequest>;
  if (candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string') {
    throw new SyntaxError('Not a valid JSON-RPC 2.0 request.');
  }
  return candidate as JsonRpcRequest;
}

export { JSON_RPC_ERRORS, failure as jsonRpcFailure };
export type { Env };
