/**
 * capture/index.js — HTTP trigger function for capturing thoughts from Teams
 * 
 * What this does:
 * - Receives POST requests from Logic App (or Power Automate) with thought content
 * - Generates embedding and extracts metadata using Azure OpenAI
 * - Inserts thought into Cosmos DB
 * - Returns confirmation JSON for Teams reply
 * 
 * Expected input: { userId, content, source }
 * Returns: { id, message, metadata }
 */

const { app } = require('@azure/functions');
const { v4: uuidv4 } = require('uuid');
const { generateEmbedding, extractMetadata } = require('../shared/ai-client');
const { insertThought } = require('../shared/cosmos');

/**
 * HTTP trigger function handler for capturing thoughts
 */
app.http('capture', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    context.log('Capture function invoked');

    try {
      // Parse request body (handles both Logic App and Power Automate formats)
      const body = await request.json();
      let { userId, content, source, teamsContext } = body;

      // Logic App sends Teams HTML — strip tags
      if (content && content.includes('<')) {
        content = content.replace(/<[^>]*>/g, '').trim();
      }
      // Strip #brain hashtag from content
      if (content) {
        content = content.replace(/#brain\s*/gi, '').trim();
      }
      // Default userId
      userId = userId || process.env.DEFAULT_USER_ID || 'user-default';

      if (!content || content.trim().length === 0) {
        return {
          status: 400,
          jsonBody: {
            error: 'Missing required field: content'
          }
        };
      }

      context.log(`Capturing thought for user: ${userId}`);

      // Generate embedding and extract metadata in parallel
      const [embedding, metadata] = await Promise.all([
        generateEmbedding(content),
        extractMetadata(content)
      ]);

      // Create thought document
      const thoughtId = uuidv4();
      const now = new Date().toISOString();

      const thought = {
        id: thoughtId,
        userId: userId,
        content: content,
        embedding: embedding,
        metadata: metadata,
        source: source || 'api',
        createdAt: now,
        updatedAt: now
      };

      // Insert into Cosmos DB
      await insertThought(thought);

      context.log(`Successfully captured thought: ${thoughtId}`);

      // Return success response for Teams
      return {
        status: 200,
        jsonBody: {
          id: thoughtId,
          message: 'Captured!',
          metadata: {
            type: metadata.type,
            topics: metadata.topics,
            people: metadata.people,
            actionItems: metadata.actionItems,
            projects: metadata.projects
          }
        }
      };

    } catch (error) {
      context.error('Error capturing thought:', error);

      return {
        status: 500,
        jsonBody: {
          error: 'Failed to capture thought',
          details: error.message
        }
      };
    }
  }
});
