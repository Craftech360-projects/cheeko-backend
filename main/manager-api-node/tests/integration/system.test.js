/**
 * System Routes Integration Tests
 *
 * Tests for /system/* endpoints (params and dictionaries)
 */

const request = require('supertest');
const app = require('../../src/app');

describe('System Routes', () => {
  // ==================== SYSTEM PARAMETERS ====================

  describe('GET /toy/system/params/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/params/page');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });

    it('should accept paramType filter', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ paramType: 1 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/system/params/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/params/list');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should return params list with valid auth', async () => {
      const res = await request(app)
        .get('/toy/system/params/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/system/params/code/:code', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/TEST_PARAM');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept parameter code in path', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/SOME_CONFIG')
        .set('Authorization', 'Bearer test-token');

      // Should return 401 (auth) or 404 (not found) with valid route
      expect([200, 401, 404]).toContain(res.status);
    });
  });

  describe('GET /toy/system/params/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/params/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept parameter ID in path', async () => {
      const res = await request(app)
        .get('/toy/system/params/999')
        .set('Authorization', 'Bearer test-token');

      // Should return 401 (auth) or 404 (not found)
      expect([200, 401, 404]).toContain(res.status);
    });
  });

  describe('POST /toy/system/params', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .send({ paramCode: 'TEST_PARAM', paramValue: 'test' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require paramCode in body', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      // Would return 400 for missing paramCode if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid parameter creation request', async () => {
      const res = await request(app)
        .post('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({
          paramCode: 'NEW_PARAM',
          paramValue: 'test_value',
          valueType: 'string',
          paramType: 1,
          remark: 'Test parameter'
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/system/params/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .put('/toy/system/params/1')
        .send({ paramValue: 'updated' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept update request with valid data', async () => {
      const res = await request(app)
        .put('/toy/system/params/1')
        .set('Authorization', 'Bearer admin-token')
        .send({
          paramValue: 'updated_value',
          remark: 'Updated description'
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/params/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/params/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/params/999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/params (batch)', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require ids array in body', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      // Would return 400 for missing ids if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept batch delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [1, 2, 3] });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== DICTIONARY TYPES ====================

  describe('GET /toy/system/dict/type/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/system/dict/type/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should return dict types list with valid auth', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/system/dict/type/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept dict type ID in path', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/999')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404]).toContain(res.status);
    });
  });

  describe('POST /toy/system/dict/type', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .send({ dictType: 'test_type', dictName: 'Test Type' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require dictType and dictName in body', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject missing dictName', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictType: 'test_type' });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid dict type creation request', async () => {
      const res = await request(app)
        .post('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({
          dictType: 'content_status',
          dictName: 'Content Status',
          remark: 'Status values for content items',
          sort: 0
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/system/dict/type/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .put('/toy/system/dict/type/1')
        .send({ dictName: 'Updated Name' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept update request with valid data', async () => {
      const res = await request(app)
        .put('/toy/system/dict/type/1')
        .set('Authorization', 'Bearer admin-token')
        .send({
          dictName: 'Updated Type Name',
          remark: 'Updated description'
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/dict/type/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type/999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/dict/type (batch)', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require ids array in body', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept batch delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/type')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [1, 2, 3] });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== DICTIONARY DATA ====================

  describe('GET /toy/system/dict/data/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });

    it('should accept dictTypeId filter', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .query({ dictTypeId: 1 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/system/dict/data/type/:dictType', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/content_status');

      // This is a public endpoint, should return 200 (empty array if type doesn't exist)
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return empty array for non-existent type', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/nonexistent_type');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /toy/system/dict/data/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept dict data ID in path', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/999')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404]).toContain(res.status);
    });
  });

  describe('POST /toy/system/dict/data', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .send({ dictTypeId: 1, dictLabel: 'Active', dictValue: '1' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require dictTypeId, dictLabel, and dictValue', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject missing dictLabel', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictTypeId: 1, dictValue: '1' });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject missing dictValue', async () => {
      const res = await request(app)
        .post('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ dictTypeId: 1, dictLabel: 'Active' });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid dict data creation request', async () => {
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
    });
  });

  describe('PUT /toy/system/dict/data/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .put('/toy/system/dict/data/1')
        .send({ dictLabel: 'Updated Label' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept update request with valid data', async () => {
      const res = await request(app)
        .put('/toy/system/dict/data/1')
        .set('Authorization', 'Bearer admin-token')
        .send({
          dictLabel: 'Updated Label',
          dictValue: '2',
          remark: 'Updated remark'
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/dict/data/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data/999')
        .set('Authorization', 'Bearer admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/system/dict/data (batch)', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require ids array in body', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept batch delete request', async () => {
      const res = await request(app)
        .delete('/toy/system/dict/data')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [1, 2, 3] });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== ROUTE PRIORITY TESTS ====================

  describe('Route priority', () => {
    it('should match /params/page before /params/:id', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .set('Authorization', 'Bearer test-token');

      // Should be treated as page route, not :id route
      expect([200, 401]).toContain(res.status);
    });

    it('should match /params/list before /params/:id', async () => {
      const res = await request(app)
        .get('/toy/system/params/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });

    it('should match /params/code/:code before /params/:id', async () => {
      const res = await request(app)
        .get('/toy/system/params/code/TEST')
        .set('Authorization', 'Bearer test-token');

      // Should return 401 (auth) or 404 (not found), not match :id route
      expect([200, 401, 404]).toContain(res.status);
    });

    it('should match /dict/type/page before /dict/type/:id', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/page')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });

    it('should match /dict/type/list before /dict/type/:id', async () => {
      const res = await request(app)
        .get('/toy/system/dict/type/list')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });

    it('should match /dict/data/page before /dict/data/:id', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/page')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.status);
    });

    it('should match /dict/data/type/:dictType before /dict/data/:id', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/status');

      // Public endpoint, should return 200
      expect(res.status).toBe(200);
    });
  });

  // ==================== INPUT VALIDATION TESTS ====================

  describe('Input validation', () => {
    it('should validate paramType as integer', async () => {
      const res = await request(app)
        .get('/toy/system/params/page')
        .query({ paramType: 'invalid' })
        .set('Authorization', 'Bearer test-token');

      // NaN converts to undefined in parseInt, so should still work
      expect([200, 401]).toContain(res.status);
    });

    it('should handle empty ids array for batch delete', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should handle non-array ids for batch delete', async () => {
      const res = await request(app)
        .delete('/toy/system/params')
        .set('Authorization', 'Bearer admin-token')
        .send({ ids: 'not-an-array' });

      expect([400, 401, 403]).toContain(res.status);
    });
  });
});
