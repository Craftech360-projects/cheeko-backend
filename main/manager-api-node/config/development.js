/**
 * Development Environment Configuration
 *
 * Settings optimized for local development.
 * Overrides default.js values.
 */

const defaultConfig = require('./default');

module.exports = {
  ...defaultConfig,

  // Server
  server: {
    ...defaultConfig.server,
    env: 'development'
  },

  // Logging - verbose for debugging
  logging: {
    ...defaultConfig.logging,
    level: process.env.LOG_LEVEL || 'debug'
  },

  // Rate Limiting - more permissive for dev
  rateLimit: {
    ...defaultConfig.rateLimit,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000
  },

  // CORS - allow all localhost ports in dev
  cors: {
    origins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
      : [
        'http://localhost:8080',
        'http://localhost:3000',
        'http://localhost:5173', // Vite default
        'http://127.0.0.1:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173'
      ]
  },

  // Swagger - enabled
  swagger: {
    enabled: true,
    path: '/doc.html'
  }
};
