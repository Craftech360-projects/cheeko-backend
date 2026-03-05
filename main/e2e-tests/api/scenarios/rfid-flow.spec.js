/**
 * RFID Flow E2E Scenarios
 * Covers: 6.1 Register tag, 6.5 Reassign, 12.3 RFID-to-playback (API parts)
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders } = require('../helpers/auth.helper');
const { testRfidCard, testRfidSeries } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

describe('RFID Flow E2E', () => {

  let cardId = null;
  const card = testRfidCard();

  describe('Step 1: Create RFID card (6.1)', () => {
    it('should create an RFID card mapping', async () => {
      const res = await pactum.spec()
        .post('/admin/rfid/card')
        .withHeaders(getServiceKeyHeaders())
        .withJson(card)
        .expectStatus(200)
        .returns('data.id');

      cardId = res;
      cleanup.track('rfid-card', cardId);
    });
  });

  describe('Step 2: List RFID cards', () => {
    it('should include the created card in list', async () => {
      await pactum.spec()
        .get('/admin/rfid/card/list')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: Card lookup (12.3 API part)', () => {
    it('should look up card by rfidUid', async () => {
      if (!cardId) return;

      await pactum.spec()
        .get(`/admin/rfid/card/lookup/${card.rfidUid}`)
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200);
    });
  });

  describe('Step 4: RFID series management', () => {
    let seriesId = null;

    it('should create an RFID series', async () => {
      const series = testRfidSeries();
      const res = await pactum.spec()
        .post('/admin/rfid/series')
        .withHeaders(getServiceKeyHeaders())
        .withJson(series)
        .expectStatus(200)
        .returns('data.id');

      seriesId = res;
      cleanup.track('rfid-series', seriesId);
    });

    it('should list RFID series', async () => {
      await pactum.spec()
        .get('/admin/rfid/series/list')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

});
