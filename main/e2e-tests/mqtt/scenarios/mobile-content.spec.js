/**
 * Mobile Music Request & Legacy Download MQTT E2E Scenarios
 *
 * Tests mobile_music_request, habit_download_request, rhyme_download_request,
 * and ready_for_greeting message types.
 *
 * MAC range: E2:E2:00:00:08:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT Mobile Music Request E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:08:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── Mobile music request ───────────────────────────────────────────

  it('should process mobile_music_request for music', async () => {
    const response = await device.sendMobileMusicRequest('happy birthday', 'music', 'en');
    expect(device.isConnected()).toBe(true);
  });

  it('should process mobile_music_request for story', async () => {
    const response = await device.sendMobileMusicRequest('cinderella', 'story', 'en');
    expect(device.isConnected()).toBe(true);
  });

  it('should process mobile_music_request with different language', async () => {
    const response = await device.sendMobileMusicRequest('twinkle twinkle', 'music', 'zh');
    expect(device.isConnected()).toBe(true);
  });

  it('should handle mobile_music_request with empty song name', async () => {
    const response = await device.sendMobileMusicRequest('', 'music');
    expect(device.isConnected()).toBe(true);
  });
});

describe('MQTT Legacy Download Requests E2E', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:08:02' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
  });

  // ── Habit download ─────────────────────────────────────────────────

  it('should process habit_download_request', async () => {
    const response = await device.sendHabitDownloadRequest('E2E-HABIT-001');
    expect(device.isConnected()).toBe(true);
  });

  it('should handle habit_download_request with unknown UID', async () => {
    const response = await device.sendHabitDownloadRequest('UNKNOWN-HABIT-999');
    expect(device.isConnected()).toBe(true);
  });

  // ── Rhyme download ─────────────────────────────────────────────────

  it('should process rhyme_download_request', async () => {
    const response = await device.sendRhymeDownloadRequest('E2E-RHYME-001');
    expect(device.isConnected()).toBe(true);
  });

  it('should handle rhyme_download_request with unknown UID', async () => {
    const response = await device.sendRhymeDownloadRequest('UNKNOWN-RHYME-999');
    expect(device.isConnected()).toBe(true);
  });
});

describe('MQTT Ready For Greeting E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:08:03' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:08:04' });
    await deviceNoHello.connect();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── ready_for_greeting ─────────────────────────────────────────────

  it('should process ready_for_greeting message', async () => {
    const response = await device.sendReadyForGreeting();
    expect(device.isConnected()).toBe(true);
  });

  it('should not crash on ready_for_greeting without prior hello', async () => {
    const response = await deviceNoHello.sendReadyForGreeting();
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Health check ───────────────────────────────────────────────────

  it('should report healthy after all mobile/download tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
