// function-app.bicep — Azure Functions (Node.js 20, consumption plan, managed identity)

@description('Location for all resources')
param location string

@description('Function App name')
param functionAppName string

@description('Storage account name (required by Azure Functions runtime)')
param storageAccountName string

@description('Azure OpenAI endpoint URL')
param openAIEndpoint string

@description('Cosmos DB endpoint URL')
param cosmosEndpoint string

@description('Application Insights instrumentation key')
param appInsightsInstrumentationKey string

@description('Auto-generated MCP access key')
@secure()
param mcpAccessKey string

// Storage account required by Azure Functions
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// Consumption plan (serverless)
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        { name: 'AZURE_OPENAI_ENDPOINT', value: openAIEndpoint }
        { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
        { name: 'AZURE_OPENAI_CHAT_DEPLOYMENT', value: 'gpt-4o-mini' }
        { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
        { name: 'COSMOS_DATABASE', value: 'secondbrain' }
        { name: 'COSMOS_CONTAINER', value: 'thoughts' }
        { name: 'MCP_ACCESS_KEY', value: mcpAccessKey }
        { name: 'DEFAULT_USER_ID', value: 'user-default' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsightsInstrumentationKey }
      ]
      cors: {
        allowedOrigins: ['https://portal.azure.com']
      }
    }
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output principalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
