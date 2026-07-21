/**
 * POST /webhooks/razorpay integration tests (SUB-6).
 *
 * Like the other suites here, this runs without a live database (see
 * tests/setup.js), so it asserts the gate in front of the ledger: signature
 * verification happens on the raw body BEFORE anything is written, and the
 * new mobile subscription endpoints stay behind Firebase auth. Transition
 * logic is unit-tested in tests/unit/razorpay.service.test.js.
 */

const crypto = require('crypto');
const { request, app, BASE } = require('../setup');

const SECRET = 'whsec-integration-test';
const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

describe('POST /webhooks/razorpay', () => {
  const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
  });

  it('returns 503 when the webhook secret is not configured', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send('{"event":"subscription.activated"}');

    expect(res.statusCode).toBe(503);
  });

  it('returns 401 on an invalid signature and writes nothing', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'not-the-signature')
      .set('X-Razorpay-Event-Id', 'evt_bad_sig')
      .send('{"event":"subscription.activated"}');

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the signature header is missing entirely', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send('{"event":"subscription.activated"}');

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on a correctly signed body without an event id', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const raw = '{"event":"subscription.activated"}';

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', sign(raw))
      .send(raw);

    expect(res.statusCode).toBe(400);
  });
});

describe('mobile subscription endpoints require Firebase auth', () => {
  it('GET /api/mobile/subscription/plans without a token is refused', async () => {
    const res = await request(app).get(`${BASE}/api/mobile/subscription/plans`);
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/mobile/devices/:mac/subscription/checkout without a token is refused', async () => {
    const res = await request(app)
      .post(`${BASE}/api/mobile/devices/AA:BB:CC:DD:EE:FF/subscription/checkout`)
      .send({ tier: 'family' });
    expect(res.statusCode).toBe(401);
  });
});
