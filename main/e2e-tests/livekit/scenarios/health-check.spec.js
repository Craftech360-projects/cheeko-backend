/**
 * Media API Health Check E2E Scenarios
 * Covers: Health endpoint, service initialization status
 */

const { isMediaApiAvailable, mediaGet } = require('../helpers/media-api.helper');

let apiAvailable = false;

beforeAll(async () => {
  apiAvailable = await isMediaApiAvailable();
  if (!apiAvailable) {
    console.log('  Media API not running (port 8003) — health check tests will be skipped');
  }
});

describe('Media API Health Check E2E', () => {

  it('should return healthy status', async () => {
    if (!apiAvailable) return;

    const res = await mediaGet('/health');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('status', 'healthy');
  });

  it('should report active_bots count', async () => {
    if (!apiAvailable) return;

    const res = await mediaGet('/health');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('active_bots');
    expect(typeof res.data.active_bots).toBe('number');
  });

  it('should report music_service initialization status', async () => {
    if (!apiAvailable) return;

    const res = await mediaGet('/health');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('music_service');
    expect(typeof res.data.music_service).toBe('boolean');
  });

  it('should report story_service initialization status', async () => {
    if (!apiAvailable) return;

    const res = await mediaGet('/health');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('story_service');
    expect(typeof res.data.story_service).toBe('boolean');
  });

});
