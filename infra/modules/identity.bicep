metadata name = 'BigForge workload identity'
metadata description = 'User-assigned managed identity shared by the Container App for registry pull, Key Vault secret reads and (optionally) Azure OpenAI.'

@description('Name of the user-assigned managed identity.')
param name string

@description('Azure region.')
param location string = resourceGroup().location

@description('Resource tags.')
param tags object = {}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: name
  location: location
  tags: tags
}

@description('Resource ID of the identity.')
output id string = identity.id

@description('Name of the identity.')
output name string = identity.name

@description('Object (principal) ID, used as the principal of role assignments.')
output principalId string = identity.properties.principalId

@description('Client ID, exposed to the app as AZURE_CLIENT_ID so DefaultAzureCredential selects this identity.')
output clientId string = identity.properties.clientId
