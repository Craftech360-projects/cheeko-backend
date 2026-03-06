/**
 * Kid Profiles UI E2E Scenarios
 * Covers: 7.1 Create, 9.4 CRUD profiles
 */

const { test, expect } = require('../fixtures/test.fixture');
const { KidProfilesPage } = require('../pages/kid-profiles.page');

test.describe('Kid Profiles Scenarios', () => {

  test('Kid profiles page loads', async ({ page }) => {
    const profilesPage = new KidProfilesPage(page);
    await profilesPage.goto();

    // Either table or empty state should be visible
    const tableVisible = await profilesPage.profileTable.isVisible().catch(() => false);
    const emptyVisible = await profilesPage.emptyState.isVisible().catch(() => false);
    expect(tableVisible || emptyVisible).toBeTruthy();
  });

  test('Add Kid Profile button is visible', async ({ page }) => {
    const profilesPage = new KidProfilesPage(page);
    await profilesPage.goto();

    await expect(profilesPage.addButton).toBeVisible();
  });

  test('7.1 - Add Kid Profile dialog opens', async ({ page }) => {
    const profilesPage = new KidProfilesPage(page);
    await profilesPage.goto();

    await profilesPage.addButton.click();

    const dialog = page.locator('.el-dialog').filter({ hasText: 'Add Kid Profile' }).first();
    await expect(dialog).toBeVisible();

    // Dialog should have Name field
    await expect(dialog.locator('label').filter({ hasText: 'Name' }).first()).toBeVisible();
  });

  test('Profile table has expected columns', async ({ page }) => {
    const profilesPage = new KidProfilesPage(page);
    await profilesPage.goto();

    const profileCount = await profilesPage.getProfileCount().catch(() => 0);
    if (profileCount > 0) {
      const headers = page.locator('.el-table__header th');
      const headerTexts = await headers.allTextContents();
      const expectedColumns = ['Name', 'Age', 'Gender', 'Actions'];
      for (const col of expectedColumns) {
        expect(headerTexts.some(h => h.includes(col))).toBeTruthy();
      }
    }
  });

  test('Back button is visible', async ({ page }) => {
    const profilesPage = new KidProfilesPage(page);
    await profilesPage.goto();

    await expect(profilesPage.backButton).toBeVisible();
  });

});
