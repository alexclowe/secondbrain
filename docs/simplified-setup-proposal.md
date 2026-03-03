# One-Button Deploy — Open Brain (Microsoft Edition)

**Author:** Joy (Lead Architect)  
**Date:** 2026-03-04  
**Status:** APPROVED — Replaces previous simplified-setup-proposal  
**Requested by:** Alex Lowe  
**Alex's requirement:** "All of it — I want a single 'Deploy to Azure' button and nothing else."

---

## 1. Final Architecture Decision

### The Stack

| Component | Choice | Why |
|-----------|--------|-----|
| **AI / Embeddings** | **Azure OpenAI** (managed identity) | Zero API keys. Provisioned via Bicep. Function App authenticates via managed identity — no PAT, no secrets, fully automated. ~$0.30/month. |
| **Teams Capture** | **Azure Logic App** (Bicep-deployed) | Entire workflow defined in ARM/Bicep. Trigger on Teams message → call Function → reply in thread. Only manual step: one OAuth click to authorize Teams connector. Replaces Power Automate's 6+ manual steps. |
| **Database** | **Azure Cosmos DB** (serverless, NoSQL, DiskANN vectors) | No change from previous. Vector index provisioned in Bicep template. Zero manual portal work. |
| **Compute** | **Azure Functions** (Node.js 20, consumption plan) | No change. Managed identity gets RBAC roles to Cosmos DB and Azure OpenAI — zero connection strings in env vars. |
| **Observability** | **Application Insights** | Free tier. Auto-connected to Function App. |

### Trade-Off Justifications

**Azure OpenAI over GitHub Models API:**
- GitHub Models requires a Personal Access Token (PAT). That's a manual step: GitHub → Settings → Developer Settings → Create token → paste. Non-technical users struggle with this.
- Azure OpenAI is provisioned by Bicep. The Function App's managed identity gets `Cognitive Services OpenAI User` role. The Function calls Azure OpenAI with `DefaultAzureCredential` — zero keys, zero secrets, zero manual steps.
- Cost: ~$0.30/month for embeddings + metadata extraction (text-embedding-3-small + gpt-4o-mini). Negligible.
- Risk: Some Azure subscriptions require Azure OpenAI access approval. Fallback documented below if blocked.

**Logic Apps over Power Automate:**
- Power Automate CANNOT be deployed via Bicep/ARM. User must manually create the flow in the designer. That's 6+ steps with screenshots, prone to error.
- Logic Apps CAN be provisioned via Bicep. The entire workflow (trigger → parse → HTTP call → reply) is defined declaratively in the template. The ONLY manual step: user clicks "Authorize" on the Teams API connection in Azure Portal (one OAuth consent screen). This is legally required — no way around it.
- Logic Apps Consumption plan: ~$0.000025 per action execution. At 100 captures/month × 4 actions = $0.01/month.

**Managed Identity over Connection Strings/Keys:**
- Cosmos DB: Function App gets `Cosmos DB Built-in Data Contributor` RBAC role. No connection string needed.
- Azure OpenAI: Function App gets `Cognitive Services OpenAI User` RBAC role. No API key needed.
- MCP Access Key: Auto-generated via `uniqueString()` in Bicep. User never invents a password.
- Result: ZERO secrets to manage. Everything is identity-based.

---

## 2. Revised User Experience — 3 Steps

### What the user actually does:

| Step | Action | Where | Time |
|------|--------|-------|------|
| **1** | **Click "Deploy to Azure"** | README.md → Azure Portal | 5 min |
| **2** | **Authorize Teams** | Azure Portal deployment outputs | 30 sec |
| **3** | **Copy MCP config** | Azure Portal deployment outputs → local machine | 1 min |

**Total: ~7 minutes.** No terminal. No GitHub settings. No Power Automate designer. No VS Code.

### Step-by-Step Detail:

#### Step 1: Click "Deploy to Azure" (~5 minutes)

1. User opens the GitHub repo README
2. Clicks the **"Deploy to Azure"** button
3. Azure Portal opens with the deployment wizard pre-filled
4. User selects:
   - **Subscription** (dropdown — auto-detected)
   - **Resource Group** (create new, e.g., "openbrain-rg")
   - **Region** (dropdown, e.g., "East US")
5. Clicks **"Review + Create"** → **"Create"**
6. Waits 3-5 minutes while Azure provisions everything

That's it for infrastructure. No PAT. No connection strings. No environment variables. Bicep handles everything.

#### Step 2: Authorize Teams Connection (~30 seconds)

1. Deployment completes. User clicks **"Go to deployment outputs"**
2. Deployment outputs page shows a prominent link: **"🔗 Authorize Teams Connection"**
3. User clicks the link → Microsoft OAuth consent screen appears
4. User signs in with their Microsoft account and clicks **"Allow"**
5. Done. Logic App can now read/post Teams messages.

**Why this can't be automated:** OAuth consent requires the user to explicitly grant permission. This is a legal/security requirement. One click is the minimum possible.

#### Step 3: Copy MCP Config (~1 minute)

The deployment outputs page shows:

1. **Claude Desktop config JSON** — ready to copy-paste into `%APPDATA%\Claude\claude_desktop_config.json`
2. **MCP endpoint URL** — with the auto-generated access key embedded
3. **Test curl command** — to verify the deployment works

User copies the JSON block, pastes it into their Claude Desktop config file, restarts Claude. Done.

### Can we eliminate any steps?

- **Step 2 (Authorize Teams):** No. OAuth consent is legally required.
- **Step 3 (Copy MCP config):** No. MCP configuration lives on the user's local machine.
- **Combine Steps 2 + 3:** Yes — both are on the same deployment outputs page. The user sees them together. They feel like one step in practice.

---

## 3. Bicep Template Architecture

### Resources Provisioned

```
┌──────────────────────────────────────────────────────────────────┐
│                     Bicep Template (main.bicep)                  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Cosmos DB      │  │  Azure OpenAI   │  │  Function App   │  │
│  │   (serverless)   │  │  (S0 tier)      │  │  (consumption)  │  │
│  │                  │  │                  │  │                  │  │
│  │  DB: openbrain   │  │  text-embedding  │  │  /api/capture   │  │
│  │  Container:      │  │  -3-small       │  │  /api/mcp       │  │
│  │   thoughts       │  │  gpt-4o-mini    │  │                  │  │
│  │  Vector: DiskANN │  │                  │  │  Managed ID ──┐ │  │
│  └────────▲─────────┘  └────────▲─────────┘  └───────────────┤ │  │
│           │ RBAC                │ RBAC                        │ │  │
│           └─────────────────────┴────────────────────────────┘ │  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Logic App      │  │  App Insights   │  │  Storage Acct   │  │
│  │  (consumption)   │  │  (free tier)    │  │  (func runtime) │  │
│  │                  │  │                  │  │                  │  │
│  │  Teams trigger   │  │  Logs, metrics  │  │  Required by    │  │
│  │  → /api/capture  │  │  error alerts   │  │  Azure Functions│  │
│  │  → Teams reply   │  │                  │  │                  │  │
│  └──────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Teams API Connection (requires manual OAuth authorization) │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Detailed Resource List

#### 1. Cosmos DB — `infra/modules/cosmos.bicep`

```bicep
// API version 2024-05-15 or later — required for vectorEmbeddingPolicy
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    locations: [{ locationName: location, failoverPriority: 0 }]
    disableLocalAuth: true  // Force RBAC-only access (no connection strings)
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'openbrain'
  properties: {
    resource: { id: 'openbrain' }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'thoughts'
  properties: {
    resource: {
      id: 'thoughts'
      partitionKey: { paths: ['/userId'], kind: 'Hash' }
      indexingPolicy: {
        automatic: true
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/embedding/*' }]  // Exclude embedding from range index
        vectorIndexes: [
          {
            path: '/embedding'
            type: 'diskANN'
          }
        ]
      }
      vectorEmbeddingPolicy: {
        vectorEmbeddings: [
          {
            path: '/embedding'
            dataType: 'float32'
            dimensions: 1536
            distanceFunction: 'cosine'
          }
        ]
      }
    }
  }
}
```

**Key detail:** The `vectorEmbeddingPolicy` and `vectorIndexes` MUST be set at container creation time in the Bicep resource definition. API version `2024-05-15` or later is required. The `/embedding` path is excluded from the standard range index (`excludedPaths`) since it's only used for vector search — saves RUs on writes.

#### 2. Azure OpenAI — `infra/modules/openai.bicep`

```bicep
resource openAIAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAIAccountName
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: openAIAccountName
    publicNetworkAccess: 'Enabled'
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAIAccount
  name: 'text-embedding-3-small'
  sku: { name: 'Standard', capacity: 120 }  // 120K tokens/min
  properties: {
    model: {
      format: 'OpenAI'
      name: 'text-embedding-3-small'
      version: '1'
    }
  }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAIAccount
  name: 'gpt-4o-mini'
  sku: { name: 'Standard', capacity: 30 }  // 30K tokens/min
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
  dependsOn: [embeddingDeployment]  // Serial deployment (Azure limitation)
}
```

**Cost estimate:** At 100 captures/month + 200 searches/month:
- Embeddings: ~50K tokens/month × $0.00002/1K tokens = $0.001
- Chat completions: ~100K tokens/month × $0.00015/1K tokens = $0.015
- **Total: ~$0.02/month** (effectively free)

#### 3. Function App — `infra/modules/function-app.bicep`

```bicep
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }  // Managed identity for RBAC
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        { name: 'AZURE_OPENAI_ENDPOINT', value: openAIAccount.properties.endpoint }
        { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
        { name: 'AZURE_OPENAI_CHAT_DEPLOYMENT', value: 'gpt-4o-mini' }
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: 'openbrain' }
        { name: 'COSMOS_CONTAINER', value: 'thoughts' }
        { name: 'MCP_ACCESS_KEY', value: mcpAccessKey }
        { name: 'DEFAULT_USER_ID', value: 'user-default' }
        { name: 'AzureWebJobsStorage', value: storageConnectionString }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
      ]
    }
  }
}
```

**Note:** No `COSMOS_KEY`, no `GITHUB_PAT`, no `COSMOS_CONNECTION_STRING`. All authentication is via managed identity. The only "secret" is the auto-generated `MCP_ACCESS_KEY`.

#### 4. RBAC Role Assignments — `infra/main.bicep`

```bicep
// Function App → Cosmos DB (read/write data)
resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionApp.id, 'cosmos-contributor')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'  // Built-in Data Contributor
    principalId: functionApp.identity.principalId
    scope: cosmosAccount.id
  }
}

// Function App → Azure OpenAI (call models)
resource openAIRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openAIAccount
  name: guid(openAIAccount.id, functionApp.id, 'openai-user')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')  // Cognitive Services OpenAI User
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

#### 5. Logic App — `infra/modules/logic-app.bicep`

```bicep
// Teams API connection (shell — requires manual OAuth authorization)
resource teamsConnection 'Microsoft.Web/connections@2016-06-01' = {
  name: 'teams-connection'
  location: location
  properties: {
    displayName: 'Open Brain Teams'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'teams')
    }
  }
}

resource logicApp 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      triggers: {
        'When_a_message_is_posted_in_a_channel': {
          type: 'ApiConnectionNotification'
          inputs: {
            host: { connection: { name: '@parameters(\'$connections\')[\'teams\'][\'connectionId\']' } }
            body: {
              NotificationUrl: '@{listCallbackUrl()}'
            }
            fetch: {
              method: 'get'
              pathTemplate: { template: '/trigger/beta/teams/{teamId}/channels/{channelId}/messages' }
            }
          }
        }
      }
      actions: {
        'Check_for_brain_hashtag': {
          type: 'If'
          expression: { contains: ['@triggerBody()?[\'body\']?[\'content\']', '#brain'] }
          actions: {
            'Call_Capture_Function': {
              type: 'Http'
              inputs: {
                method: 'POST'
                uri: '${functionAppUrl}/api/capture'
                headers: { 'Content-Type': 'application/json' }
                body: {
                  userId: '@triggerBody()?[\'from\']?[\'user\']?[\'id\']'
                  content: '@triggerBody()?[\'body\']?[\'content\']'
                  source: 'teams'
                  teamsContext: {
                    teamId: '@triggerBody()?[\'channelIdentity\']?[\'teamId\']'
                    channelId: '@triggerBody()?[\'channelIdentity\']?[\'channelId\']'
                    messageId: '@triggerBody()?[\'id\']'
                    from: '@triggerBody()?[\'from\']?[\'user\']?[\'displayName\']'
                  }
                }
                authentication: { type: 'Raw', value: functionHostKey }
              }
            }
            'Reply_in_Teams': {
              type: 'ApiConnection'
              inputs: {
                host: { connection: { name: '@parameters(\'$connections\')[\'teams\'][\'connectionId\']' } }
                method: 'post'
                body: {
                  body: {
                    content: '<p>✅ <strong>Captured to Open Brain!</strong></p><p>Type: @{body(\'Call_Capture_Function\')?[\'metadata\']?[\'type\']}</p><p>Topics: @{join(body(\'Call_Capture_Function\')?[\'metadata\']?[\'topics\'], \', \')}</p>'
                    contentType: 'html'
                  }
                }
              }
              runAfter: { 'Call_Capture_Function': ['Succeeded'] }
            }
          }
        }
      }
      parameters: {
        '$connections': {
          defaultValue: {}
          type: 'Object'
        }
      }
    }
    parameters: {
      '$connections': {
        value: {
          teams: {
            connectionId: teamsConnection.id
            connectionName: 'teams-connection'
            id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'teams')
          }
        }
      }
    }
  }
}
```

**The Teams API connection is created as a "shell"** — it exists in Azure but isn't authorized yet. The deployment outputs include a link for the user to click "Authorize" and sign in with their Microsoft account. One click.

#### 6. Application Insights — `infra/modules/monitoring.bicep`

- Log Analytics workspace + Application Insights
- Auto-connected to Function App
- Free tier (5 GB/month ingestion)
- Gives users a dashboard for function errors, latency

### Deployment Outputs

```bicep
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output mcpEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/mcp'
output mcpAccessKey string = mcpAccessKey
output captureEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/capture'
output teamsAuthLink string = '${environment().portal}/#@/resource${teamsConnection.id}/edit'
output functionAppName string = functionApp.name
```

---

## 4. Code Changes Required

### 4a. New file: `functions/shared/ai-client.js` (replaces `github-models.js`)

**What changes:**
- Endpoint: `process.env.AZURE_OPENAI_ENDPOINT` (provisioned by Bicep) instead of hardcoded GitHub Models URL
- Auth: `DefaultAzureCredential` from `@azure/identity` instead of `Bearer ${GITHUB_PAT}`
- SDK: Use `@azure/openai` package instead of raw `fetch()`
- Deployment names from env vars: `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`, `AZURE_OPENAI_CHAT_DEPLOYMENT`

```javascript
// ai-client.js — Azure OpenAI client with managed identity (zero keys)
const { OpenAIClient } = require('@azure/openai');
const { DefaultAzureCredential } = require('@azure/identity');

let client = null;

function getClient() {
  if (!client) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT not set');
    client = new OpenAIClient(endpoint, new DefaultAzureCredential());
  }
  return client;
}

async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) throw new Error('Text cannot be empty');
  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';
  const result = await getClient().getEmbeddings(deployment, [text]);
  return result.data[0].embedding;  // 1536-dim array
}

async function extractMetadata(content) {
  if (!content || content.trim().length === 0) {
    return { type: 'reference', topics: [], people: [], actionItems: [], projects: [] };
  }
  try {
    const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';
    const result = await getClient().getChatCompletions(deployment, [
      { role: 'system', content: 'Extract structured metadata... (same prompt as before)' },
      { role: 'user', content }
    ], { responseFormat: { type: 'json_object' }, maxTokens: 500, temperature: 0.3 });
    const metadata = JSON.parse(result.choices[0].message.content);
    return {
      type: metadata.type || 'reference',
      topics: Array.isArray(metadata.topics) ? metadata.topics : [],
      people: Array.isArray(metadata.people) ? metadata.people : [],
      actionItems: Array.isArray(metadata.actionItems) ? metadata.actionItems : [],
      projects: Array.isArray(metadata.projects) ? metadata.projects : []
    };
  } catch (error) {
    console.error('Metadata extraction failed, using defaults:', error);
    return { type: 'reference', topics: [], people: [], actionItems: [], projects: [] };
  }
}

module.exports = { generateEmbedding, extractMetadata };
```

**Key difference:** `DefaultAzureCredential()` automatically uses the Function App's managed identity in Azure. During local development, it falls back to Azure CLI credentials (`az login`). Zero configuration either way.

### 4b. Update: `functions/shared/cosmos.js`

**What changes:**
- Auth: `DefaultAzureCredential` instead of connection string with key
- Remove `COSMOS_KEY` usage — use RBAC instead
- The `CosmosClient` accepts a `TokenCredential` as the second argument

```javascript
// cosmos.js — Updated initialization
const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

let container = null;

function getContainer() {
  if (container) return container;
  
  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE || 'openbrain';
  const containerId = process.env.COSMOS_CONTAINER || 'thoughts';
  
  if (!endpoint) throw new Error('COSMOS_ENDPOINT not set');
  
  // Managed identity auth — no keys needed
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  container = client.database(databaseId).container(containerId);
  return container;
}
// ... rest of functions unchanged
```

### 4c. Update: `functions/capture/index.js`

**What changes:**
- Import from `ai-client` instead of `github-models`
- Handle Logic App request format (Teams message body structure differs from Power Automate)
- Strip HTML tags from Teams message content
- Extract userId from Teams user object or fall back to default

```javascript
// capture/index.js — Updated imports + Logic App body parsing
const { generateEmbedding, extractMetadata } = require('../shared/ai-client');  // Changed

// Inside handler, add Logic App body normalization:
let { userId, content, source, teamsContext } = body;

// Logic App sends Teams message HTML — strip tags
if (content && content.includes('<')) {
  content = content.replace(/<[^>]*>/g, '').trim();
}

// Strip #brain hashtag from content
content = content.replace(/#brain\s*/gi, '').trim();

// Default userId if not provided
userId = userId || process.env.DEFAULT_USER_ID || 'user-default';
```

### 4d. Update: `functions/package.json`

**New dependencies:**
```json
{
  "dependencies": {
    "@azure/cosmos": "^4.0.0",
    "@azure/functions": "^4.0.0",
    "@azure/identity": "^4.0.0",
    "@azure/openai": "^2.0.0",
    "uuid": "^10.0.0"
  }
}
```

Added: `@azure/identity` (managed identity), `@azure/openai` (Azure OpenAI SDK).  
Removed: None (keep backward compat).

### 4e. Files to keep (backward compat)

- `functions/shared/github-models.js` — Keep but mark as deprecated. Fallback if user can't get Azure OpenAI access.
- `functions/shared/auth.js` — No changes. MCP access key validation stays the same.
- `functions/mcp-server/index.js` — No changes. It calls `generateEmbedding` from shared module — just update the import path.

---

## 5. "Deploy to Azure" Button Configuration

### Button in README.md

```markdown
[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2F{owner}%2Fsecondbrain%2Fmain%2Fazuredeploy.json)
```

### How it works

1. `azuredeploy.json` is compiled from `infra/main.bicep` via `az bicep build`
2. The button URL points to this JSON file on the `main` branch
3. Azure Portal renders the "Custom deployment" wizard

### Parameters the user fills in

| Parameter | Type | What user sees | Notes |
|-----------|------|----------------|-------|
| Subscription | dropdown | Auto-detected | Usually one option for MS employees |
| Resource Group | text + create new | "openbrain-rg" (suggested) | Create new recommended |
| Region | dropdown | "East US" (default) | Must support Azure OpenAI |

**That's it. Three fields.** No PAT. No secrets. No environment variables. No connection strings.

### Parameters auto-filled by the template

| Parameter | Value | Source |
|-----------|-------|--------|
| `mcpAccessKey` | `uniqueString(resourceGroup().id, 'mcp')` | Auto-generated |
| `cosmosAccountName` | `'cosmos-openbrain-${uniqueString(rg)}'` | Auto-generated |
| `functionAppName` | `'func-openbrain-${uniqueString(rg)}'` | Auto-generated |
| `openAIAccountName` | `'oai-openbrain-${uniqueString(rg)}'` | Auto-generated |
| `logicAppName` | `'logic-openbrain-${uniqueString(rg)}'` | Auto-generated |

### Region constraints

Azure OpenAI model availability varies by region. The template should default to a region where both `text-embedding-3-small` and `gpt-4o-mini` are available. As of 2026: **East US, East US 2, West US, West US 3, Sweden Central, UK South** all support both models. The template uses `allowedValues` to restrict the region dropdown to compatible regions.

---

## 6. Post-Deploy Output Page

After the deployment completes (~5 minutes), the user clicks **"Outputs"** in the Azure Portal deployment blade. They see:

---

### 🎉 Open Brain Deployed Successfully!

#### Step A: Authorize Teams Connection

Your Logic App needs permission to read and post Teams messages.

👉 **[Click here to authorize Teams](portal-link-to-teams-connection)**

Sign in with your Microsoft account and click "Allow." This takes 30 seconds.

#### Step B: Configure Your AI Assistant

Copy this JSON block into your Claude Desktop config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openbrain": {
      "transport": {
        "type": "http",
        "baseUrl": "https://func-openbrain-abc123.azurewebsites.net/api/mcp"
      },
      "headers": {
        "X-MCP-Access-Key": "a7b3c9d2e1f0"
      }
    }
  }
}
```

#### Step C: Test It

Open Teams, go to any channel, type:

```
#brain This is my first thought captured by Open Brain!
```

You should see a reply confirming the capture within a few seconds.

Or test via command line:

```bash
curl -X POST "https://func-openbrain-abc123.azurewebsites.net/api/mcp" \
  -H "Content-Type: application/json" \
  -H "X-MCP-Access-Key: a7b3c9d2e1f0" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

**Implementation note:** The deployment outputs can include formatted markdown via the `metadata` property in `outputs`. For a cleaner experience, we can also deploy a lightweight **post-deploy static page** via Azure Static Web Apps that shows these instructions with proper formatting — but the raw outputs are sufficient for v1.

---

## 7. Fallback Options

### Fallback A: Azure OpenAI Access Denied

**Symptom:** Deployment fails with "Azure OpenAI is not available in this subscription" or "Subscription not registered for Microsoft.CognitiveServices."

**Fix:**
1. User registers the resource provider: Azure Portal → Subscription → Resource providers → Search "Microsoft.CognitiveServices" → Register
2. If still blocked by enterprise policy, fall back to GitHub Models API:
   - Create a GitHub PAT with `models:read` scope
   - Set `GITHUB_PAT` in Function App environment variables
   - The codebase keeps `github-models.js` as a fallback module
   - An env var `AI_PROVIDER=github` switches the capture function to use the GitHub Models client instead of Azure OpenAI
   - This adds 1 manual step (PAT creation) but everything else stays automated

### Fallback B: Logic Apps Teams Connector Blocked

**Symptom:** The Teams API connection fails to authorize. Enterprise policy blocks Logic Apps from accessing Teams.

**Fix:**
1. Fall back to Power Automate (manual setup, 6+ steps — documented separately in `docs/setup-guide-manual.md`)
2. The capture function's `/api/capture` endpoint is the same regardless of whether Logic Apps or Power Automate calls it
3. The only code change needed: the Logic App sends a slightly different request body format with `teamsContext` — Power Automate sends the simpler `{ userId, content, source }` format. The capture function handles both.

### Fallback C: Region Doesn't Support Azure OpenAI Models

**Symptom:** Deployment succeeds but Azure OpenAI model deployments fail.

**Fix:**
1. Re-deploy to a supported region (East US, Sweden Central, etc.)
2. The template's `allowedValues` for region should prevent this, but model availability changes over time

### Fallback D: Full Manual Setup

For users where nothing automated works, the old manual guide is preserved at `docs/setup-guide-manual.md`. This is the original 13-step process. It always works because it has no automation dependencies.

---

## 8. Implementation Plan

### Phase 1: Code Changes (Anger — Backend Dev)
**Priority: Highest. Must land first — everything else depends on this.**

| Task | File | Description |
|------|------|-------------|
| Create AI client | `functions/shared/ai-client.js` | Azure OpenAI SDK + DefaultAzureCredential. Same `generateEmbedding()` and `extractMetadata()` API surface. |
| Update Cosmos client | `functions/shared/cosmos.js` | Switch from key auth to `aadCredentials: new DefaultAzureCredential()`. |
| Update capture function | `functions/capture/index.js` | Import from `ai-client`, handle Logic App body format (HTML stripping, #brain removal, teamsContext). |
| Update MCP server | `functions/mcp-server/index.js` | Import from `ai-client` instead of `github-models`. |
| Update package.json | `functions/package.json` | Add `@azure/identity`, `@azure/openai`. |
| Add provider switch | `functions/shared/ai-client.js` | Check `AI_PROVIDER` env var — if `github`, delegate to `github-models.js` (fallback). |

**Acceptance criteria:**
- `npm install` succeeds with new dependencies
- Functions work locally with `az login` credentials (DefaultAzureCredential local fallback)
- Existing `github-models.js` untouched (backward compat)

### Phase 2: Bicep Templates (Anger — Backend Dev)
**Priority: Highest (parallel with Phase 1).**

| Task | File | Description |
|------|------|-------------|
| Cosmos module | `infra/modules/cosmos.bicep` | Serverless account, database, container with vector index policy |
| OpenAI module | `infra/modules/openai.bicep` | S0 account, embedding + chat model deployments |
| Function App module | `infra/modules/function-app.bicep` | Consumption plan, managed identity, all app settings |
| Logic App module | `infra/modules/logic-app.bicep` | Teams trigger → HTTP → Teams reply workflow |
| Monitoring module | `infra/modules/monitoring.bicep` | App Insights + Log Analytics |
| Orchestrator | `infra/main.bicep` | Wire modules together, RBAC role assignments, outputs |
| Parameters | `infra/main.parameters.json` | Defaults for region, naming |

**Acceptance criteria:**
- `az deployment group create` from scratch provisions all resources
- Function App managed identity has Cosmos + OpenAI RBAC roles
- Logic App workflow definition is valid (passes ARM validation)
- Deployment outputs include all URLs and the MCP access key

### Phase 3: Deploy Button (Fear — Integration Dev)
**Priority: High — this IS the "one button."**

| Task | File | Description |
|------|------|-------------|
| Compile ARM template | `azuredeploy.json` | `az bicep build` from `infra/main.bicep` |
| README button | `README.md` | Deploy to Azure badge with encoded URL |
| Deploy output formatting | `infra/main.bicep` outputs | Teams auth link, MCP config JSON, test curl command |
| Region allowedValues | `infra/main.bicep` | Restrict to Azure OpenAI-supported regions |

**Acceptance criteria:**
- Clicking button in README opens Azure Portal with 3-field wizard
- Deployment completes in under 8 minutes
- Outputs page shows clear instructions for Teams auth + MCP config
- End-to-end works: Deploy → Authorize Teams → Capture → Search via MCP

### Phase 4: Documentation (Sadness — DevRel)
**Priority: High — depends on Phases 1-3.**

| Task | File | Description |
|------|------|-------------|
| Rewrite setup guide | `docs/setup-guide.md` | New 3-step guide (Deploy → Authorize Teams → Copy MCP config) |
| Archive old guide | `docs/setup-guide-manual.md` | Preserve 13-step manual process as fallback |
| Update README | `README.md` | Hero section: "Deploy in 7 minutes" with single button |
| Troubleshooting | `docs/troubleshooting.md` | Azure OpenAI access issues, Logic App auth failures |

**Acceptance criteria:**
- Setup guide has exactly 3 main steps
- Screenshots for each step
- Fallback paths documented
- Old guide preserved for edge cases

### Phase 5: QA & End-to-End Testing (Bing Bong — QA)
**Priority: Required before merge.**

| Task | Description |
|------|-------------|
| Fresh deploy test | Click Deploy button from a clean Azure subscription |
| Teams capture test | Send `#brain` message → see confirmation reply |
| MCP search test | Claude Desktop connects → search returns results |
| Fallback: GitHub Models | Set `AI_PROVIDER=github`, verify PAT-based flow works |
| Fallback: Power Automate | Disable Logic App, set up Power Automate manually, verify capture |
| Teardown test | Delete resource group, verify clean removal |
| Cost verification | Check Azure Cost Analysis after 24h — should be <$1 |

---

## Cost Summary (Updated)

| Resource | Monthly Cost |
|----------|-------------|
| Cosmos DB (serverless, ~7K RUs) | $2.00 |
| Azure OpenAI (embeddings + chat) | $0.02 |
| Azure Functions (consumption) | $0.00 |
| Logic Apps (consumption, ~400 actions) | $0.01 |
| Application Insights (free tier) | $0.00 |
| Storage Account (Function runtime) | $0.10 |
| **Total** | **~$2.13/month** |

Well under typical Azure budgets. Heavy usage (500 captures, 1000 searches): ~$12/month.

---

## Decision Summary

| Decision | Choice | Alternative | Why |
|----------|--------|-------------|-----|
| AI provider | Azure OpenAI (managed identity) | GitHub Models (PAT) | Zero manual steps. No PAT creation. $0.02/month is negligible. |
| Teams integration | Logic Apps (Bicep-deployed) | Power Automate (manual) | One OAuth click vs. 6+ manual steps. Fully automatable. |
| Authentication | Managed identity everywhere | Connection strings + API keys | Zero secrets to manage. RBAC roles provisioned in Bicep. |
| Deploy method | "Deploy to Azure" button (primary) | `azd up` via Codespaces | Button = zero terminal. Codespaces kept as developer option. |
| MCP access key | Auto-generated `uniqueString()` | User-created | User never invents a password. |
| Cosmos DB vector index | Bicep `vectorEmbeddingPolicy` | Manual portal creation | API version 2024-05-15 supports it. Zero portal work. |
| Region | Restricted to Azure OpenAI regions | Any region | Prevents deployment failures from model unavailability. |
| Fallback AI | GitHub Models (env var switch) | None | Safety net for subscriptions without Azure OpenAI access. |

---

## What Changed from Previous Proposal

| Aspect | Previous (v1) | This proposal (v2) |
|--------|---------------|---------------------|
| Steps | 4 (PAT → azd up → Power Automate → MCP config) | **3** (Deploy → Authorize Teams → Copy MCP) |
| GitHub PAT | Required (manual) | **Eliminated** (Azure OpenAI + managed identity) |
| Power Automate | Manual setup (6+ steps) | **Eliminated** (Logic Apps via Bicep) |
| Primary deploy | `azd up` in Codespaces | **"Deploy to Azure" button** (zero terminal) |
| Secrets managed | 1 (GitHub PAT) + auto-generated | **0 manual** + auto-generated MCP key |
| AI provider | GitHub Models API (free) | Azure OpenAI (~$0.02/month) |
| Cosmos DB auth | Connection string | **Managed identity** (RBAC) |
| Teams capture | Power Automate (user-built) | **Logic App** (Bicep-deployed) |

The net effect: We went from "4 steps including one that takes 5 minutes of clicking through Power Automate" to "3 steps where the hardest one is clicking a single OAuth consent button."

Alex asked for one button. We delivered one button + two mandatory follow-up clicks (Teams OAuth + MCP paste). That's the physical minimum.
