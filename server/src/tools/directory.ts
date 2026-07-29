/**
 * Identity and people lookup.
 *
 * Planner assignments are keyed by Entra user object ID, but people ask for
 * tasks to be assigned to "Sarah". These tools bridge that gap so the model
 * never has to invent a GUID.
 */

import { ToolContext, ToolDefinition } from '../types';
import { compact, defineTool, optionalNumber, requireString } from './util';

/** Escape a value for an OData string literal, where `'` is doubled. */
function odataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export const directoryTools: ToolDefinition[] = [
  defineTool({
    name: 'whoami',
    title: 'Get the signed-in user',
    description:
      'Return the signed-in Microsoft 365 user, including the Entra object ID used for Planner assignments. Call this when you need to assign something to the user themselves, or to confirm which account is connected.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, { graph }: ToolContext) {
      const me = await graph.get<{
        id: string;
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
        jobTitle?: string;
      }>('/me', { $select: 'id,displayName,mail,userPrincipalName,jobTitle' });

      return compact({
        userId: me.id,
        displayName: me.displayName,
        email: me.mail ?? me.userPrincipalName,
        jobTitle: me.jobTitle,
      });
    },
  }),

  defineTool({
    name: 'directory_find_person',
    title: 'Find a colleague',
    description:
      'Look up colleagues by name or email address and return their Entra user object IDs. Use this to turn a name like "Sarah Chen" into the ID that planner_assign_task and planner_create_task require. If several people match, ask the user which one they meant rather than guessing.',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A name, partial name, or email address to search for.' },
        limit: { type: 'number', description: 'Maximum matches to return. Defaults to 10, maximum 25.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async handler(args, { graph }: ToolContext) {
      const query = requireString(args, 'query');
      const limit = Math.min(optionalNumber(args, 'limit') ?? 10, 25);
      const literal = odataLiteral(query);

      // startswith across the common name fields avoids needing the
      // ConsistencyLevel: eventual header that $search requires.
      const filter = [
        `startswith(displayName,'${literal}')`,
        `startswith(givenName,'${literal}')`,
        `startswith(surname,'${literal}')`,
        `startswith(mail,'${literal}')`,
        `startswith(userPrincipalName,'${literal}')`,
      ].join(' or ');

      const users = await graph.list<{
        id: string;
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
        jobTitle?: string;
      }>(
        '/users',
        { $filter: filter, $select: 'id,displayName,mail,userPrincipalName,jobTitle', $top: limit },
        limit,
      );

      return {
        people: users.map((user) =>
          compact({
            userId: user.id,
            displayName: user.displayName,
            email: user.mail ?? user.userPrincipalName,
            jobTitle: user.jobTitle,
          }),
        ),
        count: users.length,
        ambiguous: users.length > 1,
      };
    },
  }),
];
