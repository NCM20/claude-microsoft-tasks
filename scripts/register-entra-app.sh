#!/usr/bin/env bash
#
# Register the Entra application the Cowork plugin signs in against.
#
# Creates a public client app with the five delegated Microsoft Graph
# permissions the MCP server needs, then prints the client and tenant IDs.
#
# Deliberately does NOT grant admin consent. That is a Global Administrator's
# decision and should follow a look at what was actually requested.
#
# Requires: az CLI, logged in with rights to create app registrations.

set -euo pipefail

APP_NAME="${APP_NAME:-NCM Claude Tasks}"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

SCOPES=(
  "Tasks.ReadWrite"
  "Tasks.ReadWrite.Shared"
  "User.Read"
  "User.ReadBasic.All"
  "offline_access"
)

# Entra ignores the port on localhost redirect URIs for public clients, but not
# the path, so both shapes are registered.
REDIRECT_URIS=(
  "http://localhost/callback"
  "http://localhost"
)

command -v az >/dev/null || { echo "az CLI not found. Install it first." >&2; exit 1; }

TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "Tenant: ${TENANT_ID}"
echo "Creating app registration: ${APP_NAME}"
echo

# Resolve permission names to IDs at runtime rather than hardcoding GUIDs.
echo "Resolving Microsoft Graph delegated permission IDs..."
declare -a RESOURCE_ACCESS=()
for scope in "${SCOPES[@]}"; do
  id="$(az ad sp show --id "${GRAPH_APP_ID}" \
    --query "oauth2PermissionScopes[?value=='${scope}'].id | [0]" -o tsv)"
  if [[ -z "${id}" || "${id}" == "None" ]]; then
    echo "  Could not resolve '${scope}' against Microsoft Graph." >&2
    exit 1
  fi
  echo "  ${scope} -> ${id}"
  RESOURCE_ACCESS+=("{\"id\":\"${id}\",\"type\":\"Scope\"}")
done

REQUIRED_ACCESS="$(printf '[{"resourceAppId":"%s","resourceAccess":[%s]}]' \
  "${GRAPH_APP_ID}" \
  "$(IFS=,; echo "${RESOURCE_ACCESS[*]}")")"

MANIFEST="$(mktemp -t entra-required-access)"
trap 'rm -f "${MANIFEST}"' EXIT
printf '%s' "${REQUIRED_ACCESS}" > "${MANIFEST}"

echo
echo "Creating application..."
APP_ID="$(az ad app create \
  --display-name "${APP_NAME}" \
  --sign-in-audience AzureADMyOrg \
  --is-fallback-public-client true \
  --public-client-redirect-uris "${REDIRECT_URIS[@]}" \
  --required-resource-accesses "@${MANIFEST}" \
  --query appId -o tsv)"

# The service principal is what admin consent is actually recorded against.
az ad sp create --id "${APP_ID}" >/dev/null 2>&1 || true

cat <<EOF

Done.

  Application (client) ID : ${APP_ID}
  Directory (tenant) ID   : ${TENANT_ID}

Next:

  1. Grant admin consent, after reviewing the requested permissions:

       az ad app permission admin-consent --id ${APP_ID}

     Or in the Entra admin center under App registrations -> ${APP_NAME}
     -> API permissions -> Grant admin consent.

  2. Put the tenant ID in server/wrangler.jsonc as TENANT_ID.

  3. Put the client ID in plugin/.mcp.json as oauth.clientId.

EOF
