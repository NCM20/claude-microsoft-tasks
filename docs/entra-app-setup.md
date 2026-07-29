# Entra app registration

The Worker never holds credentials. Each user signs in to Microsoft themselves
through this app registration, and Cowork sends the resulting Microsoft Graph
token along with every request. One registration serves the whole tenant.

## What you are creating

A **public client** application using authorization code flow with PKCE. Public
client means no client secret, which is correct here: the client is a desktop
app on each user's machine, and a secret shipped to every desktop is not a
secret.

## Permissions

All delegated, all against Microsoft Graph:

| Permission | Why | Admin consent required |
|---|---|---|
| `Tasks.ReadWrite` | Read and write Planner tasks and To Do tasks | No |
| `Tasks.ReadWrite.Shared` | Reach To Do lists shared with the user | No |
| `User.Read` | Identify the signed-in user and get their object ID | No |
| `User.ReadBasic.All` | Resolve colleague names to the object IDs Planner assignment needs | No |
| `offline_access` | Refresh tokens, so users are not re-prompted daily | No |

None of these require admin consent on paper. Grant tenant-wide admin consent
anyway: most organisations disable user consent, and without it every user hits
a "need admin approval" wall on first use.

Nothing here reaches mail, files, calendar, or Teams messages. If you need to
justify this to a security reviewer, that is the point worth making: the app can
see the user's tasks and look up colleagues in the directory, and nothing else.

`User.ReadBasic.All` is the broadest of the five. It exposes name, email, and
job title for directory users, which is the same thing the address book shows.
Drop it if you would rather not grant it; assignment by name then stops working
and users must supply object IDs, which in practice means assignment stops
working. See [Running without directory lookup](#running-without-directory-lookup).

## Portal steps

1. **Entra admin center** → Applications → App registrations → New registration.
2. Name: `NCM Claude Tasks`. This is not cosmetic. It is the name every user
   reads on the Microsoft consent screen when deciding whether to grant access
   to their tasks, so it should be recognisable as something your organisation
   sanctioned. Override it in the script with `APP_NAME=...` if you want
   something else.
3. Supported account types: **Accounts in this organizational directory only**.
4. Skip the redirect URI here; add it in the next step where the platform type
   matters.
5. Register, then copy the **Application (client) ID** and **Directory (tenant)
   ID**. You need both.
6. → **Authentication** → Add a platform → **Mobile and desktop applications**.
   Add these redirect URIs:
   - `http://localhost/callback`
   - `http://localhost`

   For public client apps, Entra ignores the port on `http://localhost` redirect
   URIs, so you do not need to match Cowork's callback port. It does **not**
   ignore the path, which is why both variants are registered. If sign-in fails
   with `AADSTS50011`, the error text names the exact URI Cowork sent; add that
   one and the problem goes away.
7. Confirm **Allow public client flows** is set to **Yes** on the same page.
8. → **API permissions** → Add a permission → Microsoft Graph → Delegated
   permissions. Add the five from the table above.
9. → **Grant admin consent for _your tenant_**. Confirm every row shows
   "Granted".

Do not create a client secret. If one exists, the app is a confidential client
and the desktop flow will not work.

## Scripted alternative

`scripts/register-entra-app.sh` does the same thing through the Azure CLI. It
looks the permission IDs up at runtime rather than hardcoding GUIDs, so it stays
correct as Microsoft's catalogue changes.

```bash
az login
./scripts/register-entra-app.sh
```

It prints the client ID and tenant ID you need for the next two steps, and it
stops short of granting admin consent so that a Global Administrator can review
what was requested first. Read it before running it.

## Running without directory lookup

To drop `User.ReadBasic.All`, leave it out of the registration. The
`directory_find_person` tool then returns 403 and assignment by name stops
working. Everything else, including Planner tasks assigned to the signed-in user
via `whoami`, continues to work.

## Multi-tenant

The default here is single tenant, which is almost always what you want. If you
genuinely need to serve several tenants, set supported account types to
"Accounts in any organizational directory", set the Worker's `TENANT_ID` to
`organizations`, and set `ALLOWED_TENANT_IDS` to the tenant GUIDs you intend to
serve. Every additional tenant needs its own admin consent.

## What to hand off

Once this is done you should have:

- **Application (client) ID**, which goes in the plugin's `.mcp.json`.
- **Directory (tenant) ID**, which goes in the Worker's `TENANT_ID`.
