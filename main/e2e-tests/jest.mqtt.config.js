/**
 * Jest Configuration for MQTT E2E tests only.
 *
 * Uses MQTT-specific global setup (broker + gateway check only,
 * no Manager API auth required).
 *
 * Run with: npx jest --config jest.mqtt.config.js
 */

module.exports = {
  testMatch: [
    '**/mqtt/scenarios/**/*.spec.js',
  ],
  testTimeout: 30000,
  globalSetup: './mqtt/helpers/global-setup.js',
  globalTeardown: './mqtt/helpers/global-teardown.js',
  reporters: [
    'default',
    './scripts/jest-json-reporter.js',
  ],
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
