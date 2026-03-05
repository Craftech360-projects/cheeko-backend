/**
 * Jest Configuration for API + MQTT E2E scenarios
 *
 * Playwright has its own config (playwright.config.js).
 * This config covers PactumJS API flows and MQTT device simulation.
 */

module.exports = {
  testMatch: [
    '**/api/scenarios/**/*.spec.js',
    '**/mqtt/scenarios/**/*.spec.js',
  ],
  testTimeout: 30000,
  globalSetup: './api/helpers/global-setup.js',
  globalTeardown: './api/helpers/global-teardown.js',
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
