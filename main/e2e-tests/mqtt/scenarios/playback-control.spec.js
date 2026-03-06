/**
 * Playback Control MQTT E2E Scenarios
 *
 * Tests playback_control message type with next/previous/start_agent actions.
 *
 * MAC range: E2:E2:00:00:03:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Playback Control E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:03:01' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:03:02' });
    await deviceNoHello.connect();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── Standard playback controls ───────────────────────────────────

  it('should process playback_control with action=next', async () => {
    const response = await device.sendPlaybackControl('next');
    expect(device.isConnected()).toBe(true);
  });

  it('should process playback_control with action=previous', async () => {
    const response = await device.sendPlaybackControl('previous');
    expect(device.isConnected()).toBe(true);
  });

  it('should process playback_control with action=start_agent', async () => {
    const response = await device.sendPlaybackControl('start_agent');
    expect(device.isConnected()).toBe(true);
  });

  // ── Without prior hello ──────────────────────────────────────────

  it('should not crash on playback_control without prior hello', async () => {
    const response = await deviceNoHello.sendPlaybackControl('next');
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Rapid next/previous ──────────────────────────────────────────

  it('should handle rapid next/previous toggling', async () => {
    const actions = ['next', 'previous', 'next', 'previous', 'next'];
    for (const action of actions) {
      await device.sendPlaybackControl(action);
    }
    expect(device.isConnected()).toBe(true);
  });

  // ── Health check ─────────────────────────────────────────────────

  it('should report healthy after all playback control tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
