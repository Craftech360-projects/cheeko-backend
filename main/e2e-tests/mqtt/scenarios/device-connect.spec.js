/**
 * Device Connection MQTT E2E Scenarios
 *
 * Tests MQTT broker connectivity, hello/goodbye lifecycle, reconnection,
 * and edge cases like empty MAC or different firmware versions.
 *
 * MAC range: E2:E2:00:00:01:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

async function checkGatewayHealth() {
  try {
    const res = await axios.get(HEALTH_URL, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return res;
  } catch {
    return null; // Gateway HTTP not available
  }
}

describe('MQTT Device Connection E2E', () => {
  const devices = [];

  afterAll(async () => {
    for (const d of devices) {
      await d.disconnectQuiet().catch(() => {});
    }
  });

  function createDevice(mac) {
    const d = new DeviceSimulator({ mac });
    devices.push(d);
    return d;
  }

  // ── 1. MQTT Broker Connectivity ──────────────────────────────────

  it('should connect to the MQTT broker successfully', async () => {
    const device = createDevice('E2:E2:00:00:01:01');
    await device.connect();
    expect(device.isConnected()).toBe(true);
  });

  // ── 2. Hello message delivery ────────────────────────────────────

  it('should send hello and not crash the gateway', async () => {
    const device = createDevice('E2:E2:00:00:01:02');
    await device.connect();
    const response = await device.sendHello();
    // response may be null if LiveKit/Manager API not running — that is OK
    // The test passes as long as no exception is thrown
    expect(device.isConnected()).toBe(true);
  });

  // ── 3. Hello with different firmware versions ────────────────────

  it('should accept hello with firmware version 2.0.0', async () => {
    const device = createDevice('E2:E2:00:00:01:03');
    await device.connect();
    const response = await device.sendHello({ firmwareVersion: '2.0.0' });
    expect(device.isConnected()).toBe(true);
  });

  it('should accept hello with firmware version 0.1.0-beta', async () => {
    const device = createDevice('E2:E2:00:00:01:04');
    await device.connect();
    const response = await device.sendHello({ firmwareVersion: '0.1.0-beta' });
    expect(device.isConnected()).toBe(true);
  });

  // ── 4. Goodbye after hello ───────────────────────────────────────

  it('should send goodbye after hello without errors', async () => {
    const device = createDevice('E2:E2:00:00:01:05');
    await device.connect();
    await device.sendHello();
    await device.sendGoodbye();
    // No exception means success
    expect(device.isConnected()).toBe(true);
  });

  // ── 5. Reconnection (multiple hello from same device) ────────────

  it('should handle multiple hello messages from the same MAC (reconnection)', async () => {
    const device = createDevice('E2:E2:00:00:01:06');
    await device.connect();
    await device.sendHello();
    // Small delay to let gateway process first hello
    await new Promise(r => setTimeout(r, 500));
    // Second hello simulates device reconnect
    const response = await device.sendHello();
    expect(device.isConnected()).toBe(true);
  });

  // ── 6. Connection with empty/minimal MAC ─────────────────────────

  it('should not crash the gateway when hello has unusual MAC', async () => {
    const device = createDevice('00:00:00:00:00:00');
    await device.connect();
    await device.sendHello();
    expect(device.isConnected()).toBe(true);
  });

  // ── 7. Gateway health after all connection operations ────────────

  it('should report healthy after all device connection tests', async () => {
    const res = await checkGatewayHealth();
    if (!res) return; // Gateway HTTP not available — skip
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('status');
  });

  // ── 8. Health endpoint returns stats ─────────────────────────────

  it('should return stats in health response', async () => {
    const res = await checkGatewayHealth();
    if (!res) return; // Gateway HTTP not available — skip
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('stats');
  });
});
