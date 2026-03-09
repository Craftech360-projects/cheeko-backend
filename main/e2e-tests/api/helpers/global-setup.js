/**
 * Jest Global Setup for E2E API + MQTT tests
 *
 * Logs in once, caches token. PactumJS and MQTT tests read from this file.
 * Same pattern as api-tests/lib/global-setup.js.
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { request } = require('pactum');

const TOKEN_FILE = path.resolve(__dirname, '..', '..', '.auth-token.json');
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function globalSetup() {
  const config = require('../../test.config');

  console.log(`\n  E2E Setup: Authenticating against ${config.env} environment...`);

  // Configure PactumJS base URL
  request.setBaseUrl(config.managerApi.baseUrl);
  request.setDefaultTimeout(config.settings.timeoutMs);

  // Acquire Bearer token
  let token = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`  E2E Setup: Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);
      await sleep(delay);
    }

    try {
      const captchaUuid = uuidv4();

      await axios.get(`${config.managerApi.baseUrl}/user/captcha`, {
        params: { uuid: captchaUuid },
        timeout: 10000,
        validateStatus: () => true,
      });

      const loginRes = await axios.post(`${config.managerApi.baseUrl}/user/login`, {
        username: config.auth.adminUser,
        password: config.auth.adminPass,
        captcha: 'MOBILE_APP_BYPASS',
        captchaId: captchaUuid,
      }, {
        timeout: 10000,
        validateStatus: () => true,
      });

      if (loginRes.status === 429) {
        if (attempt === MAX_RETRIES) {
          console.error('  E2E Setup: Rate-limited after all retries');
          break;
        }
        continue;
      }

      if (loginRes.data?.data?.token) {
        token = loginRes.data.data.token;
        console.log('  E2E Setup: Login successful');
        break;
      }

      console.error('  E2E Setup: Unexpected response:', JSON.stringify(loginRes.data));
      break;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error('  E2E Setup: Login failed -', error.message);
        break;
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') continue;
      console.error('  E2E Setup: Error -', error.message);
      break;
    }
  }

  const authData = {
    bearerToken: token || null,
    serviceKey: config.auth.serviceKey || null,
    firebaseToken: config.auth.firebaseToken || null,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(authData, null, 2));
  console.log('  E2E Setup: Auth data written to .auth-token.json\n');
};
