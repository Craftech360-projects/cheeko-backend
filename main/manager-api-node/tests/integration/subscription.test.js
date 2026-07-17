/**
 * Subscription Routes Integration Tests
 *
 * Covers the auth contract of GET /toy/device/:mac/session-verdict and
 * POST /toy/device/:mac/usage-heartbeat.
 *
 * Like the other suites here, this runs without a live database or .env (see
 * tests/setup.js), so it asserts only what holds in that environment: the
 * endpoint is service-key gated and never answers an unauthenticated caller.
 * The verdict decision itself is unit-tested in tests/unit/subscription.service.test.js.
 */

const { request, app, BASE } = require('../setup');

const MAC = '00:16:3E:AC:B5:38';
const verdictUrl = (mac) => `${BASE}/device/${mac}/session-verdict`;

describe('GET /toy/device/:mac/session-verdict', () => {
  it('returns 401 without a service key', async () => {
    const res = await request(app).get(verdictUrl(MAC));

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('msg');
  });

  it('returns 401 with a wrong service key', async () => {
    const res = await request(app)
      .get(verdictUrl(MAC))
      .set('X-Service-Key', 'definitely-not-the-key');

    expect(res.statusCode).toBe(401);
  });

  it('never leaks subscription state to an unauthenticated caller', async () => {
    const res = await request(app).get(verdictUrl(MAC));

    expect(res.body.data).toBeFalsy();
  });
});

describe('POST /toy/device/:mac/usage-heartbeat', () => {
  const heartbeatUrl = (mac) => `${BASE}/device/${mac}/usage-heartbeat`;

  it('returns 401 without a service key', async () => {
    const res = await request(app)
      .post(heartbeatUrl(MAC))
      .send({ sessionId: 'session-1', sessionDurationSeconds: 42 });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a wrong service key', async () => {
    const res = await request(app)
      .post(heartbeatUrl(MAC))
      .set('X-Service-Key', 'definitely-not-the-key')
      .send({ sessionId: 'session-1' });

    expect(res.statusCode).toBe(401);
  });
});
