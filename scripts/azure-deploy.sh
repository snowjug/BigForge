#!/usr/bin/env bash
# DEPLOY BigForge to Azure. THIS CREATES BILLABLE RESOURCES.
#
# It refuses to run unless every gate below is satisfied:
#   1. BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes is set in the environment.
#   2. AZURE_SUBSCRIPTION_ID and LOCATION are set explicitly (no defaults, no inference).
#   3. stdin is an interactive terminal (so the prompts cannot be piped or scripted away).
#   4. The templates build and lint cleanly (local checks).
#   5. You type 'what-if reviewed', attesting that you reviewed scripts/azure-whatif.sh output
#      for exactly these settings.
#   6. `az deployment sub create --confirm-with-what-if` shows the what-if for this deployment
#      and asks you to confirm once more.
#
# Do not run this without explicit authorization to create resources in the target subscription.
# Read docs/AZURE.md first. Teardown is described there too.
#
# Usage (two phases, because the container registry is created by the same template):
#   1. Foundation (no image): creates everything except the Container App, and writes a freshly
#      generated session secret to Key Vault.
#        BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes AZURE_SUBSCRIPTION_ID=<id> LOCATION=<region> \
#          scripts/azure-deploy.sh
#   2. Push an image to the new registry (commands are printed at the end of phase 1), then
#      deploy again with BIGFORGE_AZURE_IMAGE=<registry>.azurecr.io/bigforge:<tag> to create the
#      Container App. The session secret from phase 1 is reused (it is not rewritten).
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

command -v az >/dev/null 2>&1 || die "Azure CLI (az) not found."

# Gate 4: local validation (does not contact Azure).
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

cat <<SUMMARY

About to create BILLABLE Azure resources:
  subscription:   ${subscription_name}
  location:       ${location}
  environment:    ${BIGFORGE_AZURE_ENVIRONMENT:-dev}
  app mode:       ${BIGFORGE_AZURE_APP_MODE:-demo}
  image:          ${BIGFORGE_AZURE_IMAGE:-<none: phase 1, foundation only>}
  azure openai:   ${BIGFORGE_AZURE_OPENAI:-false}
  budget amount:  ${BIGFORGE_AZURE_BUDGET_AMOUNT:-0} (0 means no budget)
  session secret: ${secret_note}

SUMMARY

# Gate 5: attestation.
read -r -p "Have you reviewed scripts/azure-whatif.sh output for exactly these settings? Type 'what-if reviewed' to continue: " answer
[[ "${answer}" == "what-if reviewed" ]] || die "Not confirmed. Nothing was deployed."

deployment_name="bigforge-deploy-$(date -u +%Y%m%d%H%M%S)"

# Gate 6: the CLI prints the what-if for this exact deployment and asks to confirm.
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
To create it, push an image and deploy again (replace <tag>):

  az acr login --name ${registry_name}
  docker build --tag ${login_server}/bigforge:<tag> .
  docker push ${login_server}/bigforge:<tag>
  BIGFORGE_CONFIRM_CHARGEABLE_DEPLOYMENT=yes AZURE_SUBSCRIPTION_ID=<subscription-id> LOCATION=${location} \\
    BIGFORGE_AZURE_IMAGE=${login_server}/bigforge:<tag> scripts/azure-deploy.sh

NEXT
fi
