# Build Your Open Brain (Microsoft Edition)
## Complete Setup Guide

---

## Introduction

You're about to build **AI infrastructure** — not just another notes app. Your Open Brain is a personal database that understands what you're thinking. Type a thought into a Teams channel with a simple #brain tag. Within seconds, it's embedded with vector math, classified by type and topics, stored in your Azure database, and ready to be searched from Claude, ChatGPT, VS Code, or any AI tool you use.

Every captured thought becomes a searchable memory, organized by meaning rather than folders. Ask your AI: *"Show me all decisions we made about authentication,"* and it searches your actual brain, not Google. This is semantic memory — the kind that compounds over time.

**What makes this different:** You're not giving your thoughts to Notion, Slack, or a third-party service. Everything lives in your own Azure account. GitHub Models gives you free AI access. Power Automate (Microsoft's automation engine) connects Teams to Azure Functions with zero code. You own the entire stack.

**This guide is designed for:**
- People with zero coding experience (we'll handle all the code)
- Anyone with an Azure account and GitHub account
- Anyone who wants semantic search for their own brain

**Time estimate:** 60 minutes (most steps are clicking buttons in the Azure Portal)

---

## What You're Building

Here's what happens when you capture a thought:

1. **You type** in a Teams channel: `#brain I just realized we should architect decision caching in our LLM pipeline.`
2. **Power Automate triggers** — a simple Microsoft automation that watches for the #brain tag
3. **Azure Function runs** — your code in the cloud:
   - Generates a vector embedding (mathematical fingerprint) via GitHub Models API
   - Extracts metadata: type (idea/question/todo), topics, people mentioned
   - Stores the complete thought in Azure Cosmos DB
4. **Teams confirms** with an adaptive card: `✅ Captured to Open Brain! Type: idea | Topics: architecture, llm`
5. **You search later** in Claude Desktop:
   - Claude loads your Open Brain via MCP protocol
   - You ask: *"What did we decide about caching?"*
   - Your brain searches itself — returns the exact thought with context
6. **It connects everywhere**: Claude, ChatGPT, VS Code Copilot, GitHub Copilot Chat, any AI that supports MCP

**The architecture in one sentence:** Teams message → Power Automate webhook → Azure Function → GitHub Models API → Azure Cosmos DB with vector index → MCP server → Claude/AI.

---

## What You Need (All Free or Included)

### 1. **Azure Account**
- Sign up at [azure.microsoft.com](https://azure.microsoft.com) — free tier includes $200 one-time credit
- If you don't, you can get a free Azure account (comes with $200 one-time credit)

### 2. **GitHub Account**
- You probably have one already
- We'll use GitHub Models API (free for all GitHub users with Copilot SDK access)

### 3. **Microsoft Teams**
- Included in Microsoft 365 (Office, Outlook, Teams)
- If not, you can use the free Teams web version

### 4. **VS Code (Optional but Recommended)**
- Makes deploying Azure Functions a one-click operation
- [Download here](https://code.visualstudio.com/)
- We'll show the Azure Portal path too if you prefer not to install

### 5. **60 Minutes**
- Most of it is reading confirmation screens and copying credentials

---

## Part 1: Setting Up Your Brain (Infrastructure)

### Step 1: Create Your Azure Cosmos DB Account

This is where your thoughts live. Think of Cosmos DB as a smart filing cabinet that understands meaning.

#### 1.1 — Open Azure Portal

1. Go to [portal.azure.com](https://portal.azure.com)
2. Sign in with your Azure account

#### 1.2 — Create a Cosmos DB Account

1. Click **+ Create a resource** (top left)
2. Search for `Cosmos DB`
3. Click **Azure Cosmos DB** (the one with the purple sphere icon)
4. Click **Create**

#### 1.3 — Select API Type

You'll see: "Which API would you like to use?"

- Click **Core (SQL) - Recommended**
- This gives us the JSON document model + native vector search

#### 1.4 — Configure Basics

Fill in the form:

| Field | Value |
|-------|-------|
| **Subscription** | Your Azure subscription |
| **Resource Group** | Create new: `openbrain-rg` |
| **Account Name** | `openbrain-<yourname>` (e.g., `openbrain-alex`) — must be globally unique |
| **Location** | East US (closest to you, or pick your region) |
| **Capacity Mode** | **Serverless** ← Important! This means you only pay for what you use |

Then click **Review + Create** → **Create**

**⏱️ This takes 5-10 minutes.** While it's deploying, go make coffee. You'll see a "Deployment in progress" notification.

#### 1.4 — Wait for Deployment

When the deployment finishes, you'll see: "Go to resource". Click it.

**You now have:** Azure Cosmos DB account name, endpoint URL (e.g., `https://openbrain-alex.documents.azure.com:443/`)

---

### Step 2: Create Your Database and Vector-Indexed Container

Now we'll set up the actual database and the "thoughts" collection.

#### 2.1 — Navigate to Data Explorer

In your Cosmos DB account, click **Data Explorer** (left sidebar)

#### 2.2 — Create a Database

1. Click **New Database**
2. Database ID: `openbrain`
3. Click **OK**

#### 2.3 — Create a Container

Now you'll create the "thoughts" container (like a table, but smarter):

1. Under `openbrain`, click **New Container**
2. Fill in:

| Field | Value |
|-------|-------|
| **Database ID** | openbrain (already selected) |
| **Container ID** | thoughts |
| **Partition key** | `/userId` (This allows future multi-user support) |

3. Click **OK**

#### 2.4 — Add Vector Indexing Policy

After the container is created, click on **thoughts** in the Data Explorer.

1. Click **Scale & Settings** (right sidebar)
2. Scroll down to **Indexing Policy**
3. You'll see a JSON editor. Replace the entire policy with:

```json
{
  "indexingMode": "consistent",
  "automatic": true,
  "includedPaths": [
    {
      "path": "/*"
    }
  ],
  "excludedPaths": [
    {
      "path": "/\"_etag\"/?"
    }
  ],
  "vectorIndexes": [
    {
      "path": "/embedding",
      "type": "diskANN"
    }
  ]
}
```

4. Click **Save**

**What this does:** Tells Cosmos DB that documents in this container have an "embedding" property (a list of 1536 numbers) and to index it for fast similarity search.

**⏱️ Takes 2-5 minutes to apply.**

---

### Step 3: Get Your Cosmos DB Credentials

You'll need these to deploy the Azure Functions.

#### 3.1 — Copy Connection String

1. In your Cosmos DB account, click **Keys** (left sidebar)
2. Copy the **Primary Connection String** (long string starting with `AccountEndpoint=...`)
3. **Save this somewhere safe** — you'll paste it into Azure Functions in Step 6

#### 3.2 — Copy Account Endpoint and Key

While you're here:

1. Copy **URI** (e.g., `https://openbrain-alex.documents.azure.com:443/`)
2. Copy **Primary Key** (long string of random characters)

**Your Credential Tracker (Part 1):**
```
[ ] Cosmos DB Endpoint: https://openbrain-xxx.documents.azure.com:443/
[ ] Cosmos DB Primary Key: (long string)
[ ] Cosmos DB Connection String: AccountEndpoint=...
```

---

### Step 4: Create a GitHub Personal Access Token

This token lets your Azure Functions call GitHub Models API to generate embeddings and extract metadata.

#### 4.1 — Generate Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token** → **Generate new fine-grained token**
3. Fill in:

| Field | Value |
|-------|-------|
| **Token name** | openbrain-token |
| **Expiration** | 90 days (or longer if you prefer) |
| **Resource owner** | Your account |
| **Repository access** | All repositories |

#### 4.2 — Set Permissions

Scroll to **Account Permissions**:

1. Find **GitHub Models** → Click it
2. Select **Read-only** (it will auto-select if not already)

#### 4.3 — Generate and Copy

1. Click **Generate token**
2. **Copy the token immediately** — you won't see it again!
3. Paste it into a text editor temporarily (we'll need it in Step 6)

**Your Credential Tracker (Part 2):**
```
[ ] GitHub Personal Access Token: ghp_xxxxxxxxxxxxx
```

---

### Step 5: Create a Microsoft Teams Channel for Your Brain

This is where you'll type thoughts with #brain tag.

#### 5.1 — Create or Open a Team

1. Open Microsoft Teams (web.teams.microsoft.com or your desktop app)
2. Click **+ Create a team** or use an existing team you own
3. Click **Create** → Choose team type: **Private** (just for you)
4. Name: `Open Brain` (or whatever you like)

#### 5.2 — Create a Channel

1. Click the team, then **+ Add a channel**
2. Channel name: `brain` (or `thoughts`, `captures`, your choice)
3. Leave as **Private** (only you see it)
4. Click **Create**

#### 5.3 — Get the Channel ID

1. Right-click the channel name → **Get the link to the channel**
2. Copy the URL — it looks like: `https://teams.microsoft.com/l/channel/19:xxxxx@thread.tacv2/...`
3. The channel ID is the part after `/channel/` and before `@thread`

**Your Credential Tracker (Part 3):**
```
[ ] Teams Channel ID: 19:xxxxxxxxxxxxx@thread.tacv2
[ ] Teams Team ID: (optional, but useful)
```

**If you want the Team ID too:**
1. Right-click the team name → **Get the link to the team**
2. Copy the URL and extract the ID

---

### Step 6: Deploy Azure Functions

This is the code that captures thoughts, generates embeddings, and makes your brain searchable. We've packaged it for you — you'll deploy it in about 5 minutes.

#### 6.1 — Choose Your Deployment Method

**Option A: Using VS Code (Recommended)**

1. Install VS Code from [code.visualstudio.com](https://code.visualstudio.com/)
2. Install the **Azure Functions** extension (search "Azure Functions" in VS Code extensions)
3. Sign in to Azure (VS Code will prompt you)

**Option B: Using Azure Portal (No Installation)**

- Skip to section 6.3 below

---

#### 6.2 — Prepare the Code

The Azure Functions code is in the `/functions` folder of this repository. It includes:

- **`capture/index.js`** — HTTP endpoint that captures thoughts from Teams
- **`mcp-server/index.js`** — MCP server that makes your brain searchable from Claude
- **`shared/`** — Helper code for Cosmos DB, GitHub Models, authentication

**For now:** We've prepared the code structure. You'll copy the functions into Azure.

---

#### 6.3A — Deploy via VS Code (Recommended Path)

1. Open this repository in VS Code (`File` → `Open Folder` → select `secondbrain`)
2. Click the **Azure** icon (left sidebar)
3. Click **Sign in to Azure** (VS Code will open a browser)
4. Authorize VS Code to access your Azure account
5. In the Azure panel, expand your **subscription** → **Functions** (you'll see your subscription name)
6. Right-click → **Create Function App in Azure**
7. Fill in:

   | Field | Value |
   |-------|-------|
   | **App name** | openbrain-functions |
   | **Runtime** | Node.js |
   | **Runtime version** | 20 LTS |
   | **Location** | Same as Cosmos DB (e.g., East US) |

8. Once created, right-click the new function app → **Deploy to Function App**
9. Select the `functions/` folder when prompted

**VS Code will upload the code and deploy it.** You'll see a notification when it's done.

---

#### 6.3B — Deploy via Azure Portal (If Not Using VS Code)

1. In the Azure Portal, click **+ Create a resource**
2. Search for **Function App**
3. Click **Create**
4. Fill in:

   | Field | Value |
   |-------|-------|
   | **Resource Group** | openbrain-rg (same as Cosmos DB) |
   | **Function App name** | openbrain-functions |
   | **Runtime stack** | Node.js |
   | **Version** | 20 LTS |
   | **Operating System** | Linux |
   | **Plan type** | Consumption (pay per use) |
   | **Location** | Same as Cosmos DB |

5. Click **Create**
6. Once deployed, go to the Function App
7. Click **Code + Test** (left sidebar, under "Functions")
8. Copy the code from `/functions/capture/index.js` (we'll provide the full code)
9. Paste it into the portal editor
10. Click **Save**

**Repeat this for `/api/mcp` endpoint**

---

### Step 7: Set Environment Variables in Azure Functions

Your functions need to know:
- How to connect to Cosmos DB
- Your GitHub PAT (for embeddings API)
- Your MCP access key (for security)

#### 7.1 — Go to Function App Settings

1. In your Function App, click **Configuration** (left sidebar)
2. Click **+ New application setting**

#### 7.2 — Add Each Secret

Add these one by one:

| Name | Value |
|------|-------|
| `COSMOS_ENDPOINT` | Your Cosmos DB endpoint (from Step 3.2) |
| `COSMOS_KEY` | Your Cosmos DB Primary Key (from Step 3.2) |
| `COSMOS_DATABASE` | `openbrain` |
| `COSMOS_CONTAINER` | `thoughts` |
| `GITHUB_PAT` | Your GitHub Personal Access Token (from Step 4.3) |
| `MCP_ACCESS_KEY` | Create a random string (e.g., `my-secret-key-12345`) — you'll use this in Step 11 |

For each one:
1. Click **+ New application setting**
2. Enter **Name** and **Value**
3. Click **OK**

When done, click **Save** at the top.

**Your Credential Tracker (Part 4):**
```
[ ] MCP Access Key: (whatever you created above)
[ ] Azure Function App URL: https://openbrain-functions.azurewebsites.net
[ ] Capture Function Key: (copy from Manage Functions after deployment)
```

---

### Step 8: Get Your Function URLs and Keys

You'll need the function URLs and keys for the Power Automate flow and MCP configuration.

#### 8.1 — Get Capture Function URL and Key

1. In your Function App, expand **Functions** (left sidebar)
2. Click on **capture** function
3. Click **Code + Test**
4. In the top right, click **</> Get Function URL**
5. Copy the full URL (includes `?code=...`)

**Your Credential Tracker (Part 5A):**
```
[ ] Capture Function URL: https://openbrain-functions.azurewebsites.net/api/capture?code=xxxxx
```

#### 8.2 — Get MCP Function Base URL

For the MCP server, you don't need a function key (it uses custom access key instead):

1. In your Function App, expand **Functions** (left sidebar)
2. Click on **mcp-server** function
3. The base URL is: `https://<your-function-app>.azurewebsites.net/api/mcp` (no `?code=` needed)

**Your Credential Tracker (Part 5B):**
```
[ ] MCP Function Base URL: https://openbrain-functions.azurewebsites.net/api/mcp
```

---

### Step 9: Create a Power Automate Flow (Teams → Azure Functions)

This is the automation that watches for #brain messages in Teams and sends them to your Azure Function.

#### 9.1 — Open Power Automate

1. Go to [flow.microsoft.com](https://flow.microsoft.com)
2. Sign in with your Microsoft account
3. Click **+ Create** (top left)
4. Click **Cloud flow** → **Automated cloud flow**

#### 9.2 — Set Up the Trigger

1. Flow name: `Capture Thought to Open Brain`
2. Choose trigger: Search for **Teams** → **When a new message is posted in a channel**
3. Click **Create**

#### 9.3 — Configure the Trigger

Fill in:

| Field | Value |
|-------|-------|
| **Team** | Open Brain (the team you created in Step 5) |
| **Channel** | brain (the channel you created) |

Then click **Add an action**

#### 9.4 — Add Compose Action (Clean Message Content)

Before sending to the function, let's clean up the message:

1. Click **Add an action**
2. Search for **Compose**
3. Click **Data Operations - Compose**
4. In the **Inputs** field, paste:
   ```
   @{replace(triggerOutputs()?['body/body/content'], '#brain', '')}
   ```
   This removes the `#brain` tag from the message.
5. Rename this action to "Clean message content" (click the three dots → Rename)

#### 9.5 — Add Condition (Check for #brain Tag)

1. Click **Add an action**
2. Search for **Condition**
3. In the condition, set up:
   - Left side: Select **Message body** (from the trigger)
   - Operator: **contains**
   - Right side: type `#brain`

#### 9.6 — Add HTTP Action (Call Your Function)

1. In the **If yes** branch, click **Add an action**
2. Search for **HTTP**
3. Click **HTTP**
4. Fill in:

   | Field | Value |
   |-------|-------|
   | **Method** | POST |
   | **URI** | Paste your capture function URL (from Step 8.1) |
   | **Headers** | `Content-Type: application/json` |
   | **Body** | See below |

5. For **Body**, use:

```json
{
  "userId": "@{triggerOutputs()?['body/from/user/id']}",
  "content": "@{outputs('Clean_message_content')}",
  "source": "teams"
}
```

This sends the cleaned message content to your capture function.

#### 9.7 — Add Response Action (Optional but Nice)

1. Click **Add an action**
2. Search for **Post message in a chat or channel**
3. Click the Teams action
4. Fill in:

   | Field | Value |
   |-------|-------|
   | **Team** | Open Brain |
   | **Channel** | brain |
   | **Message** | `✅ Captured to your Open Brain!` |

#### 9.8 — Save the Flow

1. Click **Save** (top right)
2. You should see "Flow created successfully"

**Your Power Automate flow is now live!** 🎉

---

### Step 10: Test Capture

Let's make sure everything works end-to-end.

#### 10.1 — Send a Test Message

1. Open the **brain** channel in Teams
2. Type: `#brain I need to understand vector embeddings for semantic search.`
3. Hit **Send**

#### 10.2 — Check Results

1. The Power Automate flow should trigger within a few seconds
2. You should see a response message in Teams: `✅ Captured to your Open Brain!`
3. (Optional) Check your Azure Functions logs to see if the capture was successful:
   - Go to your Function App in the Azure Portal
   - Click **Monitor** (left sidebar)
   - You should see the function invocation

**If it works:** 🎉 Congratulations! Your capture system is operational.

**If it doesn't work:** See the **Troubleshooting** section at the end.

---

## Part 2: Making Your Brain Searchable (MCP Server)

Now we'll make your brain accessible from Claude, ChatGPT, and any AI tool.

### Step 11: Set Up Claude Desktop to Use Your Brain

Claude Desktop (the app on your computer) can connect to your brain via the MCP protocol.

#### 11.1 — Install Claude Desktop

1. Go to [claude.ai/download](https://claude.ai/download)
2. Download and install Claude Desktop (free)

#### 11.2 — Locate Your MCP Configuration File

**On Mac:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**On Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

1. Open your file browser
2. Navigate to the path above
3. If the file doesn't exist, create a new text file named `claude_desktop_config.json`

#### 11.3 — Add Your Brain to Claude's MCP Servers

Edit (or create) the `claude_desktop_config.json` file:

```json
{
  "mcpServers": {
    "openbrain": {
      "transport": {
        "type": "http",
        "baseUrl": "https://openbrain-functions.azurewebsites.net/api/mcp"
      },
      "headers": {
        "X-MCP-Access-Key": "YOUR-MCP-ACCESS-KEY-HERE"
      }
    }
  }
}
```

Replace:
- `openbrain-functions.azurewebsites.net` with your actual Function App URL (from Step 8.1)
- `YOUR-MCP-ACCESS-KEY-HERE` with the MCP access key you created in Step 7.2

#### 11.4 — Restart Claude Desktop

1. Close Claude Desktop completely
2. Reopen it
3. You should see a new "Open Brain" section in the Tools panel

**Your Credential Tracker (Part 6):**
```
[ ] Claude Desktop MCP configured
```

---

### Step 12: Use Your Brain in Claude

Now test the MCP connection.

#### 12.1 — Open Claude Desktop

1. Start a new conversation
2. At the bottom, you should see **Tools** including your new **openbrain** server

#### 12.2 — Try a Search

Type a message like:

> Search my brain for thoughts about vector search.

Claude should:
1. Use the `search_thoughts` tool from your MCP server
2. Query your Azure Cosmos DB
3. Return results from your captured thoughts

#### 12.3 — Try Other Tools

Your brain exposes four MCP tools:

1. **`search_thoughts`** — Search by natural language query
2. **`browse_recent`** — See your most recent captures
3. **`brain_stats`** — See how many thoughts you have, top topics, etc.
4. **`capture_thought`** — Add a new thought directly from Claude

**Example prompts to try:**

```
- Show me my recent thoughts about architecture
- Search for anything related to "decisions we made"
- What are my top topics this month?
- Save this to my brain: "AI agents should have explainable decision trees"
```

---

### Step 13: Connect Other AI Tools (Optional)

Your MCP server works with any AI that supports the MCP protocol.

#### For ChatGPT (with browser mode):

1. Go to [ChatGPT.com](https://chatgpt.com)
2. In "Canvas" mode, you can configure external data sources
3. Add your MCP server URL and access key

#### For VS Code Copilot:

1. Install the **MCP for VS Code** extension
2. Configure it with your Function App URL and MCP access key
3. Copilot will have tools to search your brain while you code

#### For GitHub Copilot Chat:

1. Similar configuration to VS Code
2. Your brain becomes searchable while working in GitHub

**For other tools:** Check their MCP integration documentation.

---

## How It All Works (Under the Hood)

Don't need to understand this to use your brain, but here's the magic:

### Capture Flow

```
Teams message (#brain tag)
    ↓
Power Automate trigger (watches channel)
    ↓
HTTP POST to Azure Function (/api/capture)
    ↓
Function calls GitHub Models API
    ├─ text-embedding-3-small → converts "vector search" → [0.1, -0.2, 0.5, ...] (1536 numbers)
    └─ gpt-4o-mini → extracts metadata (type: "idea", topics: ["ai", "search"])
    ↓
Function inserts document into Cosmos DB with embedding + metadata
    ↓
Teams shows confirmation: ✅ Captured!
```

### Search Flow

```
Claude asks: "Show me thoughts about vector search"
    ↓
Claude's MCP client calls your /api/mcp endpoint with query
    ↓
MCP function:
    1. Converts query to embedding (same model as capture)
    2. Runs VectorDistance query in Cosmos DB: "Find documents where embedding is similar to query"
    3. Returns top 10 results
    ↓
Claude displays results to you with full context
```

### Why This Works

- **Embeddings** capture meaning (not just words). "semantic search" and "vector similarity" are mathematically close.
- **Cosmos DB's DiskANN indexing** makes similarity search fast even with thousands of thoughts.
- **GitHub Models API is free** because you're accessing it through your Microsoft/GitHub account (no per-API costs).
- **Serverless Azure Functions** cost ~$0 for personal use (first 1M executions free).
- **MCP protocol** is a standard that any AI can speak — your brain is portable.

---

## Cost Breakdown

Here's what this costs on Azure pay-as-you-go:

### Azure Cosmos DB (Serverless)

| Component | Usage | Cost |
|-----------|-------|------|
| Storage | <1GB for 10,000 thoughts | $0.25/month |
| RU: Captures | 100 thoughts/month × 10 RUs | $0.29 |
| RU: Searches | 200 searches/month × 30 RUs | $1.71 |
| RU: Browse/Stats | 100 operations × 5-10 RUs | $0.15 |
| **Subtotal** | | **~$2.40/month** |

### Azure Functions (Consumption)

| Component | Usage | Cost |
|-----------|-------|------|
| Capture executions | 100/month | Free (under 1M) |
| MCP executions | 250/month | Free (under 1M) |
| Compute time | ~100ms per call | Free (under 1M) |
| **Subtotal** | | **$0.00/month** |

### GitHub Models API

| Model | Usage | Cost |
|-------|-------|------|
| text-embedding-3-small | 100 calls/month | **Free** |
| gpt-4o-mini | 100 calls/month | **Free** |

*Free tier: 15 requests/minute (personal use stays under this)*

### Power Automate

| Component | Cost |
|-----------|------|
| Standard connectors (Teams, HTTP) | **Free** (included with Microsoft 365) |

### **Total Monthly Cost**

**~$2.40 - $5.00/month** (depending on usage)

- 📊 **Heavy use** (500 captures, 1000 searches): **~$15/month**
- 💰 **Low monthly cost** → plenty of headroom for growth
- 🎯 **Budget alert:** Set up a spending alert in Azure Portal (Step 1) at $10/month, just to be safe

---

## Companion Prompts

These are ready-to-use prompts that work with your brain and its MCP tools. Use them in Claude, ChatGPT, or any AI connected to your Open Brain.

### Prompt 1: Memory Migration
*One-time: Extract everything an AI already knows about you and save to your brain*

```
I want to save all the context you have about me to my Open Brain system.

Here's what I'll do: I'll describe my background, goals, working style, and key context. You'll use the capture_thought tool to save extracted insights to my brain.

Ready? Ask me questions to understand me better, then save 10-15 key insights about me.
```

### Prompt 2: Second Brain Migration
*Import from Notion, Obsidian, Apple Notes, or any text file*

```
I have a lot of notes in [Notion/Obsidian/Apple Notes] that I want to import to my Open Brain.

I'll paste them below. Please:
1. Break them into individual thoughts (one idea per capture)
2. Remove duplicate/redundant content
3. Use the capture_thought tool to save each one to my brain

Here are my notes:
[paste your notes]
```

### Prompt 3: Open Brain Spark
*Personalized use case interview*

```
Help me discover the best ways to use my Open Brain.

Ask me 5 questions about:
- My role and workflow
- Tools I use daily
- Pain points (things I forget, lose context on, can't find later)
- How I currently take notes
- What AI tools I use

Based on my answers, generate "Your First 5 Captures" — specific insights, decisions, and context that I should save to my brain right now, formatted for easy use_capture_thought.
```

### Prompt 4: Quick Capture Templates
*Copy-paste sentence starters for better metadata extraction*

```
Here are sentence starters that capture thoughts with great metadata:

1. Decision Capture: "Decision: [what]. Context: [why]. Owner: [who]."
2. Person Note: "[Name] — [what happened]. Key takeaway: [insight]."
3. Insight Capture: "Insight: [realization]. Triggered by: [context]."
4. Meeting Debrief: "Meeting with [who] about [topic]. Key points: […]. Action items: [...]."
5. The AI Save: "Saving from [tool/conversation]: [key takeaway]. Why it matters: [...]."

When I type #brain in Teams, I'll use one of these formats so my metadata is clean and searchable.
```

### Prompt 5: Weekly Review
*Friday ritual: See what you learned this week*

```
Run my weekly review:

1. Use brain_stats to see how many thoughts I captured this week
2. Use browse_recent to show me the last 7 days
3. Analyze:
   - Themes and patterns
   - Open loops (decisions pending, questions unanswered)
   - Connections between ideas
   - Gaps in my thinking

Format output as:
- **Week at a Glance** (sentence summary)
- **Themes** (patterns)
- **Open Loops** (actionable items)
- **Connections** (ideas that link together)
- **Gaps** (what I should be thinking about)
- **Suggested Focus** (where to direct my thinking next week)
```

---

## Troubleshooting

### **Problem: Teams message doesn't trigger the flow**

**Symptoms:**
- You type `#brain Something` in Teams but nothing happens
- No Power Automate confirmation message appears

**Check these:**

1. **Is the Power Automate flow turned on?**
   - Go to [flow.microsoft.com](https://flow.microsoft.com)
   - Find your "Capture Thought to Open Brain" flow
   - Make sure the toggle is **On**

2. **Is the message in the right channel?**
   - You typed in the `brain` channel, right?
   - Not in a different team's channel?

3. **Does the message include `#brain`?**
   - Power Automate looks for the text `#brain`
   - `#brain Something` ✅
   - `#brain something` ✅
   - `#brainwave` ❌ (doesn't match the condition)

4. **Check the Flow Run History**
   - In Power Automate, click your flow
   - Click on the flow name to see details
   - Look for **28-day run history** at the bottom
   - Click the most recent run to see if it succeeded or failed
   - If it failed, the error message will tell you why

5. **Is your Azure Function deployed correctly?**
   - Go to Azure Portal → Your Function App
   - Click **Monitor**
   - Do you see any function invocations?
   - Are there any errors in the logs?

**Still stuck?** See **Common Error Messages** below.

---

### **Problem: Capture Function returns an error**

**Symptoms:**
- Power Automate flow runs but shows an error
- Azure Function logs show a red error message

**Common issues:**

1. **`401 Unauthorized` — Authentication failed**
   - Check that your GitHub PAT is correct (Step 4.3)
   - Make sure it has the `GitHub Models: Read-only` permission
   - The PAT might have expired — generate a new one

2. **`Connection timeout` — Can't reach Cosmos DB**
   - Check your `COSMOS_ENDPOINT` and `COSMOS_KEY` in Azure Function settings (Step 7.2)
   - Make sure you copied them exactly with no spaces
   - Cosmos DB might still be initializing — wait 5 more minutes

3. **`COSMOS_KEY is undefined` — Missing environment variables**
   - Go to Function App → **Configuration**
   - Verify all these are set:
     - `COSMOS_ENDPOINT`
     - `COSMOS_KEY`
     - `COSMOS_DATABASE`
     - `COSMOS_CONTAINER`
     - `GITHUB_PAT`
     - `MCP_ACCESS_KEY`
   - Click **Save** after adding/fixing them

4. **Function took too long (timeout)**
   - GitHub Models API might be slow (30 second timeout)
   - Try again — sometimes it's just network latency
   - If it keeps timing out, file an issue on the GitHub Models API

---

### **Problem: Claude Desktop can't find your brain**

**Symptoms:**
- You open Claude and don't see your Open Brain in the Tools panel
- Or it shows "Unable to connect"

**Check these:**

1. **Did you restart Claude Desktop after configuring MCP?**
   - Close it completely (Command+Q or Ctrl+Q)
   - Reopen it
   - Check the Tools panel again

2. **Is your MCP configuration file correct?**
   - Open `claude_desktop_config.json` (see Step 11.2)
   - Make sure the JSON is valid (no syntax errors)
   - Double-check your Function App URL — it should match exactly
   - Your MCP access key should match what you set in Step 7.2

3. **Is your Azure Function running?**
   - Go to Azure Portal → Your Function App
   - Click **Overview**
   - Status should show "Running" (green)
   - If it's stopped, click the **Start** button

4. **Test the MCP endpoint directly**
   - Open a terminal/PowerShell
   - Run:
     ```bash
     curl -X POST https://openbrain-functions.azurewebsites.net/api/mcp \
       -H "X-MCP-Access-Key: YOUR-MCP-ACCESS-KEY" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
     ```
   - If you get a response (not a 401 error), your endpoint is working
   - If you get `401`, your access key is wrong

5. **Check Claude's error logs**
   - Claude Desktop logs are in:
     - **Mac:** `~/Library/Logs/Claude/`
     - **Windows:** `%APPDATA%\Claude\logs\`
   - Look for errors mentioning your MCP server URL

---

### **Problem: MCP Tools (search, browse, etc.) return no results**

**Symptoms:**
- You ask Claude to search your brain, and it says "no results"
- Or the tool runs but returns empty

**Check these:**

1. **Do you have any thoughts captured?**
   - Go to Azure Portal → Cosmos DB → Data Explorer
   - Click **thoughts** container
   - Click **New SQL Query**
   - Paste: `SELECT * FROM c`
   - Click **Execute**
   - You should see your captured documents
   - If empty, you haven't captured anything yet — test with Step 10 again

2. **Is your search query too specific?**
   - If you search for "quantum computing" but never captured that phrase, no results
   - Try broader searches or use `browse_recent` instead to see recent thoughts

3. **Check your Cosmos DB configuration**
   - Make sure the vector indexing policy is applied (Step 2.4)
   - Go to Cosmos DB → Data Explorer → **thoughts** → **Scale & Settings**
   - Scroll to **Indexing Policy** and verify the `vectorIndexes` section is there

4. **Check MCP function logs**
   - Go to Azure Portal → Function App → **Monitor**
   - Look for `/api/mcp` invocations
   - Click any errors to see the failure reason

---

### **Problem: Getting charged unexpectedly**

**Symptoms:**
- Your Azure bill shows a surprise charge
- Alerts are firing

**Likely causes:**

1. **Indexing operations**
   - When you add many documents at once, Cosmos DB indexes them all
   - This burns RUs temporarily
   - It's normal and will stop once indexing is done

2. **Vector search is expensive**
   - Each vector similarity search costs ~30 RUs
   - If you're searching 100+ times a day, costs add up
   - Check your usage in Azure Portal → Metrics

3. **Function code has a loop**
   - A bug in the Azure Function might be calling GitHub Models API repeatedly
   - Check function logs (step 2 above) for repeated API calls

**How to prevent:**

1. Set a **spending alert** in Azure Portal
   - Go to Cost Management → Budgets
   - Click **+ Create**
   - Set limit to $10/month
   - You'll get emailed if you approach it

2. Monitor your usage
   - Cosmos DB → **Metrics**
   - Look at "Normalized RU Consumption" graph
   - Should be flat or slightly up

3. If costs spike
   - Immediately disable the Power Automate flow (Step 9.7)
   - Check function logs for errors/loops
   - Contact Azure Support

---

### **Common Error Messages (Quick Reference)**

| Error | What It Means | Fix |
|-------|---------------|-----|
| `COSMOS_ENDPOINT is undefined` | Missing env var in Azure Function | Add to Function App Configuration (Step 7) |
| `401 Unauthorized` on GitHub API | Bad GitHub PAT | Regenerate token in GitHub Settings (Step 4) |
| `Cannot POST /api/capture` | Function not deployed | Redeploy using VS Code or Portal (Step 6) |
| `Header X-MCP-Access-Key not found` | Missing auth header in MCP request | Check Claude config file (Step 11.3) |
| `VectorDistance query failed` | Cosmos DB vector index not applied | Reapply indexing policy (Step 2.4) |
| `Teams channel not found` | Power Automate looking for wrong channel | Edit flow, select correct Team and Channel (Step 9) |
| `Message contains #brain but no trigger` | Power Automate flow is off | Turn on the flow in flow.microsoft.com (Step 9) |
| `Connection timeout` | Service taking too long to respond | Wait 30 seconds, retry. Check your internet. |

---

## You Just Built AI Infrastructure Using AI

Seriously. You now have:

✅ **Semantic vector database** — Cosmos DB with 1536-dimensional embeddings  
✅ **Serverless compute** — Azure Functions running your brain's logic  
✅ **AI embeddings + extraction** — GitHub Models API generating metadata  
✅ **Conversational interface** — Teams capture, Claude/ChatGPT search  
✅ **Automation engine** — Power Automate connecting it all  
✅ **Cost-effective infrastructure** — ~$2-5/month, zero coding required  
✅ **Portable brain** — MCP protocol means it works with any AI  

**What you learned:**
- How vector embeddings work (converting meaning to numbers)
- How serverless computing scales to zero cost
- How to use no-code automation (Power Automate)
- How AI agents use tools (MCP protocol)
- How to set up a personal AI infrastructure

**What you can do next:**

1. **Import your existing notes** (use Prompt 2: Second Brain Migration)
2. **Train Claude on your thinking** (use Prompt 1: Memory Migration)
3. **Run weekly reviews** (use Prompt 5: Weekly Review)
4. **Add your brain to VS Code** (configure MCP for GitHub Copilot)
5. **Share insights** (browse_recent tool shows your thinking over time)
6. **Build on this** — The code is in `/functions/` if you want to extend it

---

## Need Help?

**If something isn't working:**
1. Check the **Troubleshooting** section above
2. Look at your Azure Function logs (Monitor tab)
3. Run the test in Step 10 again to isolate the issue
4. Check [GitHub Issues](https://github.com/secondbrain) for similar problems

**If you want to extend your brain:**
1. Read `/docs/architecture.md` to understand how everything connects
2. Modify `/functions/shared/github-models.js` to extract different metadata
3. Add new MCP tools by editing `/functions/mcp-server/index.js`
4. Deploy changes using VS Code (one click)

**If you're building something cool with your brain:**
- Share it! Your setup is a template for others.
- Consider writing a prompt that works well with your data.

---

## Summary of Credentials (Keep This Handy)

```
STEP 2 (Cosmos DB):
[ ] Cosmos DB Endpoint: https://openbrain-xxx.documents.azure.com:443/
[ ] Cosmos DB Primary Key: (long string)
[ ] Cosmos DB Connection String: AccountEndpoint=...

STEP 4 (GitHub):
[ ] GitHub Personal Access Token: ghp_xxxxx

STEP 5 (Teams):
[ ] Teams Channel ID: 19:xxxxx@thread.tacv2
[ ] Teams Team ID: (if captured)

STEP 8 (Azure Functions):
[ ] Capture Function URL: https://openbrain-functions.azurewebsites.net/api/capture?code=xxxxx
[ ] MCP Function Base URL: https://openbrain-functions.azurewebsites.net/api/mcp

STEP 7 (Function Environment):
[ ] MCP Access Key: (whatever you created)

STEP 11 (Claude Desktop):
[ ] Claude Desktop MCP Configured (openbrain server added)
```

---

**Last Updated:** 2026-03-04  
**Written for:** Anyone with an Azure account who wants semantic search for their thinking  
**Status:** Ready to follow — all services are live and available  

Good luck building your brain. You've got this. 🧠✨

