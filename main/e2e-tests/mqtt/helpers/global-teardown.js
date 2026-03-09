/**
 * MQTT Tests Global Teardown
 *
 * Lightweight cleanup after MQTT tests complete.
 */

module.exports = async function globalTeardown() {
  console.log('\n  MQTT E2E Teardown: Complete\n');
};
