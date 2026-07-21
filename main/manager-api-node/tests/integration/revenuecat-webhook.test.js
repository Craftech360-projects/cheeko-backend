/**
 * POST /webhooks/revenuecat integration tests (SUB-15).
 *
 * Runs without a live database (tests/setup.js) — asserts the gate in front
 * of the ledger: Authorization compare before anything is written. Transition
 * logic is unit-tested in tests/unit/revenuecat.service.test.js.
 */

const { request, app } = require('../setup');

const AUTH = 'rc-integration-secret';

describe('POST /webhooks/revenuecat', () => {
  const original = process.env.REVENUECAT_WEBHOOK_AUTH;
  afterEach(() => {
    if (original === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH;
    else process.env.REVENUECAT_WEBHOOK_AUTH = original;
  });

  it('returns 503 when the auth secret is not configured', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    const res = await request(app)
      .post('/webhooks/revenuecat')
      .send({ api_version: '1.0', event: { id: 'e1', type: 'TEST' } });
    expect(res.statusCode).toBe(503);
  });

  it('returns 401 on a wrong Authorization header', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
    const res = await request(app)
      .post('/webhooks/revenuecat')
      .set('Authorization', 'wrong')
      .send({ api_version: '1.0', event: { id: 'e1', type: 'TEST' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
    const res = await request(app)
      .post('/webhooks/revenuecat')
      .send({ api_version: '1.0', event: { id: 'e1', type: 'TEST' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on an authorized body without an event id', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
    const res = await request(app)
      .post('/webhooks/revenuecat')
      .set('Authorization', AUTH)
      .send({ api_version: '1.0', event: { type: 'TEST' } });
    expect(res.statusCode).toBe(400);
  });
});
