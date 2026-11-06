metadata name = 'BigForge Container Apps environment'
metadata description = 'Container Apps managed environment on the Consumption workload profile; console and system logs go to Log Analytics.'

@description('Name of the managed environment.')
param name string

@description('Azure region.')
param location string = resourceGroup().location

@description('Name of the Log Analytics workspace (in this resource group) that receives logs.')
param logAnalyticsWorkspaceName string

@description('Resource tags.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

@description('Resource ID of the managed environment.')
output id string = environment.id

@description('Name of the managed environment.')
output name string = environment.name
