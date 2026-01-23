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
 * Verify custom token from sys_user_token table
 * @param {string} token - Custom token
 * @returns {Promise<Object|null>} User data or null
 */
const verifyCustomToken = async (token) => {
  if (!supabaseAdmin) {
    logger.warn('Supabase not configured, cannot verify token');
    return null;
  }

  try {
    // Find valid token in sys_user_token table
    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('sys_user_token')
      .select('user_id, expire_date')
      .eq('token', token)
      .single();

    if (tokenError || !tokenData) {
      logger.debug('Token not found:', tokenError?.message);
      return null;
    }

    // Check expiration
    if (new Date(tokenData.expire_date) < new Date()) {
      logger.debug('Token expired');
      // Delete expired token
      await supabaseAdmin
        .from('sys_user_token')
        .delete()
        .eq('token', token);
      return null;
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from('sys_user')
      .select('id, username, email, role, status, created_at')
      .eq('id', tokenData.user_id)
      .eq('status', 1)
      .single();

    if (userError || !user) {
      logger.debug('User not found:', userError?.message);
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

  const user = await verifyCustomToken(token);
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
    const user = await verifyCustomToken(token);
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
    const user = await verifyCustomToken(token);
    if (user) {
      req.user = user;
      req.token = token;
    }
  }

  next();
};

/**
 * Middleware: Require admin role
 * Combines authentication and admin check
 */
const requireAdmin = async (req, res, next) => {
  // First verify authentication
  const token = extractBearerToken(req);

  if (!token) {
    return unauthorized(res, 'No authorization token provided');
  }

  const user = await verifyCustomToken(token);
  if (!user) {
    return unauthorized(res, 'Invalid or expired token');
  }

  req.user = user;
  req.token = token;

  // Check admin flag in user metadata or database
  const isAdmin = user.user_metadata?.admin === true ||
                  user.user_metadata?.super_admin === true ||
                  user.app_metadata?.admin === true ||
                  user.app_metadata?.super_admin === true ||
                  (user.app_metadata?.roles || []).includes('admin');

  if (!isAdmin) {
    return forbidden(res, 'Admin access required');
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
  verifyCustomToken,
  requireAuth,
  requireAdmin,
  requireServiceKey,
  requireDualAuth,
  optionalAuth,
  requireSuperAdmin,
  requireRole
};
