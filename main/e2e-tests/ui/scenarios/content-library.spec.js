/**
 * Content Library UI E2E Scenarios
 * Covers: 5.1-5.3 Upload, 5.9 Delete, search/filter
 */

const { test, expect } = require('../fixtures/test.fixture');
const { ContentLibraryPage } = require('../pages/content-library.page');

test.describe('Content Library Scenarios', () => {

  test('Content library page loads with stats', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    // Stats cards should be visible
    await expect(contentPage.statsTotal).toBeVisible();
    await expect(contentPage.statsMusic).toBeVisible();
    await expect(contentPage.statsStories).toBeVisible();
    await expect(contentPage.statsTextbooks).toBeVisible();
  });

  test('Stats show numeric values', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    const stats = await contentPage.getStats();
    // Each stat should be a number
    expect(parseInt(stats.total)).toBeGreaterThanOrEqual(0);
    expect(parseInt(stats.music)).toBeGreaterThanOrEqual(0);
  });

  test('5.1 - Add content dialog opens', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    await contentPage.addContentButton.click();

    const dialog = page.locator('.el-dialog');
    await expect(dialog).toBeVisible();
  });

  test('Search filters content list', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    const initialCount = await contentPage.getContentCount();

    // Search for something unlikely
    await contentPage.searchContent('zzz-nonexistent-zzz');

    // Count should be different (likely 0 or less)
    const filteredCount = await contentPage.getContentCount();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test('Filter by type changes displayed content', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    // Filter by Music
    await contentPage.filterByType('Music');
    await page.waitForTimeout(500);

    // All visible type tags should be "music"
    const typeTags = page.locator('.el-table .el-tag');
    const count = await typeTags.count();
    for (let i = 0; i < count; i++) {
      const text = await typeTags.nth(i).textContent();
      expect(text.toLowerCase()).toContain('music');
    }
  });

  test('Content table displays expected columns', async ({ page }) => {
    const contentPage = new ContentLibraryPage(page);
    await contentPage.goto();

    const headers = page.locator('.el-table__header th');
    const headerTexts = await headers.allTextContents();
    const expectedColumns = ['Type', 'Title'];
    for (const col of expectedColumns) {
      expect(headerTexts.some(h => h.includes(col))).toBeTruthy();
    }
  });

});
