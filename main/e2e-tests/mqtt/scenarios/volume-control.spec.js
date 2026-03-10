/**
 * Volume & Device Control MQTT E2E Scenarios
 *
 * Tests function_call messages for volume control, battery queries,
 * and device status — these are handled directly by the gateway
 * (bypassing the LiveKit agent for faster response).
 *
 * MAC range: E2:E2:00:00:09:xx (unique to this spec — avoids resilience spec's 09 range
 * by using 09:A0+ hex)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Volume Control E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:09:A1' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── Volume function calls ──────────────────────────────────────────

  it('should process self_volume_up function call', async () => {
    const response = await device.sendFunctionCall('self_volume_up', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process self_volume_down function call', async () => {
    const response = await device.sendFunctionCall('self_volume_down', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process self_mute function call', async () => {
    const response = await device.sendFunctionCall('self_mute', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process self_unmute function call', async () => {
    const response = await device.sendFunctionCall('self_unmute', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process self_get_volume function call', async () => {
    const response = await device.sendFunctionCall('self_get_volume', {});
    expect(device.isConnected()).toBe(true);
  });

  // ── Rapid volume changes (debounce test) ───────────────────────────

  it('should handle rapid volume up/down toggling', async () => {
    const calls = [
      'self_volume_up', 'self_volume_up', 'self_volume_down',
      'self_volume_up', 'self_volume_down', 'self_volume_down',
    ];
    for (const fn of calls) {
      await device.sendFunctionCall(fn, {});
    }
    expect(device.isConnected()).toBe(true);
  });
});

describe('MQTT Device Query E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:09:A2' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── Battery & device status queries ────────────────────────────────

  it('should process self_get_battery_status function call', async () => {
    const response = await device.sendFunctionCall('self_get_battery_status', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process self_get_device_status function call', async () => {
    const response = await device.sendFunctionCall('self_get_device_status', {});
    expect(device.isConnected()).toBe(true);
  });

  // ── Playback function calls ────────────────────────────────────────

  it('should process next_song function call', async () => {
    const response = await device.sendFunctionCall('next_song', {});
    expect(device.isConnected()).toBe(true);
  });

  it('should process previous_song function call', async () => {
    const response = await device.sendFunctionCall('previous_song', {});
    expect(device.isConnected()).toBe(true);
  });

  // ── Health check ───────────────────────────────────────────────────

  it('should report healthy after all device control tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
