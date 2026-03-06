/**
 * Content Library Page Object Model
 * Maps to: manager-web/src/views/ContentLibrary.vue
 */

class ContentLibraryPage {
  constructor(page) {
    this.page = page;
    this.addContentButton = page.locator('button').filter({ hasText: 'Add Content' });
    this.contentTable = page.locator('.el-table');
    this.typeFilter = page.locator('.filter-row .el-select').first();
    this.searchInput = page.locator('input[placeholder="Search content..."]');
    this.statsTotal = page.locator('.stat-card').filter({ hasText: 'Total Content' }).locator('.stat-value');
    this.statsMusic = page.locator('.stat-card').filter({ hasText: 'Music' }).locator('.stat-value');
    this.statsStories = page.locator('.stat-card').filter({ hasText: 'Stories' }).locator('.stat-value');
    this.statsTextbooks = page.locator('.stat-card').filter({ hasText: 'Textbooks' }).locator('.stat-value');
  }

  async goto() {
    await this.page.goto('/#/content-library');
    await this.contentTable.waitFor();
  }

  async getStats() {
    return {
      total: await this.statsTotal.textContent(),
      music: await this.statsMusic.textContent(),
      stories: await this.statsStories.textContent(),
      textbooks: await this.statsTextbooks.textContent(),
    };
  }

  async addContent(data) {
    await this.addContentButton.click();
    const dialog = this.page.locator('.el-dialog');
    await dialog.waitFor();

    // Fill title
    const titleInput = dialog.locator('input').first();
    await titleInput.fill(data.title || '');

    // Select type if provided
    if (data.content_type) {
      const typeSelect = dialog.locator('.el-select').first();
      await typeSelect.click();
      await this.page.locator('.el-select-dropdown__item').filter({ hasText: data.content_type }).click();
    }

    // Submit
    await dialog.locator('button').filter({ hasText: /confirm|save|ok/i }).click();
  }

  async searchContent(query) {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(500); // debounce
    await this.page.waitForLoadState('networkidle');
  }

  async filterByType(type) {
    await this.typeFilter.click();
    await this.page.locator('.el-select-dropdown__item').filter({ hasText: type }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async getContentCount() {
    const rows = this.contentTable.locator('tbody tr');
    return await rows.count();
  }

  async deleteContent(rowIndex = 0) {
    const rows = this.contentTable.locator('tbody tr');
    await rows.nth(rowIndex).locator('button').filter({ hasText: /delete/i }).click();
    // Confirm dialog
    await this.page.locator('.el-message-box__btns button').filter({ hasText: /confirm|ok|yes/i }).click();
  }
}

module.exports = { ContentLibraryPage };
