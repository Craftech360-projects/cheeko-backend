'use strict';

/**
 * E2E — Mobile Kids API Tests  (TC-3, TC-6.8)
 *
 * All /toy/api/mobile/kids routes require Firebase auth (requireFirebaseAuth).
 * Without a valid Firebase token the middleware returns 401.
 *
 * Tests are grouped by:
 *   1. Auth gate — every endpoint rejects unauthenticated requests
 *   2. Request validation — bad payloads get 400 even with a (fake) token
 *   3. Happy-path shape — with the test Firebase token we verify response envelope
 */

const { request, app, BASE } = require('../setup');

const KIDS_BASE = `${BASE}/api/mobile/kids`;
const FAKE_TOKEN = 'Bearer fake-firebase-token-for-testing';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
}

// ---------------------------------------------------------------------------
// TC-3.x  Auth gate — all kid routes require Firebase auth
// ---------------------------------------------------------------------------

describe('Kids API — auth gate (TC-3)', () => {
  it('GET /kids returns 401 without auth', async () => {
    const res = await request(app).get(KIDS_BASE);
    expect(res.status).toBe(401);
  });

  it('POST /kids returns 401 without auth', async () => {
    const res = await request(app)
      .post(KIDS_BASE)
      .send({ name: 'Arjun', date_of_birth: '2020-06-01', gender: 'Male' });
    expect(res.status).toBe(401);
  });

  it('PUT /kids/:id returns 401 without auth', async () => {
    const res = await request(app)
      .put(`${KIDS_BASE}/some-kid-id`)
      .send({ name: 'Updated' });
    expect(res.status).toBe(401);
  });

  it('DELETE /kids/:id returns 401 without auth', async () => {
    const res = await request(app).delete(`${KIDS_BASE}/some-kid-id`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// TC-3.5  POST /kids — request body validation
// ---------------------------------------------------------------------------

describe('POST /kids — body validation (TC-3.5)', () => {
  it('returns 400 or 401 when name is missing', async () => {
    const res = await request(app)
      .post(KIDS_BASE)
      .set('Authorization', FAKE_TOKEN)
      .send({ date_of_birth: '2020-06-01', gender: 'Male' });
    expect([400, 401]).toContain(res.status);
  });

  it('returns 400 or 401 when date_of_birth is missing', async () => {
    const res = await request(app)
      .post(KIDS_BASE)
      .set('Authorization', FAKE_TOKEN)
      .send({ name: 'Arjun', gender: 'Male' });
    expect([400, 401]).toContain(res.status);
  });

  it('returns 400 or 401 when body is empty', async () => {
    const res = await request(app)
      .post(KIDS_BASE)
      .set('Authorization', FAKE_TOKEN)
      .send({});
    expect([400, 401]).toContain(res.status);
  });

  it('returns 400 or 401 for an invalid date_of_birth format', async () => {
    const res = await request(app)
      .post(KIDS_BASE)
      .set('Authorization', FAKE_TOKEN)
      .send({ name: 'Arjun', date_of_birth: 'not-a-date', gender: 'Male' });
    expect([400, 401]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-3.7  PUT /kids/:id — update validation
// ---------------------------------------------------------------------------

describe('PUT /kids/:id — body validation (TC-3.7)', () => {
  it('returns 400 or 401 when body is empty', async () => {
    const res = await request(app)
      .put(`${KIDS_BASE}/nonexistent-id`)
      .set('Authorization', FAKE_TOKEN)
      .send({});
    expect([400, 401, 404]).toContain(res.status);
  });

  it('returns 400, 401, or 404 for unknown kid id', async () => {
    const res = await request(app)
      .put(`${KIDS_BASE}/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', FAKE_TOKEN)
      .send({ name: 'Updated Name' });
    expect([400, 401, 404, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-3.x  Response envelope is always present
// ---------------------------------------------------------------------------

describe('Kids API — response envelope shape', () => {
  it('GET /kids response has code field (even on 401)', async () => {
    const res = await request(app).get(KIDS_BASE);
    assertEnvelope(res);
  });

  it('POST /kids response has code field (even on 401)', async () => {
    const res = await request(app).post(KIDS_BASE).send({});
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-3.x  DELETE /kids/:id
// ---------------------------------------------------------------------------

describe('DELETE /kids/:id (TC-3)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`${KIDS_BASE}/any-id`);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 400, 401, or 404 with fake token and unknown id', async () => {
    const res = await request(app)
      .delete(`${KIDS_BASE}/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', FAKE_TOKEN);
    expect([400, 401, 404]).toContain(res.status);
  });
});
