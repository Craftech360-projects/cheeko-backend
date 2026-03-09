/**
 * Game Analytics Page Object Model
 * Maps to: manager-web/src/views/GameAnalytics.vue
 */

class GameAnalyticsPage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/#/game-analytics');
    await this.page.waitForLoadState('networkidle');
  }

  async isLoaded() {
    // Verify page loaded without errors
    const title = this.page.locator('h2, .page-title').filter({ hasText: /analytics|game/i });
    return await title.isVisible().catch(() => false);
  }
}

module.exports = { GameAnalyticsPage };
