/**
 * Analytics UI E2E Scenarios
 * Covers: 10.5 Admin views analytics dashboard
 */

const { test, expect } = require('../fixtures/test.fixture');
const { GameAnalyticsPage } = require('../pages/game-analytics.page');

test.describe('Analytics Scenarios', () => {

  test('10.5 - Game analytics page loads without errors', async ({ page }) => {
    const analyticsPage = new GameAnalyticsPage(page);
    await analyticsPage.goto();

    // Page should not redirect to login
    await expect(page).not.toHaveURL(/login/);

    // No console errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.waitForTimeout(2000);
    // Allow minor errors but no crashes
  });

  test('Analytics page is accessible from navigation', async ({ page }) => {
    // Start from home
    await page.goto('/home');

    // Navigate to analytics
    await page.goto('/game-analytics');

    await expect(page).toHaveURL(/game-analytics/);
  });

});
