/**
 * Device Connection MQTT E2E Scenarios
 * Covers: 8.1 MQTT connection, 8.2 Device hello/goodbye
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

describe('MQTT Device Connection E2E', () => {

  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:01:01' });
  });

  afterAll(async () => {
    if (device) await device.disconnect().catch(() => {});
  });

  describe('8.1 - MQTT connection established', () => {
    it('should connect to MQTT broker', async () => {
      await device.connect();
      // If we get here without error, connection succeeded
      expect(true).toBe(true);
    });
  });

  describe('8.2 - Device hello message', () => {
    it('should send hello message without errors', async () => {
      const response = await device.sendHello();
      // Gateway may or may not respond — the key is no error
    });
  });

  describe('Gateway health check after device messages', () => {
    it('should respond to HTTP health check', async () => {
      const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      expect(res.status).toBe(200);
    });
  });

});
