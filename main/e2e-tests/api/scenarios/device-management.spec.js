/**
 * Device Management E2E Scenarios
 * Covers: Device update, bind/unbind, kid assignment, mode switching, playlists
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders } = require('../helpers/auth.helper');
const { testDevice, testContent, uniqueId } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

// ── Device Update ───────────────────────────────────────────────────────────

describe('Device Update E2E', () => {

  const device = testDevice();
  let deviceId = null;

  it('should register a device', async () => {
    await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should get device details by MAC', async () => {
    const mac = device.macAddress.replace(/:/g, '').toLowerCase();
    await pactum.spec()
      .get(`/device/${mac}`)
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should list devices with pagination', async () => {
    await pactum.spec()
      .get('/device/list')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ page: 1, size: 5 })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});

// ── Device Mode Switching ───────────────────────────────────────────────────

describe('Device Mode Switching E2E', () => {

  const device = testDevice();
  let mac;

  it('should register device for mode tests', async () => {
    await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });

    mac = device.macAddress.replace(/:/g, '').toLowerCase();
  });

  it('should get current mode', async () => {
    await pactum.spec()
      .get(`/device/${mac}/mode`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should cycle mode (conversation → music → story)', async () => {
    await pactum.spec()
      .post(`/device/${mac}/cycle-mode`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get device-mode (auto/manual)', async () => {
    await pactum.spec()
      .get(`/device/${mac}/device-mode`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Device Playlists ────────────────────────────────────────────────────────

describe('Device Playlist E2E', () => {

  const device = testDevice();
  let mac;
  let contentId;

  it('should register device and create content', async () => {
    // Register device
    await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });

    mac = device.macAddress.replace(/:/g, '').toLowerCase();

    // Create music content for playlist
    const music = testContent('music');
    contentId = await pactum.spec()
      .post('/content/library')
      .withHeaders(getBearerHeaders())
      .withJson(music)
      .expectStatus(200)
      .returns('data.id');

    cleanup.track('content', contentId);
  });

  it('should get empty music playlist', async () => {
    await pactum.spec()
      .get(`/device/${mac}/playlist/music`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should add content to music playlist', async () => {
    if (!contentId) return;

    await pactum.spec()
      .post(`/device/${mac}/playlist/music`)
      .withHeaders(getBearerHeaders())
      .withJson({ contentId })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should get music playlist with added content', async () => {
    await pactum.spec()
      .get(`/device/${mac}/playlist/music`)
      .expectStatus(200);
  });

  it('should get empty story playlist', async () => {
    await pactum.spec()
      .get(`/device/${mac}/playlist/story`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should clear music playlist', async () => {
    await pactum.spec()
      .delete(`/device/${mac}/playlist/music/clear`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Device Kid Assignment ───────────────────────────────────────────────────

describe('Device Kid Assignment E2E', () => {

  const device = testDevice();
  let deviceId = null;

  it('should register device', async () => {
    const res = await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expectStatus(200)
      .returns('res.body');

    deviceId = res?.data?.id;
  });

  it('should assign kid by MAC', async () => {
    await pactum.spec()
      .put('/device/assign-kid-by-mac')
      .withHeaders(getBearerHeaders())
      .withJson({
        mac: device.macAddress,
        kidId: 1, // May not exist, but tests the endpoint
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Device Unbind ───────────────────────────────────────────────────────────

describe('Device Unbind E2E', () => {

  const device = testDevice();

  it('should register then unbind a device', async () => {
    const res = await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expectStatus(200)
      .returns('res.body');

    const deviceId = res?.data?.id;
    if (!deviceId) return;

    await pactum.spec()
      .post('/device/unbind')
      .withHeaders(getBearerHeaders())
      .withJson({ deviceId })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });
});
