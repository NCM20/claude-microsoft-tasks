/** Small argument-coercion helpers shared by the tool modules. */

import { ToolDefinition } from '../types';

export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArgumentError';
  }
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolArgumentError(`"${key}" is required and must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ToolArgumentError(`"${key}" must be a string.`);
  return value.trim();
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ToolArgumentError(`"${key}" must be a boolean.`);
  return value;
}

export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new ToolArgumentError(`"${key}" must be a number.`);
  return parsed;
}

export function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ToolArgumentError(`"${key}" must be an array of strings.`);
  }
  return value as string[];
}

/**
 * Normalise a user-supplied date into the ISO 8601 UTC string Graph expects.
 *
 * A bare `YYYY-MM-DD` is anchored at midday UTC rather than midnight. Planner
 * and To Do store the instant verbatim and clients render it in local time, so
 * a midnight-UTC due date displays as the *previous* day for anyone west of
 * UTC. Midday keeps the calendar date intact across every populated timezone.
 */
export function toGraphDateTime(value: string, field: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T12:00:00Z`;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolArgumentError(
      `"${field}" must be a date (YYYY-MM-DD) or an ISO 8601 timestamp. Received: ${value}`,
    );
  }
  return parsed.toISOString();
}

/** Drop undefined values so we never PATCH a property we did not mean to set. */
export function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function defineTool<A = Record<string, unknown>>(tool: ToolDefinition<A>): ToolDefinition<A> {
  return tool;
}

/** RFC 4122 v4 identifier, used for Planner checklist item keys. */
export function uuid(): string {
  return crypto.randomUUID();
}
