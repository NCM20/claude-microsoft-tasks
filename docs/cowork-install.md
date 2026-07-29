# Installing in Cowork

## Before you start

Fill in `plugin/.mcp.json` with the two values from the earlier steps:

```json
{
  "mcpServers": {
    "microsoft-tasks": {
      "type": "http",
      "url": "https://microsoft-tasks-mcp.your-subdomain.workers.dev/mcp",
      "oauth": {
        "clientId": "your-entra-application-client-id",
        "callbackPort": 3119
      }
    }
  }
}
```

Then push this repository somewhere your users can reach. It is already laid out
as a plugin marketplace: `.claude-plugin/marketplace.json` at the root points at
`./plugin`.

A private GitHub repo is fine. Cowork clones it using each user's own GitHub
credentials, so anyone who can read the repo can install from it.

## Users: install it

1. **Customize** in the sidebar, then **Plugins**.
2. **Add marketplace**, and enter the repository as `owner/repo` or its full
   GitHub URL.
3. The `microsoft-tasks` plugin appears alongside the others. **Install**.
4. Cowork prompts to sign in to Microsoft. Sign in with the work account whose
   tasks you want to reach.
5. Open the plugin to confirm four skills and one connector are listed.

Then try it: *"What's on my plate this week?"*

## Admins: push it to everyone

On Team and Enterprise plans, administrators can mark a plugin as required, in
which case it installs automatically and users cannot remove it. That is
configured on the Anthropic side rather than in this repository. See
[MCP, plugins, skills, and hooks](https://claude.com/docs/cowork/3p/extensions)
for the provisioning routes.

Each user still signs in to Microsoft individually. That is the design: the
Worker never holds a shared identity, so every action is taken as the person who
asked for it and Microsoft's own permissions apply unchanged. A user who cannot
see a plan in Planner cannot see it here either.

## Updating

Push to the repository, then have users click **Update** on the marketplace
entry in Cowork. Bump `version` in `plugin/.claude-plugin/plugin.json` so the
change is visible.

Changing the Worker needs no plugin update at all, as long as the URL holds
steady. Redeploy and users pick it up on their next call.

## Verifying the OAuth handshake

This is the step most worth watching the first time, because it is where a
misconfigured Entra app shows up.

Expected: clicking through sign-in sends the user to
`login.microsoftonline.com`, shows a consent screen naming your app and the
Tasks permissions, and returns to Cowork with the connector marked connected.

If it fails:

| Symptom | Cause |
|---|---|
| `AADSTS50011: redirect URI does not match` | The redirect URI Cowork used is not registered. The error text names the exact URI it sent; add that one under Mobile and desktop applications. |
| `AADSTS65001: user or administrator has not consented` | Admin consent was not granted, and user consent is disabled in the tenant. Grant admin consent. |
| `AADSTS7000218: request body must contain client_assertion or client_secret` | The app is registered as a confidential client. Remove any client secret and confirm the redirect URI sits under **Mobile and desktop applications**, not **Web**. |
| Connected, but every tool returns 401 | The token was issued for the wrong audience. Confirm the scopes in the Worker's protected-resource metadata are the fully qualified `https://graph.microsoft.com/...` form. |
| Connected, but tools return 403 | Permissions granted but consent not applied to this user. Re-run admin consent and have the user reconnect. |

`npx wrangler tail` shows what the Worker received while you reproduce it.

## A caveat worth knowing

Cowork's plugin support is in beta, and Anthropic's own documentation notes that
plugins are currently stored locally per machine, with org-wide sharing and
management still landing. Plan on each user adding the marketplace themselves
for now, and revisit the admin-managed route once it is generally available.

The exact shape of the `oauth` block in a plugin's `.mcp.json` is the one part
of this setup taken from Anthropic's own published plugins rather than from
reference documentation. If Cowork rejects the static `clientId` and insists on
dynamic client registration, the fix is a small OAuth proxy in front of the
Worker; Entra does not support dynamic registration itself. Test with one user
before rolling out widely.
