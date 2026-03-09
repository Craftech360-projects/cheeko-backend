/**
 * RFID Management Page Object Model
 * Maps to: manager-web/src/views/RfidManagement.vue
 */

class RfidManagementPage {
  constructor(page) {
    this.page = page;
    this.searchInput = page.locator('input[placeholder="Search..."]');
    this.searchButton = page.locator('.btn-search');

    // Tab buttons
    this.questionPacksTab = page.locator('.tab-btn').filter({ hasText: 'Q&A Packs' });
    this.contentPacksTab = page.locator('.tab-btn').filter({ hasText: 'Content Packs' });
    this.productSkusTab = page.locator('.tab-btn').filter({ hasText: 'Product SKUs' });
    this.cardMappingsTab = page.locator('.tab-btn').filter({ hasText: 'Card Mappings' });
    this.bulkRangesTab = page.locator('.tab-btn').filter({ hasText: 'Bulk Ranges' });
    this.lookupTab = page.locator('.tab-btn').filter({ hasText: 'Lookup' });

    // Stats
    this.statsQAPacks = page.locator('.stat-item').filter({ hasText: 'Q&A Packs' }).locator('.stat-value');
    this.statsContentPacks = page.locator('.stat-item').filter({ hasText: 'Content Packs' }).locator('.stat-value');
    this.statsProductSkus = page.locator('.stat-item').filter({ hasText: 'Product SKUs' }).locator('.stat-value');
    this.statsCardMappings = page.locator('.stat-item').filter({ hasText: 'Card Mappings' }).locator('.stat-value');
    this.statsBulkRanges = page.locator('.stat-item').filter({ hasText: 'Bulk Ranges' }).locator('.stat-value');
  }

  async goto() {
    await this.page.goto('/#/rfid-management');
    await this.page.waitForLoadState('networkidle');
  }

  async switchTab(tabName) {
    const tabs = {
      questionPacks: this.questionPacksTab,
      contentPacks: this.contentPacksTab,
      productSkus: this.productSkusTab,
      cardMappings: this.cardMappingsTab,
      bulkRanges: this.bulkRangesTab,
      lookup: this.lookupTab,
    };
    await tabs[tabName].click();
    await this.page.waitForLoadState('networkidle');
  }

  async search(keyword) {
    await this.searchInput.fill(keyword);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getStats() {
    return {
      qaPacks: await this.statsQAPacks.textContent(),
      contentPacks: await this.statsContentPacks.textContent(),
      productSkus: await this.statsProductSkus.textContent(),
      cardMappings: await this.statsCardMappings.textContent(),
      bulkRanges: await this.statsBulkRanges.textContent(),
    };
  }
}

module.exports = { RfidManagementPage };
