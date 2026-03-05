/**
 * RFID Scan MQTT E2E Scenarios
 * Covers: 6.2-6.4 RFID scan triggers, 6.6 Card dialog mutual exclusivity
 */

const { DeviceSimulator } = require('../helpers/device-simulator');

describe('MQTT RFID Scan E2E', () => {

  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:04:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    if (device) await device.disconnect().catch(() => {});
  });

  describe('6.2 - RFID scan triggers content lookup', () => {
    it('should send card_lookup message', async () => {
      const response = await device.sendCardLookup('TEST-RFID-001');
      // Gateway should process without error
    });
  });

  describe('6.4 - Unregistered RFID scanned', () => {
    it('should handle unknown card gracefully', async () => {
      const response = await device.sendCardLookup('UNKNOWN-CARD-999');
      // Should not crash the gateway
    });
  });

  describe('6.6 - Card dialog mutual exclusivity', () => {
    it('should handle rapid consecutive card scans', async () => {
      // Simulate scanning two cards rapidly
      await device.sendCardLookup('CARD-A');
      await device.sendCardLookup('CARD-B');
      // Should not crash or deadlock
    });
  });

});
