#!/usr/bin/env bash
# DEPLOY BigForge to Azure. THIS CREATES BILLABLE RESOURCES.
#
# It refuses to run unless every gate below is satisfied:
#   1. BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes is set in the environment.
#   2. AZURE_SUBSCRIPTION_ID and LOCATION are set explicitly (no defaults, no inference).
#   3. stdin is an interactive terminal (so the prompts cannot be piped or scripted away).
#   4. In production mode (BIGFORGE_AZURE_APP_MODE=production), BIGFORGE_AZURE_ADMIN_EMAIL and
#      BIGFORGE_AZURE_ADMIN_PASSWORD (12+ characters) are set by you. They are never generated and
#      never printed. Production mode seeds no demo users, so without them nobody can sign in.
#      Checked before any az command runs; demo mode ignores both variables.
#   5. The templates build and lint cleanly (local checks).
#   6. You type 'what-if reviewed', attesting that you reviewed scripts/azure-whatif.sh output
#      for exactly these settings.
#   7. `az deployment sub create --confirm-with-what-if` shows the what-if for this deployment
#      and asks you to confirm once more.
#
# Do not run this without explicit authorization to create resources in the target subscription.
# Read docs/AZURE.md first. Teardown is described there too.
#
# Usage (two phases, because the container registry is created by the same template):
#   1. Foundation (no image): creates everything except the Container App, and writes a freshly
#      generated session secret (and, in production mode, your admin password) to Key Vault.
#        BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes AZURE_SUBSCRIPTION_ID=<id> LOCATION=<region> \
#          scripts/azure-deploy.sh
#   2. Push an image to the new registry (commands are printed at the end of phase 1), then
#      deploy again with BIGFORGE_AZURE_IMAGE=<registry>.azurecr.io/bigforge:<tag> to create the
#      Container App. The session secret from phase 1 is reused (it is not rewritten). In
#      production mode keep the admin variables set for this run too: the Container App is only
#      wired to the admin when both are provided.
#
# Template parameters come from infra/main.bicepparam (optional BIGFORGE_AZURE_* variables).

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n'
  fi
}

# Production mode seeds no demo users, so the operator must supply the first admin. It is never
# generated (a password nobody saw would leave nobody able to sign in) and never printed.
require_production_admin() {
  [[ "${BIGFORGE_AZURE_APP_MODE:-demo}" == "production" ]] || return 0
  if [[ -z "${BIGFORGE_AZURE_ADMIN_EMAIL:-}" || -z "${BIGFORGE_AZURE_ADMIN_PASSWORD:-}" ]]; then
    die "BIGFORGE_AZURE_APP_MODE=production needs BOTH BIGFORGE_AZURE_ADMIN_EMAIL and BIGFORGE_AZURE_ADMIN_PASSWORD (the first admin; without it nobody can sign in). Export them in your environment; they are never generated or printed."
  fi
  local email_pattern="^[A-Za-z0-9._%+'-]+@([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$"
  if [[ ! "${BIGFORGE_AZURE_ADMIN_EMAIL}" =~ ${email_pattern} || ${#BIGFORGE_AZURE_ADMIN_EMAIL} -gt 200 ]]; then
    die "BIGFORGE_AZURE_ADMIN_EMAIL must be a full e-mail address of at most 200 characters; the sign-in form rejects anything else."
  fi
  if [[ ${#BIGFORGE_AZURE_ADMIN_PASSWORD} -lt 12 ]]; then
    die "BIGFORGE_AZURE_ADMIN_PASSWORD must be at least 12 characters; the app ignores a shorter one and nobody could sign in."
  fi
}

# Gate 1: explicit opt-in.
if [[ "${BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT:-}" != "yes" ]]; then
  cat >&2 <<'REFUSAL'
REFUSING TO RUN: this script creates billable Azure resources.

To proceed deliberately, set BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes, set AZURE_SUBSCRIPTION_ID
and LOCATION, and read docs/AZURE.md. To preview without any changes, run scripts/azure-whatif.sh.
REFUSAL
  exit 1
fi

# Gate 2: explicit target.
subscription="${AZURE_SUBSCRIPTION_ID:-}"
location="${LOCATION:-}"
[[ -n "${subscription}" ]] || die "AZURE_SUBSCRIPTION_ID is not set."
[[ -n "${location}" ]] || die "LOCATION is not set."

# Gate 3: interactive terminal.
[[ -t 0 ]] || die "stdin is not a terminal; this script only runs interactively."

# Gate 4: production mode needs the operator's own admin credentials (before any az command).
require_production_admin

command -v az >/dev/null 2>&1 || die "Azure CLI (az) not found."

# Gate 5: local validation (does not contact Azure).
echo "Validating templates locally..."
az bicep build --file infra/main.bicep --stdout >/dev/null
az bicep lint --file infra/main.bicep
for module in infra/modules/*.bicep; do
  [[ -e "${module}" ]] || continue
  az bicep lint --file "${module}"
done
az bicep build-params --file infra/main.bicepparam --stdout >/dev/null

subscription_name="$(az account show --subscription "${subscription}" --query name --output tsv)" ||
  die "Cannot read subscription '${subscription}'. Run 'az login' with an account that can access it."

# Phase 1 (no image) writes a new random session secret to Key Vault. Phase 2 (image set) reuses
# the existing secret unless you supply BIGFORGE_AZURE_SESSION_SECRET yourself. The value is
# never printed.
secret_note="not written (phase 2 reuses the secret already in Key Vault)"
if [[ -n "${BIGFORGE_AZURE_SESSION_SECRET:-}" ]]; then
  secret_note="supplied by you; written to Key Vault (not printed)"
elif [[ -z "${BIGFORGE_AZURE_IMAGE:-}" ]]; then
  BIGFORGE_AZURE_SESSION_SECRET="$(random_secret)"
  export BIGFORGE_AZURE_SESSION_SECRET
  secret_note="generated for this run; written to Key Vault (not printed)"
fi

admin_note="not used (demo mode seeds its own demo users)"
if [[ "${BIGFORGE_AZURE_APP_MODE:-demo}" == "production" ]]; then
  admin_note="e-mail and password supplied by you (not printed); password written to Key Vault"
fi

cat <<SUMMARY

About to create BILLABLE Azure resources:
  subscription:    ${subscription_name}
  location:        ${location}
  environment:     ${BIGFORGE_AZURE_ENVIRONMENT:-dev}
  app mode:        ${BIGFORGE_AZURE_APP_MODE:-demo}
  bootstrap admin: ${admin_note}
  provider mode:   ${BIGFORGE_AZURE_PROVIDER_MODE:-deterministic}
  allowed IPs:     ${BIGFORGE_AZURE_ALLOWED_IPS:-<none: open to the internet>}
  image:           ${BIGFORGE_AZURE_IMAGE:-<none: phase 1, foundation only>}
  azure openai:    ${BIGFORGE_AZURE_OPENAI:-false}
  budget amount:   ${BIGFORGE_AZURE_BUDGET_AMOUNT:-0} (0 means no budget)
  session secret:  ${secret_note}

SUMMARY

# Gate 6: attestation.
read -r -p "Have you reviewed scripts/azure-whatif.sh output for exactly these settings? Type 'what-if reviewed' to continue: " answer
[[ "${answer}" == "what-if reviewed" ]] || die "Not confirmed. Nothing was deployed."

deployment_name="bigforge-deploy-$(date -u +%Y%m%d%H%M%S)"

# Gate 7: the CLI prints the what-if for this exact deployment and asks to confirm.
az deployment sub create \
  --subscription "${subscription}" \
  --location "${location}" \
  --name "${deployment_name}" \
  --parameters infra/main.bicepparam \
  --no-prompt true \
  --confirm-with-what-if \
  --query properties.outputs \
  --output json

if [[ -z "${BIGFORGE_AZURE_IMAGE:-}" ]]; then
  login_server="$(az deployment sub show --subscription "${subscription}" --name "${deployment_name}" \
    --query properties.outputs.containerRegistryLoginServer.value --output tsv)"
  registry_name="${login_server%%.*}"
  cat <<NEXT

Phase 1 finished: the Container App does not exist yet because the registry is empty.
To create it, push an image and deploy again (replace <tag>). The default image has no telemetry
exporter; the build argument below adds the Azure Monitor exporter (also add @azure/identity@^4
when Azure OpenAI is used with Entra ID authentication). In production mode keep
BIGFORGE_AZURE_ADMIN_EMAIL and BIGFORGE_AZURE_ADMIN_PASSWORD exported for the second run as well.
See docs/AZURE.md.

  az acr login --name ${registry_name}
  docker build --build-arg "EXTRA_RUNTIME_PACKAGES=@azure/monitor-opentelemetry@^1" \\
    --tag ${login_server}/bigforge:<tag> .
  docker push ${login_server}/bigforge:<tag>
  BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes AZURE_SUBSCRIPTION_ID=<subscription-id> LOCATION=${location} \\
    BIGFORGE_AZURE_IMAGE=${login_server}/bigforge:<tag> scripts/azure-deploy.sh

NEXT
fi
