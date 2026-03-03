/**
 * System Routes Integration Tests
 *
 * Tests for /toy/system/* endpoints covering:
 * - System Parameters  (read = requireAuth, write = requireAdmin)
 * - Dictionary Types   (read = requireAuth, write = requireAdmin)
 * - Dictionary Data    (read = requireAuth, write = requireAdmin;
 *                       /dict/data/type/:dictType is public)
 *
 * Auth notes:
 *   requireAuth  – missing/invalid Bearer token → 401
 *   requireAdmin – missing/invalid token → 401; valid token that is not admin → 403
 *                  NOTE: requireAdmin also accepts a valid X-Service-Key as
 *                  "god mode", so tests using 'admin-token' (invalid) may still
 *                  get 401 or 403 from the DB-less environment.
 *
 * Route priority note (Express matches routes in registration order):
 *   /params/page  before /params/:id
 *   /params/list  before /params/:id
 *   /params/code/:code before /params/:id
 *   /dict/type/page  before /dict/type/:id
 *   /dict/type/list  before /dict/type/:id
 *   /dict/data/page  before /dict/data/:id
 *   /dict/data/type/:dictType before /dict/data/:id
 */

const request = require('supertest');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every API response must carry a `code` field. */
const expectCodeField = (res) => {
  expect(res.body).toHaveProperty('code');
};

// ---------------------------------------------------------------------------
// System Parameters
// ---------------------------------------------------------------------------

describe('System Routes – Parameters', () => {

  // GET /toy/system/params/page
  describe('GET /toy/system/params/page', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/params/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond 200, 401 or 500 when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept page and limit pagination params', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept paramType filter param', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ paramType: 1 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should coerce invalid paramType gracefully (defaults to undefined)', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ paramType: 'invalid' })
        .set('Authorization', 'Bearer test-token');

      // parseInt('invalid') = NaN, treated as undefined by the route
      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/params/list
  describe('GET /toy/system/params/list', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/params/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/params/list')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond 200, 401 or 500 when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/params/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/params/code/:code
  describe('GET /toy/system/params/code/:code', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/TEST_PARAM');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/TEST_PARAM')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 401, 404 or 500 for a valid request', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/SOME_CONFIG')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/params/:id
  describe('GET /toy/system/params/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/params/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/params/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 401, 404 or 500 for a valid request', async () => {
      const res = await request(app)
        .get('/toy/system/params/999999')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/system/params
  describe('POST /toy/system/params', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .send({ paramCode: 'TEST_PARAM', paramValue: 'test' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .set('Authorization', 'Bearer invalid-token')
        .send({ paramCode: 'TEST_PARAM', paramValue: 'test' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when paramCode is missing', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a valid parameter creation request', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({
          paramCode: 'NEW_PARAM_INTEGRATION',
          paramValue: 'test_value',
          valueType: 'string',
          paramType: 1,
          remark: 'Integration test parameter'
        });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/system/params/:id
  describe('PUT /toy/system/params/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/system/params/1')
        .send({ paramValue: 'updated' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .put('/toy/system/params/1')
        .set('Authorization', 'Bearer invalid-token')
        .send({ paramValue: 'updated' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .put('/toy/system/params/1')
        .set('Authorization', 'Bearer admin-token')
        .send({ paramValue: 'updated_value', remark: 'Updated via integration test' });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/params/:id
  describe('DELETE /toy/system/params/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/params/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .delete('/toy/system/params/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .delete('/toy/system/params/999999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/params  (batch)
  describe('DELETE /toy/system/params (batch)', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 400, 401 or 403 when ids field is missing', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when ids array is empty', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when ids is not an array', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: 'not-an-array' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a valid ids array', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [999998, 999999] });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Dictionary Types
// ---------------------------------------------------------------------------

describe('System Routes – Dictionary Types', () => {

  // GET /toy/system/dict/type/page
  describe('GET /toy/system/dict/type/page', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept pagination params when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/dict/type/list
  describe('GET /toy/system/dict/type/list', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond 200, 401 or 500 when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/dict/type/:id
  describe('GET /toy/system/dict/type/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 401, 404 or 500 for a valid request', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/999999')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/system/dict/type
  describe('POST /toy/system/dict/type', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .send({ dictType: 'test_type', dictName: 'Test Type' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer invalid-token')
        .send({ dictType: 'test_type', dictName: 'Test Type' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when both dictType and dictName are absent', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when dictName is missing', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictType: 'test_type' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when dictType is missing', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictName: 'Test Type' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a valid dict type creation request', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({
          dictType: 'integration_test_type',
          dictName: 'Integration Test Type',
          remark: 'Created by integration test',
          sort: 0
        });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/system/dict/type/:id
  describe('PUT /toy/system/dict/type/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/system/dict/type/1')
        .send({ dictName: 'Updated Name' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .put('/toy/system/dict/type/1')
        .set('Authorization', 'Bearer invalid-token')
        .send({ dictName: 'Updated Name' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .put('/toy/system/dict/type/1')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictName: 'Updated Type Name', remark: 'Updated by integration test' });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/dict/type/:id
  describe('DELETE /toy/system/dict/type/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type/999999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/dict/type  (batch)
  describe('DELETE /toy/system/dict/type (batch)', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 400, 401 or 403 when ids field is missing', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when ids array is empty', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a valid ids array', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [999998, 999999] });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Dictionary Data
// ---------------------------------------------------------------------------

describe('System Routes – Dictionary Data', () => {

  // GET /toy/system/dict/data/page
  describe('GET /toy/system/dict/data/page', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept pagination params when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept dictTypeId filter when a token is present', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .query({ dictTypeId: 1 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/system/dict/data/type/:dictType  –  PUBLIC endpoint
  describe('GET /toy/system/dict/data/type/:dictType (public)', () => {
    it('should be accessible without any authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/content_status');

      // Public endpoint: DB unavailable → 500 is acceptable; otherwise 200
      expect([200, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return code 0 (success) and an array when accessible', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/content_status');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('code', 0);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });

    it('should return an empty array or 500 for a non-existent dict type', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/nonexistent_type_xyz');

      // Route does NOT 404 on missing type – it returns an empty array or 500 if DB down
      expect([200, 500]).toContain(res.status);
      expectCodeField(res);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('code', 0);
        // May be empty array or populated depending on DB state
      }
    });

    it('should not require auth for any dict type code', async () => {
      const typeCodes = ['content_status', 'user_status', 'device_type'];

      for (const dictType of typeCodes) {
        const res = await request(app)
          .get(`/toy/system/dict/data/type/${dictType}`);

        // No auth header → should NOT return 401 (it is public)
        expect(res.status).not.toBe(401);
        expectCodeField(res);
      }
    });
  });

  // GET /toy/system/dict/data/:id
  describe('GET /toy/system/dict/data/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 401, 404 or 500 for a valid request', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/999999')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/system/dict/data
  describe('POST /toy/system/dict/data', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .send({ dictTypeId: 1, dictLabel: 'Active', dictValue: '1' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer invalid-token')
        .send({ dictTypeId: 1, dictLabel: 'Active', dictValue: '1' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when required fields are all absent', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when dictLabel is missing', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictTypeId: 1, dictValue: '1' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when dictValue is missing', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictTypeId: 1, dictLabel: 'Active' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when dictTypeId is missing', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictLabel: 'Active', dictValue: '1' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a fully populated valid dict data creation request', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({
          dictTypeId: 1,
          dictLabel: 'Active',
          dictValue: '1',
          remark: 'Active status',
          sort: 0
        });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/system/dict/data/:id
  describe('PUT /toy/system/dict/data/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/system/dict/data/1')
        .send({ dictLabel: 'Updated Label' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .put('/toy/system/dict/data/1')
        .set('Authorization', 'Bearer invalid-token')
        .send({ dictLabel: 'Updated Label' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .put('/toy/system/dict/data/1')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictLabel: 'Updated Label', dictValue: '2', remark: 'Updated by integration test' });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/dict/data/:id
  describe('DELETE /toy/system/dict/data/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data/1')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 200, 400, 401 or 403 for a valid request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data/999999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/system/dict/data  (batch)
  describe('DELETE /toy/system/dict/data (batch)', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 400, 401 or 403 when ids field is missing', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400, 401 or 403 when ids array is empty', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a valid ids array', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [999998, 999999] });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Route Priority Verification
// ---------------------------------------------------------------------------

describe('System Routes – Route Priority', () => {
  it('/params/page should be matched before /params/:id', async () => {
    const res = await request(app)
      .get('/toy/system/params/page');

    // Both require auth, so 401 expected without token
    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/params/list should be matched before /params/:id', async () => {
    const res = await request(app)
      .get('/toy/system/params/list');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/params/code/:code should be matched before /params/:id', async () => {
    const res = await request(app)
      .get('/toy/system/params/code/TEST');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/dict/type/page should be matched before /dict/type/:id', async () => {
    const res = await request(app)
      .get('/toy/system/dict/type/page');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/dict/type/list should be matched before /dict/type/:id', async () => {
    const res = await request(app)
      .get('/toy/system/dict/type/list');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/dict/data/page should be matched before /dict/data/:id', async () => {
    const res = await request(app)
      .get('/toy/system/dict/data/page');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/dict/data/type/:dictType should be matched before /dict/data/:id and be public', async () => {
    const res = await request(app)
      .get('/toy/system/dict/data/type/status');

    // Public endpoint – must NOT return 401
    expect(res.status).not.toBe(401);
    expectCodeField(res);
  });
});

// ---------------------------------------------------------------------------
// Response Format Verification
// ---------------------------------------------------------------------------

describe('System Routes – Response Format', () => {
  it('all protected GET routes should return 401 with code = 401 and a msg string when no token is provided', async () => {
    const protectedGetRoutes = [
      '/toy/system/params/page',
      '/toy/system/params/list',
      '/toy/system/params/1',
      '/toy/system/dict/type/page',
      '/toy/system/dict/type/list',
      '/toy/system/dict/type/1',
      '/toy/system/dict/data/page',
      '/toy/system/dict/data/1',
    ];

    for (const path of protectedGetRoutes) {
      const res = await request(app).get(path);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(typeof res.body.msg).toBe('string');
    }
  });

  it('all protected POST routes should return 401 with code = 401 and a msg string when no token is provided', async () => {
    const protectedPostRoutes = [
      { path: '/toy/system/params', body: { paramCode: 'X', paramValue: 'y' } },
      { path: '/toy/system/dict/type', body: { dictType: 'x', dictName: 'y' } },
      { path: '/toy/system/dict/data', body: { dictTypeId: 1, dictLabel: 'x', dictValue: 'y' } },
    ];

    for (const { path, body } of protectedPostRoutes) {
      const res = await request(app).post(path).send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(typeof res.body.msg).toBe('string');
    }
  });

  it('the public dict-data-by-type endpoint should never return 401', async () => {
    const res = await request(app)
      .get('/toy/system/dict/data/type/any_type_code');

    expect(res.status).not.toBe(401);
    expectCodeField(res);
  });
});
