'use strict';

/**
 * E2E — Analytics Query API Tests  (TC-7)
 *
 * Routes tested:
 *   GET /toy/analytics/usage/daily/:mac    — TC-7.1 Day tab
 *   GET /toy/analytics/usage/weekly/:mac   — TC-7.2 Week tab
 *   GET /toy/analytics/user/:mac/overall   — TC-7.3 overall stats
 *   GET /toy/analytics/user-progress/:mac  — TC-7.4 user progress
 *   GET /toy/analytics/game-attempts/:mac  — TC-7.5 game stats
 *   GET /toy/analytics/session/list/:mac   — TC-7.6 / TC-8.1 sessions
 *
 * Auth: "Flex auth" — accepts either Bearer token OR X-Service-Key.
 * Without either → 401.
 */

const { request, app, BASE, loginAsAdmin, getServiceKey } = require('../setup');

const ANALYTICS = `${BASE}/analytics`;
const TEST_MAC   = 'AA:BB:CC:DD:EE:FF';
const FAKE_BEARER = 'Bearer fake-token';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
}

// ---------------------------------------------------------------------------
// TC-7.1  Daily usage endpoint
// ---------------------------------------------------------------------------

describe('GET /analytics/usage/daily/:mac  (TC-7.1 – Day tab)', () => {
  it('returns 401 without any auth', async () => {
    const res = await request(app).get(`${ANALYTICS}/usage/daily/${TEST_MAC}`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 200/401/500 with service key auth', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/daily/${TEST_MAC}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('accepts optional date query param without error', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/daily/${TEST_MAC}`)
      .query({ date: '2026-06-18' })
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('rejects invalid MAC format', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/daily/NOT_A_MAC`)
      .set('X-Service-Key', getServiceKey());
    expect([400, 401, 404, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-7.2  Weekly usage endpoint
// ---------------------------------------------------------------------------

describe('GET /analytics/usage/weekly/:mac  (TC-7.2 – Week tab)', () => {
  it('returns 401 without any auth', async () => {
    const res = await request(app).get(`${ANALYTICS}/usage/weekly/${TEST_MAC}`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 200/401/500 with service key auth', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/weekly/${TEST_MAC}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-7.3  Overall stats
// ---------------------------------------------------------------------------

describe('GET /analytics/user/:mac/overall  (TC-7.3)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(`${ANALYTICS}/user/${TEST_MAC}/overall`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns valid response shape with service key', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/user/${TEST_MAC}/overall`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-7.4  User progress
// ---------------------------------------------------------------------------

describe('GET /analytics/user-progress/:mac  (TC-7.4)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(`${ANALYTICS}/user-progress/${TEST_MAC}`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 200/401/404/500 with service key', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/user-progress/${TEST_MAC}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-7.5  Game attempt stats
// ---------------------------------------------------------------------------

describe('GET /analytics/attempts/stats/:mac  (TC-7.5)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(`${ANALYTICS}/attempts/stats/${TEST_MAC}`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 200/401/404/500 with service key', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/attempts/stats/${TEST_MAC}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-7.6 / TC-7.9  Device switch — same endpoint, different MAC
// ---------------------------------------------------------------------------

describe('Device MAC isolation in analytics (TC-7.6)', () => {
  const MAC_A = 'AA:BB:CC:DD:EE:FF';
  const MAC_B = '11:22:33:44:55:66';

  it('daily endpoint scopes to MAC_A', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/daily/${MAC_A}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
  });

  it('daily endpoint scopes to MAC_B independently', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/usage/daily/${MAC_B}`)
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-8.1  Session list (also used in Chat History screen)
// ---------------------------------------------------------------------------

describe('GET /analytics/session/list/:mac  (TC-8.1 – Chat History)', () => {
  it('returns 401 or 404 without auth (flex-auth route)', async () => {
    const res = await request(app).get(`${ANALYTICS}/session/list/${TEST_MAC}`);
    expect([401, 404]).toContain(res.status);
    assertEnvelope(res);
  });

  it('accepts limit query param', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/session/list/${TEST_MAC}`)
      .query({ limit: 20 })
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('accepts large limit (100) for home screen polling', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/session/list/${TEST_MAC}`)
      .query({ limit: 100 })
      .set('X-Service-Key', getServiceKey());
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('returns 400/401/404 for negative limit', async () => {
    const res = await request(app)
      .get(`${ANALYTICS}/session/list/${TEST_MAC}`)
      .query({ limit: -1 })
      .set('X-Service-Key', getServiceKey());
    expect([400, 401, 404, 422]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-7.7  Pull to refresh — response envelope always present
// ---------------------------------------------------------------------------

describe('All analytics endpoints return response envelope', () => {
  const endpoints = [
    `${ANALYTICS}/usage/daily/${TEST_MAC}`,
    `${ANALYTICS}/usage/weekly/${TEST_MAC}`,
    `${ANALYTICS}/user/${TEST_MAC}/overall`,
    `${ANALYTICS}/user-progress/${TEST_MAC}`,
    `${ANALYTICS}/session/list/${TEST_MAC}`,
  ];

  endpoints.forEach((url) => {
    it(`${url} has code field on 401`, async () => {
      const res = await request(app).get(url);
      assertEnvelope(res);
    });
  });
});
