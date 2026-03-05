/**
 * Playback Control MQTT E2E Scenarios
 * Covers: Playback next/previous/start_agent actions
 */

const { DeviceSimulator } = require('../helpers/device-simulator');

describe('MQTT Playback Control E2E', () => {

  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'E2:E2:00:00:03:01' });
    await device.connect();
    await device.sendHello();
  });

  afterAll(async () => {
    if (device) await device.disconnect().catch(() => {});
  });

  it('should send next playback control', async () => {
    const response = await device.sendPlaybackControl('next');
  });

  it('should send previous playback control', async () => {
    const response = await device.sendPlaybackControl('previous');
  });

  it('should send start_agent playback control', async () => {
    const response = await device.sendPlaybackControl('start_agent');
  });

});
