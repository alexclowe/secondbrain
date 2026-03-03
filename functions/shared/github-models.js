/**
 * github-models.js — GitHub Models API client for embeddings and metadata extraction
 * 
 * What this does:
 * - Calls GitHub Models API (free for GitHub users)
 * - generateEmbedding: Converts text to 1536-dim vector using text-embedding-3-small
 * - extractMetadata: Uses gpt-4o-mini to extract structured metadata from thoughts
 * - Both functions use GitHub Personal Access Token for authentication
 */

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com';

/**
 * Generate embedding vector for text using text-embedding-3-small
 * 
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - 1536-dimensional embedding vector
 * @throws {Error} - If API call fails or token is missing
 */
async function generateEmbedding(text) {
  const githubPat = process.env.GITHUB_PAT;
  
  if (!githubPat) {
    throw new Error('GITHUB_PAT environment variable not set');
  }

  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  try {
    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting with user-friendly message
      if (response.status === 429) {
        throw new Error('GitHub Models API rate limit reached (15 requests/minute). Please wait a moment and try again.');
      }
      
      throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // API returns array of embeddings, we only send one input
    if (!result.data || !result.data[0] || !result.data[0].embedding) {
      throw new Error('Invalid response format from embeddings API');
    }

    return result.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Extract structured metadata from thought content using gpt-4o-mini
 * 
 * @param {string} content - The thought content to analyze
 * @returns {Promise<Object>} - Metadata object with type, topics, people, actionItems, projects
 * @throws {Error} - If API call fails or token is missing
 */
async function extractMetadata(content) {
  const githubPat = process.env.GITHUB_PAT;
  
  if (!githubPat) {
    throw new Error('GITHUB_PAT environment variable not set');
  }

  if (!content || content.trim().length === 0) {
    // Return default metadata for empty content
    return {
      type: 'reference',
      topics: [],
      people: [],
      actionItems: [],
      projects: []
    };
  }

  try {
    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
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
          {
            role: 'user',
            content: content
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting with user-friendly message
      if (response.status === 429) {
        throw new Error('GitHub Models API rate limit reached (15 requests/minute). Please wait a moment and try again.');
      }
      
      throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
      throw new Error('Invalid response format from chat completions API');
    }

    const metadata = JSON.parse(result.choices[0].message.content);
    
    // Validate and set defaults for required fields
    return {
      type: metadata.type || 'reference',
      topics: Array.isArray(metadata.topics) ? metadata.topics : [],
      people: Array.isArray(metadata.people) ? metadata.people : [],
      actionItems: Array.isArray(metadata.actionItems) ? metadata.actionItems : [],
      projects: Array.isArray(metadata.projects) ? metadata.projects : []
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    
    // Return default metadata on error rather than failing
    return {
      type: 'reference',
      topics: [],
      people: [],
      actionItems: [],
      projects: []
    };
  }
}

module.exports = {
  generateEmbedding,
  extractMetadata
};
