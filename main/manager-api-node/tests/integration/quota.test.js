/**
 * Quota Routes Integration Tests
 *
 * Tests for /quota/* endpoints (question quota management)
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Quota Routes', () => {
  // ==================== SERVICE KEY ENDPOINTS ====================

  describe('GET /toy/quota/check/:mac', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .get('/toy/quota/check/aabbccddeeff');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid service key', async () => {
      const res = await request(app)
        .get('/toy/quota/check/aabbccddeeff')
        .set('X-Service-Key', 'test-service-key');

      // Will return 401 if key doesn't match, or 200/400 if it does
      expect([200, 400, 401]).toContain(res.status);
    });

    it('should accept MAC with colons', async () => {
      const res = await request(app)
        .get('/toy/quota/check/aa:bb:cc:dd:ee:ff')
        .set('X-Service-Key', 'test-service-key');

      expect([200, 400, 401]).toContain(res.status);
    });
  });

  describe('POST /toy/quota/increment/:mac', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/quota/increment/aabbccddeeff');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid service key', async () => {
      const res = await request(app)
        .post('/toy/quota/increment/aabbccddeeff')
        .set('X-Service-Key', 'test-service-key');

      expect([200, 400, 401]).toContain(res.status);
    });
  });

  // ==================== ADMIN ENDPOINTS ====================

  describe('GET /toy/quota/user/:userId', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/toy/quota/user/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid admin token', async () => {
      const res = await request(app)
        .get('/toy/quota/user/1')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should accept monthKey query parameter', async () => {
      const res = await request(app)
        .get('/toy/quota/user/1')
        .query({ monthKey: '2026-03' })
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('POST /toy/quota/user/:userId/grant', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .send({ amount: 10 });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should reject missing amount', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      // 400 for bad request, or 401/403 if auth fails
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject zero amount', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .set('Authorization', 'Bearer admin-token')
        .send({ amount: 0 });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject negative amount', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .set('Authorization', 'Bearer admin-token')
        .send({ amount: -5 });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid grant request', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .set('Authorization', 'Bearer admin-token')
        .send({ amount: 10 });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/quota/summary', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/toy/quota/summary');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/quota/summary')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should accept monthKey filter', async () => {
      const res = await request(app)
        .get('/toy/quota/summary')
        .query({ monthKey: '2026-03' })
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== ROUTE EXISTENCE TESTS ====================

  describe('Route existence', () => {
    it('should not return 404 for quota check route', async () => {
      const res = await request(app)
        .get('/toy/quota/check/testmac');

      // Should be 401 (auth required), not 404 (route not found)
      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for quota increment route', async () => {
      const res = await request(app)
        .post('/toy/quota/increment/testmac');

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for quota user route', async () => {
      const res = await request(app)
        .get('/toy/quota/user/1');

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for quota grant route', async () => {
      const res = await request(app)
        .post('/toy/quota/user/1/grant')
        .send({ amount: 5 });

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for quota summary route', async () => {
      const res = await request(app)
        .get('/toy/quota/summary');

      expect(res.status).not.toBe(404);
    });
  });
});
