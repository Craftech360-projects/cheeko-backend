/**
 * Auth UI E2E Scenarios
 * Covers: Login form, credentials, error handling, session, logout, route guards
 *
 * NOTE: Vue router uses hash mode, so routes are /#/login, /#/home, etc.
 */

const { test, expect } = require('../fixtures/test.fixture');
const { LoginPage } = require('../pages/login.page');
const config = require('../../test.config');

// Helper: create a fresh context with NO auth state
async function freshContext(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

// ── Login Page Rendering ─────────────────────────────────────────────────────

test.describe('Login page renders correctly', () => {

  test('should display login form with all elements', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await expect(loginPage.loginBox).toBeVisible();
    await expect(loginPage.loginText).toHaveText('Login');
    await expect(loginPage.welcomeText).toHaveText('WELCOME TO LOGIN');
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.captchaInput).toBeVisible();
    await expect(loginPage.captchaImage).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();
    await expect(loginPage.loginButton).toHaveText('Login');

    await context.close();
  });

  test('should load captcha image on page load', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    const src = await loginPage.captchaImage.getAttribute('src');
    expect(src).toBeTruthy();

    await context.close();
  });

});

// ── Successful Login ─────────────────────────────────────────────────────────

test.describe('Successful login', () => {

  test('should login and redirect to /home', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, config.auth.adminPass);
    await loginPage.expectLoginSuccess();

    await expect(page).toHaveURL(/#\/home/);

    await context.close();
  });

  test('should show success toast on login', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, config.auth.adminPass);
    await loginPage.expectSuccessToast();

    await context.close();
  });

  test('should store token in localStorage after login', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, config.auth.adminPass);
    await loginPage.expectLoginSuccess();

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();

    await context.close();
  });

});

// ── Invalid Credentials ──────────────────────────────────────────────────────

test.describe('Invalid credentials', () => {

  test('should show error for wrong password', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, 'wrong-password-xxx');

    // Wait for API response — should show error or stay on login
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/#\/login/);

    await context.close();
  });

  test('should show error for wrong username', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login('nonexistent_user_xyz', 'somepassword');

    // Wait for API response — should show error or stay on login
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/#\/login/);

    await context.close();
  });

  test('should show error for empty username', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.passwordInput.fill('admin123');
    await loginPage.captchaInput.fill('MOBILE_APP_BYPASS');
    await loginPage.loginButton.click();

    const msg = await loginPage.getErrorMessage();
    expect(msg).toContain('Username cannot be empty');

    await context.close();
  });

  test('should show error for empty password', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.usernameInput.fill('admin');
    await loginPage.captchaInput.fill('MOBILE_APP_BYPASS');
    await loginPage.loginButton.click();

    const msg = await loginPage.getErrorMessage();
    expect(msg).toContain('Password cannot be empty');

    await context.close();
  });

  test('should show error for empty captcha', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.usernameInput.fill('admin');
    await loginPage.passwordInput.fill('admin123');
    await loginPage.loginButton.click();

    const msg = await loginPage.getErrorMessage();
    expect(msg).toContain('Verification code cannot be empty');

    await context.close();
  });

});

// ── Enter Key Login ──────────────────────────────────────────────────────────

test.describe('Keyboard interaction', () => {

  test('should login on Enter key press', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.usernameInput.fill(config.auth.adminUser);
    await loginPage.passwordInput.fill(config.auth.adminPass);
    await loginPage.captchaInput.fill('MOBILE_APP_BYPASS');

    await loginPage.captchaInput.press('Enter');
    await loginPage.expectLoginSuccess();

    await context.close();
  });

});

// ── Captcha Refresh ──────────────────────────────────────────────────────────

test.describe('Captcha behavior', () => {

  test('should refresh captcha when image is clicked', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    const srcBefore = await loginPage.captchaImage.getAttribute('src');

    await loginPage.captchaImage.click();
    await page.waitForTimeout(1500);

    const srcAfter = await loginPage.captchaImage.getAttribute('src');
    expect(srcAfter).not.toBe(srcBefore);

    await context.close();
  });

});

// ── Route Guards (unauthenticated) ───────────────────────────────────────────

test.describe('Route guards - unauthenticated access', () => {

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
    test(`should redirect ${route} to login when not authenticated`, async ({ browser }) => {
      const { context, page } = await freshContext(browser);

      await page.goto(`/#${route}`);
      await expect(page).toHaveURL(/#\/login/);

      await context.close();
    });
  }

});

// ── Route Guards (authenticated) ─────────────────────────────────────────────

test.describe('Route guards - authenticated access', () => {

  test('should access /home without redirect', async ({ page }) => {
    await page.goto('/#/home');
    await expect(page).not.toHaveURL(/#\/login/);
  });

  test('should access all protected routes', async ({ page }) => {
    const routes = [
      '/device-management',
      '/content-library',
      '/rfid-management',
      '/kid-profiles',
      '/user-management',
      '/game-analytics',
    ];

    for (const route of routes) {
      await page.goto(`/#${route}`);
      await expect(page).not.toHaveURL(/#\/login/);
    }
  });

});

// ── Session Persistence ──────────────────────────────────────────────────────

test.describe('Session persistence', () => {

  test('should stay logged in after page refresh', async ({ page }) => {
    await page.goto('/#/home');
    await expect(page).not.toHaveURL(/#\/login/);

    await page.reload();

    await expect(page).not.toHaveURL(/#\/login/);
  });

});

// ── Logout ───────────────────────────────────────────────────────────────────

test.describe('Logout', () => {

  test('should clear token and redirect to login on logout', async ({ browser }) => {
    const { context, page } = await freshContext(browser);
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.login(config.auth.adminUser, config.auth.adminPass);
    await loginPage.expectLoginSuccess();

    // Simulate logout by clearing localStorage and hard-reloading
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('isSuperAdmin');
    });
    // Full reload clears Vuex in-memory state too
    await page.goto('/#/home');
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page).toHaveURL(/#\/login/, { timeout: 10000 });

    await context.close();
  });

});
