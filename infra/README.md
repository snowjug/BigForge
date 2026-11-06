# infra: Azure templates for BigForge

Bicep templates for an **optional** Azure demo deployment (Azure Container Apps). They are validated
locally only; nothing is deployed. The full picture, limitations and safety rules are in
[`docs/AZURE.md`](../docs/AZURE.md).

## Layout

- `main.bicep`: subscription-scope entry point. Creates the resource group and deploys the modules.
- `main.bicepparam`: dev-safe placeholder values. Per-run values come from `BIGFORGE_AZURE_*`
  environment variables read at compile time; no secrets, tenant ids or subscription ids are stored.
- `bicepconfig.json`: linter rules (security-relevant rules are errors).
- `modules/`: `monitoring`, `identity`, `key-vault`, `container-registry`,
  `container-apps-environment`, `container-app`, `azure-openai` (optional), `budget` (optional).

## Two-phase deployment

The registry is created by this template, so the Container App only exists once an image is given.
With `BIGFORGE_AZURE_IMAGE` unset, the template creates everything except the Container App
("foundation"). Push an image to the new registry, then deploy again with `BIGFORGE_AZURE_IMAGE` set.

## Production mode

`BIGFORGE_AZURE_APP_MODE=production` seeds no demo users, so the first admin must come from you:
set `BIGFORGE_AZURE_ADMIN_EMAIL` and `BIGFORGE_AZURE_ADMIN_PASSWORD` (12 or more characters) for
both phases. The password is written to Key Vault and read by the Container App through the managed
identity; it is never generated. The template wires the admin only in production mode and only when
both values are given, and the scripts and the deploy workflow stop before any Azure access when
either is missing or invalid. Demo mode ignores both.

## Telemetry privacy

The Container App opts out of Azure Monitor's Statsbeat usage telemetry by default; set
`enableStatsbeat` to `true` in `main.bicepparam` to opt in.

## Validate locally (no Azure access, nothing deployed)

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null
az bicep lint --file infra/main.bicep
for f in infra/modules/*.bicep; do az bicep lint --file "$f"; done
az bicep build-params --file infra/main.bicepparam --stdout > /dev/null
```

`scripts/azure-whatif.sh` runs these and, only when `AZURE_SUBSCRIPTION_ID` and `LOCATION` are set,
a read-only `az deployment sub what-if`. `scripts/azure-deploy.sh` is the only script that deploys,
and it refuses to run without explicit confirmation.
