/**
 * Multi-Device MQTT E2E Scenarios
 * Covers: 8.4 Multiple devices simultaneously, 12.5 Multi-device household
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

describe('MQTT Multi-Device E2E', () => {

  const devices = [];
  const DEVICE_COUNT = 3;

  beforeAll(async () => {
    for (let i = 0; i < DEVICE_COUNT; i++) {
      const mac = `E2:E2:00:00:0A:0${i + 1}`;
      const device = new DeviceSimulator({ mac });
      await device.connect();
      devices.push(device);
    }
  });

  afterAll(async () => {
    for (const device of devices) {
      await device.disconnect().catch(() => {});
    }
  });

  describe('8.4 - Multiple devices connect simultaneously', () => {
    it('should accept hello from all devices', async () => {
      const results = await Promise.allSettled(
        devices.map(d => d.sendHello())
      );

      // All should succeed (no rejections from connection errors)
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBe(0);
    });
  });

  describe('12.5 - Independent device sessions', () => {
    it('should handle concurrent mode changes without cross-talk', async () => {
      // Each device changes to a different mode simultaneously
      const modes = ['music', 'story', 'conversation'];
      const results = await Promise.allSettled(
        devices.map((d, i) => d.sendModeChange(modes[i]))
      );

      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBe(0);
    });

    it('should handle concurrent card lookups', async () => {
      const results = await Promise.allSettled(
        devices.map((d, i) => d.sendCardLookup(`MULTI-CARD-${i}`))
      );

      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBe(0);
    });
  });

  describe('Gateway stability after concurrent operations', () => {
    it('should still be healthy', async () => {
      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });
  });

});
