'use strict';

/**
 * Shared test helpers for integration tests.
 *
 * Provides:
 *  - request  : supertest bound to the Express app
 *  - app      : the Express app instance
 *  - BASE     : the context path ('/toy')
 *  - loginAsAdmin  : attempts a login and returns the Bearer token string, or null
 *  - getServiceKey : returns the service key from env or a default test value
 */

const request = require('supertest');
const app = require('../src/app');

const BASE = '/toy';

/**
 * Attempt to log in with admin credentials.
 *
 * The login endpoint requires a valid captcha UUID + code, or the special
 * bypass code 'MOBILE_APP_BYPASS'.  We obtain a fresh captcha UUID first,
 * then submit the login with the bypass code so no real captcha solve is
 * needed.
 *
 * Returns a fully-formed "Bearer <token>" string on success, or null when
 * the DB is unavailable (CI without a live database).
 *
 * @returns {Promise<string|null>}
 */
async function loginAsAdmin() {
  const username = process.env.TEST_ADMIN_USER || 'admin';
  const password = process.env.TEST_ADMIN_PASS || 'admin123';

  // Step 1: obtain a real captcha UUID so the server has it in its store.
  const { v4: uuidv4 } = require('uuid');
  const captchaId = uuidv4();

  // Hit the captcha endpoint to register the UUID in the in-memory store.
  await request(app).get(`${BASE}/user/captcha`).query({ uuid: captchaId });

  // Step 2: log in using the mobile-app bypass captcha code.
  const res = await request(app)
    .post(`${BASE}/user/login`)
    .send({
      username,
      password,
      captcha: 'MOBILE_APP_BYPASS',
      captchaId
    });

  if (res.body && res.body.data && res.body.data.token) {
    return `Bearer ${res.body.data.token}`;
  }
  return null;
}

/**
 * Return the service secret key used by backend-to-backend endpoints.
 * Falls back to a placeholder value when the env variable is absent so that
 * tests exercising the "invalid key" path still work without configuration.
 *
 * @returns {string}
 */
function getServiceKey() {
  return process.env.SERVICE_SECRET_KEY || 'test-service-key';
}

module.exports = { request, app, BASE, loginAsAdmin, getServiceKey };
