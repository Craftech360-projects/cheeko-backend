/**
 * User Management Page Object Model
 * Maps to: manager-web/src/views/UserManagement.vue
 */

class UserManagementPage {
  constructor(page) {
    this.page = page;
    this.userTable = page.locator('.el-table');
  }

  async goto() {
    await this.page.goto('/#/user-management');
    await this.page.waitForLoadState('networkidle');
  }

  async getUserCount() {
    const rows = this.userTable.locator('tbody tr');
    return await rows.count();
  }
}

module.exports = { UserManagementPage };
