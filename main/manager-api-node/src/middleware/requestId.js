/**
 * Request ID Middleware
 *
 * Adds a unique request ID to each incoming request for tracing and debugging.
 * The ID is available in req.requestId and added to response headers.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate or extract request ID
 * Uses X-Request-ID header if provided, otherwise generates a new UUID
 */
const requestIdMiddleware = (options = {}) => {
  const {
    headerName = 'X-Request-ID',
    generateId = () => uuidv4(),
    setHeader = true
  } = options;

  return (req, res, next) => {
    // Use existing request ID from header or generate new one
    const requestId = req.get(headerName) || generateId();

    // Attach to request object
    req.requestId = requestId;

    // Add to response headers
    if (setHeader) {
      res.setHeader(headerName, requestId);
    }

    next();
  };
};

module.exports = { requestIdMiddleware };
