/**
 * Auth UI E2E Scenarios
 * Covers: 1.1 Admin login, 1.7 Role-based access
 */

const { test, expect } = require('../fixtures/test.fixture');
const { LoginPage } = require('../pages/login.page');
const { HomePage } = require('../pages/home.page');
const config = require('../../test.config');

test.describe('Authentication Scenarios', () => {

  test('1.1 - Admin login with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, config.auth.adminPass);
    await loginPage.expectLoginSuccess();

    // Verify home page loads with stats
    const homePage = new HomePage(page);
    await expect(page.locator('.add-device')).toBeVisible();
  });

  test('1.2 - Login with invalid credentials shows error', async ({ browser }) => {
    // Use fresh context — no saved auth
    const context = await browser.newContext();
    const page = await context.newPage();

    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login('wronguser', 'wrongpass');
    await loginPage.expectLoginError();

    // Should still be on login page
    await expect(page).toHaveURL(/login/);

    await context.close();
  });

  test('1.6 - Accessing protected route without auth redirects to login', async ({ browser }) => {
    // Fresh context — no saved auth
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/device-management');

    // Should redirect to login
    await expect(page).toHaveURL(/login/);

    await context.close();
  });

  test('1.7 - Authenticated admin can access all protected routes', async ({ page }) => {
    const protectedRoutes = [
      '/home',
      '/device-management',
      '/content-library',
      '/rfid-management',
      '/kid-profiles',
      '/user-management',
      '/game-analytics',
    ];

    for (const route of protectedRoutes) {
      await page.goto(route);
      // Should NOT be redirected to login
      await expect(page).not.toHaveURL(/login/);
    }
  });

});
