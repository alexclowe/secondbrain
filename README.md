# 🧠 Second Brain (Microsoft Edition)

**Your personal AI memory. One database, one button, every AI you use.**

Second Brain is a personal knowledge system backed by Azure Cosmos DB with vector search. Capture thoughts from Microsoft Teams, search them by meaning from GitHub Copilot, VS Code, or any MCP-compatible AI. One brain. All of them.

---

## Deploy in 7 Minutes

### Step 1: Click the Button (~5 min)

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Falexclowe%2Fsecondbrain%2Fmain%2Fazuredeploy.json)

1. Click the button above → Azure Portal opens
2. Select your **Subscription** and **Resource Group** (create new: `openbrain-rg`)
3. Pick a **Region** (East US is fine)
4. Click **Review + Create** → **Create**
5. Wait 3–5 minutes ☕

> **That's it for infrastructure.** No terminal. No API keys. No environment variables. Everything is provisioned automatically with managed identity.

### Step 2: Authorize Teams (~30 sec)

1. When deployment completes, click **"Outputs"** in the Azure Portal
2. Find the **teamsAuthLink** — click it
3. Click **"Authorize"** → sign in with your Microsoft account → click **"Allow"**

> This lets the Logic App read and post messages in Teams. One OAuth click — legally required, can't be automated.

### Step 3: Connect Your AI (~1 min)

From the deployment outputs, copy the **copilotMcpConfig** value.

#### Option A: VS Code Workspace Config (Recommended)

Create a file called `.vscode/mcp.json` in any workspace:

```json
{
  "servers": {
    "openbrain": {
      "type": "http",
      "url": "https://YOUR-FUNCTION-APP.azurewebsites.net/api/mcp",
      "headers": {
        "X-MCP-Access-Key": "YOUR-ACCESS-KEY"
      }
    }
  }
}
```

Replace the URL and key with your deployment output values. GitHub Copilot Chat will automatically discover the MCP server.

#### Option B: VS Code User Settings (Available in All Workspaces)

Open VS Code Settings (JSON) and add:

```json
{
  "github.copilot.chat.mcp.servers": {
    "openbrain": {
      "type": "http",
      "url": "https://YOUR-FUNCTION-APP.azurewebsites.net/api/mcp",
      "headers": {
        "X-MCP-Access-Key": "YOUR-ACCESS-KEY"
      }
    }
  }
}
```

Open GitHub Copilot Chat and ask a question — you'll see "openbrain" in the available tools. Done.

---

## How It Works

```
Teams (#brain message)
    → Logic App (trigger)
        → Azure Function (embed + classify)
            → Cosmos DB (store with vector)

GitHub Copilot / VS Code / Any MCP Client
    → MCP Server (search by meaning)
        → Cosmos DB (vector search)
```

### Capture from Teams
Type `#brain` followed by your thought in any Teams channel. The Logic App picks it up, the Function embeds it with Azure OpenAI, extracts metadata (type, topics, people, action items), and stores everything in Cosmos DB. You get a confirmation reply in the thread.

### Search from Any AI
Your MCP server exposes 4 tools:
- **search_thoughts** — Semantic search by meaning
- **browse_recent** — Browse latest thoughts
- **brain_stats** — See your brain's statistics
- **capture_thought** — Capture directly from AI conversations

---

## What Gets Deployed

| Resource | Purpose | Monthly Cost |
|----------|---------|-------------|
| Azure Cosmos DB (serverless) | Vector database | ~$2.00 |
| Azure OpenAI (text-embedding-3-small + gpt-4o-mini) | Embeddings + metadata | ~$0.02 |
| Azure Functions (consumption) | Capture + MCP server | ~$0.00 |
| Logic App (consumption) | Teams → Function bridge | ~$0.01 |
| Application Insights | Monitoring | ~$0.00 |
| Storage Account | Function runtime | ~$0.10 |
| **Total** | | **~$2.13/month** |

Fits easily in a free-tier or pay-as-you-go Azure subscription.

---

## Test It

### From Teams
Go to any channel and type:
```
#brain This is my first thought captured by Second Brain!
```
You should see a ✅ confirmation reply within a few seconds.

### From GitHub Copilot
In VS Code, open Copilot Chat and ask: *"Search my brain for recent thoughts"* — it will use the `search_thoughts` tool automatically.

### From Command Line
```bash
curl -X POST "YOUR_MCP_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-MCP-Access-Key: YOUR_KEY" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
(Replace with values from your deployment outputs)

---

## Troubleshooting

### "Azure OpenAI is not available in this subscription"
1. Go to Azure Portal → Subscriptions → Resource Providers
2. Search for `Microsoft.CognitiveServices` → click **Register**
3. Re-deploy

### Teams capture not working
1. Check the Logic App is enabled: Azure Portal → Logic App → Overview → should say "Enabled"
2. Verify the Teams connection is authorized: Logic App → API connections → should show "Connected"
3. Check Function logs: Application Insights → Live Metrics → watch for incoming requests

### MCP not connecting
1. Verify the URL in your VS Code MCP config matches the deployment output
2. Check the access key is correct
3. Test with the curl command from deployment outputs

---

## Fallback: GitHub Models API

If Azure OpenAI isn't available in your subscription, you can use GitHub Models API (free with your GitHub Copilot license):

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token → select `models:read`
2. In Azure Portal, go to your Function App → Configuration → Application Settings
3. Add: `AI_PROVIDER` = `github` and `GITHUB_PAT` = your token
4. Save and restart the Function App

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full technical architecture, including database schema, API specifications, and design decisions.

## License

MIT
