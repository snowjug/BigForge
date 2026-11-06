metadata name = 'BigForge Azure OpenAI (optional)'
metadata description = 'Azure OpenAI account with one model deployment. API-key authentication is disabled; the workload identity gets "Cognitive Services OpenAI User".'

@description('Account name. Also used as the custom subdomain, which Microsoft Entra authentication requires, so it must be globally unique.')
@minLength(2)
@maxLength(64)
param name string

@description('Azure region. Model availability and quota are regional and per subscription.')
param location string = resourceGroup().location

@description('Principal (object) ID granted "Cognitive Services OpenAI User" on the account.')
param userPrincipalId string

@description('Name of the model deployment; this is the value of AZURE_OPENAI_DEPLOYMENT.')
param deploymentName string

@description('Model name, for example gpt-4o-mini. Verify current availability before deploying; the default is a placeholder, not a recommendation.')
param modelName string

@description('Model version matching modelName.')
param modelVersion string

@description('Deployment SKU. Both options are pay-per-token; no provisioned capacity is created.')
@allowed([
  'Standard'
  'GlobalStandard'
])
param skuName string = 'GlobalStandard'

@description('Capacity in units of 1,000 tokens per minute (rate limit, not a spending cap).')
@minValue(1)
param capacity int = 10

@description('Resource tags.')
param tags object = {}

// Built-in role "Cognitive Services OpenAI User" (inference only, no management rights).
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
  }
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, userPrincipalId, openAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: userPrincipalId
    principalType: 'ServicePrincipal'
  }
}

@description('Resource ID of the Azure OpenAI account.')
output id string = account.id

@description('Name of the Azure OpenAI account.')
output name string = account.name

@description('Endpoint (AZURE_OPENAI_ENDPOINT), for example https://<name>.openai.azure.com/.')
output endpoint string = account.properties.endpoint

@description('Name of the model deployment (AZURE_OPENAI_DEPLOYMENT).')
output deploymentName string = modelDeployment.name
