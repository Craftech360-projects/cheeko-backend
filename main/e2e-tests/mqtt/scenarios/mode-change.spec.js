/**
 * Mode Change MQTT E2E Scenarios
 * Covers: 8.3 Protocol conversion, mode-change and character-change messages
 */

const { DeviceSimulator } = require('../helpers/device-simulator');
const axios = require('axios');
const config = require('../../test.config');

describe('MQTT Mode Change E2E', () => {

  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:02:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    if (device) await device.disconnect().catch(() => {});
  });

  it('should send mode-change to music without errors', async () => {
    const response = await device.sendModeChange('music');
    // No crash = success
  });

  it('should send mode-change to story without errors', async () => {
    const response = await device.sendModeChange('story');
  });

  it('should send mode-change to conversation without errors', async () => {
    const response = await device.sendModeChange('conversation');
  });

  it('should send character-change without errors', async () => {
    const response = await device.sendCharacterChange('cheeko');
  });

  it('gateway should still be healthy after mode changes', async () => {
    const res = await axios.get(`${config.mqttGateway.httpUrl}/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    expect(res.status).toBe(200);
  });

});
