/**
 * Login Page Object Model
 * Maps to: manager-web/src/views/login.vue
 */

class LoginPage {
  constructor(page) {
    this.page = page;
    this.usernameInput = page.locator('input[placeholder="Enter username"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.captchaInput = page.locator('input[placeholder="Enter verification code"]');
    this.loginButton = page.locator('.login-btn');
    this.loginBox = page.locator('.login-box');
  }

  async goto() {
    await this.page.goto('/login');
    await this.loginBox.waitFor();
  }

  async login(username, password, captcha = 'MOBILE_APP_BYPASS') {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.captchaInput.fill(captcha);
    await this.loginButton.click();
  }

  async expectLoginSuccess() {
    await this.page.waitForURL('**/home', { timeout: 15000 });
  }

  async expectLoginError(message) {
    const toast = this.page.locator('.el-message--error, .el-message--warning');
    await toast.waitFor({ timeout: 5000 });
  }
}

module.exports = { LoginPage };
