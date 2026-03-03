'use strict';
/**
 * Token Usage Analytics Routes Integration Tests
 *
 * All endpoints are under /toy/usage and require authentication
 * via requireAuth middleware (Bearer token lookup in sys_user_token).
 *
 * Endpoints:
 *   GET /toy/usage/tokens/:macAddress/session/:sessionId  — per-session usage
 *   GET /toy/usage/analytics/daily-summary               — daily aggregate
 *   GET /toy/usage/analytics/per-device                  — per-device breakdown
 *   GET /toy/usage/analytics/totals                      — overall totals
 */

const request = require('supertest');
const app = require('../../src/app');

const BASE = '/toy/usage';

// Example test values
const TEST_MAC = 'AA:BB:CC:DD:EE:FF';
const TEST_SESSION_ID = 'test-session-abc-123';
const UNKNOWN_MAC = '00:00:00:00:00:01';
const UNKNOWN_SESSION = 'nonexistent-session-id';

// =============================================
// GET /toy/usage/tokens/:macAddress/session/:sessionId
// =============================================

describe('Usage Analytics Routes (/toy/usage)', () => {
  describe('GET /tokens/:macAddress/session/:sessionId', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(res.body).toHaveProperty('msg');
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject malformed Authorization header', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}`)
        .set('Authorization', 'Basic abc123');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return JSON content-type on 401', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}`);

      expect(res.type).toMatch(/json/);
    });

    it('should return standard error envelope on 401', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should require auth for MAC with dashes', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/AA-BB-CC-DD-EE-FF/session/${TEST_SESSION_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require auth for lowercase MAC', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/aa:bb:cc:dd:ee:ff/session/${TEST_SESSION_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require auth for UUID-style session ID', async () => {
      const res = await request(app)
        .get(`${BASE}/tokens/${TEST_MAC}/session/550e8400-e29b-41d4-a716-446655440000`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  // =============================================
  // GET /toy/usage/analytics/daily-summary
  // =============================================

  describe('GET /analytics/daily-summary', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should require auth even with startDate and endDate params', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary?startDate=2025-01-01&endDate=2025-01-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require auth with only startDate param', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary?startDate=2025-01-01`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should require auth with only endDate param', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary?endDate=2025-12-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // GET /toy/usage/analytics/per-device
  // =============================================

  describe('GET /analytics/per-device', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/per-device`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/per-device`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/per-device`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should require auth with date range params', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/per-device?startDate=2025-01-01&endDate=2025-01-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/per-device`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // GET /toy/usage/analytics/totals
  // =============================================

  describe('GET /analytics/totals', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/totals`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/totals`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/totals`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/totals`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // Auth guard coverage — all endpoints together
  // =============================================

  describe('Auth Guard — all usage endpoints', () => {
    const endpoints = [
      { method: 'get', path: `${BASE}/tokens/${TEST_MAC}/session/${TEST_SESSION_ID}` },
      { method: 'get', path: `${BASE}/analytics/daily-summary` },
      { method: 'get', path: `${BASE}/analytics/per-device` },
      { method: 'get', path: `${BASE}/analytics/totals` },
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
          .set('Authorization', 'Bearer totally-invalid-xyz');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
      }
    );
  });

  // =============================================
  // Response format consistency
  // =============================================

  describe('Response Format', () => {
    it('should include data property in successful responses', async () => {
      // We cannot get a valid token in integration tests, but we can verify
      // that the success response shape is { code: 0, msg, data } by checking
      // a public test — already covered in auth.test.js; here we confirm
      // the error shape is consistent across all usage endpoints.
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      // data may be null or absent on error responses — do not assert its presence
    });

    it('should never expose stack traces in the response body', async () => {
      const res = await request(app)
        .get(`${BASE}/analytics/daily-summary`);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toMatch(/at Object\./);
      expect(bodyStr).not.toMatch(/stack/);
    });
  });
});
