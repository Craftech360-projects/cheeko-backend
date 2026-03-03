/**
 * Authentication Middleware
 *
 * Supports two authentication methods:
 * 1. Custom Token (Bearer token) - for user authentication via sys_user_token
 * 2. Service Key (X-Service-Key header) - for backend-to-backend calls
 */

const { prisma } = require('../config/database');
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
  try {
    logger.debug('Verifying token:', token ? `${token.substring(0, 20)}...` : 'empty');

    // Find token in sys_user_token table
    const tokenData = await prisma.sys_user_token.findFirst({
      where: { token },
      select: { user_id: true, expire_date: true },
    });

    if (!tokenData) {
      logger.debug('Token not found in sys_user_token');
      return null;
    }

    // Check expiration
    if (new Date(tokenData.expire_date) < new Date()) {
      logger.debug('Token expired');
      await prisma.sys_user_token.deleteMany({ where: { token } });
      return null;
    }

    // Get user
    const user = await prisma.sys_user.findFirst({
      where: { id: tokenData.user_id, status: 1 },
      select: { id: true, username: true, email: true, role: true, status: true, created_at: true },
    });

    if (!user) {
      logger.debug('User not found');
      return null;
    }

    // Map role to super_admin for compatibility with Spring Boot format
    user.super_admin = user.role === 'admin' ? 1 : 0;

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
  // Check for Service Key first (God Mode for internal tools)
  const serviceKey = extractServiceKey(req);
  if (serviceKey && SERVICE_SECRET_KEY && serviceKey === SERVICE_SECRET_KEY) {
    req.isServiceAuth = true;
    req.user = { id: 0, role: 'admin', super_admin: 1, email: 'service@internal' };
    return next();
  }

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

  // Check admin flag in user object (from custom token) or metadata (from Supabase Auth)
  const isAdmin = user.super_admin === 1 ||
    user.role === 'admin' ||
    user.user_metadata?.admin === true ||
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

  // Check super_admin flag in database (1 = super admin)
  // Also check metadata for backward compatibility
  const isSuperAdmin = req.user.super_admin === 1 ||
    req.user.user_metadata?.super_admin === true ||
    req.user.app_metadata?.super_admin === true ||
    req.user.role === 'admin'; // Fallback: treat 'admin' role as super admin

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
