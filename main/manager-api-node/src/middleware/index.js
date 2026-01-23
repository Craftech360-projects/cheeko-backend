/**
 * Middleware Index
 *
 * Exports all middleware modules for easy importing.
 */

const { ApiError, notFoundHandler, errorHandler, asyncHandler } = require('./errorHandler');
const {
  requireAuth,
  requireServiceKey,
  requireDualAuth,
  optionalAuth,
  requireSuperAdmin,
  requireRole
} = require('./auth');
const { validate, schemas } = require('./validation');
const { xssFilter, escapeHtml, sanitize, stripHtml } = require('./xssFilter');

module.exports = {
  // Error handling
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler,

  // Authentication
  requireAuth,
  requireServiceKey,
  requireDualAuth,
  optionalAuth,
  requireSuperAdmin,
  requireRole,

  // Validation
  validate,
  schemas,

  // XSS protection
  xssFilter,
  escapeHtml,
  sanitize,
  stripHtml
};
