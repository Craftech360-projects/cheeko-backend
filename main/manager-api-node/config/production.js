/**
 * Production Environment Configuration
 *
 * Settings optimized for production deployment.
 * Overrides default.js values.
 */

const defaultConfig = require('./default');

module.exports = {
  ...defaultConfig,

  // Server
  server: {
    ...defaultConfig.server,
    env: 'production'
  },

  // Logging - info level, file output enabled
  logging: {
    ...defaultConfig.logging,
    level: process.env.LOG_LEVEL || 'info'
  },

  // Rate Limiting - production limits
  rateLimit: {
    ...defaultConfig.rateLimit,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },

  // CORS - restrict to known origins
  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
      : []  // Must be explicitly configured in production
  },

  // Swagger - can be disabled in production
  swagger: {
    enabled: process.env.SWAGGER_ENABLED !== 'false',
    path: '/doc.html'
  }
};
