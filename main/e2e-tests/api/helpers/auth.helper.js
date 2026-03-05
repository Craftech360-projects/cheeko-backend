/**
 * Auth Helper for PactumJS E2E tests
 *
 * Reads cached tokens from global-setup and provides header builders.
 */

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.resolve(__dirname, '..', '..', '.auth-token.json');

let cachedAuth = null;

function loadAuth() {
  if (cachedAuth) return cachedAuth;
  try {
    cachedAuth = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch (_) {
    cachedAuth = { bearerToken: null, serviceKey: null, firebaseToken: null };
  }
  return cachedAuth;
}

function getBearerHeaders() {
  const auth = loadAuth();
  return { Authorization: `Bearer ${auth.bearerToken}` };
}

function getServiceKeyHeaders() {
  const auth = loadAuth();
  return { 'X-Service-Key': auth.serviceKey };
}

function getFirebaseHeaders() {
  const auth = loadAuth();
  return { Authorization: `Bearer ${auth.firebaseToken}` };
}

function getInvalidHeaders() {
  return { Authorization: 'Bearer invalid-expired-token-xxx' };
}

function clearCache() {
  cachedAuth = null;
}

module.exports = {
  loadAuth,
  getBearerHeaders,
  getServiceKeyHeaders,
  getFirebaseHeaders,
  getInvalidHeaders,
  clearCache,
};
