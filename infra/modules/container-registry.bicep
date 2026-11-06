metadata name = 'BigForge container registry'
metadata description = 'Basic-tier Azure Container Registry with the admin user disabled; the workload identity gets AcrPull.'

@description('Name of the registry (5-50 lowercase alphanumeric characters, globally unique).')
@minLength(5)
@maxLength(50)
param name string

@description('Azure region.')
param location string = resourceGroup().location

@description('Principal (object) ID granted AcrPull on this registry.')
param pullPrincipalId string

@description('Resource tags.')
param tags object = {}

// Built-in role "AcrPull".
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, pullPrincipalId, acrPullRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

@description('Resource ID of the registry.')
output id string = registry.id

@description('Name of the registry.')
output name string = registry.name

@description('Registry login server (for example <name>.azurecr.io).')
output loginServer string = registry.properties.loginServer
