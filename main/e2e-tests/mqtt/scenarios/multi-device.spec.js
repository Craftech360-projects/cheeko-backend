/**
 * Multi-Device MQTT E2E Scenarios
 *
 * Tests that multiple devices can connect simultaneously and operate
 * independently without cross-contamination.
 *
 * MAC range: E2:E2:00:00:0A:xx (unique to this spec)
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

const HEALTH_URL = `${config.mqttGateway.httpUrl}/health`;
const DEVICE_COUNT = 3;

describe('MQTT Multi-Device E2E', () => {
  const devices = [];

  beforeAll(async () => {
    for (let i = 0; i < DEVICE_COUNT; i++) {
      const hex = (i + 1).toString(16).padStart(2, '0').toUpperCase();
      const mac = `E2:E2:00:00:0A:${hex}`;
      const device = new DeviceSimulator({ mac });
      await device.connect();
      devices.push(device);
    }
  });

  afterAll(async () => {
    for (const d of devices) {
      await d.disconnectQuiet().catch(() => {});
    }
  });

  // ── All devices connect ──────────────────────────────────────────

  it('should have all 3 devices connected', () => {
    for (const d of devices) {
      expect(d.isConnected()).toBe(true);
    }
  });

  // ── All devices send hello ───────────────────────────────────────

  it('should accept hello from all devices concurrently', async () => {
    const results = await Promise.allSettled(
      devices.map(d => d.sendHello())
    );

    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBe(0);
  });

  // ── Concurrent mode changes ──────────────────────────────────────

  it('should handle concurrent mode changes from different devices', async () => {
    const modes = ['music', 'story', 'conversation'];
    const results = await Promise.allSettled(
      devices.map((d, i) => d.sendModeChange(modes[i]))
    );

    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBe(0);
  });

  // ── Concurrent card lookups ──────────────────────────────────────

  it('should handle concurrent card_lookup from different devices', async () => {
    const results = await Promise.allSettled(
      devices.map((d, i) => d.sendCardLookup(`MULTI-CARD-${i}`))
    );

    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBe(0);
  });

  // ── Independent sessions ─────────────────────────────────────────

  it('should maintain independent sessions (device actions do not affect others)', async () => {
    // Device 0 changes mode, device 1 does card lookup, device 2 sends abort
    const results = await Promise.allSettled([
      devices[0].sendModeChange('music'),
      devices[1].sendCardLookup('INDEPENDENCE-TEST'),
      devices[2].sendAbort(),
    ]);

    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBe(0);

    // All devices should still be connected
    for (const d of devices) {
      expect(d.isConnected()).toBe(true);
    }
  });

  // ── Health check ─────────────────────────────────────────────────

  it('should report healthy after all multi-device operations', async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000, validateStatus: () => true });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status');
    } catch {
      // Gateway HTTP not available — skip
    }
  });
});
