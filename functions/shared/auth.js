/**
 * auth.js — Simple authentication validation for Azure Functions
 * 
 * What this does:
 * - Validates MCP access key from request headers or query params
 * - Returns boolean (true = valid, false = invalid)
 * - Used by MCP server function to restrict access
 */

/**
 * Validate MCP access key from request
 * Checks both X-MCP-Access-Key header and ?key= query parameter
 * 
 * @param {Object} req - Azure Functions HTTP request object
 * @returns {boolean} - True if key matches, false otherwise
 */
function validateMcpKey(req) {
  const expectedKey = process.env.MCP_ACCESS_KEY;
  
  // No key configured = open access (development mode)
  if (!expectedKey) {
    console.warn('WARNING: MCP_ACCESS_KEY not set - allowing all requests');
    return true;
  }

  // Check header first (preferred method)
  const headerKey = req.headers.get('x-mcp-access-key');
  if (headerKey === expectedKey) {
    return true;
  }

  // Fallback to query parameter
  const queryKey = req.query.get('key');
  if (queryKey === expectedKey) {
    return true;
  }

  // No valid key found
  return false;
}

module.exports = {
  validateMcpKey
};
