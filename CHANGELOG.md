# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org).

The plugin and the Worker are versioned separately on purpose. They ship
independently: a Worker fix reaches users on deploy with no plugin update, and a
skill change reaches them on plugin update with no deploy. Each entry below says
which half moved.

## Worker 0.5.0 - 2026-07-29

First version proven working end to end against a live tenant, via Claude Code.

### Fixed

- **Worker**: decide client authentication per request instead of always sending
  the secret. One app registration now serves two client types with opposite
  requirements: Cowork's `claude.ai` callback is registered under Entra's Web
  platform and is confidential, so omitting the secret returns `AADSTS7000218`;
  Claude Code's `http://localhost:<port>/callback` is registered under Mobile
  and desktop applications and is public, so sending the secret returns
  `AADSTS700025`.

  The redirect URI distinguishes them, but a `refresh_token` grant carries none,
  so the proxy infers from what it has and retries once when Entra names the
  secret as the problem in either direction.

### Verified

Whole chain exercised against the real tenant through Claude Code, which uses
the same Worker, proxy, secret handling, and app registration as Cowork:

- Token exchange granted, with a refresh token, carrying `Tasks.ReadWrite`.
- MCP requests arrive with `aud: https://graph.microsoft.com`.
- Reads: `whoami`, `todo_list_lists`, `todo_my_tasks` across lists,
  `planner_list_plans` (10 real plans), `planner_list_tasks`.
- Writes: create, add checklist steps, tick a step, complete, delete.

### Changed

- **Worker**: corrected the reasoning on due-date anchoring. Microsoft To Do
  ignores the time and normalises to midnight UTC, so the midday anchor is inert
  there. It is kept for Planner, whose rendering remains unverified.

## Worker 0.4.0 - 2026-07-29

Everything here was found by driving the real Cowork client against a real
tenant. None of it was predictable from the specifications.

### Fixed

- **Worker**: strip `prompt=consent` before redirecting to Entra. Cowork sends
  it on every authorization request, which tells Entra to re-run consent and
  ignore any existing grant. In a tenant where user consent is disabled, that
  turns an already-consented app into a permanent "admin approval required" wall
  for every non-admin. Admin consent already covers every scope this server
  requests, so re-consent has nothing to add and, for a non-admin, cannot
  succeed.

- **Worker**: authenticate the token exchange with `ENTRA_CLIENT_SECRET`.
  Registering the Cowork callback under Entra's Web platform makes the app a
  confidential client, and Entra rejects an unauthenticated exchange with
  `AADSTS7000218`. Because the Worker proxies the exchange, the secret stays in
  the Worker's encrypted secret store and is never distributed. Callers remain
  public clients that never see it, and an intercepted authorization code can no
  longer be redeemed on its own.

  Note for anyone testing this: an invalid authorization code returns
  `AADSTS9002313` whether or not client authentication would have succeeded,
  because Entra validates the code first. That test cannot confirm this fix.

### Added

- **Entra**: `openid`, `profile`, and `email` to the app registration and the
  admin grant. Not the cause of the consent wall, which was `prompt=consent`,
  but harmless and avoids a failure if a client ever requests them. They convey
  no data access beyond `User.Read`.

- **Worker**: log the requested and forwarded scopes, and the `prompt` value, on
  every authorize. This is what identified `prompt=consent`.

## Worker 0.3.0 - 2026-07-29

The Worker is now a full OAuth authorization server proxy rather than only a
metadata host. Plugin unchanged.

### Added

- **Worker**: `/authorize` and `/token`, proxying Entra. Combined with the
  existing `/register`, every endpoint the metadata advertises is now the same
  origin as its `issuer`.

  This was the fix for the connector that authorized successfully and then went
  quiet. Entra granted four valid Graph tokens; Cowork attached none of them.
  Serving metadata that claims one issuer while pointing `authorization_endpoint`
  at a foreign host is the shape of a mix-up attack, and a careful client that
  completes such a flow cannot reconcile the token it receives with the
  authorization server it recorded.

  PKCE passes through untouched and the authorization code goes straight from
  Entra to the client's redirect URI, so the proxy never handles a credential.
  `resource` (RFC 8707) is dropped, since Entra predates it and derives the
  audience from scopes instead. Scopes are rewritten to the fully qualified
  Graph ones when a client asks for anything else, because only those produce a
  token Graph will accept.

- **Worker**: RFC 7592 `registration_client_uri` and `registration_access_token`,
  plus `GET /register/{client_id}`. Without them a client has no way to confirm
  a registration still exists, and Cowork re-registered on every attempt.

- **Worker**: structured logging for the whole handshake, covering authorize,
  token grant outcomes, registration, and whether an inbound Authorization
  header was absent or merely unparseable. Tokens are never logged. This is what
  made the diagnosis possible.

## [0.2.1] - 2026-07-29

### Fixed

- **Entra / scripts**: register `https://claude.ai/api/mcp/auth_callback` as a
  Web redirect URI. Cowork does not run a loopback listener; it brokers OAuth
  through a hosted callback on claude.ai, so the `callbackPort` in a plugin's
  `.mcp.json` is a Claude Code concept that Cowork ignores. Without this,
  sign-in fails with `AADSTS50011`.

  It must be Web rather than Single-page application: claude.ai exchanges the
  code server-side, and Entra rejects non-CORS token requests against
  SPA-registered URIs with `AADSTS9002327`. The localhost URIs are kept for
  Claude Code, which does use a loopback listener.

## [0.2.0] - 2026-07-29

First version that can actually connect.

### Added

- **Worker**: RFC 7591 dynamic client registration at `/register`, answering
  with the one pre-registered public client. Cowork attempts registration before
  anything else and refuses to connect without it, rather than falling back to
  the `clientId` in `.mcp.json`. Entra has no dynamic registration of its own.
  No client secret is issued, and authorization still runs against Entra with
  PKCE.
- **Worker**: RFC 8414 authorization server metadata, served by the Worker
  rather than deferring to Entra. Entra implements OpenID Connect discovery but
  not RFC 8414, and omits `code_challenge_methods_supported` despite supporting
  PKCE with S256, either of which stops a conforming MCP client.
- **Repo**: GitHub Actions deploy on push to `main`, with the tenant GUID
  supplied from a secret rather than committed.

### Changed

- **Plugin**: connector now points at the deployed Worker and the
  `NCM Claude Tasks` app registration, replacing placeholders.
- **Worker**: 401 guidance no longer blames an expired sign-in outright.
  Microsoft To Do answers 401 rather than 403 when a token simply lacks the
  Tasks scopes, so a missing consent looks identical to an expired session.

### Fixed

- **Scripts**: `register-entra-app.sh` used `mktemp -t <prefix>`, which BSD
  accepts but GNU coreutils rejects without an `XXXXXX` placeholder. Both are
  common on macOS, and it aborted the script before anything was created.

## [0.1.0] - 2026-07-28

Initial build. Cloudflare Worker MCP server covering Microsoft Planner and
Microsoft To Do over the Graph API, plus a Cowork plugin with four skills.

Never successfully connected from Cowork; see 0.2.0.
