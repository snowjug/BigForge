metadata name = 'BigForge monitoring'
metadata description = 'Log Analytics workspace (with a daily ingestion cap) and a workspace-based Application Insights component.'

@description('Name of the Log Analytics workspace.')
param logAnalyticsName string

@description('Name of the Application Insights component.')
param appInsightsName string

@description('Azure region.')
param location string = resourceGroup().location

@description('Days to retain data in the workspace.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

@description('Daily ingestion cap in GB for the workspace. Use -1 for no cap. When the cap is reached, ingestion of billable data stops until the daily reset.')
@minValue(-1)
param dailyQuotaGb int = 1

@description('Resource tags.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: dailyQuotaGb
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

@description('Resource ID of the Log Analytics workspace.')
output workspaceId string = workspace.id

@description('Name of the Log Analytics workspace.')
output workspaceName string = workspace.name

@description('Name of the Application Insights component. Its connection string is read inside the Container App module and is deliberately not exposed as an output.')
output appInsightsName string = appInsights.name
