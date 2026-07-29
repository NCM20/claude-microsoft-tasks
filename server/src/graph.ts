/**
 * Thin Microsoft Graph client.
 *
 * Two Graph quirks drive most of the design here:
 *
 * 1. Planner requires optimistic concurrency. Every PATCH and DELETE must carry
 *    an `If-Match` header holding the entity's current `@odata.etag`, verbatim
 *    including the `W/` prefix and quotes. A stale or reformatted ETag returns
 *    412 and the write is lost.
 * 2. Planner PATCH returns `204 No Content` unless you ask for the entity back
 *    with `Prefer: return=representation`, so we always ask.
 */

import { DEFAULT_GRAPH_BASE } from './auth';
import { Env, GraphLike, QueryParams } from './types';

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }

  /** A message aimed at the model, telling it what to do next. */
  get guidance(): string {
    switch (this.status) {
      case 401:
        // Microsoft To Do answers 401, not 403, when the token simply lacks the
        // Tasks scopes, so an expired sign-in is only one of two explanations
        // and blaming it outright sends people down the wrong path.
        return 'Microsoft 365 rejected the token. Either the sign-in expired or was revoked, or it was issued without the Tasks permissions this call needs. Ask the user to reconnect the Microsoft Planner & To Do connector. If reconnecting does not help, the app registration is missing consent for Tasks.ReadWrite.';
      case 403:
        return 'Microsoft 365 refused this operation. The signed-in user may lack access to this plan or list, or the app was not granted the required permission.';
      case 404:
        return 'That item does not exist or is not visible to the signed-in user. Re-list the parent collection to get a current ID rather than reusing one from earlier in the conversation.';
      case 409:
        return 'The item was changed concurrently. Re-fetch it and retry.';
      case 412:
        return 'The ETag was stale, so the write was rejected and nothing changed. Re-fetch the item to get its current etag, then retry the update once.';
      case 429:
        return 'Microsoft Graph is throttling. Wait a few seconds before retrying, and reduce how many items you request at once.';
      default:
        return this.status >= 500
          ? 'Microsoft Graph returned a server error. Retry once; if it persists, report it to the user rather than retrying in a loop.'
          : 'The request was rejected by Microsoft Graph. Check the arguments against the tool schema.';
    }
  }
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  etag?: string;
  /** Consistency headers some Graph filters require. */
  consistencyLevel?: boolean;
}

export class GraphClient implements GraphLike {
  private readonly base: string;
  private readonly maxPages: number;

  constructor(
    private readonly token: string,
    env: Env,
  ) {
    this.base = (env.GRAPH_BASE ?? DEFAULT_GRAPH_BASE).replace(/\/+$/, '');
    this.maxPages = Number(env.MAX_GRAPH_PAGES ?? '5') || 5;
  }

  private url(path: string, query?: QueryParams): string {
    // Absolute URLs come from @odata.nextLink and are already fully formed.
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const url = new URL(this.base + (path.startsWith('/') ? path : `/${path}`));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.etag) headers['if-match'] = options.etag;
    if (options.consistencyLevel) headers['consistencylevel'] = 'eventual';
    // Ask Planner to echo the updated entity instead of returning 204.
    if (method === 'PATCH') headers['prefer'] = 'return=representation';

    const response = await fetch(this.url(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) throw await toGraphError(response);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  /**
   * GET a collection, following `@odata.nextLink` until `limit` items are
   * collected or the page budget runs out. Graph ignores `$top` on several
   * Planner endpoints, so the limit is also enforced client-side.
   */
  async list<T>(path: string, query?: QueryParams, limit = 100): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = this.url(path, query);

    for (let page = 0; next && page < this.maxPages && items.length < limit; page++) {
      const body: { value?: T[]; '@odata.nextLink'?: string } = await this.request('GET', next);
      items.push(...(body.value ?? []));
      next = body['@odata.nextLink'];
    }

    return items.slice(0, limit);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  patch<T>(path: string, body: unknown, etag?: string): Promise<T> {
    return this.request<T>('PATCH', path, { body, etag });
  }

  async delete(path: string, etag?: string): Promise<void> {
    await this.request<void>('DELETE', path, { etag });
  }
}

async function toGraphError(response: Response): Promise<GraphError> {
  const requestId = response.headers.get('request-id') ?? undefined;
  let code = String(response.status);
  let message = response.statusText || 'Microsoft Graph request failed';

  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Graph occasionally returns an empty or non-JSON error body.
  }

  return new GraphError(response.status, code, message, requestId);
}

/**
 * Pull the ETag off a Graph entity. Planner writes fail with 412 if this is
 * altered in any way, so it is returned exactly as received.
 */
export function etagOf(entity: unknown): string | undefined {
  if (entity && typeof entity === 'object' && '@odata.etag' in entity) {
    const value = (entity as Record<string, unknown>)['@odata.etag'];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * Fetch an entity purely to read its current ETag. Used by the write tools so
 * callers never have to pass ETags around, which is the single most common
 * source of 412s when a model drives Planner directly.
 */
export async function currentEtag(graph: GraphLike, path: string): Promise<string> {
  const entity = await graph.get<Record<string, unknown>>(path);
  const etag = etagOf(entity);
  if (!etag) {
    throw new GraphError(500, 'missingEtag', `Microsoft Graph returned no ETag for ${path}, so it cannot be safely updated.`);
  }
  return etag;
}
