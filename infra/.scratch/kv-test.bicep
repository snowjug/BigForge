metadata name = 'BigForge Key Vault'
metadata description = 'RBAC-authorized Key Vault (no access policies) with soft delete, optional purge protection, an optional session secret, audit logging, and secret-read access for the workload identity.'

@description('Name of the Key Vault (3-24 characters, globally unique).')
@minLength(3)
@maxLength(24)
param name string

@description('Azure region.')
param location string = resourceGroup().location

@description('Enable purge protection. It cannot be disabled once enabled, and it keeps a deleted vault (and its name) reserved until the soft-delete retention period ends.')
param enablePurgeProtection bool = false

@description('Days a deleted vault and its secrets are retained (soft delete). Cannot be changed after the vault is created.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 7

@description('Principal (object) ID of the workload identity, granted "Key Vault Secrets User" on this vault.')
param workloadPrincipalId string

@description('Name of the session secret that the Container App reads.')
param sessionSecretName string

@description('Value of the session secret. When empty, no secret is written and a secret with the name above must already exist before the Container App is deployed.')
@secure()
param sessionSecretValue string = ''

@description('Resource ID of the Log Analytics workspace that receives Key Vault audit logs.')
param logAnalyticsWorkspaceId string

@description('Resource tags.')
param tags object = {}

// Built-in role "Key Vault Secrets User" (read secret contents).
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionInDays
    // Sending an explicit false is rejected by the service; omit the property instead.
    enablePurgeProtection: enablePurgeProtection ? true : null
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource sessionSecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (!empty(sessionSecretValue)) {
  parent: vault
  name: sessionSecretName
  properties: {
    value: sessionSecretValue
    contentType: 'text/plain'
    attributes: {
      enabled: true
    }
  }
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, workloadPrincipalId, keyVaultSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workloadPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// The only stable diagnosticSettings API version predates category groups, so the preview
// version stays; it is what current Azure samples use for the 'audit' group.
#disable-next-line use-recent-api-versions
resource auditLogs 'Microsoft.Insights/diagnosticSettings@2016-09-01' = {
  scope: vault
  name: 'audit-to-log-analytics'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
}

@description('Resource ID of the Key Vault.')
output id string = vault.id

@description('Name of the Key Vault.')
output name string = vault.name

@description('Data-plane URI of the Key Vault, ending in a slash.')
output vaultUri string = vault.properties.vaultUri
