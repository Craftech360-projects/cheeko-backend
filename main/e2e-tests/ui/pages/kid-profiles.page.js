/**
 * Kid Profiles Page Object Model
 * Maps to: manager-web/src/views/KidProfiles.vue
 */

class KidProfilesPage {
  constructor(page) {
    this.page = page;
    this.addButton = page.locator('button').filter({ hasText: 'Add Kid Profile' });
    this.backButton = page.locator('button').filter({ hasText: 'Back' });
    this.profileTable = page.locator('.el-table');
    this.emptyState = page.locator('.empty-state');
    this.dialog = page.locator('.el-dialog');
  }

  async goto(macAddress) {
    const url = macAddress ? `/kid-profiles?mac=${macAddress}` : '/kid-profiles';
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  async addProfile(data) {
    await this.addButton.click();
    await this.dialog.waitFor();

    // Fill name
    await this.dialog.locator('input').filter({ has: this.page.locator('[placeholder="Enter name"]') })
      .or(this.dialog.locator('label').filter({ hasText: 'Name' }).locator('~ div input').first())
      .first().fill(data.name);

    // Fill nickname if provided
    if (data.nickname) {
      await this.dialog.locator('input[placeholder="Enter nickname (optional)"]').fill(data.nickname);
    }

    // Fill birth date
    if (data.birthDate) {
      await this.dialog.locator('.el-date-editor input').fill(data.birthDate);
      await this.page.keyboard.press('Enter');
    }

    // Submit
    await this.dialog.locator('button').filter({ hasText: /confirm|save|ok/i }).click();
  }

  async editProfile(rowIndex, data) {
    const rows = this.profileTable.locator('tbody tr');
    await rows.nth(rowIndex).locator('button').filter({ hasText: 'Edit' }).click();
    await this.dialog.waitFor();

    if (data.name) {
      const nameInput = this.dialog.locator('input').first();
      await nameInput.clear();
      await nameInput.fill(data.name);
    }

    await this.dialog.locator('button').filter({ hasText: /confirm|save|ok/i }).click();
  }

  async deleteProfile(rowIndex) {
    const rows = this.profileTable.locator('tbody tr');
    await rows.nth(rowIndex).locator('button').filter({ hasText: 'Delete' }).click();
    // Confirm dialog
    await this.page.locator('.el-message-box__btns button').filter({ hasText: /confirm|ok|yes/i }).click();
  }

  async assignProfile(rowIndex) {
    const rows = this.profileTable.locator('tbody tr');
    await rows.nth(rowIndex).locator('button').filter({ hasText: /Assign|Unassign/ }).click();
  }

  async getProfileCount() {
    const rows = this.profileTable.locator('tbody tr');
    return await rows.count();
  }
}

module.exports = { KidProfilesPage };
