/**
 * Extended Test Fixture
 *
 * Adds an API client to Playwright tests so you can verify backend state
 * after UI actions in the same test.
 */

const playwright = require('@playwright/test');
const base = playwright.test;
const expect = playwright.expect;
const config = require('../../test.config');

const test = base.extend({
  /**
   * API client for backend verification within UI tests.
   * Uses Playwright's built-in request context.
   */
  apiClient: async ({ playwright }, use) => {
    const apiContext = await playwright.request.newContext({
      baseURL: config.managerApi.baseUrl,
      extraHTTPHeaders: {
        'X-Service-Key': config.auth.serviceKey,
        'Content-Type': 'application/json',
      },
    });
    await use(apiContext);
    await apiContext.dispose();
  },
});

module.exports = { test, expect };
