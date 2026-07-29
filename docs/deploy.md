# Deploying the Worker

The MCP server is a single Cloudflare Worker with no database, no Durable
Object, and no stored state. It holds no secrets, because it holds no
credentials: tokens arrive on each request and are forwarded to Microsoft Graph.

## Prerequisites

- A Cloudflare account.
- The tenant ID from [Entra app registration](entra-app-setup.md).
- Node 20 or later.

## Deploy from GitHub Actions

This is the normal path. `.github/workflows/deploy.yml` typechecks and deploys
on every push to `main` that touches `server/`, and can be run by hand from the
Actions tab.

Add three repository secrets under **Settings → Secrets and variables →
Actions**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID, from the Workers dashboard sidebar |
| `ENTRA_TENANT_ID` | The directory (tenant) ID from [Entra app registration](entra-app-setup.md) |

Separately, the Worker needs the Entra client secret. This is a **Worker**
secret, not a GitHub one, because the Worker uses it at runtime to authenticate
the token exchange:

```bash
cd server && npx wrangler secret put ENTRA_CLIENT_SECRET
```

Worker secrets persist across deploys, so this is a one-time step that CI never
touches. Without it the OAuth flow completes at Microsoft and then fails at the
token exchange with `AADSTS7000218`, which surfaces as a connector that simply
will not connect.

Optionally add a repository **variable** (not a secret) named `WORKER_URL`, set
to the deployed origin. The workflow then smoke-tests `/health` after each
deploy instead of assuming success.

The tenant GUID is passed at deploy time rather than committed, which is why
`wrangler.jsonc` still says `organizations`. Do not "fix" that value in the file
and do not set it as a plaintext variable in the Cloudflare dashboard: a
`wrangler deploy` replaces dashboard variables with whatever the config file
declares, so a dashboard value disappears on the next deploy without warning.

The workflow never runs on `pull_request`. A fork PR would otherwise get to
execute arbitrary code in a job holding your Cloudflare token.

## Deploy by hand

For the first deploy, or when you want to watch it happen:

```bash
cd server
npm install
npx wrangler login
npx wrangler deploy --var TENANT_ID:"<your-tenant-guid>"
```

Wrangler prints the deployed URL, something like
`https://microsoft-tasks-mcp.<your-subdomain>.workers.dev`. The MCP endpoint is
that URL plus `/mcp`.

Passing the tenant GUID rather than leaving `organizations` means Entra will
only ever issue tokens for your own directory, which is one fewer thing to get
wrong. Omit `--var` for local `wrangler dev` and the default is fine.

## Verify

```bash
BASE=https://microsoft-tasks-mcp.<your-subdomain>.workers.dev

# Should report ok and a tool count of 24.
curl -s "$BASE/health"

# Should list this Worker as the authorization server and the five Graph scopes.
curl -s "$BASE/.well-known/oauth-protected-resource/mcp"

# Should return Entra's authorize and token endpoints, with S256 declared.
# See docs/cowork-install.md for why the Worker publishes this itself.
curl -s "$BASE/.well-known/oauth-authorization-server"

# Should return 401 with a WWW-Authenticate header pointing at that metadata.
curl -si -X POST "$BASE/mcp" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  | grep -i -E '^(HTTP|www-authenticate)'
```

Confirm the `authorization_servers` entry matches your tenant, then check that
Entra publishes discovery metadata where clients will look for it:

```bash
curl -s "https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration" \
  | head -c 200
```

## Custom domain

Optional, and worth it if you would rather users saw a company hostname during
consent. Add a route in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "tasks-mcp.example.com", "custom_domain": true }
]
```

Redeploy, then update the `url` in `plugin/.mcp.json` to match. The URL in
`.mcp.json` and the URL users actually reach must agree, or OAuth discovery
resolves to the wrong resource.

## Configuration reference

Set in `wrangler.jsonc` under `vars`.

| Variable | Default | Purpose |
|---|---|---|
| `TENANT_ID` | `organizations` | Entra tenant. Supplied at deploy time from the `ENTRA_TENANT_ID` secret rather than committed. |
| `GRAPH_BASE` | `https://graph.microsoft.com/v1.0` | Graph endpoint. Change only for national clouds. |
| `LOGIN_BASE` | `https://login.microsoftonline.com` | Entra login host. Change only for national clouds. |
| `MAX_GRAPH_PAGES` | `5` | Pages of Graph results a single tool call will follow. |
| `ALLOWED_TENANT_IDS` | unset | Comma-separated tenant GUIDs allowed to call the server. |

`ALLOWED_TENANT_IDS` checks the `tid` claim before spending a Graph round trip.
It reads that claim without verifying the token signature, so treat it as a
filter rather than a security boundary. The real check is Graph rejecting the
token a moment later.

## National clouds

For US Gov or 21Vianet, override all three of `GRAPH_BASE`, `LOGIN_BASE`, and
`TENANT_ID`. Note that Planner is not available in 21Vianet at all; To Do tools
will work there and Planner tools will return 404.

## Operating it

```bash
npx wrangler tail          # live logs
npx wrangler deployments list
```

Observability is on in `wrangler.jsonc`, so requests and exceptions show up in
the Workers dashboard.

The Worker logs no token contents and no task data. What you get is status
codes and Graph request IDs, which is what you need to chase a Microsoft-side
problem and nothing more.

### Things that will page you eventually

- **429 from Graph.** Planner throttles per user and fairly aggressively on
  writes. The tools surface it with guidance to back off; they do not retry
  automatically, on purpose, because a retry loop against a throttled Planner
  tenant makes things worse.
- **412 on Planner writes.** Means somebody edited the task between the read and
  the write. The tools fetch a fresh ETag on every write, so this is rare and
  self-correcting on a retry.
- **403 on assignment.** Nearly always the assignee not being a member of the
  group that owns the plan.
