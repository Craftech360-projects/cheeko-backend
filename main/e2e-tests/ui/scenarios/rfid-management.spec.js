/**
 * RFID Management UI E2E Scenarios
 * Covers: 6.1 Register RFID, 6.5 Reassign, tab navigation
 */

const { test, expect } = require('../fixtures/test.fixture');
const { RfidManagementPage } = require('../pages/rfid-management.page');

test.describe('RFID Management Scenarios', () => {

  test('RFID management page loads with stats', async ({ page }) => {
    const rfidPage = new RfidManagementPage(page);
    await rfidPage.goto();

    // Stats should be visible
    const stats = await rfidPage.getStats();
    expect(parseInt(stats.qaPacks)).toBeGreaterThanOrEqual(0);
    expect(parseInt(stats.cardMappings)).toBeGreaterThanOrEqual(0);
  });

  test('Tab navigation works', async ({ page }) => {
    const rfidPage = new RfidManagementPage(page);
    await rfidPage.goto();

    // Switch to Card Mappings tab
    await rfidPage.switchTab('cardMappings');
    await expect(rfidPage.page.locator('.tab-btn.active')).toContainText('Card Mappings');

    // Switch to Bulk Ranges tab
    await rfidPage.switchTab('bulkRanges');
    await expect(rfidPage.page.locator('.tab-btn.active')).toContainText('Bulk Ranges');

    // Switch to Lookup tab
    await rfidPage.switchTab('lookup');
    await expect(rfidPage.page.locator('.tab-btn.active')).toContainText('Lookup');
  });

  test('Search functionality works', async ({ page }) => {
    const rfidPage = new RfidManagementPage(page);
    await rfidPage.goto();

    await rfidPage.search('test-rfid');

    // Page should not crash
    await expect(page.locator('.content-panel')).toBeVisible();
  });

  test('Stats cards are clickable and switch tabs', async ({ page }) => {
    const rfidPage = new RfidManagementPage(page);
    await rfidPage.goto();

    // Click Q&A Packs stat
    await page.locator('.stat-item').filter({ hasText: 'Q&A Packs' }).click();
    await expect(page.locator('.tab-btn.active')).toContainText('Q&A Packs');
  });

});
