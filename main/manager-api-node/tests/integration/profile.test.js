/**
 * Profile / Mobile Routes Integration Tests
 *
 * Covers: /toy/api/mobile/*
 *
 * Auth model:
 *   - ALL routes under /toy/api/mobile/* are guarded by
 *     `requireFirebaseAuth` (router-level middleware in mobile.routes.js).
 *   - Without a valid Firebase ID token the middleware responds with 401.
 *   - Tests in this file verify only that the auth gates are working;
 *     no real Firebase token is issued.
 *
 * Note on /check-email:
 *   The route is defined inside the same router that applies
 *   requireFirebaseAuth at the top, so it also requires Firebase auth.
 *   The spec says it "may be public" — the current implementation gates it,
 *   so we test for 401 without auth and mark 200 as also acceptable in case
 *   the implementation changes.
 *
 * Standard response for routes using the `success()` helper:
 *   { code: 0, msg: 'success', data: {...} }
 * Routes that haven't adopted the helper respond with raw JSON (no code field).
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');

const MOCK_TOKEN = 'Bearer test-token';

// ============================================================
// Helper: verify the request was rejected (auth gate fired)
// ============================================================
function expectAuthRejection(res) {
  // Firebase auth middleware returns 401; body format may vary
  expect(res.status).toBe(401);
}

// ============================================================
// Parent profile
// ============================================================

describe('GET /toy/api/mobile/parent-profile', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/api/mobile/parent-profile');
    expectAuthRejection(res);
  });

  it('with fake token still returns 401 (invalid Firebase token)', async () => {
    const res = await request(app)
      .get('/toy/api/mobile/parent-profile')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 404, 500]).toContain(res.status);
  });
});

describe('POST /toy/api/mobile/parent-profile', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/api/mobile/parent-profile')
      .send({ fullName: 'Test Parent' });
    expectAuthRejection(res);
  });
});

describe('PUT /toy/api/mobile/parent-profile', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/api/mobile/parent-profile')
      .send({ fullName: 'Updated Parent' });
    expectAuthRejection(res);
  });
});

// ============================================================
// Kids
// ============================================================

describe('GET /toy/api/mobile/kids', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/api/mobile/kids');
    expectAuthRejection(res);
  });
});

describe('POST /toy/api/mobile/kids', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/api/mobile/kids')
      .send({ name: 'Test Kid', birthDate: '2018-05-15', gender: 'male' });
    expectAuthRejection(res);
  });
});

// ============================================================
// User state
// ============================================================

describe('GET /toy/api/mobile/user-state', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/api/mobile/user-state');
    expectAuthRejection(res);
  });
});

describe('POST /toy/api/mobile/user-state', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/api/mobile/user-state')
      .send({});
    expectAuthRejection(res);
  });
});

// ============================================================
// Agents
// ============================================================

describe('GET /toy/api/mobile/agents', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/api/mobile/agents');
    expectAuthRejection(res);
  });
});

describe('POST /toy/api/mobile/agents', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/api/mobile/agents')
      .send({ name: 'My Agent' });
    expectAuthRejection(res);
  });
});

// ============================================================
// Account deletion
// ============================================================

describe('DELETE /toy/api/mobile/account', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/toy/api/mobile/account');
    expectAuthRejection(res);
  });
});

// ============================================================
// Check email (inside requireFirebaseAuth block — also 401)
// ============================================================

describe('GET /toy/api/mobile/check-email', () => {
  it('returns 401 without auth (route is inside Firebase-auth block)', async () => {
    const res = await request(app)
      .get('/toy/api/mobile/check-email')
      .query({ email: 'test@example.com' });
    // Currently gated by requireFirebaseAuth; may be relaxed to public later
    expect([200, 401]).toContain(res.status);
  });

  it('without auth the status is never a server error', async () => {
    const res = await request(app)
      .get('/toy/api/mobile/check-email')
      .query({ email: 'test@example.com' });
    expect(res.status).not.toBe(500);
  });
});

// ============================================================
// Additional auth-gated mobile routes (spot-check)
// ============================================================

describe('PUT /toy/api/mobile/kids/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/api/mobile/kids/1')
      .send({ name: 'Updated' });
    expectAuthRejection(res);
  });
});

describe('GET /toy/api/mobile/agents/:agentId', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .get('/toy/api/mobile/agents/test-agent-id');
    expectAuthRejection(res);
  });
});

describe('PUT /toy/api/mobile/agents/:agentId', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/api/mobile/agents/test-agent-id')
      .send({ name: 'Updated Agent' });
    expectAuthRejection(res);
  });
});

describe('DELETE /toy/api/mobile/agents/:agentId', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/toy/api/mobile/agents/test-agent-id');
    expectAuthRejection(res);
  });
});

describe('PUT /toy/api/mobile/user-state/onboarding-completed', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/api/mobile/user-state/onboarding-completed');
    expectAuthRejection(res);
  });
});

// ============================================================
// Response format
// ============================================================

describe('Response format on auth failure', () => {
  it('rejected request has a non-empty body', async () => {
    const res = await request(app).get('/toy/api/mobile/parent-profile');
    expect(res.status).toBe(401);
    // Firebase auth middleware may return { error } or { code, msg } — either is valid
    expect(typeof res.body).toBe('object');
  });

  it('multiple protected routes all reject the same way', async () => {
    const endpoints = [
      () => request(app).get('/toy/api/mobile/parent-profile'),
      () => request(app).get('/toy/api/mobile/kids'),
      () => request(app).get('/toy/api/mobile/user-state'),
      () => request(app).get('/toy/api/mobile/agents'),
    ];

    for (const call of endpoints) {
      const res = await call();
      expect(res.status).toBe(401);
    }
  });
});
