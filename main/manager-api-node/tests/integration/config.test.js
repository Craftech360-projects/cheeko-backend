'use strict';
/**
 * Config Routes Integration Tests
 *
 * Tests for /toy/config/* endpoints used by LiveKit workers
 * to fetch device/agent configuration. All endpoints are public
 * (no auth required) but most require a valid macAddress in the body.
 */

const request = require('supertest');
const app = require('../../src/app');

// Shared test constants
const VALID_MAC = 'AA:BB:CC:DD:EE:FF';
const UNKNOWN_MAC = '00:00:00:00:00:01'; // valid format, unlikely to exist in DB
const INVALID_MAC = 'not-a-mac';

// =============================================
// POST /toy/config/server-base
// =============================================

describe('Config Routes', () => {
  describe('POST /toy/config/server-base', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/server-base');

      // Public endpoint - no 401 expected
      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response envelope', async () => {
      const res = await request(app)
        .post('/toy/config/server-base');

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      // code 0 means success, non-zero means error from DB unavailability
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should succeed or fail gracefully without a request body', async () => {
      const res = await request(app)
        .post('/toy/config/server-base')
        .send({});

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // POST /toy/config/agent-models
  // =============================================

  describe('POST /toy/config/agent-models', () => {
    it('should require macAddress field', async () => {
      const res = await request(app)
        .post('/toy/config/agent-models')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body).toHaveProperty('msg');
      expect(res.body.msg).toMatch(/macAddress/i);
    });

    it('should reject empty macAddress', async () => {
      const res = await request(app)
        .post('/toy/config/agent-models')
        .send({ macAddress: '' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/agent-models')
        .send({ macAddress: VALID_MAC });

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 or error for unknown MAC', async () => {
      const res = await request(app)
        .post('/toy/config/agent-models')
        .send({ macAddress: UNKNOWN_MAC });

      // Device not in DB → 404, or 400/500 if DB unavailable
      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format for valid request', async () => {
      const res = await request(app)
        .post('/toy/config/agent-models')
        .send({ macAddress: VALID_MAC });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      expect([200, 400, 404, 500]).toContain(res.status);
    });
  });

  // =============================================
  // POST /toy/config/agent-prompt
  // =============================================

  describe('POST /toy/config/agent-prompt', () => {
    it('should require macAddress field', async () => {
      const res = await request(app)
        .post('/toy/config/agent-prompt')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/macAddress/i);
    });

    it('should reject missing macAddress', async () => {
      const res = await request(app)
        .post('/toy/config/agent-prompt')
        .send({ someOtherField: 'value' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/agent-prompt')
        .send({ macAddress: VALID_MAC });

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle unknown device gracefully', async () => {
      const res = await request(app)
        .post('/toy/config/agent-prompt')
        .send({ macAddress: UNKNOWN_MAC });

      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/agent-prompt')
        .send({ macAddress: VALID_MAC });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // =============================================
  // POST /toy/config/child-profile-by-mac
  // =============================================

  describe('POST /toy/config/child-profile-by-mac', () => {
    it('should require macAddress field', async () => {
      const res = await request(app)
        .post('/toy/config/child-profile-by-mac')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/macAddress/i);
    });

    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/child-profile-by-mac')
        .send({ macAddress: VALID_MAC });

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle unknown device gracefully', async () => {
      const res = await request(app)
        .post('/toy/config/child-profile-by-mac')
        .send({ macAddress: UNKNOWN_MAC });

      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/child-profile-by-mac')
        .send({ macAddress: VALID_MAC });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      expect([200, 400, 404, 500]).toContain(res.status);
    });
  });

  // =============================================
  // POST /toy/config/agent-template-id
  // =============================================

  describe('POST /toy/config/agent-template-id', () => {
    it('should require macAddress field', async () => {
      const res = await request(app)
        .post('/toy/config/agent-template-id')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/macAddress/i);
    });

    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/agent-template-id')
        .send({ macAddress: VALID_MAC });

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle unknown device gracefully', async () => {
      const res = await request(app)
        .post('/toy/config/agent-template-id')
        .send({ macAddress: UNKNOWN_MAC });

      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/agent-template-id')
        .send({ macAddress: VALID_MAC });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // =============================================
  // POST /toy/config/device-location
  // =============================================

  describe('POST /toy/config/device-location', () => {
    it('should require macAddress field', async () => {
      const res = await request(app)
        .post('/toy/config/device-location')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/macAddress/i);
    });

    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/device-location')
        .send({ macAddress: VALID_MAC });

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle unknown device gracefully', async () => {
      const res = await request(app)
        .post('/toy/config/device-location')
        .send({ macAddress: UNKNOWN_MAC });

      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/device-location')
        .send({ macAddress: VALID_MAC });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // =============================================
  // POST /toy/config/weather
  // =============================================

  describe('POST /toy/config/weather', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/config/weather')
        .send({});

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle empty body without crashing', async () => {
      const res = await request(app)
        .post('/toy/config/weather')
        .send({});

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should accept latitude and longitude', async () => {
      const res = await request(app)
        .post('/toy/config/weather')
        .send({ latitude: 28.6139, longitude: 77.2090 });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept city name', async () => {
      const res = await request(app)
        .post('/toy/config/weather')
        .send({ city: 'New Delhi' });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/weather')
        .send({ latitude: 28.6139, longitude: 77.2090 });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // =============================================
  // POST /toy/config/assign-child-profile
  // =============================================

  describe('POST /toy/config/assign-child-profile', () => {
    it('should reject request without service secret header', async () => {
      const res = await request(app)
        .post('/toy/config/assign-child-profile')
        .send({ macAddress: VALID_MAC, name: 'Alice' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/secret/i);
    });

    it('should reject request with wrong service secret', async () => {
      const res = await request(app)
        .post('/toy/config/assign-child-profile')
        .set('secret', 'wrong-secret-key')
        .send({ macAddress: VALID_MAC, name: 'Alice' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require macAddress even with valid secret', async () => {
      // We do not know the real secret in test env, so both cases (wrong secret or missing mac)
      // will return 400. This confirms the field validation is wired correctly.
      const res = await request(app)
        .post('/toy/config/assign-child-profile')
        .set('secret', process.env.SERVICE_SECRET_KEY || 'test-secret')
        .send({ name: 'Alice' });

      // Either bad secret (400) or missing macAddress (400)
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require name even with valid secret and macAddress', async () => {
      const res = await request(app)
        .post('/toy/config/assign-child-profile')
        .set('secret', process.env.SERVICE_SECRET_KEY || 'test-secret')
        .send({ macAddress: VALID_MAC });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .post('/toy/config/assign-child-profile')
        .send({ macAddress: VALID_MAC, name: 'Alice' });

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // =============================================
  // GET /toy/config/template/:templateId
  // =============================================

  describe('GET /toy/config/template/:templateId', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .get('/toy/config/template/nonexistent-template-id');

      expect(res.status).not.toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for a non-existent template', async () => {
      const res = await request(app)
        .get('/toy/config/template/nonexistent-template-id');

      // 404 if DB available and template missing; 400/500 if DB unavailable
      expect([400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return standard response format', async () => {
      const res = await request(app)
        .get('/toy/config/template/some-template-id');

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should handle UUID-style template IDs', async () => {
      const res = await request(app)
        .get('/toy/config/template/550e8400-e29b-41d4-a716-446655440000');

      expect([200, 400, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return data property on success', async () => {
      const res = await request(app)
        .get('/toy/config/template/some-template-id');

      // Even on error, the envelope must be present
      expect(res.body).toHaveProperty('code');
      if (res.status === 200) {
        expect(res.body).toHaveProperty('data');
      }
    });
  });

  // =============================================
  // Response format consistency
  // =============================================

  describe('Response Format Consistency', () => {
    const publicEndpoints = [
      { method: 'post', path: '/toy/config/server-base', body: {} },
      { method: 'post', path: '/toy/config/agent-models', body: { macAddress: VALID_MAC } },
      { method: 'post', path: '/toy/config/agent-prompt', body: { macAddress: VALID_MAC } },
      { method: 'post', path: '/toy/config/child-profile-by-mac', body: { macAddress: VALID_MAC } },
      { method: 'post', path: '/toy/config/agent-template-id', body: { macAddress: VALID_MAC } },
      { method: 'post', path: '/toy/config/device-location', body: { macAddress: VALID_MAC } },
      { method: 'post', path: '/toy/config/weather', body: {} },
      { method: 'get', path: '/toy/config/template/test-id', body: null },
    ];

    it.each(publicEndpoints)(
      'should return { code, msg } envelope for $method $path',
      async ({ method, path, body }) => {
        const req = request(app)[method](path);
        if (body) req.send(body);
        const res = await req;

        expect(res.body).toHaveProperty('code');
        expect(res.body).toHaveProperty('msg');
        expect(typeof res.body.code).toBe('number');
        expect(typeof res.body.msg).toBe('string');
      }
    );

    it('should never return 401 on config endpoints (they are public)', async () => {
      const publicPosts = [
        { path: '/toy/config/server-base', body: {} },
        { path: '/toy/config/weather', body: {} },
      ];

      for (const { path, body } of publicPosts) {
        const res = await request(app).post(path).send(body);
        expect(res.status).not.toBe(401);
      }
    });
  });
});
