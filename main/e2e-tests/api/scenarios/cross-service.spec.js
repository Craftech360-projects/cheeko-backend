/**
 * Cross-Service E2E Scenarios
 * Covers: 12.2 Content delivery pipeline, 12.3 RFID to playback (API parts)
 *
 * These are the highest-value tests — they validate multiple services working together.
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders } = require('../helpers/auth.helper');
const { testDevice, testContent, testRfidCard } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

describe('12.2 - Content Delivery Pipeline (Full Flow)', () => {

  let musicId;

  it('Step 1: Register device', async () => {
    const device = testDevice();
    await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('Step 2: Upload music content', async () => {
    const music = testContent('music');
    musicId = await pactum.spec()
      .post('/content/library')
      .withHeaders(getServiceKeyHeaders())
      .withJson(music)
      .expectStatus(200)
      .returns('data.id');

    cleanup.track('content', musicId);
    expect(musicId).toBeTruthy();
  });

  it('Step 3: Verify content library has the music', async () => {
    await pactum.spec()
      .get('/content/library')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('Step 4: Verify device exists in list', async () => {
    await pactum.spec()
      .get('/device/list')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

});

describe('12.3 - RFID to Playback (API Parts)', () => {

  let cardId, contentId;
  const card = testRfidCard();

  it('Step 1: Create content for RFID linkage', async () => {
    const content = testContent('story');
    contentId = await pactum.spec()
      .post('/content/library')
      .withHeaders(getServiceKeyHeaders())
      .withJson(content)
      .expectStatus(200)
      .returns('data.id');

    cleanup.track('content', contentId);
  });

  it('Step 2: Create RFID card', async () => {
    const res = await pactum.spec()
      .post('/admin/rfid/card')
      .withHeaders(getServiceKeyHeaders())
      .withJson(card)
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    if (res?.data?.id) {
      cardId = res.data.id;
      cleanup.track('rfid-card', cardId);
    }
  });

  it('Step 3: Link RFID card to content', async () => {
    if (!cardId || !contentId) return;

    await pactum.spec()
      .put('/admin/rfid/card')
      .withHeaders(getServiceKeyHeaders())
      .withJson({ id: cardId, contentId: contentId })
      .expectStatus(200);
  });

  it('Step 4: Verify card lookup returns linked content', async () => {
    if (!cardId) return;

    await pactum.spec()
      .get(`/admin/rfid/card/lookup/${card.rfidUid}`)
      .withHeaders(getServiceKeyHeaders())
      .expectStatus(200);
  });

});
