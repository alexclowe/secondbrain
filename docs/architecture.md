# Second Brain (Microsoft Edition) — Architecture

**Version:** 1.0  
**Last Updated:** 2025-01-19  
**Author:** Joy (Lead Architect)

## Executive Summary

This architecture ports the original Supabase/Slack/OpenRouter Second Brain system to an Azure-native stack. Total estimated monthly cost: **$2-12**. All components use Azure Portal or browser-based setup — no CLI required.

---

## Component Mapping

| Original (Supabase) | Microsoft Edition | Why |
|---------------------|-------------------|-----|
| **PostgreSQL + pgvector** | **Azure Cosmos DB for NoSQL** (with DiskANN vector indexing) | Native vector search in GA, serverless pricing ($0.285/million RUs), JSON document model, browser-based portal setup, 43x cheaper than alternatives |
| **match_thoughts SQL function** | **Cosmos DB vector query** (VectorDistance in WHERE clause) | Native SDK support, no custom functions needed, same cosine distance algorithm |
| **Supabase Edge Functions** | **Azure Functions** (Node.js, consumption plan) | Serverless HTTP triggers, VS Code one-click deploy, $0.20 per million executions, first 1M free |
| **OpenRouter text-embedding-3-small** | **GitHub Models API** (text-embedding-3-small via Azure endpoint) | Free for GitHub users, same 1536-dim embeddings, requires GitHub PAT |
| **OpenRouter gpt-4o-mini** | **GitHub Models API** (gpt-4o or gpt-4o-mini) | Free via GitHub account, same structured extraction capabilities |
| **Slack bot** | **Power Automate Flow** (Teams webhook trigger) | No-code browser setup, official Microsoft migration path (Slack webhooks deprecated), posts to Teams channel |
| **Supabase Row Level Security** | **Azure Function App Keys** + connection string security | Function-level keys (host key for MCP, function key per endpoint), Cosmos connection string in Azure Key Vault optional |
| **MCP Server on Edge Functions** | **MCP Server on Azure Function** (HTTP trigger with Streamable transport) | Same protocol, HTTP/SSE transport, accessible from VS Code/GitHub Copilot |

---

## Database Design

### Azure Cosmos DB for NoSQL — "thoughts" Container

**Why Cosmos DB NoSQL over alternatives:**
- **Azure SQL + pg_vector:** Requires server provisioning, more expensive for sporadic access, complex vector extension setup
- **Azure AI Search:** Designed for full-text search first, vectors secondary; higher minimum cost (~$75/month)
- **Cosmos DB NoSQL:** Native vector support with DiskANN (GA as of late 2024), serverless model charges only for operations consumed, portal-based setup, JSON document flexibility

**Container Configuration:**
- **Database:** `secondbrain`
- **Container:** `thoughts`
- **Partition Key:** `/userId` (enables multi-user future extension; single user uses same value for all documents)
- **Indexing Policy:**
  - Automatic indexing for all properties (default)
  - **Vector indexing policy:**
    ```json
    {
      "vectorIndexes": [
        {
          "path": "/embedding",
          "type": "diskANN"
        }
      ]
    }
    ```
  - DiskANN configuration: quantization=SQ8, 50 centroids (suitable for <100k documents)

**Document Schema:**
```json
{
  "id": "UUID-v4",
  "userId": "user-alex",
  "content": "The actual thought text...",
  "embedding": [0.123, -0.456, ...],  // 1536-dim float array
  "metadata": {
    "type": "idea | question | todo | reference | meeting_note",
    "topics": ["engineering", "ai"],
    "people": ["Alice", "Bob"],
    "actionItems": ["Follow up on PR #123"],
    "projects": ["secondbrain"]
  },
  "source": "teams | manual | api",
  "createdAt": "2025-01-19T10:30:00Z",
  "updatedAt": "2025-01-19T10:30:00Z"
}
```

**Vector Search Query Pattern:**
```javascript
// Using Cosmos DB Node.js SDK v4
const { VectorDistance } = require('@azure/cosmos');

const querySpec = {
  query: `SELECT c.id, c.content, c.metadata, c.createdAt, 
          VectorDistance(c.embedding, @embedding) AS similarity
          FROM c
          WHERE VectorDistance(c.embedding, @embedding) < @threshold
          ORDER BY VectorDistance(c.embedding, @embedding)
          OFFSET 0 LIMIT @limit`,
  parameters: [
    { name: "@embedding", value: queryEmbedding },  // 1536-dim array
    { name: "@threshold", value: 0.3 },  // Cosine distance < 0.3 = similar
    { name: "@limit", value: 10 }
  ]
};
```

**Cost Estimate:**
- Storage: ~$0.25/GB/month (expect <1GB for 10k thoughts = $0.25/month)
- RU consumption:
  - Insert with embedding: ~10 RUs per document
  - Vector search: ~20-50 RUs per query (varies by result set)
  - Monthly estimate (100 thoughts, 200 searches): ~7,000 RUs = **$2/month**

---

## Azure Functions Design

**Deployment Model:** VS Code Azure Functions extension (one-click publish from local dev)  
**Runtime:** Node.js 20 LTS  
**Hosting Plan:** Consumption (pay per execution)  
**Region:** Same as Cosmos DB (e.g., East US) to reduce latency

### Function App Structure

```
secondbrain-functions/
├── capture/
│   └── index.js          // HTTP trigger for Teams → Cosmos
├── mcp-server/
│   └── index.js          // HTTP trigger for MCP protocol
├── shared/
│   ├── cosmos.js         // Cosmos DB client + vector search helpers
│   ├── github-models.js  // GitHub Models API client (embeddings + LLM)
│   └── auth.js           // Function key validation
├── host.json             // Function app config
├── package.json
└── local.settings.json   // Environment variables (not committed)
```

### Function 1: `/api/capture` (Teams Capture)

**Trigger:** HTTP POST  
**Auth:** Function-level key (passed by Power Automate)  
**Input:** `{ userId, content, source }`  
**Logic:**
1. Validate function key
2. Generate embedding via GitHub Models API (text-embedding-3-small)
3. Generate metadata via GitHub Models API (gpt-4o-mini) — prompt: "Extract type, topics, people, action items, projects from: {content}"
4. Insert document into Cosmos DB `thoughts` container
5. Return: `{ id, message: "Captured!", topics, type }`

**Response to Teams:** Power Automate receives JSON and posts adaptive card reply

**RU Estimate:** ~10 RUs per capture (1 insert + metadata indexing)

### Function 2: `/api/mcp` (MCP Server)

**Trigger:** HTTP POST (SSE transport for streaming)  
**Auth:** Custom header `X-MCP-Access-Key` (user sets in VS Code MCP config)  
**Protocol:** MCP Streamable HTTP (Server-Sent Events)

**MCP Tools Implemented:**

1. **`search_thoughts`**
   - Input: `{ query: string, limit?: number }`
   - Logic: Generate embedding → VectorDistance query → return matches
   - Output: Array of `{ id, content, similarity, metadata, createdAt }`

2. **`browse_recent`**
   - Input: `{ limit?: number, filter?: { type, topics } }`
   - Logic: Query Cosmos with ORDER BY createdAt DESC + optional WHERE filters
   - Output: Array of thoughts sorted by recency

3. **`brain_stats`**
   - Input: None
   - Logic: Aggregate queries (COUNT by type, topics histogram, storage size)
   - Output: `{ totalThoughts, byType: {...}, topTopics: [...], storageGB }`

4. **`capture_thought`**
   - Input: `{ content: string, source?: string }`
   - Logic: Same as `/api/capture` but called from Copilot/VS Code
   - Output: `{ id, message, metadata }`

**RU Estimate per tool:**
- `search_thoughts`: ~30 RUs (vector query)
- `browse_recent`: ~5 RUs (index scan)
- `brain_stats`: ~10 RUs (aggregate)
- `capture_thought`: ~10 RUs (insert)

**Expected monthly usage:** 200 searches + 100 captures + 50 browse = **8,000 RUs = $2.30**

---

## Teams Integration Design

**Decision: Power Automate Flow** (not outgoing webhook)

**Why:**
- Microsoft deprecated legacy Teams webhooks; Power Automate is the official migration path (2024-2025)
- No-code setup in browser (perfect for non-technical users)
- Native Azure Functions connector (no custom HTTP handling)
- Can post rich adaptive cards (outgoing webhooks cannot)

**Flow Design: "Capture Thought to Second Brain"**

**Trigger:** "When a new channel message is posted" (Teams connector)  
**Condition:** Message contains specific hashtag (e.g., `#brain` or `#capture`)  
**Actions:**
1. **Parse message content** (remove hashtag, trim whitespace)
2. **HTTP POST to Azure Function** `/api/capture`
   - Method: POST
   - URI: `https://<function-app>.azurewebsites.net/api/capture?code=<function-key>`
   - Headers: `Content-Type: application/json`
   - Body: 
     ```json
     {
       "userId": "@{triggerOutputs()?['body/from/user/id']}",
       "content": "@{triggerOutputs()?['body/body/content']}",
       "source": "teams"
     }
     ```
3. **Parse JSON response** from function
4. **Post adaptive card reply** in Teams thread:
   ```json
   {
     "type": "AdaptiveCard",
     "body": [
       { "type": "TextBlock", "text": "✅ Captured to Second Brain!", "weight": "Bolder" },
       { "type": "TextBlock", "text": "Type: @{outputs('Parse_JSON')?['metadata']['type']}" },
       { "type": "TextBlock", "text": "Topics: @{join(outputs('Parse_JSON')?['metadata']['topics'], ', ')}" }
     ]
   }
   ```

**Permissions Needed:**
- Flow creator must have Teams channel access (read messages, post replies)
- Function key stored in Power Automate secure parameter (not visible in flow UI)

**Alternative for Advanced Users:** Bot Framework (requires app registration, more code) — NOT recommended for non-technical audience.

---

## GitHub Models API Integration

**Decision:** Use GitHub Models API via Azure OpenAI-compatible endpoint (free for GitHub users)

**Endpoint:** `https://models.inference.ai.azure.com`  
**Auth:** GitHub Personal Access Token (PAT) with `models:read` scope

**Creating GitHub PAT:**
1. GitHub.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Select: `All repositories` or specific repo (doesn't matter, just need account access)
3. Permissions: `Account permissions` → `GitHub Models: Read-only`
4. Generate token → Copy (treat like password)

### Embeddings API

**Model:** `text-embedding-3-small` (1536 dimensions)

**Request:**
```javascript
const response = await fetch('https://models.inference.ai.azure.com/embeddings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${GITHUB_PAT}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'text-embedding-3-small',
    input: 'Your text to embed here...'
  })
});

const { data } = await response.json();
const embedding = data[0].embedding;  // 1536-dim array
```

**Rate Limits:** Free tier = 15 requests/minute (sufficient for personal use)  
**Cost:** Free

### Chat Completions API (Metadata Extraction)

**Model:** `gpt-4o-mini` (fast, cheap for structured extraction)

**Request:**
```javascript
const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${GITHUB_PAT}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Extract structured metadata from user thoughts. Return JSON: { type: "idea|question|todo|reference|meeting_note", topics: string[], people: string[], actionItems: string[], projects: string[] }'
      },
      {
        role: 'user',
        content: thoughtContent
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500
  })
});

const metadata = JSON.parse(response.choices[0].message.content);
```

**Rate Limits:** 15 req/min (free tier)  
**Cost:** Free

---

## MCP Server Design

**MCP Protocol Version:** 2024-11-05  
**Transport:** Streamable HTTP (Server-Sent Events over HTTPS)  
**Hosting:** Azure Function with HTTP trigger at `/api/mcp`

### Configuration for GitHub Copilot (VS Code)

**File:** `.vscode/mcp.json` in any workspace, or add to VS Code User Settings under `github.copilot.chat.mcp.servers`

```json
{
  "mcpServers": {
    "secondbrain": {
      "transport": {
        "type": "http",
        "baseUrl": "https://<your-function-app>.azurewebsites.net/api/mcp"
      },
      "headers": {
        "X-MCP-Access-Key": "<your-custom-secret>"
      }
    }
  }
}
```

### Auth Strategy

**Decision:** Custom access key (not function keys) for user control

**Why:**
- Function host keys are admin-level (full access to all functions)
- Function-specific keys are managed in Azure Portal (not user-friendly)
- Custom access key allows users to rotate without touching Azure

**Implementation:**
1. User sets `MCP_ACCESS_KEY` environment variable in Function App settings (portal)
2. Function validates `X-MCP-Access-Key` header matches environment variable
3. If invalid → 401 Unauthorized

**For production (optional):** Store key in Azure Key Vault, reference in Function App

### MCP Tools Schema

```typescript
{
  name: "search_thoughts",
  description: "Semantic search across your captured thoughts using vector similarity",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query" },
      limit: { type: "number", default: 10, description: "Max results" },
      filter: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["idea", "question", "todo", "reference", "meeting_note"] },
          topics: { type: "array", items: { type: "string" } }
        }
      }
    },
    required: ["query"]
  }
}
```

*Similar schemas for `browse_recent`, `brain_stats`, `capture_thought`*

---

## Cost Estimate

### Azure Cosmos DB for NoSQL (Serverless)

| Usage | RUs/Month | Cost |
|-------|-----------|------|
| Storage (1GB) | N/A | $0.25 |
| 100 captures @ 10 RUs | 1,000 | $0.29 |
| 200 searches @ 30 RUs | 6,000 | $1.71 |
| 50 browse @ 5 RUs | 250 | $0.07 |
| 20 stats @ 10 RUs | 200 | $0.06 |
| **Subtotal** | **7,450 RUs** | **$2.38** |

*(Pricing: $0.285 per million RUs = $0.000000285 per RU)*

### Azure Functions (Consumption Plan)

| Usage | Executions/Month | Cost |
|-------|------------------|------|
| Capture function | 100 | Free (under 1M) |
| MCP server | 270 | Free (under 1M) |
| **Subtotal** | **370** | **$0.00** |

*(First 1 million executions free; $0.20 per million after)*

### GitHub Models API

| Service | Usage | Cost |
|---------|-------|------|
| text-embedding-3-small | 370 requests/month | **Free** |
| gpt-4o-mini | 100 requests/month | **Free** |

*(Free tier: 15 req/min per user)*

### Power Automate

| Plan | Cost |
|------|------|
| Standard connectors (Teams, HTTP) | **Free** (included with Microsoft 365) |

### **Total Estimated Monthly Cost**

**$2.38 - $5.00** (depending on usage)

- Base case (100 captures, 200 searches): **$2.38/month**
- Heavy use (500 captures, 1000 searches): **$15/month**
- **Low cost** with room for 10-100x growth

---

## File Structure

```
secondbrain/                    # Repository root
├── docs/
│   ├── architecture.md         # This file
│   ├── setup-guide.md          # Step-by-step user instructions (to be created)
│   └── troubleshooting.md      # Common issues (to be created)
├── functions/
│   ├── capture/
│   │   └── index.js            # Capture function handler
│   ├── mcp-server/
│   │   └── index.js            # MCP server handler
│   ├── shared/
│   │   ├── cosmos.js           # Cosmos DB client + queries
│   │   ├── github-models.js    # GitHub Models API client
│   │   └── auth.js             # Function key validation
│   ├── host.json               # Function app runtime config
│   ├── package.json            # Dependencies
│   ├── .funcignore             # Files to exclude from deployment
│   └── local.settings.json     # Local dev environment vars (gitignored)
├── power-automate/
│   └── flow-template.json      # Power Automate flow export (for import)
├── .squad/                     # Team coordination (not deployed)
├── .gitignore
└── README.md                   # Quick start + link to setup guide
```

**Key Files to Create:**
1. `functions/` — All Azure Function code
2. `docs/setup-guide.md` — Step-by-step walkthrough for non-technical users
3. `power-automate/flow-template.json` — Importable Teams flow
4. `README.md` — Overview + "Click here to get started"

---

## Design Principles

1. **Portal-First:** All Azure setup via browser (no CLI required)
2. **Copy-Paste Friendly:** Code blocks ready to paste into Azure Portal inline editor or VS Code
3. **Fail-Safe Defaults:** Serverless = no servers to crash; auto-scaling handles spikes
4. **Cost Transparency:** Serverless pricing = pay only for actual usage, not reserved capacity
5. **Incremental Complexity:** Start with Teams capture only; add MCP later; add multi-user later
6. **Microsoft-Native:** Prefer Microsoft products (Teams > Slack, Azure > AWS, Power Automate > Zapier)

---

## Implementation Phases

### Phase 1: Database + Capture (MVP)
- Create Cosmos DB account + container (portal)
- Deploy Azure Function for `/api/capture` (VS Code)
- Create Power Automate flow for Teams → Function
- **Deliverable:** Users can type `#brain <thought>` in Teams and see confirmation

### Phase 2: MCP Server
- Implement `/api/mcp` function with 4 tools
- Configure GitHub Copilot in VS Code to connect
- **Deliverable:** GitHub Copilot can search/browse thoughts via MCP

### Phase 3: Documentation
- Write `docs/setup-guide.md` with screenshots
- Create video walkthrough (optional)
- Export Power Automate flow template
- **Deliverable:** Non-technical user can reproduce entire system in 2 hours

### Phase 4: Enhancements (Post-MVP)
- Multi-user support (partition key = userId)
- Web dashboard (Azure Static Web Apps)
- Backup/export (Azure Function timer trigger → Blob Storage)
- Advanced metadata extraction (extract dates, links, sentiment)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| GitHub Models API rate limits (15 req/min) | Personal use stays under limit; batch operations if needed |
| Cosmos DB RU spikes | Serverless auto-scales; set budget alert in Azure Portal at $10/month |
| Power Automate flow breaks | Export flow as backup; documentation includes rebuild steps |
| Vector search accuracy | Start with cosine distance threshold 0.3; tune based on user feedback |
| User loses GitHub PAT | Document regeneration steps; PAT stored in Azure Function env vars only |
| Azure Function cold start latency | Consumption plan = 1-3s cold start (acceptable for async capture) |

---

## Security Considerations

1. **Secrets Management:**
   - GitHub PAT: Stored in Azure Function App Settings (encrypted at rest)
   - Cosmos connection string: Auto-generated, stored in Function App config
   - MCP access key: User-defined env var (no hardcoding)

2. **Network Security:**
   - Cosmos DB: Firewall allows Azure services only (no public internet)
   - Azure Functions: HTTPS only (HTTP disabled)
   - Power Automate: Runs in Microsoft 365 tenant (no external data flow)

3. **Data Privacy:**
   - Thoughts stored in user's Azure tenant (not shared infra)
   - No telemetry sent to third parties
   - Optional: Enable Cosmos DB encryption with customer-managed keys

4. **Access Control:**
   - Cosmos: No public access (connection string required)
   - Functions: Key-based auth per endpoint
   - MCP: Custom access key (separate from Function keys)

---

## Future Enhancements

1. **Multi-User Support:** Partition by userId, add Azure AD auth
2. **Rich Metadata:** Extract URLs, dates, sentiment, categories beyond topics
3. **Recurring Summaries:** Timer-triggered function emails weekly digest
4. **Web UI:** Static site (Azure SWA) for browsing/editing thoughts
5. **Mobile Capture:** Teams mobile app works out-of-box; could add Outlook integration
6. **Advanced Search:** Hybrid search (vector + full-text) using Cosmos DB's new capabilities

---

## Decision Log

**2025-01-19 — Joy (Lead Architect)**

1. **Cosmos DB NoSQL over Azure SQL:** Native vector search in GA, 43x cheaper for this use case, serverless pricing model perfect for personal use, no server provisioning.

2. **Power Automate over Outgoing Webhooks:** Microsoft's official migration path (webhooks deprecated), no-code setup, richer adaptive cards, better security.

3. **GitHub Models API over Azure OpenAI:** Free for GitHub users, same models, no additional Azure spend.

4. **Consumption Plan over App Service Plan:** Pay-per-execution aligns with sporadic personal use; first 1M executions free = $0 cost for MVP.

5. **Custom Access Key over Function Keys for MCP:** User-controlled rotation, simpler mental model for non-technical users, doesn't expose Azure Portal.

6. **VS Code Deployment over Portal/CLI:** Best balance of "no-code" (GUI-based) and version control (git-backed); non-technical users can follow screenshots.

---

**Next Steps:** Backend team implements functions/, integration team builds Power Automate flow, documentation team writes setup guide.
