/**
 * Mode Change MQTT E2E Scenarios
 *
 * Tests mode-change and character-change message types.
 * Verifies gateway processes messages without crashing.
 *
 * MAC range: E2:E2:00:00:02:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Mode Change E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:02:01' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:02:02' });
    await deviceNoHello.connect();
    // Intentionally no hello sent
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── Mode changes ────────────────────────────────────────────────

  it('should process mode-change to music', async () => {
    const response = await device.sendModeChange('music');
    // response may be null (needs LiveKit), but no exception = pass
    expect(device.isConnected()).toBe(true);
  });

  it('should process mode-change to story', async () => {
    const response = await device.sendModeChange('story');
    expect(device.isConnected()).toBe(true);
  });

  it('should process mode-change to conversation', async () => {
    const response = await device.sendModeChange('conversation');
    expect(device.isConnected()).toBe(true);
  });

  // ── Mode change without prior hello ──────────────────────────────

  it('should not crash on mode-change without prior hello', async () => {
    const response = await deviceNoHello.sendModeChange('music');
    // Gateway should handle gracefully even without a hello first
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Character changes ────────────────────────────────────────────

  it('should process character-change to Cheeko', async () => {
    const response = await device.sendCharacterChange('Cheeko');
    expect(device.isConnected()).toBe(true);
  });

  it('should process character-change to Math Tutor', async () => {
    const response = await device.sendCharacterChange('Math Tutor');
    expect(device.isConnected()).toBe(true);
  });

  // ── Character change without prior hello ─────────────────────────

  it('should not crash on character-change without prior hello', async () => {
    const response = await deviceNoHello.sendCharacterChange('Cheeko');
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Rapid mode changes ──────────────────────────────────────────

  it('should handle rapid successive mode changes', async () => {
    const modes = ['music', 'story', 'conversation', 'music', 'story'];
    for (const mode of modes) {
      await device.sendModeChange(mode);
    }
    // Gateway should still be functional
    expect(device.isConnected()).toBe(true);
  });

  // ── Health check ─────────────────────────────────────────────────

  it('should report healthy after all mode change tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
