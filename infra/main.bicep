targetScope = 'subscription'

metadata name = 'BigForge on Azure Container Apps'
metadata description = 'Subscription-scope entry point: creates one resource group and, inside it, the optional Azure demo deployment of BigForge (single replica, no secrets in the template).'

// ---------------------------------------------------------------------------
// Placement and naming
// ---------------------------------------------------------------------------

@description('Azure region for the resource group and its resources. Defaults to the region passed as --location to the deployment command.')
param location string = deployment().location

@description('Short workload name used in resource names: 3-12 lowercase letters and digits.')
@minLength(3)
@maxLength(12)
param workloadName string = 'bigforge'

@description('Environment label used in resource names and tags. It is a naming label only and implies no production hardening.')
@allowed([
  'dev'
  'test'
  'prod'
])
param environmentName string = 'dev'

@description('Name of the resource group to create. A resource group with this name that already exists is updated in place.')
param resourceGroupName string = 'rg-${workloadName}-${environmentName}'

@description('Extra tags merged over the defaults. Do not put personal data or secrets in tags.')
param tags object = {}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

@description('Fully qualified image to run, for example <registry>.azurecr.io/bigforge:<tag>. Leave empty for the first (foundation) deployment: the registry is created by this template and starts empty, so the Container App is only created once an image is given.')
param containerImage string = ''

@description('Value of BIGFORGE_MODE. "production" seeds no demo users and needs bootstrap-admin variables that these templates do not set, so nobody could sign in; see docs/AZURE.md. It is not a claim of production readiness.')
@allowed([
  'demo'
  'production'
])
param appMode string = 'demo'

@description('Value of BIGFORGE_PROVIDER_MODE. "live" makes the app call the live provider that deployAzureOpenAi configures (billed per token); "deterministic" keeps the offline scripted provider even when Azure OpenAI exists.')
@allowed([
  'deterministic'
  'live'
])
param providerMode string = 'deterministic'

@description('CIDR ranges allowed to reach the public endpoint, for example 203.0.113.7/32. Empty (default) leaves the endpoint open to the internet. Demo mode seeds publicly documented credentials, so restrict access to anything you leave running.')
param allowedIpRanges string[] = []

@description('Minimum replicas. 0 lets the app scale to zero when idle. The maximum is fixed at 1 because state is a single-node SQLite database.')
@allowed([
  0
  1
])
param minReplicas int = 0

@description('Value of the BIGFORGE_SESSION_SECRET Key Vault secret. Supply it at deployment time (main.bicepparam reads it from an environment variable) and never commit it. When empty, no secret is written and one must already exist in the vault before the Container App is created.')
@secure()
param sessionSecret string = ''

@description('E-mail of the first admin (BIGFORGE_BOOTSTRAP_ADMIN_EMAIL). Used only when appMode is "production" and bootstrapAdminPassword is also set; ignored in demo mode, which seeds its own demo users.')
param bootstrapAdminEmail string = ''

@description('Password of the first admin (BIGFORGE_BOOTSTRAP_ADMIN_PASSWORD), at least 12 characters; the app ignores a shorter one. Stored as a Key Vault secret and read by the Container App through the managed identity. The operator supplies it at deployment time (main.bicepparam reads an environment variable) and must keep it: the templates never generate it. Never commit it. Ignored in demo mode.')
@secure()
param bootstrapAdminPassword string = ''

@description('Optional value of OTEL_EXPORTER_OTLP_ENDPOINT. Empty leaves the variable unset.')
param otlpEndpoint string = ''

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

@description('Days of data kept in the Log Analytics workspace.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Daily ingestion cap of the Log Analytics workspace in GB. Use -1 for no cap. At the cap, ingestion of billable data stops until the daily reset.')
@minValue(-1)
param logDailyQuotaGb int = 1

@description('Opt in to Azure Monitor "Statsbeat" SDK-usage telemetry, which the exporter packages send to Microsoft. Off by default: the Container App sets the opt-out variables.')
param enableStatsbeat bool = false

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

@description('Enable Key Vault purge protection. Irreversible once enabled; a deleted vault then keeps its name reserved until the retention period ends.')
param keyVaultPurgeProtection bool = false

@description('Days a deleted Key Vault and its secrets are retained (soft delete). Cannot be changed after the vault exists.')
@minValue(7)
@maxValue(90)
param keyVaultSoftDeleteRetentionDays int = 7

// ---------------------------------------------------------------------------
// Optional Azure OpenAI
// ---------------------------------------------------------------------------

@description('Create an Azure OpenAI account with one model deployment, key-based auth disabled, and wire the app to it with the workload identity. Billed per token consumed.')
param deployAzureOpenAi bool = false

@description('Region of the Azure OpenAI account. Model availability and quota are regional and per subscription.')
param azureOpenAiLocation string = location

@description('Model to deploy. The default is a placeholder: verify current availability and retirement dates in your region before enabling.')
param azureOpenAiModelName string = 'gpt-4o-mini'

@description('Version of the model to deploy. Placeholder; see azureOpenAiModelName.')
param azureOpenAiModelVersion string = '2024-07-18'

@description('Name of the model deployment (AZURE_OPENAI_DEPLOYMENT).')
param azureOpenAiDeploymentName string = azureOpenAiModelName

@description('Deployment SKU. Both options are pay-per-token.')
@allowed([
  'Standard'
  'GlobalStandard'
])
param azureOpenAiSkuName string = 'GlobalStandard'

@description('Deployment capacity in units of 1,000 tokens per minute. A rate limit, not a spending cap.')
@minValue(1)
param azureOpenAiCapacity int = 10

@description('Azure OpenAI data-plane API version (AZURE_OPENAI_API_VERSION).')
param azureOpenAiApiVersion string = '2024-10-21'

// ---------------------------------------------------------------------------
// Cost control
// ---------------------------------------------------------------------------

@description('Monthly budget for the resource group, in the subscription billing currency. 0 (the default) creates no budget. A budget only sends alerts; it never stops spending.')
@minValue(0)
param budgetAmount int = 0

@description('E-mail address for budget alerts. Both budgetAmount and this value must be set for a budget to be created.')
param budgetContactEmail string = ''

@description('Budget alert thresholds in percent of the budget, evaluated on actual cost. Must be unique. A forecast alert at 100 percent is always added; a budget allows five alerts in total.')
@minLength(1)
@maxLength(4)
param budgetThresholds int[] = [
  50
  80
  100
]

@description('First day (yyyy-MM-dd) of the first budget month. Defaults to the first day of the current UTC month at deployment time.')
param budgetStartDate string = utcNow('yyyy-MM-01')

// ---------------------------------------------------------------------------
// Names and tags
// ---------------------------------------------------------------------------

var workloadSlug = toLower(replace(workloadName, '-', ''))

// Deterministic per subscription, workload, environment and region: redeploying updates the
// same resources, and two subscriptions never collide on globally unique names.
var resourceToken = uniqueString(subscription().id, workloadSlug, environmentName, location)

var resourceTags = union(
  {
    application: 'bigforge'
    environment: environmentName
    managedBy: 'bicep'
  },
  tags
)

var sessionSecretName = 'bigforge-session-secret'
var bootstrapAdminPasswordSecretName = 'bigforge-bootstrap-admin-password'
var deployApp = !empty(containerImage)
var createBudget = budgetAmount > 0 && !empty(budgetContactEmail)

// Production mode seeds no demo users, so it needs the operator's admin. It is wired only when
// both values are given; demo mode ignores them.
var wireBootstrapAdmin = appMode == 'production' && !empty(bootstrapAdminEmail) && !empty(bootstrapAdminPassword)

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

resource rg 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: resourceTags
}

module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    logAnalyticsName: 'log-${workloadSlug}-${environmentName}-${resourceToken}'
    appInsightsName: 'appi-${workloadSlug}-${environmentName}'
    location: location
    retentionInDays: logRetentionDays
    dailyQuotaGb: logDailyQuotaGb
    tags: resourceTags
  }
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    name: 'id-${workloadSlug}-${environmentName}'
    location: location
    tags: resourceTags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  scope: rg
  name: 'key-vault'
  params: {
    name: 'kv-${take(workloadSlug, 7)}-${resourceToken}'
    location: location
    enablePurgeProtection: keyVaultPurgeProtection
    softDeleteRetentionInDays: keyVaultSoftDeleteRetentionDays
    workloadPrincipalId: identity.outputs.principalId
    sessionSecretName: sessionSecretName
    sessionSecretValue: sessionSecret
    bootstrapAdminPasswordSecretName: bootstrapAdminPasswordSecretName
    bootstrapAdminPasswordValue: wireBootstrapAdmin ? bootstrapAdminPassword : ''
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    tags: resourceTags
  }
}

module registry 'modules/container-registry.bicep' = {
  scope: rg
  name: 'container-registry'
  params: {
    name: 'cr${take(workloadSlug, 8)}${resourceToken}'
    location: location
    pullPrincipalId: identity.outputs.principalId
    tags: resourceTags
  }
}

module openAi 'modules/azure-openai.bicep' = if (deployAzureOpenAi) {
  scope: rg
  name: 'azure-openai'
  params: {
    name: 'oai-${take(workloadSlug, 8)}-${resourceToken}'
    location: azureOpenAiLocation
    userPrincipalId: identity.outputs.principalId
    deploymentName: azureOpenAiDeploymentName
    modelName: azureOpenAiModelName
    modelVersion: azureOpenAiModelVersion
    skuName: azureOpenAiSkuName
    capacity: azureOpenAiCapacity
    tags: resourceTags
  }
}

module containerAppsEnvironment 'modules/container-apps-environment.bicep' = {
  scope: rg
  name: 'container-apps-environment'
  params: {
    name: 'cae-${workloadSlug}-${environmentName}'
    location: location
    logAnalyticsWorkspaceName: monitoring.outputs.workspaceName
    tags: resourceTags
  }
}

module app 'modules/container-app.bicep' = if (deployApp) {
  scope: rg
  name: 'container-app'
  params: {
    name: 'ca-${workloadSlug}-${environmentName}'
    location: location
    environmentId: containerAppsEnvironment.outputs.id
    identityId: identity.outputs.id
    identityClientId: identity.outputs.clientId
    containerImage: containerImage
    registryLoginServer: registry.outputs.loginServer
    keyVaultUri: keyVault.outputs.vaultUri
    sessionSecretName: sessionSecretName
    appInsightsName: monitoring.outputs.appInsightsName
    appMode: appMode
    providerMode: providerMode
    allowedIpRanges: allowedIpRanges
    minReplicas: minReplicas
    otlpEndpoint: otlpEndpoint
    azureOpenAiEndpoint: openAi.?outputs.endpoint ?? ''
    azureOpenAiDeployment: openAi.?outputs.deploymentName ?? ''
    azureOpenAiApiVersion: azureOpenAiApiVersion
    bootstrapAdminEmail: wireBootstrapAdmin ? bootstrapAdminEmail : ''
    bootstrapAdminPasswordSecretName: wireBootstrapAdmin ? bootstrapAdminPasswordSecretName : ''
    enableStatsbeat: enableStatsbeat
    tags: resourceTags
  }
}

module budget 'modules/budget.bicep' = if (createBudget) {
  scope: rg
  name: 'budget'
  params: {
    name: 'budget-${workloadSlug}-${environmentName}'
    amount: budgetAmount
    contactEmail: budgetContactEmail
    thresholds: budgetThresholds
    startDate: budgetStartDate
  }
}

// ---------------------------------------------------------------------------
// Outputs (identifiers and endpoints only; no secrets)
// ---------------------------------------------------------------------------

@description('Name of the resource group.')
output resourceGroupName string = rg.name

@description('Name of the container registry.')
output containerRegistryName string = registry.outputs.name

@description('Login server of the container registry.')
output containerRegistryLoginServer string = registry.outputs.loginServer

@description('Name of the Key Vault.')
output keyVaultName string = keyVault.outputs.name

@description('Data-plane URI of the Key Vault.')
output keyVaultUri string = keyVault.outputs.vaultUri

@description('Name of the user-assigned managed identity.')
output managedIdentityName string = identity.outputs.name

@description('Name of the Log Analytics workspace.')
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName

@description('Name of the Application Insights component.')
output appInsightsName string = monitoring.outputs.appInsightsName

@description('Name of the Container Apps environment.')
output containerAppsEnvironmentName string = containerAppsEnvironment.outputs.name

@description('Name of the Container App. Empty until an image is supplied.')
output containerAppName string = app.?outputs.name ?? ''

@description('Public FQDN of the Container App. Empty until an image is supplied.')
output containerAppFqdn string = app.?outputs.fqdn ?? ''

@description('HTTPS URL of the Container App. Empty until an image is supplied.')
output appUrl string = empty(app.?outputs.fqdn ?? '') ? '' : 'https://${app.?outputs.fqdn}'

@description('Endpoint of the Azure OpenAI account. Empty unless deployAzureOpenAi is true.')
output azureOpenAiEndpoint string = openAi.?outputs.endpoint ?? ''

@description('Name of the Azure OpenAI model deployment. Empty unless deployAzureOpenAi is true.')
output azureOpenAiDeploymentName string = openAi.?outputs.deploymentName ?? ''
