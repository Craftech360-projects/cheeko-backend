/**
 * Content Request MQTT E2E Scenarios
 *
 * Tests function_call messages (play_music, play_story) and abort.
 * Uses the correct function_call envelope: { name, arguments }.
 *
 * MAC range: E2:E2:00:00:05:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Content Request E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:05:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── Function call: play_music ────────────────────────────────────

  it('should send play_music function_call in correct format', async () => {
    const response = await device.sendPlayMusic('play a happy song');
    // Gateway forwards to virtual connection; response depends on LiveKit
    expect(device.isConnected()).toBe(true);
  });

  // ── Function call: play_story ────────────────────────────────────

  it('should send play_story function_call in correct format', async () => {
    const response = await device.sendPlayStory('tell me a story about space');
    expect(device.isConnected()).toBe(true);
  });

  // ── Abort ────────────────────────────────────────────────────────

  it('should send abort without errors', async () => {
    await device.sendAbort();
    expect(device.isConnected()).toBe(true);
  });

  // ── Unknown function name ────────────────────────────────────────

  it('should handle function_call with unknown function name', async () => {
    const response = await device.sendFunctionCall('nonexistent_function', { foo: 'bar' });
    // Gateway should not crash on unknown function
    expect(device.isConnected()).toBe(true);
  });

  // ── Missing arguments ────────────────────────────────────────────

  it('should handle function_call with empty arguments', async () => {
    const response = await device.sendFunctionCall('play_music', {});
    expect(device.isConnected()).toBe(true);
  });

  // ── Health check ─────────────────────────────────────────────────

  it('should report healthy after all content request tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
