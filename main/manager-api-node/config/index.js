/**
 * Configuration Loader
 *
 * Loads environment-specific configuration based on NODE_ENV.
 * Falls back to default if environment-specific config doesn't exist.
 */

const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Try to load environment-specific config, fall back to default
let config;

try {
  config = require(path.join(__dirname, `${NODE_ENV}.js`));
} catch {
  // Environment-specific config not found, use default
  config = require('./default');
}

// Export the configuration
module.exports = config;

// Also export a function to get config by environment
module.exports.getConfig = (env) => {
  try {
    return require(path.join(__dirname, `${env}.js`));
  } catch {
    return require('./default');
  }
};
