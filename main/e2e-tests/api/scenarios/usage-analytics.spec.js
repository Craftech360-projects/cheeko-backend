/**
 * Usage Analytics E2E Scenarios
 * Covers: Token usage per-session queries, daily/per-device analytics with date ranges
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Usage Token Session Queries E2E', () => {

  const TEST_MAC = 'e2e000000001';

  it('should return token usage for a specific session', async () => {
    await pactum.spec()
      .get(`/usage/tokens/${TEST_MAC}/session/e2e-session-fake`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

describe('Usage Analytics Date Range Queries E2E', () => {

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  it('should return daily summary with date range', async () => {
    await pactum.spec()
      .get('/usage/analytics/daily-summary')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ startDate: weekAgo, endDate: today })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return per-device analytics with date range', async () => {
    await pactum.spec()
      .get('/usage/analytics/per-device')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ startDate: weekAgo, endDate: today })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return totals with date range', async () => {
    await pactum.spec()
      .get('/usage/analytics/totals')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ startDate: weekAgo, endDate: today })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});
