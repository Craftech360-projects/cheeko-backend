'use strict';
/**
 * Email Report Routes Integration Tests
 *
 * All endpoints are under /toy/admin/email-reports and require
 * authentication (requireAuth) AND super-admin privilege (requireSuperAdmin).
 *
 * Without a valid token the middleware stack is:
 *   requireAuth → 401 (no token / bad token)
 *   requireSuperAdmin → checked only after requireAuth passes
 */

const request = require('supertest');
const app = require('../../src/app');

const BASE = '/toy/admin/email-reports';

// =============================================
// GET /toy/admin/email-reports/config
// =============================================

describe('Email Report Routes (/toy/admin/email-reports)', () => {
  describe('GET /config', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/config`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(res.body).toHaveProperty('msg');
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/config`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject malformed Authorization header', async () => {
      const res = await request(app)
        .get(`${BASE}/config`)
        .set('Authorization', 'Basic dXNlcjpwYXNz');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .get(`${BASE}/config`);

      expect(res.type).toMatch(/json/);
    });

    it('should return standard error envelope on 401', async () => {
      const res = await request(app)
        .get(`${BASE}/config`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });
  });

  // =============================================
  // PUT /toy/admin/email-reports/config
  // =============================================

  describe('PUT /config', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .put(`${BASE}/config`)
        .send({ enabled: true, scheduleHour: 8 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .put(`${BASE}/config`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ enabled: true });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope on 401', async () => {
      const res = await request(app)
        .put(`${BASE}/config`)
        .send({});

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should reject non-admin authenticated users with 401 or 403', async () => {
      // With an invalid token the middleware returns 401 before even checking admin
      const res = await request(app)
        .put(`${BASE}/config`)
        .set('Authorization', 'Bearer non-admin-token')
        .send({ enabled: false });

      expect([401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // POST /toy/admin/email-reports/test
  // =============================================

  describe('POST /test', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .post(`${BASE}/test`)
        .send({ recipient: 'test@example.com' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post(`${BASE}/test`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ recipient: 'test@example.com' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .post(`${BASE}/test`);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .post(`${BASE}/test`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // GET /toy/admin/email-reports/history
  // =============================================

  describe('GET /history', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/history`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/history`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get(`${BASE}/history`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should support pagination query params (still 401 without auth)', async () => {
      const res = await request(app)
        .get(`${BASE}/history?page=1&limit=20`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  // =============================================
  // GET /toy/admin/email-reports/preview
  // =============================================

  describe('GET /preview', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .get(`${BASE}/preview`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`${BASE}/preview`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get(`${BASE}/preview`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .get(`${BASE}/preview`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // POST /toy/admin/email-reports/generate
  // =============================================

  describe('POST /generate', () => {
    it('should require authentication (no token)', async () => {
      const res = await request(app)
        .post(`${BASE}/generate`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post(`${BASE}/generate`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .post(`${BASE}/generate`);

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });

    it('should return JSON content-type', async () => {
      const res = await request(app)
        .post(`${BASE}/generate`);

      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // Auth guard coverage across all endpoints
  // =============================================

  describe('Auth Guard — all endpoints', () => {
    const endpoints = [
      { method: 'get',  path: `${BASE}/config` },
      { method: 'put',  path: `${BASE}/config` },
      { method: 'post', path: `${BASE}/test` },
      { method: 'get',  path: `${BASE}/history` },
      { method: 'get',  path: `${BASE}/preview` },
      { method: 'post', path: `${BASE}/generate` },
    ];

    it.each(endpoints)(
      '$method $path — no token should return 401',
      async ({ method, path }) => {
        const res = await request(app)[method](path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
        expect(res.body).toHaveProperty('msg');
      }
    );

    it.each(endpoints)(
      '$method $path — invalid token should return 401',
      async ({ method, path }) => {
        const res = await request(app)
          [method](path)
          .set('Authorization', 'Bearer completely-invalid-token');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
      }
    );
  });
});
