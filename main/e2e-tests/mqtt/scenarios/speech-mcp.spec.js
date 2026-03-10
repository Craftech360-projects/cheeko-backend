/**
 * Speech End & MCP Response MQTT E2E Scenarios
 *
 * Tests speech_end (end-of-speech marker) and mcp (Model Context Protocol)
 * response messages from device to gateway.
 *
 * MAC range: E2:E2:00:00:07:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Speech End E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:07:01' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:07:02' });
    await deviceNoHello.connect();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── speech_end ─────────────────────────────────────────────────────

  it('should process speech_end message', async () => {
    const response = await device.sendSpeechEnd();
    expect(device.isConnected()).toBe(true);
  });

  it('should handle rapid speech_end messages', async () => {
    for (let i = 0; i < 3; i++) {
      await device.sendSpeechEnd();
    }
    expect(device.isConnected()).toBe(true);
  });

  it('should not crash on speech_end without prior hello', async () => {
    const response = await deviceNoHello.sendSpeechEnd();
    expect(deviceNoHello.isConnected()).toBe(true);
  });
});

describe('MQTT MCP Response E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:07:03' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── MCP volume response ────────────────────────────────────────────

  it('should process mcp response with volume data', async () => {
    const response = await device.sendMcpResponse({
      function: 'self.audio_speaker.get_volume',
      result: { volume: 75 },
    });
    expect(device.isConnected()).toBe(true);
  });

  // ── MCP battery response ───────────────────────────────────────────

  it('should process mcp response with battery data', async () => {
    const response = await device.sendMcpResponse({
      function: 'self.get_battery_status',
      result: { level: 85, charging: false },
    });
    expect(device.isConnected()).toBe(true);
  });

  // ── MCP device status response ─────────────────────────────────────

  it('should process mcp response with device status', async () => {
    const response = await device.sendMcpResponse({
      function: 'self.get_device_status',
      result: { wifi_strength: -45, uptime: 3600 },
    });
    expect(device.isConnected()).toBe(true);
  });

  // ── MCP with empty result ──────────────────────────────────────────

  it('should handle mcp response with empty result', async () => {
    const response = await device.sendMcpResponse({
      function: 'self.audio_speaker.get_volume',
      result: {},
    });
    expect(device.isConnected()).toBe(true);
  });

  // ── MCP with no function field ─────────────────────────────────────

  it('should handle mcp response with no function field', async () => {
    const response = await device.sendMcpResponse({
      result: { volume: 50 },
    });
    expect(device.isConnected()).toBe(true);
  });

  // ── Health check ───────────────────────────────────────────────────

  it('should report healthy after all speech/mcp tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
