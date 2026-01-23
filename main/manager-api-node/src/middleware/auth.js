/**
 * Authentication Middleware
 *
 * Supports two authentication methods:
 * 1. Supabase Auth (Bearer token) - for user authentication
 * 2. Service Key (X-Service-Key header) - for backend-to-backend calls
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { unauthorized, forbidden } = require('../utils/response');

const SERVICE_SECRET_KEY = process.env.SERVICE_SECRET_KEY;

/**
 * Extract Bearer token from Authorization header
 * @param {Object} req - Express request
 * @returns {string|null} Token or null
 */
const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
};

/**
 * Extract Service Key from X-Service-Key header
 * @param {Object} req - Express request
 * @returns {string|null} Service key or null
 */
const extractServiceKey = (req) => {
  return req.headers['x-service-key'] || null;
};

/**
 * Verify Supabase JWT token
 * @param {string} token - JWT token
 * @returns {Promise<Object|null>} User data or null
 */
const verifySupabaseToken = async (token) => {
  if (!supabaseAdmin) {
    logger.warn('Supabase not configured, cannot verify token');
    return null;
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      logger.debug('Token verification failed:', error?.message);
      return null;
    }
    return user;
  } catch (error) {
    logger.error('Token verification error:', error);
    return null;
  }
};

/**
 * Middleware: Require OAuth2 authentication (Supabase Auth)
 * Attaches user to req.user if authenticated
 */
const requireAuth = async (req, res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    return unauthorized(res, 'No authorization token provided');
  }

  const user = await verifySupabaseToken(token);
  if (!user) {
    return unauthorized(res, 'Invalid or expired token');
  }

  req.user = user;
  req.token = token;
  next();
};

/**
 * Middleware: Require Service Key authentication
 * For backend-to-backend calls (e.g., from LiveKit agents)
 */
const requireServiceKey = (req, res, next) => {
  const serviceKey = extractServiceKey(req);

  if (!serviceKey) {
    return unauthorized(res, 'No service key provided');
  }

  if (!SERVICE_SECRET_KEY) {
    logger.warn('SERVICE_SECRET_KEY not configured');
    return unauthorized(res, 'Service authentication not configured');
  }

  if (serviceKey !== SERVICE_SECRET_KEY) {
    return unauthorized(res, 'Invalid service key');
  }

  req.isServiceAuth = true;
  next();
};

/**
 * Middleware: Dual authentication (OAuth2 OR Service Key)
 * Allows either authentication method
 */
const requireDualAuth = async (req, res, next) => {
  const token = extractBearerToken(req);
  const serviceKey = extractServiceKey(req);

  // Try service key first (faster check)
  if (serviceKey) {
    if (SERVICE_SECRET_KEY && serviceKey === SERVICE_SECRET_KEY) {
      req.isServiceAuth = true;
      return next();
    }
  }

  // Try OAuth2 token
  if (token) {
    const user = await verifySupabaseToken(token);
    if (user) {
      req.user = user;
      req.token = token;
      return next();
    }
  }

  return unauthorized(res, 'Authentication required');
};

/**
 * Middleware: Optional authentication
 * Attaches user to req.user if authenticated, but allows unauthenticated access
 */
const optionalAuth = async (req, res, next) => {
  const token = extractBearerToken(req);
  const serviceKey = extractServiceKey(req);

  // Check service key
  if (serviceKey && SERVICE_SECRET_KEY && serviceKey === SERVICE_SECRET_KEY) {
    req.isServiceAuth = true;
  }

  // Check OAuth2 token
  if (token) {
    const user = await verifySupabaseToken(token);
    if (user) {
      req.user = user;
      req.token = token;
    }
  }

  next();
};

/**
 * Middleware: Require super admin role
 * Must be used after requireAuth
 */
const requireSuperAdmin = async (req, res, next) => {
  if (!req.user) {
    return unauthorized(res, 'Authentication required');
  }

  // Check super_admin flag in user metadata or database
  // For now, check if user has admin role in metadata
  const isSuperAdmin = req.user.user_metadata?.super_admin === true ||
                       req.user.app_metadata?.super_admin === true;

  if (!isSuperAdmin) {
    return forbidden(res, 'Super admin access required');
  }

  next();
};

/**
 * Middleware factory: Require specific role
 * @param {string} role - Required role name
 */
const requireRole = (role) => {
  return async (req, res, next) => {
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const userRoles = req.user.app_metadata?.roles || [];
    if (!userRoles.includes(role)) {
      return forbidden(res, `Role '${role}' required`);
    }

    next();
  };
};

module.exports = {
  extractBearerToken,
  extractServiceKey,
  verifySupabaseToken,
  requireAuth,
  requireServiceKey,
  requireDualAuth,
  optionalAuth,
  requireSuperAdmin,
  requireRole
};
