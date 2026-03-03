'use strict';
/**
 * TTS Voice (Timbre) Routes Integration Tests
 *
 * All endpoints are under /toy/ttsVoice and require admin auth
 * via requireAdmin middleware (token lookup in sys_user_token + admin role check).
 *
 * Note: The route uses requireAdmin directly (not requireAuth + requireAdmin),
 * so no-token and invalid-token both return 401 at the middleware level.
 *
 * Endpoints:
 *   GET    /toy/ttsVoice/         — paginated list (requires ttsModelId query param)
 *   POST   /toy/ttsVoice/         — create timbre
 *   PUT    /toy/ttsVoice/:id      — update timbre
 *   POST   /toy/ttsVoice/delete   — batch delete
 */

const request = require('supertest');
const app = require('../../src/app');

const BASE = '/toy/ttsVoice';
const TEST_TIMBRE_ID = 'some-timbre-uuid';
const VALID_TTS_MODEL_ID = 'some-model-uuid';

// =============================================
// GET /toy/ttsVoice/
// =============================================

describe('TTS Voice Routes (/toy/ttsVoice)', () => {
  describe('GET /', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(res.body).toHaveProperty('msg');
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject malformed Authorization header', async () => {
      const res = await request(app)
        .get(`${BASE}/`)
        .set('Authorization', 'Token not-a-bearer-scheme');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return JSON content-type on 401', async () => {
      const res = await request(app)
        .get(`${BASE}/`);

      expect(res.type).toMatch(/json/);
    });

    it('should return standard error envelope on 401', async () => {
      const res = await request(app)
        .get(`${BASE}/`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should require authentication even with ttsModelId query param', async () => {
      const res = await request(app)
        .get(`${BASE}/?ttsModelId=${VALID_TTS_MODEL_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require authentication with pagination parameters', async () => {
      const res = await request(app)
        .get(`${BASE}/?ttsModelId=${VALID_TTS_MODEL_ID}&page=1&limit=10`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require authentication with name filter parameter', async () => {
      const res = await request(app)
        .get(`${BASE}/?ttsModelId=${VALID_TTS_MODEL_ID}&name=TestVoice&page=1&limit=10`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  // =============================================
  // POST /toy/ttsVoice/
  // =============================================

  describe('POST /', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .post(`${BASE}/`)
        .send({
          languages: 'en',
          name: 'Test Voice',
          ttsModelId: VALID_TTS_MODEL_ID,
          ttsVoice: 'en-US-Standard-A'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post(`${BASE}/`)
        .set('Authorization', 'Bearer invalid-token')
        .send({
          languages: 'en',
          name: 'Test Voice',
          ttsModelId: VALID_TTS_MODEL_ID,
          ttsVoice: 'en-US-Standard-A'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .post(`${BASE}/`)
        .send({});

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      // 401 (no auth) before any body validation
      expect(res.status).toBe(401);
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .post(`${BASE}/`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // PUT /toy/ttsVoice/:id
  // =============================================

  describe('PUT /:id', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .put(`${BASE}/${TEST_TIMBRE_ID}`)
        .send({
          languages: 'en',
          name: 'Updated Voice',
          ttsModelId: VALID_TTS_MODEL_ID,
          ttsVoice: 'en-US-Standard-B'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .put(`${BASE}/${TEST_TIMBRE_ID}`)
        .set('Authorization', 'Bearer invalid-token')
        .send({
          languages: 'en',
          name: 'Updated Voice',
          ttsModelId: VALID_TTS_MODEL_ID,
          ttsVoice: 'en-US-Standard-B'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .put(`${BASE}/${TEST_TIMBRE_ID}`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should require auth for any ID value', async () => {
      const res = await request(app)
        .put(`${BASE}/550e8400-e29b-41d4-a716-446655440000`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  // =============================================
  // POST /toy/ttsVoice/delete  (batch delete)
  // =============================================

  describe('POST /delete', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .post(`${BASE}/delete`)
        .send([TEST_TIMBRE_ID]);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post(`${BASE}/delete`)
        .set('Authorization', 'Bearer invalid-token')
        .send([TEST_TIMBRE_ID]);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .post(`${BASE}/delete`)
        .send([]);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .post(`${BASE}/delete`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // Auth guard coverage — all endpoints
  // =============================================

  describe('Auth Guard — all endpoints', () => {
    const endpoints = [
      { method: 'get',  path: `${BASE}/` },
      { method: 'get',  path: `${BASE}/?ttsModelId=${VALID_TTS_MODEL_ID}&page=1&limit=10` },
      { method: 'post', path: `${BASE}/` },
      { method: 'put',  path: `${BASE}/${TEST_TIMBRE_ID}` },
      { method: 'post', path: `${BASE}/delete` },
    ];

    it.each(endpoints)(
      '$method $path — no token should return 401',
      async ({ method, path }) => {
        const res = await request(app)[method](path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
        expect(res.body).toHaveProperty('msg');
        expect(typeof res.body.msg).toBe('string');
      }
    );

    it.each(endpoints)(
      '$method $path — invalid token should return 401',
      async ({ method, path }) => {
        const res = await request(app)
          [method](path)
          .set('Authorization', 'Bearer totally-invalid-token-xyz');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
      }
    );
  });

  // =============================================
  // Response format consistency
  // =============================================

  describe('Response Format', () => {
    it('should always return { code, msg } in the body on auth failure', async () => {
      const endpoints = [
        () => request(app).get(`${BASE}/`),
        () => request(app).post(`${BASE}/`).send({}),
        () => request(app).put(`${BASE}/${TEST_TIMBRE_ID}`).send({}),
        () => request(app).post(`${BASE}/delete`).send([]),
      ];

      for (const makeReq of endpoints) {
        const res = await makeReq();
        expect(res.body).toHaveProperty('code');
        expect(res.body).toHaveProperty('msg');
        expect(typeof res.body.code).toBe('number');
        expect(typeof res.body.msg).toBe('string');
      }
    });
  });
});
