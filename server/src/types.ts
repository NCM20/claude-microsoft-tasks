/**
 * Shared types for the Microsoft Tasks MCP worker.
 *
 * The worker is a stateless OAuth 2.0 resource server *and* an authorization
 * server proxy in front of Microsoft Entra ID. It stores no tokens and issues
 * none of its own: `/authorize` redirects to Entra, `/token` forwards the
 * exchange to Entra and returns the result verbatim, and every MCP request
 * carries a Microsoft Graph access token that the worker passes straight
 * through. Graph remains the authority on whether a token is valid and what it
 * may do.
 *
 * The proxy exists because Entra cannot be pointed at directly: it has no
 * dynamic client registration, does not implement RFC 8414, and does not
 * advertise PKCE support, each of which stops a conforming MCP client.
 */

export interface Env {
  /** Entra tenant the server is scoped to. A GUID, or `organizations` / `common`. */
  TENANT_ID: string;
  /**
   * Application (client) ID of the Entra app registration users sign in
   * against. Not a secret: a public client's ID appears in the browser URL on
   * every authorization request.
   */
  ENTRA_CLIENT_ID?: string;
  /**
   * Client secret for the Entra app, set with `wrangler secret put` and never
   * committed.
   *
   * Registering the Cowork callback under Entra's Web platform makes the app a
   * confidential client, so Entra demands client authentication at the token
   * endpoint. Because this Worker proxies that exchange, the secret lives here
   * and is never distributed: Cowork remains a public client talking to this
   * server, and never sees it. That is the standard reason to run an OAuth
   * proxy, and it is stronger than a bare public client, since a stolen
   * authorization code cannot be redeemed without also holding this.
   */
  ENTRA_CLIENT_SECRET?: string;
  /** Graph endpoint. Override for national clouds (e.g. US Gov, 21Vianet). */
  GRAPH_BASE?: string;
  /**
   * Optional comma-separated list of tenant GUIDs allowed to call this server.
   * Checked against the unverified `tid` claim as a cheap early reject. This is
   * defence in depth only: Graph performs the real validation.
   */
  ALLOWED_TENANT_IDS?: string;
  /** Login host. Override for national clouds. */
  LOGIN_BASE?: string;
  /** Max Graph pages any single tool call will follow. Default 5. */
  MAX_GRAPH_PAGES?: string;
}

/** Delegated Graph scopes this server expects a token to carry. */
export const REQUIRED_SCOPES = [
  'https://graph.microsoft.com/Tasks.ReadWrite',
  'https://graph.microsoft.com/Tasks.ReadWrite.Shared',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/User.ReadBasic.All',
  'offline_access',
] as const;

/** MCP protocol revisions this server can speak, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

/**
 * Version of the Worker, deliberately tracked separately from the plugin's
 * version in plugin.json. The two ship independently: server fixes reach users
 * on deploy without a plugin update, and skill changes reach them on plugin
 * update without a deploy. Keeping one number for both made it impossible to
 * tell which half was stale.
 */
export const SERVER_INFO = {
  name: 'microsoft-tasks',
  title: 'Microsoft Planner & To Do',
  version: '0.5.0',
} as const;

// --- JSON-RPC 2.0 ---

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

// --- MCP tools ---

/** JSON Schema fragment describing a tool's arguments. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition<A = Record<string, unknown>> {
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: ToolAnnotations;
  handler: (args: A, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  graph: GraphLike;
  env: Env;
}

/** Structural type for the Graph client, so tools stay easy to test. */
export interface GraphLike {
  get<T = unknown>(path: string, query?: QueryParams): Promise<T>;
  list<T = unknown>(path: string, query?: QueryParams, limit?: number): Promise<T[]>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  patch<T = unknown>(path: string, body: unknown, etag?: string): Promise<T>;
  delete(path: string, etag?: string): Promise<void>;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
