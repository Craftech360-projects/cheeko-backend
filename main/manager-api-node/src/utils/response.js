/**
 * Standardized API Response Utilities
 *
 * Matches the response format from the Spring Boot API:
 * {
 *   "code": 0,        // 0 = success, non-zero = error
 *   "msg": "success", // Message string
 *   "data": {}        // Response data
 * }
 */

/**
 * Success response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} msg - Success message
 * @param {number} statusCode - HTTP status code
 */
const success = (res, data = null, msg = 'success', statusCode = 200) => {
  return res.status(statusCode).json({
    code: 0,
    msg,
    data
  });
};

/**
 * Created response (201)
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} msg - Success message
 */
const created = (res, data = null, msg = 'Created successfully') => {
  return success(res, data, msg, 201);
};

/**
 * Error response
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 * @param {number} code - Error code (non-zero)
 * @param {number} statusCode - HTTP status code
 * @param {*} data - Additional error data
 */
const error = (res, msg = 'An error occurred', code = 500, statusCode = 500, data = null) => {
  return res.status(statusCode).json({
    code,
    msg,
    data
  });
};

/**
 * Bad request response (400)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 * @param {*} data - Validation errors or additional data
 */
const badRequest = (res, msg = 'Bad request', data = null) => {
  return error(res, msg, 400, 400, data);
};

/**
 * Unauthorized response (401)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 */
const unauthorized = (res, msg = 'Unauthorized') => {
  return error(res, msg, 401, 401);
};

/**
 * Forbidden response (403)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 */
const forbidden = (res, msg = 'Forbidden') => {
  return error(res, msg, 403, 403);
};

/**
 * Not found response (404)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 */
const notFound = (res, msg = 'Resource not found') => {
  return error(res, msg, 404, 404);
};

/**
 * Conflict response (409)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 */
const conflict = (res, msg = 'Resource already exists') => {
  return error(res, msg, 409, 409);
};

/**
 * Internal server error response (500)
 * @param {Object} res - Express response object
 * @param {string} msg - Error message
 */
const serverError = (res, msg = 'Internal server error') => {
  return error(res, msg, 500, 500);
};

/**
 * Paginated response
 * Matches Spring Boot PageUtils format
 * @param {Object} res - Express response object
 * @param {Array} list - List of items
 * @param {number} total - Total number of items
 * @param {number} page - Current page number (1-indexed)
 * @param {number} limit - Items per page
 */
const paginated = (res, list, total, page, limit) => {
  const totalPages = Math.ceil(total / limit);

  return success(res, {
    list,
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  });
};

module.exports = {
  success,
  created,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serverError,
  paginated
};
