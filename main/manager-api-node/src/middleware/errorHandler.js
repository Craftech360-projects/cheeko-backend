/**
 * Error Handling Middleware
 *
 * Global error handler and 404 handler for Express.
 * Formats errors to match Spring Boot API response format.
 */

const logger = require('../utils/logger');

/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found (404) Handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new ApiError(`Not found: ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Global Error Handler
 */
const errorHandler = (err, req, res, next) => {
  // Default values
  let statusCode = err.statusCode || 500;
  let code = err.code || statusCode;
  let message = err.message || 'Internal server error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    // Joi validation errors
    statusCode = 400;
    code = 400;
    message = err.details?.map(d => d.message).join(', ') || 'Validation error';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 401;
    message = 'Token expired';
  } else if (err.code === 'PGRST') {
    // Supabase/PostgREST errors
    statusCode = 400;
    code = 400;
    message = err.message;
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    code = 409;
    message = 'Resource already exists';
  } else if (err.code === '23503') {
    // PostgreSQL foreign key violation
    statusCode = 400;
    code = 400;
    message = 'Referenced resource does not exist';
  }

  // Log the error with request ID for tracing
  const logMeta = {
    requestId: req.requestId,
    message: err.message,
    url: req.originalUrl,
    method: req.method,
    statusCode
  };

  if (statusCode >= 500) {
    logger.error('Server error:', {
      ...logMeta,
      stack: err.stack,
      ip: req.ip
    });
  } else {
    logger.warn('Client error:', logMeta);
  }

  // Don't leak stack traces in production
  const stack = process.env.NODE_ENV === 'development' ? err.stack : undefined;

  // Send response matching Spring Boot format
  res.status(statusCode).json({
    code,
    msg: message,
    data: stack ? { stack } : null
  });
};

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler
};
