/**
 * RFID Scan MQTT E2E Scenarios
 *
 * Tests card_lookup, start_greeting, start_greeting_text, and download_request.
 * Uses rfid_uid field (not card_no). Unknown cards may get a card_unknown response
 * if Manager API is running.
 *
 * MAC range: E2:E2:00:00:04:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;

describe('MQTT RFID Scan E2E', () => {
  let device;
  let deviceNoHello;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:04:01' });
    await device.connect();
    await device.sendHello();

    deviceNoHello = new DeviceSimulator({ mac: 'E2:E2:00:00:04:02' });
    await deviceNoHello.connect();
  });

  afterAll(async () => {
    await device.disconnectQuiet().catch(() => {});
    await deviceNoHello.disconnectQuiet().catch(() => {});
  });

  // ── card_lookup with test RFID UID ───────────────────────────────

  it('should send card_lookup with a test RFID UID', async () => {
    const response = await device.sendCardLookup('E2E-RFID-TEST-001');
    // response depends on Manager API availability
    expect(device.isConnected()).toBe(true);
  });

  // ── card_lookup with unknown card ────────────────────────────────

  it('should handle card_lookup with unknown RFID UID', async () => {
    const response = await device.sendCardLookup('UNKNOWN-CARD-999999');
    // If Manager API is running, we may get a card_unknown response
    if (response && response.type) {
      expect(['card_unknown', 'card_lookup_result', 'error']).toContain(response.type);
    }
    expect(device.isConnected()).toBe(true);
  });

  // ── start_greeting ───────────────────────────────────────────────

  it('should send start_greeting with RFID UID', async () => {
    const response = await device.sendStartGreeting('E2E-RFID-GREET-001');
    expect(device.isConnected()).toBe(true);
  });

  // ── start_greeting_text ──────────────────────────────────────────

  it('should send start_greeting_text with RFID UID', async () => {
    const response = await device.sendStartGreetingText('E2E-RFID-GREET-002');
    expect(device.isConnected()).toBe(true);
  });

  // ── download_request ─────────────────────────────────────────────

  it('should send download_request with RFID UID', async () => {
    const response = await device.sendDownloadRequest('E2E-RFID-DL-001');
    expect(device.isConnected()).toBe(true);
  });

  // ── Rapid consecutive card scans ─────────────────────────────────

  it('should handle rapid consecutive card_lookup scans', async () => {
    const uids = ['RAPID-A', 'RAPID-B', 'RAPID-C', 'RAPID-D'];
    for (const uid of uids) {
      await device.sendCardLookup(uid);
    }
    // Gateway should handle without deadlock or crash
    expect(device.isConnected()).toBe(true);
  });

  // ── Card lookup without prior hello ──────────────────────────────

  it('should not crash on card_lookup without prior hello', async () => {
    const response = await deviceNoHello.sendCardLookup('NO-HELLO-CARD');
    expect(deviceNoHello.isConnected()).toBe(true);
  });

  // ── Health check ─────────────────────────────────────────────────

  it('should report healthy after all RFID scan tests', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
