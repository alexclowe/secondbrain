/**
 * MCP Server — Azure Function
 * 
 * Implements Model Context Protocol (JSON-RPC 2.0) over HTTP
 * Provides 4 tools for Claude Desktop / VS Code to interact with Open Brain
 * 
 * MCP Protocol: https://spec.modelcontextprotocol.io/specification/2024-11-05/
 * Transport: Streamable HTTP (handles both POST for messages and GET for SSE)
 * 
 * No SDK dependency — implements the JSON-RPC protocol directly for
 * maximum compatibility with Azure Functions.
 */

const { app } = require('@azure/functions');
const { v4: uuidv4 } = require('uuid');
const cosmos = require('../shared/cosmos');
const aiClient = require('../shared/ai-client');
const auth = require('../shared/auth');

// MCP protocol version
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * MCP Tool Definitions — what AI clients see when they connect
 */
const TOOLS = [
  {
    name: 'search_thoughts',
    description: 'Semantic search across captured thoughts using vector similarity. Returns thoughts ranked by relevance to your query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "ideas about AI", "meeting notes with Alice")'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)',
          default: 10
        }
      },
      required: ['query']
    }
  },
  {
    name: 'browse_recent',
    description: 'Browse recently captured thoughts sorted by date. Useful for reviewing what you\'ve been thinking about lately.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of thoughts to retrieve (default: 20)',
          default: 20
        },
        filter: {
          type: 'object',
          description: 'Optional filters',
          properties: {
            type: {
              type: 'string',
              enum: ['idea', 'question', 'todo', 'reference', 'meeting_note']
            },
            topics: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  },
  {
    name: 'brain_stats',
    description: 'Get statistics about your Open Brain: total thoughts, breakdown by type, top topics.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'capture_thought',
    description: 'Capture a new thought directly from your AI assistant. It will be embedded, analyzed for metadata, and stored in your brain.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The thought content to capture'
        },
        source: {
          type: 'string',
          description: 'Source of the thought (default: "mcp")',
          default: 'mcp'
        }
      },
      required: ['content']
    }
  }
];

// ─── JSON-RPC Request Handlers ───────────────────────────────────────────────

/**
 * Handle MCP initialize request — handshake with the client
 */
function handleInitialize(params) {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {}
    },
    serverInfo: {
      name: 'openbrain',
      version: '1.0.0'
    }
  };
}

/**
 * Handle tools/list — return available tools
 */
function handleToolsList() {
  return { tools: TOOLS };
}

/**
 * Handle tools/call — execute a tool and return results
 */
async function handleToolsCall(params, context) {
  const { name, arguments: args = {} } = params;
  context.log(`MCP tool call: ${name}`);

  switch (name) {
    case 'search_thoughts': {
      const { query, limit = 10 } = args;
      const embedding = await aiClient.generateEmbedding(query);
      const results = await cosmos.searchThoughts(embedding, limit, 0.3);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            count: results.length,
            thoughts: results.map(t => ({
              id: t.id,
              content: t.content,
              similarity: (1 - (t.similarity || 0)).toFixed(3),
              type: t.metadata?.type,
              topics: t.metadata?.topics || [],
              people: t.metadata?.people || [],
              createdAt: t.createdAt
            }))
          }, null, 2)
        }]
      };
    }

    case 'browse_recent': {
      const { limit = 20, filter } = args;
      const results = await cosmos.browseRecent(limit, filter);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: results.length,
            thoughts: results.map(t => ({
              id: t.id,
              content: t.content,
              type: t.metadata?.type,
              topics: t.metadata?.topics || [],
              people: t.metadata?.people || [],
              createdAt: t.createdAt
            }))
          }, null, 2)
        }]
      };
    }

    case 'brain_stats': {
      const stats = await cosmos.getStats();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: `Your Open Brain contains ${stats.totalThoughts} thoughts`,
            totalThoughts: stats.totalThoughts,
            byType: stats.byType,
            topTopics: stats.topTopics
          }, null, 2)
        }]
      };
    }

    case 'capture_thought': {
      const { content, source = 'mcp' } = args;

      // Validate content
      if (!content || content.trim().length === 0) {
        throw new Error('Content cannot be empty');
      }

      // Generate embedding and extract metadata in parallel
      const [embedding, metadata] = await Promise.all([
        aiClient.generateEmbedding(content),
        aiClient.extractMetadata(content)
      ]);

      const thought = {
        id: uuidv4(),
        userId: 'default',
        content,
        embedding,
        metadata,
        source,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await cosmos.insertThought(thought);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: '✅ Thought captured to Open Brain!',
            id: thought.id,
            type: metadata.type,
            topics: metadata.topics,
            people: metadata.people,
            actionItems: metadata.actionItems || []
          }, null, 2)
        }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC Message Router ─────────────────────────────────────────────────

/**
 * Route a JSON-RPC request to the correct handler
 * Returns a JSON-RPC response object (or null for notifications)
 */
async function routeJsonRpc(message, context) {
  const { method, params, id } = message;

  // Notifications (no id) — acknowledge but don't return a response
  if (id === undefined) {
    if (method === 'notifications/initialized') {
      context.log('Client initialized notification received');
    }
    return null; // Notifications don't get responses
  }

  let result;
  try {
    switch (method) {
      case 'initialize':
        result = handleInitialize(params);
        break;
      case 'tools/list':
        result = handleToolsList();
        break;
      case 'tools/call':
        result = await handleToolsCall(params, context);
        break;
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }

    return { jsonrpc: '2.0', id, result };
  } catch (error) {
    context.error(`Error handling ${method}:`, error);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error.message }
    };
  }
}

// ─── Azure Function HTTP Trigger ─────────────────────────────────────────────

// Track active SSE sessions (in-memory, per-instance)
const sessions = new Map();

app.http('mcp-server', {
  methods: ['GET', 'POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'mcp',
  handler: async (request, context) => {
    // Validate access key on every request
    if (!auth.validateMcpKey(request)) {
      return {
        status: 401,
        jsonBody: { error: 'Unauthorized: Invalid or missing access key' }
      };
    }

    const method = request.method;

    // ── POST: Handle JSON-RPC messages ──
    if (method === 'POST') {
      try {
        const body = await request.json();
        context.log('MCP POST received:', JSON.stringify(body).substring(0, 200));

        // Check for session ID header (Streamable HTTP)
        const sessionId = request.headers.get('mcp-session-id');

        // Handle batch requests (array of messages)
        if (Array.isArray(body)) {
          const responses = [];
          for (const message of body) {
            const response = await routeJsonRpc(message, context);
            if (response) responses.push(response);
          }

          // Generate session ID on initialize
          const newSessionId = !sessionId ? uuidv4() : sessionId;
          const headers = {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': newSessionId
          };

          return {
            status: 200,
            headers,
            jsonBody: responses.length === 1 ? responses[0] : responses
          };
        }

        // Handle single request
        const response = await routeJsonRpc(body, context);

        // Generate session ID on initialize
        const newSessionId = body.method === 'initialize' ? uuidv4() : (sessionId || uuidv4());
        const headers = {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': newSessionId
        };

        if (!response) {
          // Notification — no response body needed
          return { status: 202, headers };
        }

        return { status: 200, headers, jsonBody: response };

      } catch (error) {
        context.error('MCP POST error:', error);
        return {
          status: 400,
          jsonBody: {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${error.message}` }
          }
        };
      }
    }

    // ── GET: SSE endpoint (for streaming, if client requests it) ──
    if (method === 'GET') {
      const accept = request.headers.get('accept') || '';
      if (accept.includes('text/event-stream')) {
        // For Azure Functions consumption plan, long-lived SSE is limited.
        // Return a simple "connected" event and let POST handle actual work.
        const sessionId = uuidv4();
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Mcp-Session-Id': sessionId
          },
          body: `event: endpoint\ndata: /api/mcp\n\n`
        };
      }

      // Regular GET — return server info
      return {
        status: 200,
        jsonBody: {
          name: 'openbrain',
          version: '1.0.0',
          protocol: MCP_PROTOCOL_VERSION,
          status: 'ok'
        }
      };
    }

    // ── DELETE: Close session ──
    if (method === 'DELETE') {
      const sessionId = request.headers.get('mcp-session-id');
      if (sessionId) {
        sessions.delete(sessionId);
      }
      return { status: 200, jsonBody: { message: 'Session closed' } };
    }

    return { status: 405, jsonBody: { error: 'Method not allowed' } };
  }
});
