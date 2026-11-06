#!/usr/bin/env bash
# Validate the BigForge Bicep templates locally and, only when explicitly configured, preview a
# deployment with `az deployment sub what-if`.
#
# READ-ONLY. This script never creates, updates or deletes an Azure resource and never calls
# `az deployment sub create`. Deploying is a separate, explicit step: scripts/azure-deploy.sh.
#
#   Local validation (always; does not contact Azure):
#     az bicep build, az bicep lint (main + every module), az bicep build-params
#   What-if (only if BOTH AZURE_SUBSCRIPTION_ID and LOCATION are set explicitly; needs `az login`):
#     az deployment sub what-if
#
# Usage:
#   scripts/azure-whatif.sh                                              # local validation only
#   AZURE_SUBSCRIPTION_ID=<subscription-id> LOCATION=<region> scripts/azure-whatif.sh
#
# The template parameters come from infra/main.bicepparam, which reads optional BIGFORGE_AZURE_*
# environment variables (see that file). Set BIGFORGE_AZURE_IMAGE to include the Container App in
# the preview; without it the preview covers the foundation only.
#
# Production mode (BIGFORGE_AZURE_APP_MODE=production) seeds no demo users, so the script first
# requires BOTH BIGFORGE_AZURE_ADMIN_EMAIL and BIGFORGE_AZURE_ADMIN_PASSWORD (12+ characters) in
# the environment and stops before calling az if they are missing or invalid. They are never
# generated and never printed.

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

cat <<'BANNER'
==============================================================================
 BigForge Azure what-if  --  READ-ONLY
 This script makes NO changes to Azure. `az deployment sub what-if` only
 previews what a deployment would do. Deploying is a separate, explicit step
 (scripts/azure-deploy.sh) and is NOT performed here.
==============================================================================
BANNER

require_production_admin

command -v az >/dev/null 2>&1 || die "Azure CLI (az) not found."

echo
echo "[1/4] az bicep build infra/main.bicep (local)"
az bicep build --file infra/main.bicep --stdout >/dev/null

echo "[2/4] az bicep lint: main.bicep and every module (local)"
az bicep lint --file infra/main.bicep
for module in infra/modules/*.bicep; do
  [[ -e "${module}" ]] || continue
  az bicep lint --file "${module}"
done

echo "[3/4] az bicep build-params infra/main.bicepparam (local)"
az bicep build-params --file infra/main.bicepparam --stdout >/dev/null

echo "[4/4] az deployment sub what-if (read-only preview)"
subscription="${AZURE_SUBSCRIPTION_ID:-}"
location="${LOCATION:-}"

if [[ -z "${subscription}" && -z "${location}" ]]; then
  echo "Skipped: set BOTH AZURE_SUBSCRIPTION_ID and LOCATION to preview a deployment."
  echo
  echo "Local validation finished. Nothing was sent to Azure and nothing was deployed."
  exit 0
fi
if [[ -z "${subscription}" || -z "${location}" ]]; then
  die "Set both AZURE_SUBSCRIPTION_ID and LOCATION, or neither."
fi

subscription_name="$(az account show --subscription "${subscription}" --query name --output tsv)" ||
  die "Cannot read subscription '${subscription}'. Run 'az login' with an account that can access it."

# Mirror azure-deploy.sh: the first (foundation) deployment writes a freshly generated session
# secret to Key Vault. Here it is a throwaway value that is never printed or stored.
if [[ -z "${BIGFORGE_AZURE_SESSION_SECRET:-}" && -z "${BIGFORGE_AZURE_IMAGE:-}" ]]; then
  BIGFORGE_AZURE_SESSION_SECRET="$(random_secret)"
  export BIGFORGE_AZURE_SESSION_SECRET
fi

admin_note="not used (demo mode seeds its own demo users)"
if [[ "${BIGFORGE_AZURE_APP_MODE:-demo}" == "production" ]]; then
  admin_note="e-mail and password supplied by you (not printed)"
fi

cat <<SUMMARY

Previewing (read-only) against:
  subscription:    ${subscription_name}
  location:        ${location}
  environment:     ${BIGFORGE_AZURE_ENVIRONMENT:-dev}
  app mode:        ${BIGFORGE_AZURE_APP_MODE:-demo}
  bootstrap admin: ${admin_note}
  provider mode:   ${BIGFORGE_AZURE_PROVIDER_MODE:-deterministic}
  allowed IPs:     ${BIGFORGE_AZURE_ALLOWED_IPS:-<none: open to the internet>}
  image:           ${BIGFORGE_AZURE_IMAGE:-<none: foundation only, no Container App>}
  azure openai:    ${BIGFORGE_AZURE_OPENAI:-false}
  budget amount:   ${BIGFORGE_AZURE_BUDGET_AMOUNT:-0} (0 means no budget)

SUMMARY
whatif_name="bigforge-whatif-$(date -u +%Y%m%d%H%M%S)"

az deployment sub what-if \
  --subscription "${subscription}" \
  --location "${location}" \
  --name "${whatif_name}" \
  --parameters infra/main.bicepparam \
  --no-prompt true

echo
echo "what-if finished. Nothing was changed in Azure. To deploy, follow docs/AZURE.md and use scripts/azure-deploy.sh."
