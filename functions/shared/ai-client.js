/**
 * ai-client.js — Azure OpenAI client with managed identity (zero keys)
 * 
 * Uses DefaultAzureCredential for authentication:
 * - In Azure: Function App's managed identity (automatic)
 * - Locally: Azure CLI credentials (az login)
 * 
 * Fallback: Set AI_PROVIDER=github to use GitHub Models API instead
 */

const { OpenAIClient } = require('@azure/openai');
const { DefaultAzureCredential } = require('@azure/identity');

// Check for fallback to GitHub Models
if (process.env.AI_PROVIDER === 'github') {
  const githubModels = require('./github-models');
  module.exports = githubModels;
  return;
}

let client = null;

function getClient() {
  if (!client) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT not set. Set AI_PROVIDER=github to use GitHub Models instead.');
    client = new OpenAIClient(endpoint, new DefaultAzureCredential());
  }
  return client;
}

/**
 * Generate embedding vector for text using text-embedding-3-small
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - 1536-dimensional embedding vector
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) throw new Error('Text cannot be empty');

  const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';
  const result = await getClient().getEmbeddings(deployment, [text]);
  return result.data[0].embedding;
}

/**
 * Extract structured metadata from thought content using gpt-4o-mini
 * @param {string} content - The thought content to analyze
 * @returns {Promise<Object>} - Metadata with type, topics, people, actionItems, projects
 */
async function extractMetadata(content) {
  if (!content || content.trim().length === 0) {
    return { type: 'reference', topics: [], people: [], actionItems: [], projects: [] };
  }

  try {
    const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';
    const result = await getClient().getChatCompletions(deployment, [
      {
        role: 'system',
        content: `Extract structured metadata from user thoughts. Analyze the content and return JSON with these fields:
- type: one of "idea", "question", "todo", "reference", "meeting_note"
- topics: array of relevant topic keywords (lowercase, 1-2 words each)
- people: array of people mentioned (names only)
- actionItems: array of action items or tasks mentioned
- projects: array of projects or initiatives mentioned

Return ONLY valid JSON. Be concise.`
      },
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
