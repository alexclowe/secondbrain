/**
 * cosmos.js — Azure Cosmos DB client and helper functions
 * 
 * What this does:
 * - Singleton Cosmos DB client for reuse across function invocations
 * - Helper functions for inserting, searching, and querying thoughts
 * - Vector similarity search using Cosmos DB's VectorDistance function
 * - Browse recent thoughts with optional filtering
 * - Brain statistics aggregation queries
 */

const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

// Singleton client instance
let cosmosClient = null;
let container = null;

/**
 * Initialize and return Cosmos DB container client
 * Uses singleton pattern to reuse connection across invocations
 * Auth: Managed identity (DefaultAzureCredential) — no keys needed
 * Fallback: COSMOS_KEY env var for local dev or non-RBAC setups
 * 
 * @returns {Object} - Cosmos DB container client
 * @throws {Error} - If environment variables are missing
 */
function getContainer() {
  if (container) return container;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const databaseId = process.env.COSMOS_DATABASE || 'openbrain';
  const containerId = process.env.COSMOS_CONTAINER || 'thoughts';

  if (!endpoint) {
    throw new Error('Missing required env var: COSMOS_ENDPOINT');
  }

  // Prefer managed identity; fall back to key if COSMOS_KEY is set
  const key = process.env.COSMOS_KEY;
  if (key) {
    cosmosClient = new CosmosClient({ endpoint, key });
  } else {
    cosmosClient = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }

  container = cosmosClient.database(databaseId).container(containerId);
  return container;
}

/**
 * Insert a thought document into Cosmos DB
 * 
 * @param {Object} thought - Thought object with id, userId, content, embedding, metadata, source, timestamps
 * @returns {Promise<Object>} - Created document with Cosmos DB metadata
 * @throws {Error} - If insert fails
 */
async function insertThought(thought) {
  const container = getContainer();

  try {
    const { resource: createdItem } = await container.items.create(thought);
    return createdItem;
  } catch (error) {
    console.error('Error inserting thought into Cosmos DB:', error);
    throw new Error(`Failed to insert thought: ${error.message}`);
  }
}

/**
 * Search thoughts using vector similarity (semantic search)
 * Uses Cosmos DB's VectorDistance function with cosine distance
 * 
 * @param {number[]} embedding - Query embedding vector (1536 dimensions)
 * @param {number} limit - Maximum number of results (default: 10)
 * @param {number} threshold - Similarity threshold, 0-1 (default: 0.3, lower = more similar)
 * @returns {Promise<Array>} - Array of matching thoughts with similarity scores
 * @throws {Error} - If search fails
 */
async function searchThoughts(embedding, limit = 10, threshold = 0.3) {
  const container = getContainer();

  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error('Embedding must be an array of 1536 numbers');
  }

  const querySpec = {
    query: `SELECT c.id, c.userId, c.content, c.metadata, c.source, c.createdAt, 
            VectorDistance(c.embedding, @embedding) AS similarity
            FROM c
            WHERE VectorDistance(c.embedding, @embedding) < @threshold
            ORDER BY VectorDistance(c.embedding, @embedding)
            OFFSET 0 LIMIT @limit`,
    parameters: [
      { name: '@embedding', value: embedding },
      { name: '@threshold', value: threshold },
      { name: '@limit', value: limit }
    ]
  };

  try {
    const { resources: results } = await container.items
      .query(querySpec)
      .fetchAll();

    return results;
  } catch (error) {
    console.error('Error searching thoughts:', error);
    throw new Error(`Vector search failed: ${error.message}`);
  }
}

/**
 * Browse recent thoughts with optional filtering
 * 
 * @param {number} limit - Maximum number of results (default: 20)
 * @param {Object} filter - Optional filter object with type and/or topics
 * @returns {Promise<Array>} - Array of recent thoughts sorted by createdAt DESC
 * @throws {Error} - If query fails
 */
async function browseRecent(limit = 20, filter = null) {
  const container = getContainer();

  let query = 'SELECT c.id, c.userId, c.content, c.metadata, c.source, c.createdAt FROM c';
  const parameters = [];

  // Add filters if provided
  const whereClauses = [];
  
  if (filter) {
    if (filter.type) {
      whereClauses.push('c.metadata.type = @type');
      parameters.push({ name: '@type', value: filter.type });
    }
    
    if (filter.topics && Array.isArray(filter.topics) && filter.topics.length > 0) {
      // Check if any of the provided topics exist in the thought's topics array
      // Use ARRAY_CONTAINS with multiple OR conditions
      const topicConditions = filter.topics.map((_, i) => `ARRAY_CONTAINS(c.metadata.topics, @topic${i})`);
      whereClauses.push(`(${topicConditions.join(' OR ')})`);
      filter.topics.forEach((topic, i) => {
        parameters.push({ name: `@topic${i}`, value: topic });
      });
    }
  }

  if (whereClauses.length > 0) {
    query += ' WHERE ' + whereClauses.join(' AND ');
  }

  query += ' ORDER BY c.createdAt DESC';
  query += ` OFFSET 0 LIMIT @limit`;
  parameters.push({ name: '@limit', value: limit });

  const querySpec = { query, parameters };

  try {
    const { resources: results } = await container.items
      .query(querySpec)
      .fetchAll();

    return results;
  } catch (error) {
    console.error('Error browsing recent thoughts:', error);
    throw new Error(`Browse query failed: ${error.message}`);
  }
}

/**
 * Get brain statistics (total thoughts, by type, top topics)
 * 
 * @returns {Promise<Object>} - Stats object with totalThoughts, byType, topTopics
 * @throws {Error} - If query fails
 */
async function getStats() {
  const container = getContainer();

  try {
    // Get total count
    const countQuery = {
      query: 'SELECT VALUE COUNT(1) FROM c'
    };
    const { resources: countResult } = await container.items.query(countQuery).fetchAll();
    const totalThoughts = countResult[0] || 0;

    // Get count by type
    const typeQuery = {
      query: 'SELECT c.metadata.type as type, COUNT(1) as count FROM c GROUP BY c.metadata.type'
    };
    const { resources: typeResults } = await container.items.query(typeQuery).fetchAll();
    
    const byType = {};
    typeResults.forEach(item => {
      byType[item.type || 'unknown'] = item.count;
    });

    // Get all topics (need to flatten array field)
    const topicsQuery = {
      query: 'SELECT c.metadata.topics FROM c WHERE IS_DEFINED(c.metadata.topics)'
    };
    const { resources: topicsResults } = await container.items.query(topicsQuery).fetchAll();
    
    // Count topic occurrences
    const topicCounts = {};
    topicsResults.forEach(item => {
      if (Array.isArray(item.topics)) {
        item.topics.forEach(topic => {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });
      }
    });

    // Get top 10 topics
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));

    return {
      totalThoughts,
      byType,
      topTopics
    };
  } catch (error) {
    console.error('Error getting brain stats:', error);
    throw new Error(`Stats query failed: ${error.message}`);
  }
}

module.exports = {
  getContainer,
  insertThought,
  searchThoughts,
  browseRecent,
  getStats
};
