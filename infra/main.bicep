// main.bicep — Open Brain: One-Button Deploy
// Provisions everything: Cosmos DB, Azure OpenAI, Functions, Logic App, monitoring
// Zero manual secrets — managed identity everywhere

targetScope = 'resourceGroup'

@description('Azure region for all resources. Must support Azure OpenAI.')
@allowed([
  'eastus'
  'eastus2'
  'westus'
  'westus3'
  'swedencentral'
  'uksouth'
  'northcentralus'
  'southcentralus'
  'canadaeast'
  'francecentral'
])
param location string = 'eastus'

// Auto-generated unique names
var suffix = uniqueString(resourceGroup().id)
var cosmosAccountName = 'cosmos-openbrain-${suffix}'
var openAIAccountName = 'oai-openbrain-${suffix}'
var functionAppName = 'func-openbrain-${suffix}'
var logicAppName = 'logic-openbrain-${suffix}'
var storageAccountName = 'stopenbrain${suffix}'
var monitoringBaseName = 'openbrain-${suffix}'
var mcpAccessKey = uniqueString(resourceGroup().id, 'mcp-access-key')

// ─── Modules ─────────────────────────────────────────────────────────────────

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    baseName: monitoringBaseName
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    accountName: cosmosAccountName
  }
}

module openai 'modules/openai.bicep' = {
  name: 'openai'
  params: {
    location: location
    accountName: openAIAccountName
  }
}

module functionApp 'modules/function-app.bicep' = {
  name: 'functionApp'
  params: {
    location: location
    functionAppName: functionAppName
    storageAccountName: storageAccountName
    openAIEndpoint: openai.outputs.endpoint
    cosmosEndpoint: cosmos.outputs.endpoint
    appInsightsInstrumentationKey: monitoring.outputs.instrumentationKey
    mcpAccessKey: mcpAccessKey
  }
}

module logicApp 'modules/logic-app.bicep' = {
  name: 'logicApp'
  params: {
    location: location
    logicAppName: logicAppName
    captureFunctionUrl: '${functionApp.outputs.functionAppUrl}/api/capture'
  }
}

// ─── RBAC Role Assignments ───────────────────────────────────────────────────

// Cosmos DB Built-in Data Contributor role
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionApp.outputs.principalId, 'cosmos-data-contributor')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: functionApp.outputs.principalId
    scope: cosmosAccount.id
  }
  dependsOn: [cosmos, functionApp]
}

// Azure OpenAI - Cognitive Services OpenAI User role
resource openAIAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: openAIAccountName
}

resource openAIRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAIAccount.id, functionApp.outputs.principalId, 'openai-user')
  scope: openAIAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: functionApp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [openai, functionApp]
}

// ─── Deployment Outputs ──────────────────────────────────────────────────────

output functionAppUrl string = functionApp.outputs.functionAppUrl
output mcpEndpoint string = '${functionApp.outputs.functionAppUrl}/api/mcp'
output mcpAccessKey string = mcpAccessKey
output captureEndpoint string = '${functionApp.outputs.functionAppUrl}/api/capture'
output functionAppName string = functionApp.outputs.functionAppName
output teamsAuthLink string = '${environment().portal}/#blade/Microsoft.Azure.EAPortal/ApiConnectionBlade/id/${logicApp.outputs.teamsConnectionId}'

// VS Code MCP config JSON (ready to copy-paste into .vscode/mcp.json)
output copilotMcpConfig string = '{ "servers": { "openbrain": { "type": "http", "url": "${functionApp.outputs.functionAppUrl}/api/mcp", "headers": { "X-MCP-Access-Key": "${mcpAccessKey}" } } } }'

// Test command
output testCommand string = 'curl -X POST "${functionApp.outputs.functionAppUrl}/api/mcp" -H "Content-Type: application/json" -H "X-MCP-Access-Key: ${mcpAccessKey}" -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\''
