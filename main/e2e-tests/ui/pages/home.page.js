/**
 * Home Page Object Model
 * Maps to: manager-web/src/views/home.vue
 */

class HomePage {
  constructor(page) {
    this.page = page;
    this.addAgentButton = page.locator('.left-add');
    this.totalUsers = page.locator('.stats-box').filter({ hasText: 'Total Users' }).locator('.stats-count');
    this.totalDevices = page.locator('.stats-box').filter({ hasText: 'Total Devices' }).locator('.stats-count');
    this.activeToday = page.locator('.stats-box').filter({ hasText: 'Active Today' }).locator('.stats-count');
    this.agentTable = page.locator('.agent-card');
  }

  async goto() {
    await this.page.goto('/home');
    await this.page.waitForLoadState('networkidle');
  }

  async getStats() {
    return {
      totalUsers: await this.totalUsers.textContent().catch(() => '0'),
      totalDevices: await this.totalDevices.textContent().catch(() => '0'),
      activeToday: await this.activeToday.textContent().catch(() => '0'),
    };
  }

  async clickAddAgent() {
    await this.addAgentButton.click();
  }
}

module.exports = { HomePage };
