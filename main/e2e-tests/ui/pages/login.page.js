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
    this.captchaImage = page.locator('img[alt="Verification Code"]');
    this.loginButton = page.locator('.login-btn');
    this.loginBox = page.locator('.login-box');
    this.loginText = page.locator('.login-text');
    this.welcomeText = page.locator('.login-welcome');
    this.errorToast = page.locator('.el-message--error, .el-message--warning');
    this.successToast = page.locator('.el-message--success');
  }

  async goto() {
    await this.page.goto('/#/login');
    await this.loginBox.waitFor({ timeout: 15000 });
  }

  async login(username, password, captcha = 'MOBILE_APP_BYPASS') {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.captchaInput.fill(captcha);
    await this.loginButton.click();
  }

  async expectLoginSuccess() {
    await this.page.waitForURL(/#\/home/, { timeout: 15000 });
  }

  async expectLoginError() {
    await this.errorToast.waitFor({ timeout: 5000 });
  }

  async expectSuccessToast() {
    await this.successToast.waitFor({ timeout: 5000 });
  }

  async getErrorMessage() {
    await this.errorToast.waitFor({ timeout: 5000 });
    return await this.errorToast.textContent();
  }

  async clearForm() {
    await this.usernameInput.fill('');
    await this.passwordInput.fill('');
    await this.captchaInput.fill('');
  }
}

module.exports = { LoginPage };
