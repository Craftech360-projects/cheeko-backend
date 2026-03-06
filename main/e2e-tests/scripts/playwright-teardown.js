/**
 * Playwright globalTeardown — runs after all tests complete.
 * Updates the report index so the dashboard can list all runs.
 * Small delay ensures the JSON reporter has flushed to disk.
 */
module.exports = async function globalTeardown() {
  await new Promise(r => setTimeout(r, 1000));
  require('./update-report-index');
};
