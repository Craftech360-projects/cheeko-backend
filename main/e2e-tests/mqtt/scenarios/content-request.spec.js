/**
 * Content Request MQTT E2E Scenarios
 * Covers: play_music, play_story function calls
 */

const { DeviceSimulator } = require('../helpers/device-simulator');

describe('MQTT Content Request E2E', () => {

  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:05:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    if (device) await device.disconnect().catch(() => {});
  });

  it('should send play_music function call', async () => {
    const response = await device.sendPlayMusic('play a happy song');
  });

  it('should send play_story function call', async () => {
    const response = await device.sendPlayStory('tell me a story about space');
  });

  it('should handle abort message', async () => {
    await device.sendAbort();
    // Should not crash
  });

});
