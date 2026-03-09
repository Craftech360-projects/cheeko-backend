/**
 * Jest Global Teardown
 *
 * Cleans up auth token file after all tests complete.
 */

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.resolve(__dirname, '..', '..', '.auth-token.json');

module.exports = async function globalTeardown() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (_) {
    // ignore cleanup errors
  }
  console.log('\n  E2E Teardown: Complete\n');
};
