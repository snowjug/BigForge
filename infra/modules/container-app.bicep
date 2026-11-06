metadata name = 'BigForge Container App'
metadata description = 'The BigForge API and web UI as a single Container App (0.5 vCPU, 1 GiB, min 0 / max 1 replica). State is a single-node SQLite database, so the replica count must never exceed one.'

@description('Name of the Container App (2-32 characters).')
@minLength(2)
@maxLength(32)
param name string

@description('Azure region.')
param location string = resourceGroup().location

@description('Resource ID of the Container Apps managed environment.')
param environmentId string

@description('Resource ID of the user-assigned managed identity (registry pull, Key Vault read, Azure OpenAI).')
param identityId string

@description('Client ID of the user-assigned managed identity.')
param identityClientId string

@description('Fully qualified container image, for example <registry>.azurecr.io/bigforge:<tag>.')
param containerImage string

@description('Login server of the registry that hosts the image. The identity pulls with AcrPull; the admin user is not used.')
param registryLoginServer string

@description('Key Vault data-plane URI, ending in a slash.')
param keyVaultUri string

@description('Name of the Key Vault secret that holds the value of BIGFORGE_SESSION_SECRET.')
param sessionSecretName string

@description('Name of the Application Insights component in this resource group.')
param appInsightsName string

@description('Value of BIGFORGE_MODE.')
@allowed([
  'demo'
  'production'
])
param appMode string = 'demo'

@description('Minimum replicas. 0 lets the app scale to zero when idle; the ephemeral SQLite database is lost whenever the replica is removed.')
@allowed([
  0
  1
])
param minReplicas int = 0

@description('Value of OTEL_EXPORTER_OTLP_ENDPOINT. Empty leaves the variable unset.')
param otlpEndpoint string = ''

@description('Azure OpenAI endpoint. Empty leaves the live provider unconfigured.')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI deployment name (AZURE_OPENAI_DEPLOYMENT). Only used when an endpoint is set.')
param azureOpenAiDeployment string = ''

@description('Azure OpenAI data-plane API version (AZURE_OPENAI_API_VERSION). Only used when an endpoint is set.')
param azureOpenAiApiVersion string = '2024-10-21'

@description('Resource tags.')
param tags object = {}

var targetPort = 4747

// SQLite is a single-node store: more than one replica would give each replica its own
// divergent database (or, on shared storage, corrupt one). Intentionally not a parameter.
var maxReplicas = 1

// Lives on the replica's ephemeral storage; see docs/AZURE.md "Limitations".
var dataDir = '/app/data'

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

var coreEnv = [
  {
    name: 'PORT'
    value: string(targetPort)
  }
  {
    name: 'HOST'
    value: '0.0.0.0'
  }
  {
    name: 'BIGFORGE_MODE'
    value: appMode
  }
  {
    name: 'BIGFORGE_DATA_DIR'
    value: dataDir
  }
  {
    name: 'BIGFORGE_SESSION_SECRET'
    secretRef: 'session-secret'
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    secretRef: 'appinsights-connection-string'
  }
]

var otlpEnv = empty(otlpEndpoint)
  ? []
  : [
      {
        name: 'OTEL_EXPORTER_OTLP_ENDPOINT'
        value: otlpEndpoint
      }
    ]

var azureOpenAiEnv = empty(azureOpenAiEndpoint)
  ? []
  : [
      {
        name: 'BIGFORGE_LIVE_PROVIDER'
        value: 'azure-openai'
      }
      {
        name: 'AZURE_OPENAI_ENDPOINT'
        value: azureOpenAiEndpoint
      }
      {
        name: 'AZURE_OPENAI_DEPLOYMENT'
        value: azureOpenAiDeployment
      }
      {
        name: 'AZURE_OPENAI_API_VERSION'
        value: azureOpenAiApiVersion
      }
      {
        name: 'AZURE_OPENAI_AUTH'
        value: 'entra'
      }
      {
        name: 'AZURE_CLIENT_ID'
        value: identityClientId
      }
    ]

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
      secrets: [
        {
          name: 'session-secret'
          keyVaultUrl: '${keyVaultUri}secrets/${sessionSecretName}'
          identity: identityId
        }
        {
          name: 'appinsights-connection-string'
          value: appInsights.properties.ConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'bigforge'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(coreEnv, otlpEnv, azureOpenAiEnv)
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/ready'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
              successThreshold: 1
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-requests'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

@description('Resource ID of the Container App.')
output id string = app.id

@description('Name of the Container App.')
output name string = app.name

@description('Public fully qualified domain name of the app (HTTPS only).')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('Name of the latest revision.')
output latestRevisionName string = app.properties.latestRevisionName
