/**
 * Jest Configuration for LiveKit Media API E2E scenarios
 */

module.exports = {
  testMatch: [
    '**/livekit/scenarios/**/*.spec.js',
  ],
  testTimeout: 30000,
  reporters: [
    'default',
    './scripts/jest-json-reporter.js',
  ],
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
