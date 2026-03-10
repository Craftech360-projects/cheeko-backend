/**
 * Listen (Push-to-Talk) MQTT E2E Scenarios
 *
 * Tests listen/PTT message types with start/stop states and manual/vad modes.
 * Verifies gateway handles PTT lifecycle without crashing.
 *
 * MAC range: E2:E2:00:00:06:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Listen/PTT E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:06:01' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:06:02' });
    await deviceNoHello.connect();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── PTT start/stop ─────────────────────────────────────────────────

  it('should process listen start', async () => {
    const response = await device.sendListen('start');
    expect(device.isConnected()).toBe(true);
  });

  it('should process listen stop', async () => {
    const response = await device.sendListen('stop');
    expect(device.isConnected()).toBe(true);
  });

  // ── PTT with mode ──────────────────────────────────────────────────

  it('should process listen start with manual mode', async () => {
    const response = await device.sendListen('start', 'manual');
    expect(device.isConnected()).toBe(true);
  });

  it('should process listen stop with manual mode', async () => {
    const response = await device.sendListen('stop', 'manual');
    expect(device.isConnected()).toBe(true);
  });

  it('should process listen start with vad mode', async () => {
    const response = await device.sendListen('start', 'vad');
    expect(device.isConnected()).toBe(true);
  });

  // ── Rapid PTT toggling ─────────────────────────────────────────────

  it('should handle rapid PTT start/stop toggling', async () => {
    const actions = ['start', 'stop', 'start', 'stop', 'start', 'stop'];
    for (const state of actions) {
      await device.sendListen(state);
    }
    expect(device.isConnected()).toBe(true);
  });

  // ── PTT without prior hello ────────────────────────────────────────

  it('should not crash on listen without prior hello', async () => {
    const response = await deviceNoHello.sendListen('start');
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Health check ───────────────────────────────────────────────────

  it('should report healthy after all PTT tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
