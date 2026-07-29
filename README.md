# Microsoft Tasks for Claude Cowork

A Claude Cowork plugin that gives Microsoft 365 users working access to
**Microsoft Planner** and **Microsoft To Do**, backed by a self-hosted MCP
server on Cloudflare Workers.

Microsoft "Tasks" is a front end, not a third API: the Teams app called *Tasks
by Planner and To Do* is a view over the Planner and To Do APIs. This covers
both.

## Why it is built this way

A Cowork plugin can only bundle **remote** MCP servers. Its `.mcp.json` accepts
`type`, `url`, `headers`, and `oauth`, and nothing else, so a local stdio server
launched by `npx` cannot be shipped in a plugin. The server therefore has to be
hosted somewhere, and this repository hosts it on Workers.

The Worker is a pure OAuth 2.0 **resource** server. It never mints, stores, or
refreshes tokens. Each user signs in to Microsoft directly through your Entra
app registration; Cowork sends the resulting Graph token with every request; the
Worker forwards it to Graph. Nothing is persisted anywhere.

```
Cowork ──OAuth 2.0 + PKCE──▶ Entra ID (your tenant)
   │                            │
   │                            └──▶ Graph access token
   │
   └──HTTPS + Bearer──▶ Cloudflare Worker ──▶ Microsoft Graph
                        (stateless, no secrets)
```

Consent is limited to `Tasks.ReadWrite`, `Tasks.ReadWrite.Shared`, `User.Read`,
`User.ReadBasic.All`, and `offline_access`. None require admin consent by
default, and none reach mail, files, calendar, or Teams messages.

## Setup

Three steps, roughly half an hour.

1. **[Register the Entra app](docs/entra-app-setup.md)** and note the client ID
   and tenant ID. There is a script at `scripts/register-entra-app.sh`.
2. **[Deploy the Worker](docs/deploy.md)**: `cd server && npm install && npx wrangler deploy`.
3. **[Install in Cowork](docs/cowork-install.md)**: fill in `plugin/.mcp.json`,
   push this repository, and add it as a marketplace.

## What the plugin adds

Four skills, which Claude draws on automatically:

| Skill | Covers |
|---|---|
| `/microsoft-tasks:basics` | Routing between Planner and To Do, resolving names to IDs, when to confirm before writing |
| `/microsoft-tasks:planner` | Buckets, labels, priority, assignment, checklists, board reporting |
| `/microsoft-tasks:todo` | Personal lists, due dates versus reminders, steps, recurrence limits |
| `/microsoft-tasks:triage` | Cross-system review, weekly review, capturing action items from notes and email |

Twenty-four tools:

- **Planner**: list plans, list and create buckets, list plan tasks, list my
  tasks, get task with description and checklist, create, update, complete,
  assign, set details, delete.
- **To Do**: list and create lists, list tasks in a list, list all my tasks
  across lists, get, create, update, complete, edit checklist, delete.
- **Directory**: `whoami`, and `directory_find_person` to turn a colleague's
  name into the object ID Planner assignment requires.

Tool results are projected down to the fields worth reasoning about rather than
returned as raw Graph objects, which keeps long board reviews affordable.

## Known limits

Stated plainly because the skills tell Claude to say so rather than improvise:

- Cannot create or delete plans, or change plan membership.
- Cannot create recurring tasks. Completing an existing recurring To Do task
  does roll it forward correctly.
- Cannot add attachments. Planner attachment links are readable.
- Cannot see other people's To Do lists. Only Planner is shared.
- Planner is unavailable in the 21Vianet cloud.

## Repository layout

```
.claude-plugin/marketplace.json   Marketplace manifest, so this repo installs directly
.github/workflows/deploy.yml      Typecheck and deploy the Worker on push to main
plugin/                           The Cowork plugin
  .claude-plugin/plugin.json      Plugin manifest
  .mcp.json                       Connector definition, needs your URL and client ID
  skills/                         Four skills
server/                           Cloudflare Worker MCP server
  src/index.ts                    Routing, CORS, auth gate
  src/mcp.ts                      Stateless streamable-HTTP MCP
  src/auth.ts                     Bearer handling, RFC 9728 metadata
  src/graph.ts                    Graph client, paging, ETag handling
  src/tools/                      Planner, To Do, and directory tools
docs/                             Entra, deploy, and Cowork install guides
scripts/register-entra-app.sh     Azure CLI app registration
```

## Development

```bash
cd server
npm install
npm run typecheck
npm run dev        # http://127.0.0.1:8787
```

The dev server needs a real Graph token to do anything useful, but the shape of
it can be checked without one:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/.well-known/oauth-protected-resource/mcp
```

## Credits

The auth flow and Graph handling in
[jordanburke/microsoft-todo-mcp-server](https://github.com/jordanburke/microsoft-todo-mcp-server)
were a useful reference, though that project is stdio-only and covers To Do
alone.
