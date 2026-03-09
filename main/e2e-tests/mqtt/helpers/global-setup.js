/**
 * MQTT Tests Global Setup
 *
 * Verifies MQTT broker and gateway are reachable before running tests.
 * Does not require Manager API auth — MQTT tests are independent.
 */

const mqtt = require('mqtt');
const axios = require('axios');

module.exports = async function globalSetup() {
  const config = require('../../test.config');

  console.log('\n  MQTT E2E Setup: Checking prerequisites...');

  // 1. Check MQTT broker connectivity
  await new Promise((resolve, reject) => {
    const client = mqtt.connect(config.mqttGateway.brokerUrl, {
      clientId: `e2e-setup-check-${Date.now()}`,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 0,
    });

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error(`Cannot connect to MQTT broker at ${config.mqttGateway.brokerUrl}`));
    }, 10000);

    client.on('connect', () => {
      clearTimeout(timeout);
      console.log(`  MQTT E2E Setup: Broker connected at ${config.mqttGateway.brokerUrl}`);
      client.end(false, {}, resolve);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(new Error(`MQTT broker error: ${err.message}`));
    });
  });

  // 2. Check gateway health endpoint
  try {
    const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    if (res.status === 200) {
      console.log(`  MQTT E2E Setup: Gateway health OK at ${config.mqttGateway.httpUrl}`);
    } else {
      console.warn(`  MQTT E2E Setup: Gateway returned status ${res.status} (tests may still work)`);
    }
  } catch (err) {
    console.warn(`  MQTT E2E Setup: Gateway health check failed (${err.message}) — continuing anyway`);
  }

  console.log('  MQTT E2E Setup: Complete\n');
};
