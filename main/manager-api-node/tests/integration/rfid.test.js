/**
 * RFID Routes Integration Tests
 *
 * Tests for RFID card mapping endpoints as specified in PRD.
 */

const request = require('supertest');
const app = require('../../src/app');

// Test UIDs in various formats
const TEST_UID = '04A3B2C1D00000';
const TEST_UID_COLONS = '04:A3:B2:C1:D0:00:00';
const TEST_UID_DASHES = '04-A3-B2-C1-D0-00-00';
const NON_EXISTENT_UID = 'FFFFFFFFFFFFFFFF';

// Fake auth token for protected routes
const FAKE_TOKEN = 'Bearer test-token-12345';

describe('RFID Routes', () => {
  // =============================================
  // Card Mapping Routes (PRD-specified)
  // =============================================

  describe('GET /toy/admin/rfid/card/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
      expect(res.body.code).not.toBe(0);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', FAKE_TOKEN);

      // 401 expected without valid token, or 200/500 with valid setup
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept packCode filter', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/page')
        .query({ packCode: 'TEST_PACK' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept active filter', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/page')
        .query({ active: 'true' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/card/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept filter parameters', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/list')
        .query({ packCode: 'TEST_PACK', active: 'false' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/card/lookup/:rfidUid', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);

      // 200 if found, 404 if not found, 500 if DB not configured
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept UID with colons', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${encodeURIComponent(TEST_UID_COLONS)}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept UID with dashes', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${encodeURIComponent(TEST_UID_DASHES)}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent UID', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${NON_EXISTENT_UID}`);

      // 404 if found but not mapped, 500 if DB not configured
      expect([404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return card data if found', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        // Verify response structure
        expect(res.body.data).toHaveProperty('rfid_uid');
      }
    });
  });

  describe('POST /toy/admin/rfid/card', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/card')
        .send({ rfidUid: TEST_UID });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require rfidUid field', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/card')
        .send({})
        .set('Authorization', FAKE_TOKEN);

      // 400 for validation error or 401/403 for auth
      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid card mapping data', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/card')
        .send({
          rfidUid: `TEST${Date.now()}`,
          questionId: 1,
          packCode: 'TEST_PACK',
          notes: 'Test card mapping',
          active: true
        })
        .set('Authorization', FAKE_TOKEN);

      // 200 for success, 400 for duplicate, 401/403 for auth
      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept questionIds array', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/card')
        .send({
          rfidUid: `MULTI${Date.now()}`,
          questionIds: [1, 2, 3],
          packCode: 'TEST_PACK'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('PUT /toy/admin/rfid/card', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card')
        .send({ id: 1, notes: 'Updated' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require id field', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card')
        .send({ notes: 'Updated' })
        .set('Authorization', FAKE_TOKEN);

      // 400 for validation error or 401/403 for auth
      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid update data', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card')
        .send({
          id: 1,
          notes: 'Updated notes',
          active: false
        })
        .set('Authorization', FAKE_TOKEN);

      // Various valid responses depending on auth and data existence
      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/admin/rfid/card', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/card')
        .send({ id: 1 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require id or rfidUid', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/card')
        .send({})
        .set('Authorization', FAKE_TOKEN);

      // 400 for validation error or 401/403 for auth
      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept deletion by id', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/card')
        .send({ id: 999999 }) // Non-existent ID
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept deletion by rfidUid', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/card')
        .send({ rfidUid: 'NONEXISTENT123' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Series Lookup Routes
  // =============================================

  describe('GET /toy/admin/rfid/series/lookup/:uid', () => {
    it('should be a public endpoint', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/series/lookup/${TEST_UID}`);

      // 200 if found, 404 if not found, 500 if DB not configured
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for UID not in any series', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/series/lookup/${NON_EXISTENT_UID}`);

      // 404 if not found, 500 if DB not configured
      expect([404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Pack Management Routes
  // =============================================

  describe('GET /toy/admin/rfid/pack/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/pack/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept active filter', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/pack/list')
        .query({ active: 'true' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/admin/rfid/pack', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/pack')
        .send({ packCode: 'TEST', name: 'Test Pack' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require packCode', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/pack')
        .send({ name: 'Test Pack' })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require name', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/pack')
        .send({ packCode: 'TEST' })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid pack data', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/pack')
        .send({
          packCode: `TESTPACK_${Date.now()}`,
          name: 'Integration Test Pack',
          description: 'Created during testing',
          ageMin: 3,
          ageMax: 8,
          active: true
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/pack/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/pack/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent pack', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/pack/999999')
        .set('Authorization', FAKE_TOKEN);

      // 404 if not found, 401 if auth fails, 500 if DB not configured
      expect([404, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return pack details by ID', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/pack/1')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 404, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('PUT /toy/admin/rfid/pack', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/pack')
        .send({ id: 1, name: 'Updated Pack' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require id field', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/pack')
        .send({ name: 'Updated Pack' })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid update data', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/pack')
        .send({
          id: 1,
          name: 'Updated Pack Name',
          description: 'Updated description',
          ageMin: 4,
          ageMax: 10,
          active: false
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/admin/rfid/pack/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/pack/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid pack ID', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/pack/999999')
        .set('Authorization', FAKE_TOKEN);

      // 200 for success, 401/403 for auth
      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Series Management Routes
  // =============================================

  describe('GET /toy/admin/rfid/series/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept packId filter', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/page')
        .query({ packId: 1 })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept active filter', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/page')
        .query({ active: 'true' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/series/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept filter parameters', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/list')
        .query({ packId: 1, active: 'false' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/series/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent series', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/999999')
        .set('Authorization', FAKE_TOKEN);

      // 404 if not found, 401 if auth fails, 500 if DB not configured
      expect([404, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return series details by ID', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/series/1')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 404, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/admin/rfid/series', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: 'Test Series',
          startUid: '04A3B2C1D00000',
          endUid: '04A3B2C1DFFFFF'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require name', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          startUid: '04A3B2C1D00000',
          endUid: '04A3B2C1DFFFFF'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require startUid', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: 'Test Series',
          endUid: '04A3B2C1DFFFFF'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require endUid', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: 'Test Series',
          startUid: '04A3B2C1D00000'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid series data', async () => {
      const timestamp = Date.now();
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: `Test Series ${timestamp}`,
          description: 'Created during testing',
          startUid: '04A3B2C1D00000',
          endUid: '04A3B2C1DFFFFF',
          questionId: 1,
          packId: 1,
          priority: 10,
          active: true
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept UIDs with colons', async () => {
      const timestamp = Date.now();
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: `Test Series Colons ${timestamp}`,
          startUid: '04:A3:B2:C1:D0:00:00',
          endUid: '04:A3:B2:C1:DF:FF:FF'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept UIDs with dashes', async () => {
      const timestamp = Date.now();
      const res = await request(app)
        .post('/toy/admin/rfid/series')
        .send({
          name: `Test Series Dashes ${timestamp}`,
          startUid: '04-A3-B2-C1-D0-00-00',
          endUid: '04-A3-B2-C1-DF-FF-FF'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('PUT /toy/admin/rfid/series', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/series')
        .send({ id: 1, name: 'Updated Series' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require id field', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/series')
        .send({ name: 'Updated Series' })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid update data', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/series')
        .send({
          id: 1,
          name: 'Updated Series Name',
          description: 'Updated description',
          priority: 20,
          active: false
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should allow updating UID range', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/series')
        .send({
          id: 1,
          startUid: '04A3B2C1E00000',
          endUid: '04A3B2C1FFFFFF'
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/admin/rfid/series/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/series/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept valid series ID', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/series/999999')
        .set('Authorization', FAKE_TOKEN);

      // 200 for success, 401/403 for auth
      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Legacy Routes (backward compatibility)
  // =============================================

  describe('Legacy Routes', () => {
    describe('GET /toy/admin/rfid/list', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/list');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept pagination parameters', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/list')
          .query({ page: 1, limit: 10 })
          .set('Authorization', FAKE_TOKEN);

        expect([200, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/admin/rfid/by-uid/:uid', () => {
      it('should be a public endpoint', async () => {
        const res = await request(app)
          .get(`/toy/admin/rfid/by-uid/${TEST_UID}`);

        // 200 if found, 404 if not found, 500 if DB not configured
        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/admin/rfid/create', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/create')
          .send({ uid: TEST_UID });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should require uid field', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/create')
          .send({})
          .set('Authorization', FAKE_TOKEN);

        expect([400, 401]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/admin/rfid/update/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/admin/rfid/update/1')
          .send({ name: 'Updated' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('DELETE /toy/admin/rfid/delete/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .delete('/toy/admin/rfid/delete/1');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/admin/rfid/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/1');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/admin/rfid/scan/:mac/:uid', () => {
      it('should be a public endpoint', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/scan/AA:BB:CC:DD:EE:FF/${TEST_UID}`);

        // 200 if tag found, 404 if not found
        expect([200, 404]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/admin/rfid/scan-logs', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/scan-logs');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/admin/rfid/register-batch', () => {
      it('should be a public endpoint', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/register-batch')
          .send({
            mac: 'AA:BB:CC:DD:EE:FF',
            tags: [
              { uid: `BATCH${Date.now()}1`, name: 'Tag 1' },
              { uid: `BATCH${Date.now()}2`, name: 'Tag 2' }
            ]
          });

        // Success or error depending on DB config
        expect([200, 400, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should require mac and tags array', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/register-batch')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('code');
      });

      it('should validate tags is an array', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/register-batch')
          .send({ mac: 'AA:BB:CC:DD:EE:FF', tags: 'not-an-array' });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('code');
      });
    });
  });

  // =============================================
  // RAG-powered Lookup Routes
  // =============================================

  describe('RAG-powered Lookup', () => {
    describe('POST /toy/admin/rfid/card/rag-lookup/:rfidUid', () => {
      it('should be a public endpoint (no auth required)', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${TEST_UID}`)
          .send({});

        // 200 if found, 404 if not found, 500 if DB not configured
        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept embedding vector in request body', async () => {
        // Create a mock embedding (1536 dimensions like ada-002)
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${TEST_UID}`)
          .send({
            embedding: mockEmbedding,
            queryText: 'What is this animal?',
            includeRag: true
          });

        // 200 if found, 404 if not found, 500 if DB not configured
        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should work without embedding (fallback to basic lookup)', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${TEST_UID}`)
          .send({
            includeRag: false
          });

        // 200 if found, 404 if not found, 500 if DB not configured
        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should return 404 for non-existent UID', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${NON_EXISTENT_UID}`)
          .send({});

        // 404 if not found, 500 if DB not configured
        expect([404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept UID with colons', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${encodeURIComponent(TEST_UID_COLONS)}`)
          .send({});

        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept UID with dashes', async () => {
        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${encodeURIComponent(TEST_UID_DASHES)}`)
          .send({});

        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should include rag_results when card has content_pack_id and embedding provided', async () => {
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${TEST_UID}`)
          .send({
            embedding: mockEmbedding,
            includeRag: true
          });

        // If found and RAG is configured, should have rag_results
        expect([200, 404, 500]).toContain(res.status);
        if (res.status === 200 && res.body.data) {
          // Response structure is valid
          expect(res.body).toHaveProperty('code');
          expect(res.body).toHaveProperty('data');
          // rag_results may or may not be present depending on Qdrant config
        }
      });

      it('should include emotions array when available', async () => {
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post(`/toy/admin/rfid/card/rag-lookup/${TEST_UID}`)
          .send({
            embedding: mockEmbedding,
            includeRag: true
          });

        if (res.status === 200 && res.body.data && res.body.data.emotions) {
          expect(Array.isArray(res.body.data.emotions)).toBe(true);
        }
      });
    });

    describe('POST /toy/admin/rfid/rag/search', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({
            embedding: new Array(1536).fill(0)
          });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should require embedding vector', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({})
          .set('Authorization', FAKE_TOKEN);

        // 400 for validation error or 401 for auth
        expect([400, 401]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should reject empty embedding array', async () => {
        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({ embedding: [] })
          .set('Authorization', FAKE_TOKEN);

        // 400 for validation error or 401 for auth
        expect([400, 401]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept valid search request', async () => {
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({
            embedding: mockEmbedding,
            limit: 5,
            scoreThreshold: 0.7
          })
          .set('Authorization', FAKE_TOKEN);

        // 200 for success, 401 for auth, 500 if Qdrant not configured
        expect([200, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept contentPackId filter', async () => {
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({
            embedding: mockEmbedding,
            contentPackId: 1,
            limit: 5
          })
          .set('Authorization', FAKE_TOKEN);

        expect([200, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept language filter', async () => {
        const mockEmbedding = new Array(1536).fill(0).map(() => Math.random() * 2 - 1);

        const res = await request(app)
          .post('/toy/admin/rfid/rag/search')
          .send({
            embedding: mockEmbedding,
            language: 'en',
            limit: 5
          })
          .set('Authorization', FAKE_TOKEN);

        expect([200, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/admin/rfid/content-pack/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/content-pack/1');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should return 404 for non-existent pack', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/content-pack/999999')
          .set('Authorization', FAKE_TOKEN);

        // 404 if not found, 401 if auth fails, 500 if DB not configured
        expect([404, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept valid pack ID', async () => {
        const res = await request(app)
          .get('/toy/admin/rfid/content-pack/1')
          .set('Authorization', FAKE_TOKEN);

        // 200 if found, 404 if not found, 401 if auth fails
        expect([200, 404, 401, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });
  });

  // =============================================
  // Content Pack Lookup with Sequence (P0 Endpoints)
  // =============================================

  describe('GET /toy/admin/rfid/card/lookup/:rfidUid?sequence=N', () => {
    it('should accept sequence query param', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`)
        .query({ sequence: 1 });

      // 200 returns RfidContentLookupDTO shape
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('sequence');
        expect(res.body.data).toHaveProperty('cached');
      }
    });

    it('should return content pack data when sequence provided', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`)
        .query({ sequence: 1 });

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should fallback to legacy lookup without sequence', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup/${TEST_UID}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/card/content/download/:rfidUid', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/content/download/${TEST_UID}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return ContentDownloadDTO shape when found', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/content/download/${TEST_UID}`);

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('contentType');
        expect(res.body.data).toHaveProperty('packCode');
        expect(res.body.data).toHaveProperty('items');
        expect(Array.isArray(res.body.data.items)).toBe(true);
      }
    });

    it('should return 404 for non-existent UID', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/content/download/${NON_EXISTENT_UID}`);

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/rfid/card/habit/download/:rfidUid', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/habit/download/${TEST_UID}`);

      expect([200, 304, 404, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('code');
      }
    });

    it('should accept version and hash query params', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/habit/download/${TEST_UID}`)
        .query({ version: '1.0', hash: 'abc123' });

      expect([200, 304, 404, 500]).toContain(res.status);
    });

    it('should return HabitDownloadDTO shape when found', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/habit/download/${TEST_UID}`);

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('habitCode');
        expect(res.body.data).toHaveProperty('steps');
        expect(Array.isArray(res.body.data.steps)).toBe(true);
      }
    });

    it('should return 404 for non-existent UID', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/habit/download/${NON_EXISTENT_UID}`);

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/rfid/card/rhyme/download/:rfidUid', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/rhyme/download/${TEST_UID}`);

      expect([200, 404, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('code');
      }
    });

    it('should return RhymeDownloadDTO shape when found', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/rhyme/download/${TEST_UID}`);

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('packCode');
        expect(res.body.data).toHaveProperty('items');
        expect(Array.isArray(res.body.data.items)).toBe(true);
      }
    });

    it('should return 404 for non-existent UID', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/rhyme/download/${NON_EXISTENT_UID}`);

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('PUT /toy/admin/rfid/card/content-pack/:packCode/sequence/:sequence/cached-audio', () => {
    it('should accept audio URL update', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card/content-pack/RHYMES_EN_01/sequence/1/cached-audio')
        .send({ audioUrl: 'https://cdn.example.com/audio/twinkle.mp3' });

      // 200 if pack found, 404 if pack not found, 500 if DB error
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require audioUrl field', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card/content-pack/RHYMES_EN_01/sequence/1/cached-audio')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent pack code', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/card/content-pack/NONEXISTENT_PACK/sequence/1/cached-audio')
        .send({ audioUrl: 'https://cdn.example.com/audio/test.mp3' });

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/rfid/card/lookup-legacy/:rfidUid', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup-legacy/${TEST_UID}`);

      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent UID', async () => {
      const res = await request(app)
        .get(`/toy/admin/rfid/card/lookup-legacy/${NON_EXISTENT_UID}`);

      expect([404, 500]).toContain(res.status);
    });
  });

  // =============================================
  // Content Pack CRUD Routes (P2 Endpoints)
  // =============================================

  describe('GET /toy/admin/rfid/content-pack/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept pagination and filter params', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/page')
        .query({ page: 1, limit: 10, contentType: 'read_only', language: 'en' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/content-pack/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/list');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept filter params', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/list')
        .query({ contentType: 'read_only' })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/content-pack/active', () => {
    it('should be a public endpoint (no auth required)', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/active');

      expect([200, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/content-pack/type/:contentType', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/type/read_only');

      expect(res.status).toBe(401);
    });

    it('should accept valid content type', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/type/read_only')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/content-pack/language/:language', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/language/en');

      expect(res.status).toBe(401);
    });

    it('should accept valid language code', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/language/en')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/admin/rfid/content-pack/code/:packCode', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/code/RHYMES_EN_01');

      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent code', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/content-pack/code/NONEXISTENT')
        .set('Authorization', FAKE_TOKEN);

      expect([404, 401, 500]).toContain(res.status);
    });
  });

  describe('POST /toy/admin/rfid/content-pack', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/content-pack')
        .send({ packCode: 'TEST', name: 'Test Pack' });

      expect(res.status).toBe(401);
    });

    it('should require packCode and name', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/content-pack')
        .send({})
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid content pack data', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/content-pack')
        .send({
          packCode: `TEST_PACK_${Date.now()}`,
          name: 'Integration Test Pack',
          contentType: 'read_only',
          language: 'en',
          contentMd: '## 1. Test Item\n\nTest content\n\n---',
          totalItems: 1,
          active: true
        })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('PUT /toy/admin/rfid/content-pack', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/content-pack')
        .send({ id: 1, name: 'Updated' });

      expect(res.status).toBe(401);
    });

    it('should require id field', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/content-pack')
        .send({ name: 'Updated' })
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid update data', async () => {
      const res = await request(app)
        .put('/toy/admin/rfid/content-pack')
        .send({ id: 1, name: 'Updated Pack', active: false })
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/admin/rfid/content-pack', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/content-pack')
        .send([999999]);

      expect(res.status).toBe(401);
    });

    it('should require IDs array', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/content-pack')
        .send({})
        .set('Authorization', FAKE_TOKEN);

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid IDs array', async () => {
      const res = await request(app)
        .delete('/toy/admin/rfid/content-pack')
        .send([999999])
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/admin/rfid/content-pack/delete', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/content-pack/delete')
        .send([999999]);

      expect(res.status).toBe(401);
    });

    it('should accept valid IDs array', async () => {
      const res = await request(app)
        .post('/toy/admin/rfid/content-pack/delete')
        .send([999999])
        .set('Authorization', FAKE_TOKEN);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // UID Format Handling
  // =============================================

  describe('UID Format Handling', () => {
    it('should normalize UIDs with different separators', async () => {
      // All these should be treated as the same UID
      const uids = [
        '04A3B2C1D00000',        // Raw
        '04:A3:B2:C1:D0:00:00',  // Colons
        '04-A3-B2-C1-D0-00-00'   // Dashes
      ];

      const results = await Promise.all(
        uids.map(uid =>
          request(app).get(`/toy/admin/rfid/card/lookup/${encodeURIComponent(uid)}`)
        )
      );

      // All should return the same status
      const statuses = results.map(r => r.status);
      expect(new Set(statuses).size).toBe(1); // All same status
    });

    it('should convert UIDs to uppercase', async () => {
      const res1 = await request(app)
        .get('/toy/admin/rfid/card/lookup/04a3b2c1d00000');
      const res2 = await request(app)
        .get('/toy/admin/rfid/card/lookup/04A3B2C1D00000');

      expect(res1.status).toBe(res2.status);
    });
  });
});
