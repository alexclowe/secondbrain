# Open Brain: Setup Guide (Microsoft Edition)

## 3 Steps. 7 Minutes. Zero Coding.

> **For the manual 13-step process** (if the Deploy button doesn't work for you), see [setup-guide-manual.md](setup-guide-manual.md).

---

## What You Need

| Requirement | Where to Get It |
|-------------|----------------|
| Azure subscription | [azure.microsoft.com](https://azure.microsoft.com) (free tier works) |
| GitHub Copilot license | Your Microsoft account |
| Microsoft Teams | Included in Microsoft 365 |

**Cost:** ~$2.13/month on Azure pay-as-you-go.

---

## Step 1: Deploy to Azure (~5 minutes)

Click this button to deploy everything automatically:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Falexclowe%2Fsecondbrain%2Fmain%2Fazuredeploy.json)

The Azure Portal opens with a deployment form. You fill in **3 fields**:

| Field | What to Enter |
|-------|--------------|
| **Subscription** | Select your Azure subscription (usually auto-detected) |
| **Resource Group** | Click "Create new" → type `openbrain-rg` |
| **Region** | Pick `East US` (or any region in the dropdown) |

Click **"Review + Create"** → **"Create"**.

Wait 3–5 minutes while Azure provisions:
- ✅ Azure Cosmos DB with vector search
- ✅ Azure OpenAI (text-embedding-3-small + gpt-4o-mini)
- ✅ Azure Functions (capture + MCP server)
- ✅ Logic App (Teams integration)
- ✅ Application Insights (monitoring)
- ✅ All security (managed identity, RBAC roles)

**No API keys are created.** Everything authenticates via Azure managed identity — the Function App gets automatic access to Cosmos DB and Azure OpenAI with zero secrets.

---

## Step 2: Authorize Teams (~30 seconds)

When the deployment finishes:

1. Click **"Go to resource group"** (or click **"Outputs"** in the deployment blade)
2. Find the output called **teamsAuthLink** — click its URL
3. The Azure Portal opens the Teams API connection
4. Click **"Authorize"** → Microsoft sign-in appears
5. Sign in with your Microsoft account → click **"Allow"**

**Done.** The Logic App can now listen for `#brain` messages in your Teams channels.

> **Why this step can't be automated:** OAuth consent requires you to explicitly grant permission. It's a legal/security requirement. One click is the minimum possible.

---

## Step 3: Connect Your AI (~1 minute)

Go back to your deployment outputs (Resource Group → Deployments → your deployment → Outputs).

### For Claude Desktop

1. Copy the **claudeDesktopConfig** output value
2. Open your Claude Desktop config file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Paste the JSON into the file (if the file already has content, merge the `mcpServers` section)
4. Restart Claude Desktop

### For VS Code (GitHub Copilot Chat)

1. Copy the **mcpEndpoint** and **mcpAccessKey** from the outputs
2. In VS Code, open Settings → search "MCP"
3. Add a new MCP server with the endpoint URL and access key header

### For Any MCP Client

Use these values from the deployment outputs:
- **URL:** `mcpEndpoint` output
- **Auth Header:** `X-MCP-Access-Key: {mcpAccessKey output}`

---

## Test It! 🎉

### Test Teams Capture

Go to any Teams channel and type:

```
#brain This is my first thought captured by Open Brain!
```

Within a few seconds, you should see a reply:

> ✅ **Captured to Open Brain!**
> Type: reference
> Topics: open brain, first thought

### Test MCP Search

Open Claude Desktop and ask:

> "Search my brain for recent thoughts"

Claude will use the `search_thoughts` tool and return your captured thought.

### Test via Command Line (Optional)

Copy the **testCommand** from your deployment outputs and run it in a terminal. You should get a JSON response listing available tools.

---

## What Got Deployed

Here's what the Deploy button created in your Azure account:

```
Your Teams Channel
    │  (you type: #brain followed by your thought)
    ▼
Logic App (Azure)
    │  (watches for #brain messages, extracts content)
    ▼
Azure Function: /api/capture
    │  (embeds text → generates metadata → stores)
    ├──► Azure OpenAI: text-embedding-3-small (1536-dim vector)
    ├──► Azure OpenAI: gpt-4o-mini (type, topics, people, action items)
    ▼
Azure Cosmos DB
    │  (serverless, DiskANN vector index, JSON documents)
    │
    │  ← ← ← Azure Function: /api/mcp (MCP JSON-RPC 2.0)
    │              ▲
    │              │
Claude Desktop / VS Code / ChatGPT / Cursor
    (search by meaning, browse recent, capture from conversation)
```

### Monthly Cost Breakdown

| Resource | Cost |
|----------|------|
| Cosmos DB (serverless, ~7K RUs) | ~$2.00 |
| Azure OpenAI (embeddings + chat) | ~$0.02 |
| Azure Functions (consumption) | $0.00 |
| Logic App (~400 actions) | ~$0.01 |
| Application Insights | $0.00 |
| Storage Account | ~$0.10 |
| **Total** | **~$2.13/month** |

---

## Troubleshooting

### "Azure OpenAI is not available in this subscription"

1. Azure Portal → Subscriptions → Resource Providers
2. Search for `Microsoft.CognitiveServices` → click **Register**
3. Wait a minute, then re-deploy

If Azure OpenAI is blocked by enterprise policy, use the **GitHub Models fallback**:
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Create a token with `models:read` scope
3. In Azure Portal → your Function App → Configuration → Application Settings:
   - Add `AI_PROVIDER` = `github`
   - Add `GITHUB_PAT` = your token
4. Save and restart

### Teams messages not being captured

1. **Check Logic App is enabled:** Azure Portal → your resource group → Logic App → Overview → should say "Enabled"
2. **Check Teams connection:** Logic App → API connections → Teams → should say "Connected"
3. **Check the Logic App needs a team/channel configured:** After authorizing, you may need to edit the Logic App trigger to select which Team and Channel to monitor

### MCP connection not working

1. Verify the URL and access key match your deployment outputs
2. Test with the curl command from the **testCommand** output
3. Check Function App logs: Application Insights → Live Metrics

### Want to start fresh?

Delete the resource group (`openbrain-rg`) in Azure Portal. Everything gets cleaned up. Re-deploy with the button.

---

## What's Next

### Companion Prompts

After setup, grab the companion prompt pack for:
- **Memory Migration** — Import your existing AI memories
- **Second Brain Migration** — Move from Notion/Obsidian/Roam
- **Spark** — Discover use cases for your workflow
- **Capture Templates** — Optimize metadata extraction
- **Weekly Review** — Review and connect your thoughts

### Scale Up

- Increase Cosmos DB throughput for more captures
- Add more Azure OpenAI models for different tasks
- Build a web dashboard with Azure Static Web Apps
- Add more capture channels (email, mobile, browser extension)
