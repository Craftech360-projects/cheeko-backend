/**
 * Playwright Configuration for UI E2E scenarios
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env'), quiet: true });

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:8080';

// Timestamped report folder so each run is preserved
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportFolder = `reports/playwright/${timestamp}`;

module.exports = defineConfig({
  globalTeardown: './scripts/playwright-teardown.js',
  testDir: './ui/scenarios',
  fullyParallel: false, // scenarios are sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60000,

  reporter: [
    ['html', { outputFolder: reportFolder, open: 'never' }],
    ['json', { outputFile: `${reportFolder}/results.json` }],
    ['list'],
  ],

  use: {
    baseURL: DASHBOARD_URL,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
    headless: process.env.HEADLESS !== 'false',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },

  projects: [
    // Setup project — logs in and saves auth state
    {
      name: 'setup',
      testMatch: /.*\.setup\.js/,
      testDir: './ui/fixtures',
    },
    // Main tests — use saved auth state
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.resolve(__dirname, '.auth-state.json'),
      },
      dependencies: ['setup'],
    },
  ],
});
