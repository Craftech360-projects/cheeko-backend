module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/suites/**/*.test.js'],
  testTimeout: 10000,
  verbose: true,
  reporters: [
    'default',
    ['./lib/custom-reporter.js', {}]
  ],
  // Run test files sequentially (they hit a real server)
  maxWorkers: 1,
  // Force exit after tests complete (axios keeps connections alive)
  forceExit: true
};
