using './main.bicep'

// Dev-safe placeholder values: no secrets, tenant ids or subscription ids are stored here.
//
// Values that differ per run are read from environment variables by the Bicep CLI when this
// file is compiled (readEnvironmentVariable); an unset variable falls back to the default
// shown. The Azure region is not set here: it defaults to the --location argument that is
// passed to `az deployment sub ...` (see the `location` parameter in main.bicep).
//
// Environment variables read by this file:
//   BIGFORGE_AZURE_ENVIRONMENT     dev | test | prod                 (default: dev)
//   BIGFORGE_AZURE_APP_MODE        demo | production                 (default: demo)
//   BIGFORGE_AZURE_IMAGE           image to run; empty = foundation only, no Container App
//   BIGFORGE_AZURE_SESSION_SECRET  value for the Key Vault session secret; empty = do not write
//   BIGFORGE_AZURE_OPENAI          true | false                      (default: false)
//   BIGFORGE_AZURE_BUDGET_AMOUNT   monthly budget; 0 = no budget     (default: 0)
//   BIGFORGE_AZURE_BUDGET_EMAIL    alert e-mail; required for a budget (default: empty)

param workloadName = 'bigforge'
param environmentName = readEnvironmentVariable('BIGFORGE_AZURE_ENVIRONMENT', 'dev')
param tags = {}

// Application
param containerImage = readEnvironmentVariable('BIGFORGE_AZURE_IMAGE', '')
param appMode = readEnvironmentVariable('BIGFORGE_AZURE_APP_MODE', 'demo')
param minReplicas = 0
param sessionSecret = readEnvironmentVariable('BIGFORGE_AZURE_SESSION_SECRET', '')
param otlpEndpoint = ''

// Monitoring
param logRetentionDays = 30
param logDailyQuotaGb = 1

// Key Vault. Set purge protection to true for anything you intend to keep; it is irreversible.
param keyVaultPurgeProtection = false
param keyVaultSoftDeleteRetentionDays = 7

// Optional Azure OpenAI (off by default). Model name and version are placeholders; check
// current availability and retirement dates in your region before enabling.
param deployAzureOpenAi = readEnvironmentVariable('BIGFORGE_AZURE_OPENAI', 'false') == 'true'
param azureOpenAiModelName = 'gpt-4o-mini'
param azureOpenAiModelVersion = '2024-07-18'
param azureOpenAiSkuName = 'GlobalStandard'
param azureOpenAiCapacity = 10
param azureOpenAiApiVersion = '2024-10-21'

// Cost control: no budget unless both an amount and an e-mail address are provided.
param budgetAmount = int(readEnvironmentVariable('BIGFORGE_AZURE_BUDGET_AMOUNT', '0'))
param budgetContactEmail = readEnvironmentVariable('BIGFORGE_AZURE_BUDGET_EMAIL', '')
param budgetThresholds = [
  50
  80
  100
]
