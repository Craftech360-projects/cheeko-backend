/**
 * Device Management Page Object Model
 * Maps to: manager-web/src/views/DeviceManagement.vue
 */

class DeviceManagementPage {
  constructor(page) {
    this.page = page;
    this.searchInput = page.locator('input[placeholder="Enter device model or MAC address to search"]');
    this.searchButton = page.locator('.btn-search');
    this.deviceTable = page.locator('.el-table');
    this.bindWithCodeButton = page.locator('button').filter({ hasText: 'Bind with Code' });
    this.manualAddButton = page.locator('button').filter({ hasText: 'Manual Add' });
    this.unbindButton = page.locator('button.el-button--danger').filter({ hasText: 'Unbind' });
    this.selectAllButton = page.locator('button').filter({ hasText: /Select All|Deselect All/ });
    this.loading = page.locator('.el-loading-mask');
  }

  async goto() {
    await this.page.goto('/device-management');
    await this.deviceTable.waitFor();
  }

  async search(keyword) {
    await this.searchInput.fill(keyword);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  async bindWithCode(activationCode) {
    await this.bindWithCodeButton.click();
    // Wait for dialog
    const dialog = this.page.locator('.el-dialog').filter({ hasText: /bind|activation|code/i });
    await dialog.waitFor();
    await dialog.locator('input').first().fill(activationCode);
    await dialog.locator('button').filter({ hasText: /confirm|ok|submit/i }).click();
  }

  async manualAdd(macAddress, model = 'esp32') {
    await this.manualAddButton.click();
    const dialog = this.page.locator('.el-dialog').filter({ hasText: /manual|add|device/i });
    await dialog.waitFor();
    // Fill MAC address
    await dialog.locator('input').first().fill(macAddress);
    await dialog.locator('button').filter({ hasText: /confirm|ok|save/i }).click();
  }

  async getDeviceRows() {
    return this.deviceTable.locator('tbody tr');
  }

  async getDeviceCount() {
    const rows = await this.getDeviceRows();
    return await rows.count();
  }

  async clickPlaylist(rowIndex = 0) {
    const rows = await this.getDeviceRows();
    await rows.nth(rowIndex).locator('button').filter({ hasText: 'Playlist' }).click();
  }

  async clickKidProfile(rowIndex = 0) {
    const rows = await this.getDeviceRows();
    await rows.nth(rowIndex).locator('button').filter({ hasText: 'Kid Profile' }).click();
  }

  async clickUnbind(rowIndex = 0) {
    const rows = await this.getDeviceRows();
    await rows.nth(rowIndex).locator('button').filter({ hasText: 'Unbind' }).click();
  }
}

module.exports = { DeviceManagementPage };
