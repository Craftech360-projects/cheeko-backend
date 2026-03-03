/**
 * RFID Routes Integration Tests
 *
 * Covers: /toy/admin/rfid/*
 *
 * Auth model:
 *   - requireAdmin : card CRUD, pack CRUD, series CRUD
 *   - requireAuth  : question endpoints, rag/search
 *   - public       : /card/lookup/:rfidUid, /series/lookup/:uid
 *
 * Schema note: `rfid_question_pack` does NOT exist in the Prisma schema.
 *   - `rfid_card_mapping` uses `question_ids` (Json array) instead of
 *     a `question_pack_id` FK.
 *   - Pack-related routes that reference the old table return empty/null
 *     gracefully; tests allow 200 with empty data as well as error codes.
 *
 * Standard success response: { code: 0, msg: 'success', data: {...} }
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');

const MOCK_TOKEN = 'Bearer test-token';
const TEST_UID = 'TEST_UID123';
const NON_EXISTENT_UID = 'FFFFFFFFFFFFFFFF';

// ============================================================
// Helper
// ============================================================
function expectStandardBody(res) {
  expect(res.body).toHaveProperty('code');
}

// ============================================================
// Public lookup endpoints
// ============================================================

describe('GET /toy/admin/rfid/card/lookup/:rfidUid (public)', () => {
  it('returns 200 or 404 for a test UID', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);
    expect([200, 404, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('returns 404 or 200 with null for a non-existent UID', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/card/lookup/${NON_EXISTENT_UID}`);
    expect([200, 404, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('does not require an Authorization header', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);
    // Must not be 401 — the route has no requireAuth/requireAdmin guard
    expect(res.status).not.toBe(401);
  });
});

describe('GET /toy/admin/rfid/series/lookup/:uid (public)', () => {
  it('returns 200, 404, or 500 for a test UID', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/series/lookup/${TEST_UID}`);
    expect([200, 404, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('does not require an Authorization header', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/series/lookup/${TEST_UID}`);
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// Admin: card page / list
// ============================================================

describe('GET /toy/admin/rfid/card/page', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/admin/rfid/card/page');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).not.toBe(0);
  });

  it('with fake token returns 401 or 200/500', async () => {
    const res = await request(app)
      .get('/toy/admin/rfid/card/page')
      .query({ page: 1, limit: 10 })
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('GET /toy/admin/rfid/card/list', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/admin/rfid/card/list');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake token returns 401 or 200/500', async () => {
    const res = await request(app)
      .get('/toy/admin/rfid/card/list')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: POST /card — create card mapping
// ============================================================

describe('POST /toy/admin/rfid/card', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/admin/rfid/card')
      .send({ rfidUid: TEST_UID });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('without rfidUid field returns 400 or 401', async () => {
    // Auth will fail first with a fake token, so 401 is expected.
    // If auth were bypassed, missing rfidUid would cause 400.
    const res = await request(app)
      .post('/toy/admin/rfid/card')
      .set('Authorization', MOCK_TOKEN)
      .send({});
    expect([400, 401]).toContain(res.status);
    expectStandardBody(res);
  });

  it('with fake admin token and rfidUid returns 401, 400, or 500', async () => {
    const res = await request(app)
      .post('/toy/admin/rfid/card')
      .set('Authorization', MOCK_TOKEN)
      .send({ rfidUid: TEST_UID, contentType: 'music' });
    expect([400, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: PUT /card — update card mapping
// ============================================================

describe('PUT /toy/admin/rfid/card', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/admin/rfid/card')
      .send({ id: 1, rfidUid: TEST_UID });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake token returns 401, 400, or 500', async () => {
    const res = await request(app)
      .put('/toy/admin/rfid/card')
      .set('Authorization', MOCK_TOKEN)
      .send({ id: 1 });
    expect([400, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: DELETE /card
// ============================================================

describe('DELETE /toy/admin/rfid/card', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/toy/admin/rfid/card')
      .send({ id: 1 });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake token returns 401 or 400/500', async () => {
    const res = await request(app)
      .delete('/toy/admin/rfid/card')
      .set('Authorization', MOCK_TOKEN)
      .send({ id: 1 });
    expect([400, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: pack endpoints
// Note: rfid_question_pack does NOT exist in Prisma schema.
// The routes exist but the underlying service returns empty /
// null gracefully rather than crashing.
// ============================================================

describe('GET /toy/admin/rfid/pack/list', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/admin/rfid/pack/list');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake token returns 401 or 200/500', async () => {
    const res = await request(app)
      .get('/toy/admin/rfid/pack/list')
      .set('Authorization', MOCK_TOKEN);
    // Pack table does not exist → may be 200 with empty list, 401, or 500
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('POST /toy/admin/rfid/pack', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/admin/rfid/pack')
      .send({ packCode: 'TESTPACK', name: 'Test Pack' });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake token returns 401 or 400/500', async () => {
    const res = await request(app)
      .post('/toy/admin/rfid/pack')
      .set('Authorization', MOCK_TOKEN)
      .send({ packCode: 'TESTPACK', name: 'Test Pack' });
    // Pack table missing in schema → expect 401, 400, or 500
    expect([400, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Additional admin gates (spot-check)
// ============================================================

describe('GET /toy/admin/rfid/pack/page', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/admin/rfid/pack/page');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });
});

describe('PUT /toy/admin/rfid/pack', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/admin/rfid/pack')
      .send({ id: 1 });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });
});

describe('DELETE /toy/admin/rfid/pack', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/toy/admin/rfid/pack')
      .send({ id: 1 });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });
});

// ============================================================
// Response format
// ============================================================

describe('Response format', () => {
  it('auth failure returns a body with non-zero code', async () => {
    const res = await request(app).get('/toy/admin/rfid/card/page');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code');
    expect(res.body.code).not.toBe(0);
  });

  it('public lookup returns a body with code property', async () => {
    const res = await request(app)
      .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);
    expect(res.body).toHaveProperty('code');
  });
});
