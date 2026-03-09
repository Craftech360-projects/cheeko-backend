module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/suites/**/*.test.js'],
  testTimeout: 10000,
  verbose: true,
  reporters: [
    'default',
    ['./lib/custom-reporter.js', {}]
  ],
  // Login once before all tests, cleanup after
  globalSetup: './lib/global-setup.js',
  globalTeardown: './lib/global-teardown.js',
  // Run test files sequentially (they hit a real server)
  maxWorkers: 1,
  // Force exit after tests complete (axios keeps connections alive)
  forceExit: true
};
