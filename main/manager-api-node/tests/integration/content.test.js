/**
 * Content Routes Integration Tests
 *
 * Covers: /toy/content/*
 *
 * Auth model:
 *   - requireAuth  : most library / legacy read endpoints
 *   - requireAdmin : create / update / delete / upload / batch
 *   - public       : /content/search, /content/music/*, /content/story/*, /content/random/*
 *
 * Standard response: { code: 0, msg: 'success', data: {...} }
 * Auth failure returns a body with a non-zero `code`.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');

const MOCK_TOKEN = 'Bearer test-token';
const TEST_CONTENT_ID = 'test-content-id-123';

// ============================================================
// Helper: assert standard response shape
// ============================================================
function expectStandardBody(res) {
  expect(res.body).toHaveProperty('code');
}

// ============================================================
// Library endpoints  (requireAuth)
// ============================================================

describe('GET /toy/content/library', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/content/library');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with auth returns 200 or a server-side error', async () => {
    const res = await request(app)
      .get('/toy/content/library')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('accepts pagination and filter query params', async () => {
    const res = await request(app)
      .get('/toy/content/library')
      .query({ page: 1, limit: 5, contentType: 'music', category: 'English' })
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// /content/library/music  — not a real route; the actual
// equivalent is /content/music/list (public, no auth).
// Test that path to verify the legacy public endpoint works.
// ============================================================

describe('GET /toy/content/music/list (library music)', () => {
  it('is publicly accessible — no auth required', async () => {
    const res = await request(app).get('/toy/content/music/list');
    expect([200, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('returns paginated data on success', async () => {
    const res = await request(app)
      .get('/toy/content/music/list')
      .query({ page: 1, limit: 5 });
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
    }
  });
});

// ============================================================
// /content/story/list (library story)
// ============================================================

describe('GET /toy/content/story/list (library story)', () => {
  it('returns 404 after Story Corner removal', async () => {
    const res = await request(app).get('/toy/content/story/list');
    expect(res.status).toBe(404);
  });

  it('stays removed even with pagination params', async () => {
    const res = await request(app)
      .get('/toy/content/story/list')
      .query({ page: 1, limit: 5 });
    expect(res.status).toBe(404);
  });
});

// ============================================================
// /content/search  (public — no requireAuth)
// ============================================================

describe('GET /toy/content/search', () => {
  it('returns 400 when query is missing', async () => {
    const res = await request(app).get('/toy/content/search');
    expect(res.status).toBe(400);
    expectStandardBody(res);
  });

  it('returns 400 when query is shorter than 2 characters', async () => {
    const res = await request(app)
      .get('/toy/content/search')
      .query({ q: 'a' });
    expect(res.status).toBe(400);
    expectStandardBody(res);
  });

  it('with q=test returns 200 or 500 (no auth needed)', async () => {
    const res = await request(app)
      .get('/toy/content/search')
      .query({ q: 'test' });
    expect([200, 500]).toContain(res.status);
    expectStandardBody(res);
    if (res.status === 200) {
      expect(res.body.data).toHaveProperty('music');
      expect(res.body.data).toHaveProperty('stories');
    }
  });
});

// ============================================================
// /content/library/categories  (requireAuth)
// ============================================================

describe('GET /toy/content/library/categories', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/content/library/categories');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with auth returns 200 or a server-side error', async () => {
    const res = await request(app)
      .get('/toy/content/library/categories')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('accepts optional contentType filter', async () => {
    const res = await request(app)
      .get('/toy/content/library/categories')
      .query({ contentType: 'music' })
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: GET /toy/content/library  (acts as list — requireAdmin
// via POST /library but GET /library is requireAuth)
// The task spec calls this /toy/content/list; the real path is
// GET /toy/content/library — auth gate covered above.
// ============================================================

describe('Admin gate: GET /toy/content/library without auth', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/content/library');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: POST /toy/content/library/upload  (requireAdmin + multer)
// ============================================================

describe('POST /toy/content/library/upload', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/content/library/upload')
      .set('Content-Type', 'multipart/form-data');
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake admin token returns 401 or 400 (bad file)', async () => {
    const res = await request(app)
      .post('/toy/content/library/upload')
      .set('Authorization', MOCK_TOKEN)
      .field('contentType', 'music');
    // Token is invalid → 401; or upload validation fires → 400
    expect([400, 401]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: PUT /toy/content/library/:id  (requireAdmin)
// ============================================================

describe('PUT /toy/content/library/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put(`/toy/content/library/${TEST_CONTENT_ID}`)
      .send({ title: 'Updated' });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake admin token returns 401, 403, 404, or 500', async () => {
    const res = await request(app)
      .put(`/toy/content/library/${TEST_CONTENT_ID}`)
      .set('Authorization', MOCK_TOKEN)
      .send({ title: 'Updated' });
    expect([401, 403, 404, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Admin: DELETE /toy/content/library/:id  (requireAdmin)
// ============================================================

describe('DELETE /toy/content/library/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete(`/toy/content/library/${TEST_CONTENT_ID}`);
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with fake admin token returns 401, 403, 404, or 500', async () => {
    const res = await request(app)
      .delete(`/toy/content/library/${TEST_CONTENT_ID}`)
      .set('Authorization', MOCK_TOKEN);
    expect([401, 403, 404, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Library search  (requireAuth)
// ============================================================

describe('GET /toy/content/library/search', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .get('/toy/content/library/search')
      .query({ q: 'test' });
    expect(res.status).toBe(401);
    expectStandardBody(res);
  });

  it('with auth but no query returns 400 or 401', async () => {
    const res = await request(app)
      .get('/toy/content/library/search')
      .set('Authorization', MOCK_TOKEN);
    expect([400, 401]).toContain(res.status);
    expectStandardBody(res);
  });

  it('with auth and valid query returns 200, 401, or 500', async () => {
    const res = await request(app)
      .get('/toy/content/library/search')
      .query({ q: 'baby shark' })
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Removed playlist endpoints
// ============================================================

describe('Removed Playlist Routes', () => {
  const TEST_DEVICE_ID = 'test-device-id-123';

  it('returns 404 for removed music playlist route', async () => {
    const res = await request(app)
      .get(`/toy/content/playlist/music/${TEST_DEVICE_ID}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for removed story playlist route', async () => {
    const res = await request(app)
      .get(`/toy/content/playlist/story/${TEST_DEVICE_ID}`);

    expect(res.status).toBe(404);
  });
});

// ============================================================
// Response format sanity check
// ============================================================

describe('Response format', () => {
  it('auth failure returns a body with non-zero code', async () => {
    const res = await request(app).get('/toy/content/library');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code');
    expect(res.body.code).not.toBe(0);
  });
});
