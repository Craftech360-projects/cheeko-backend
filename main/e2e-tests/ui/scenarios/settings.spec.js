/**
 * Settings UI E2E Scenarios
 * Covers: 9.8 System settings
 */

const { test, expect } = require('../fixtures/test.fixture');

test.describe('Settings Scenarios', () => {

  test('9.8 - Role config page loads', async ({ page }) => {
    await page.goto('/role-config');
    await expect(page).not.toHaveURL(/login/);
  });

  test('All admin pages are accessible', async ({ page }) => {
    const adminPages = [
      { path: '/home', name: 'Home' },
      { path: '/device-management', name: 'Device Management' },
      { path: '/content-library', name: 'Content Library' },
      { path: '/rfid-management', name: 'RFID Management' },
      { path: '/kid-profiles', name: 'Kid Profiles' },
      { path: '/user-management', name: 'User Management' },
      { path: '/game-analytics', name: 'Game Analytics' },
      { path: '/role-config', name: 'Role Config' },
    ];

    for (const adminPage of adminPages) {
      await page.goto(adminPage.path);
      // Should not redirect to login
      await expect(page).not.toHaveURL(/login/, {
        message: `${adminPage.name} (${adminPage.path}) redirected to login`,
      });
    }
  });

});
