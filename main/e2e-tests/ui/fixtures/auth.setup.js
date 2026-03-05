/**
 * Playwright Auth Setup
 *
 * Logs into the admin dashboard ONCE and saves the browser storage state.
 * All UI tests reuse this state — no re-login per test.
 */

const { test: setup } = require('@playwright/test');
const path = require('path');

const AUTH_STATE_FILE = path.resolve(__dirname, '..', '..', '.auth-state.json');

setup('authenticate as admin', async ({ page }) => {
  const config = require('../../test.config');

  // Navigate to login page
  await page.goto('/login');

  // Wait for the login form to be ready
  await page.waitForSelector('.login-box');

  // Fill username
  await page.locator('.input-box').filter({ hasText: '' }).first()
    .locator('input').fill(config.auth.adminUser);

  // Fill password
  await page.locator('input[type="password"]').fill(config.auth.adminPass);

  // The captcha might need special handling in test —
  // fill with bypass value if the API supports it
  await page.locator('input[placeholder="Enter verification code"]').fill('MOBILE_APP_BYPASS');

  // Click login button
  await page.locator('.login-btn').click();

  // Wait for navigation to home page
  await page.waitForURL('**/home', { timeout: 15000 });

  // Save auth state for other tests to reuse
  await page.context().storageState({ path: AUTH_STATE_FILE });
});
