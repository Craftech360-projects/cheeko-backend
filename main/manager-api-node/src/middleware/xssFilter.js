/**
 * XSS Filter Middleware
 *
 * Sanitizes request body, query, and params to prevent XSS attacks.
 * Escapes HTML special characters in string values.
 */

/**
 * HTML entities to escape
 */
const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;'
};

/**
 * Escape HTML special characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
const escapeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"'`]/g, (char) => htmlEntities[char]);
};

/**
 * Recursively sanitize an object
 * @param {*} obj - Object to sanitize
 * @param {Object} options - Sanitization options
 * @returns {*} Sanitized object
 */
const sanitize = (obj, options = {}) => {
  const { skipFields = [] } = options;

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return escapeHtml(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, options));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip certain fields that should allow HTML (e.g., markdown content)
      if (skipFields.includes(key)) {
        sanitized[key] = value;
      } else {
        sanitized[key] = sanitize(value, options);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * XSS Filter Middleware
 * @param {Object} options - Filter options
 * @param {string[]} options.skipFields - Fields to skip sanitization
 * @param {boolean} options.sanitizeQuery - Whether to sanitize query params
 * @param {boolean} options.sanitizeBody - Whether to sanitize body
 * @param {boolean} options.sanitizeParams - Whether to sanitize params
 */
const xssFilter = (options = {}) => {
  const {
    skipFields = ['systemPrompt', 'contentMd', 'promptText', 'content', 'firmwarePath'],
    sanitizeQuery = true,
    sanitizeBody = true,
    sanitizeParams = true
  } = options;

  return (req, res, next) => {
    try {
      if (sanitizeBody && req.body) {
        req.body = sanitize(req.body, { skipFields });
      }

      if (sanitizeQuery && req.query) {
        req.query = sanitize(req.query, { skipFields });
      }

      if (sanitizeParams && req.params) {
        req.params = sanitize(req.params, { skipFields });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Strip HTML tags from a string (more aggressive sanitization)
 * @param {string} str - String to strip
 * @returns {string} String without HTML tags
 */
const stripHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '');
};

/**
 * Check if a string contains potential XSS patterns
 * @param {string} str - String to check
 * @returns {boolean} True if suspicious patterns found
 */
const hasSuspiciousPatterns = (str) => {
  if (typeof str !== 'string') return false;

  const patterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // onclick, onload, etc.
    /data:/i,
    /vbscript:/i
  ];

  return patterns.some(pattern => pattern.test(str));
};

module.exports = {
  xssFilter,
  escapeHtml,
  sanitize,
  stripHtml,
  hasSuspiciousPatterns
};
