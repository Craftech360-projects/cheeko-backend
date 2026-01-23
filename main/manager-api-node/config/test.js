/**
 * Test Environment Configuration
 *
 * Settings optimized for automated testing.
 * Overrides default.js values.
 */

const defaultConfig = require('./default');

module.exports = {
  ...defaultConfig,

  // Server
  server: {
    ...defaultConfig.server,
    env: 'test',
    port: parseInt(process.env.PORT) || 0  // Random port for parallel tests
  },

  // Logging - silent unless explicitly enabled
  logging: {
    ...defaultConfig.logging,
    level: process.env.LOG_LEVEL || 'error',
    enableInTest: process.env.LOG_IN_TEST === 'true'
  },

  // Rate Limiting - disabled for tests
  rateLimit: {
    ...defaultConfig.rateLimit,
    maxRequests: 10000
  },

  // CORS - allow all in tests
  cors: {
    origins: ['*']
  },

  // Swagger - enabled for testing documentation
  swagger: {
    enabled: true,
    path: '/doc.html'
  }
};
