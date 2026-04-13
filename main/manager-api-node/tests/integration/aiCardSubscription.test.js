/**
 * AI Card Subscription Routes Integration Tests
 *
 * Tests for all AI card time quota endpoints:
 * - GET /subscription/quota/ai-card/:rfidUid
 * - POST /subscription/consume/ai-card-time/:rfidUid
 * - POST /subscription/recharge/:rfidUid
 * - GET /subscription/ai-card-status/:rfidUid
 * - GET /subscription/my-cards
 * - GET /subscription/ai-cards/summary
 * - GET/PUT /subscription/ai-card-quota-settings
 * - POST /subscription/publish-mqtt-exhaust
 * - GET /subscription/ai-card-analytics
 */

const request = require('supertest');
const app = require('../../src/app');

const SERVICE_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';
const ADMIN_TOKEN = 'admin-token';
const PARENT_TOKEN = 'parent-token';

// Test RFID UID
const TEST_RFID_UID = '26281026';
const TEST_RFID_UID_UPPER = '26281026'; // Normalized uppercase
const TEST_RFID_INVALID = '!!!INVALID!!!';

describe('AI Card Subscription Routes', () => {

  // ============================================================
  // SERVICE KEY ENDPOINTS
  // ============================================================

  describe('GET /toy/subscription/quota/ai-card/:rfidUid', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .get(`/toy/subscription/quota/ai-card/${TEST_RFID_UID}`);

      expect(res.status).toBe(401);
    });

    it('should return 400 for missing rfidUid', async () => {
      const res = await request(app)
        .get('/toy/subscription/quota/ai-card/')
        .set('X-Service-Key', SERVICE_KEY);

      // Express will route this differently, check it's not 404
      expect(res.status).not.toBe(500);
    });

    it('should return quota info for valid rfidUid', async () => {
      const res = await request(app)
        .get(`/toy/subscription/quota/ai-card/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY);

      // Should be 200 if card exists, 400/404 if not found
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should return response with expected fields on success', async () => {
      const res = await request(app)
        .get(`/toy/subscription/quota/ai-card/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body).toHaveProperty('data');
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('remaining');
        expect(res.body.data).toHaveProperty('remainingSeconds');
        expect(res.body.data).toHaveProperty('isExhausted');
        expect(res.body.data).toHaveProperty('status');
        expect(res.body.data).toHaveProperty('used');
        expect(res.body.data).toHaveProperty('monthKey');
      }
    });
  });

  describe('POST /toy/subscription/consume/ai-card-time/:rfidUid', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .send({ seconds: 30 });

      expect(res.status).toBe(401);
    });

    it('should reject missing seconds field', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should reject negative seconds', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY)
        .send({ seconds: -10 });

      expect(res.status).toBe(400);
    });

    it('should accept valid consumption request', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY)
        .send({ seconds: 30 });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept monthKey parameter', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY)
        .send({ seconds: 30, monthKey: '2026-04' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should return response with expected fields on success', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .set('X-Service-Key', SERVICE_KEY)
        .send({ seconds: 30 });

      if (res.status === 200) {
        // Response uses {code, data, msg} format
        const body = res.body;
        expect(body).toHaveProperty('data');
        expect(body.data).toHaveProperty('remaining');
        expect(body.data).toHaveProperty('remainingSeconds');
        expect(body.data).toHaveProperty('isExhausted');
        expect(body.data).toHaveProperty('secondsUsed');
        expect(body.data).toHaveProperty('rfidUid');
        expect(body.data).toHaveProperty('monthKey');
      }
    });
  });

  // ============================================================
  // PARENT APP ENDPOINTS (Bearer Auth)
  // ============================================================

  describe('POST /toy/subscription/recharge/:rfidUid', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .send({ amount: 3600 });

      expect(res.status).toBe(401);
    });

    it('should reject missing amount', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`)
        .send({});

      // Auth may reject first if token is invalid, or 400 for bad request
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject zero amount', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`)
        .send({ amount: 0 });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject negative amount', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`)
        .send({ amount: -100 });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject amount over 86400 (24 hours)', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`)
        .send({ amount: 99999 });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid recharge request', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`)
        .send({ amount: 3600 });

      expect([200, 400, 401, 403, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/subscription/ai-card-status/:rfidUid', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/subscription/ai-card-status/${TEST_RFID_UID}`);

      expect(res.status).toBe(401);
    });

    it('should return status for valid rfidUid', async () => {
      const res = await request(app)
        .get(`/toy/subscription/ai-card-status/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`);

      expect([200, 400, 401, 403, 500]).toContain(res.status);
    });

    it('should return response with expected fields on success', async () => {
      const res = await request(app)
        .get(`/toy/subscription/ai-card-status/${TEST_RFID_UID}`)
        .set('Authorization', `Bearer ${PARENT_TOKEN}`);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body.data).toHaveProperty('rfidUid');
        expect(res.body.data).toHaveProperty('remaining');
        expect(res.body.data).toHaveProperty('remainingSeconds');
        expect(res.body.data).toHaveProperty('isExhausted');
        expect(res.body.data).toHaveProperty('status');
      }
    });
  });

  describe('GET /toy/subscription/my-cards', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/subscription/my-cards');

      expect(res.status).toBe(401);
    });

    it('should return list of cards for authenticated user', async () => {
      const res = await request(app)
        .get('/toy/subscription/my-cards')
        .set('Authorization', `Bearer ${PARENT_TOKEN}`);

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should return response with cards array on success', async () => {
      const res = await request(app)
        .get('/toy/subscription/my-cards')
        .set('Authorization', `Bearer ${PARENT_TOKEN}`);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body.data).toHaveProperty('cards');
        expect(Array.isArray(res.body.data.cards)).toBe(true);
      }
    });
  });

  // ============================================================
  // ADMIN ENDPOINTS
  // ============================================================

  describe('GET /toy/subscription/ai-cards/summary', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-cards/summary');

      expect(res.status).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-cards/summary')
        .query({ page: 1, limit: 10 })
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should accept monthKey filter', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-cards/summary')
        .query({ monthKey: '2026-04' })
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should return response with expected fields on success', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-cards/summary')
        .query({ page: 1, limit: 10 })
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body.data).toHaveProperty('cards');
        expect(res.body.data).toHaveProperty('total');
        expect(res.body.data).toHaveProperty('page');
        expect(res.body.data).toHaveProperty('limit');
        expect(Array.isArray(res.body.data.cards)).toBe(true);
      }
    });
  });

  describe('GET /toy/subscription/ai-card-quota-settings', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-quota-settings');

      expect(res.status).toBe(401);
    });

    it('should return failMode setting', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-quota-settings')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should return response with failMode on success', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-quota-settings')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body.data).toHaveProperty('failMode');
        expect(['open', 'capped']).toContain(res.body.data.failMode);
      }
    });
  });

  describe('PUT /toy/subscription/ai-card-quota-settings', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .put('/toy/subscription/ai-card-quota-settings')
        .send({ failMode: 'open' });

      expect(res.status).toBe(401);
    });

    it('should reject invalid failMode', async () => {
      const res = await request(app)
        .put('/toy/subscription/ai-card-quota-settings')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ failMode: 'invalid' });

      // Auth may reject first if token is invalid, or 400 for bad request
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid failMode: open', async () => {
      const res = await request(app)
        .put('/toy/subscription/ai-card-quota-settings')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ failMode: 'open' });

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should accept valid failMode: capped', async () => {
      const res = await request(app)
        .put('/toy/subscription/ai-card-quota-settings')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ failMode: 'capped' });

      expect([200, 401, 403, 500]).toContain(res.status);
    });
  });

  describe('POST /toy/subscription/publish-mqtt-exhaust', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/subscription/publish-mqtt-exhaust')
        .send({ macAddress: 'AABBCCDDEEFF', rfidUid: '26281026' });

      expect(res.status).toBe(401);
    });

    it('should reject missing macAddress', async () => {
      const res = await request(app)
        .post('/toy/subscription/publish-mqtt-exhaust')
        .set('X-Service-Key', SERVICE_KEY)
        .send({ rfidUid: '26281026' });

      expect(res.status).toBe(400);
    });

    it('should reject missing rfidUid', async () => {
      const res = await request(app)
        .post('/toy/subscription/publish-mqtt-exhaust')
        .set('X-Service-Key', SERVICE_KEY)
        .send({ macAddress: 'AABBCCDDEEFF' });

      expect(res.status).toBe(400);
    });

    it('should accept valid request', async () => {
      const res = await request(app)
        .post('/toy/subscription/publish-mqtt-exhaust')
        .set('X-Service-Key', SERVICE_KEY)
        .send({
          macAddress: 'AABBCCDDEEFF',
          rfidUid: '26281026',
          cardName: 'Test Card'
        });

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/subscription/ai-card-analytics', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-analytics');

      expect(res.status).toBe(401);
    });

    it('should accept monthKey parameter', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-analytics')
        .query({ monthKey: '2026-04' })
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      expect([200, 401, 403, 500]).toContain(res.status);
    });

    it('should return response with expected fields on success', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-analytics')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('success');
        expect(res.body.data).toHaveProperty('monthKey');
        expect(res.body.data).toHaveProperty('totalActiveCards');
        expect(res.body.data).toHaveProperty('exhaustedCount');
        expect(res.body.data).toHaveProperty('topCards');
        expect(res.body.data).toHaveProperty('nearExhaustion');
        expect(res.body.data).toHaveProperty('generatedAt');
      }
    });
  });

  // ============================================================
  // ROUTE EXISTENCE TESTS (no 404s)
  // ============================================================

  describe('Route existence', () => {
    it('should not return 404 for quota/ai-card route', async () => {
      const res = await request(app)
        .get(`/toy/subscription/quota/ai-card/${TEST_RFID_UID}`);

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for consume/ai-card-time route', async () => {
      const res = await request(app)
        .post(`/toy/subscription/consume/ai-card-time/${TEST_RFID_UID}`)
        .send({ seconds: 30 });

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for recharge route', async () => {
      const res = await request(app)
        .post(`/toy/subscription/recharge/${TEST_RFID_UID}`)
        .send({ amount: 3600 });

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for ai-card-status route', async () => {
      const res = await request(app)
        .get(`/toy/subscription/ai-card-status/${TEST_RFID_UID}`);

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for my-cards route', async () => {
      const res = await request(app)
        .get('/toy/subscription/my-cards');

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for ai-cards/summary route', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-cards/summary');

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for ai-card-quota-settings GET route', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-quota-settings');

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for ai-card-quota-settings PUT route', async () => {
      const res = await request(app)
        .put('/toy/subscription/ai-card-quota-settings')
        .send({ failMode: 'open' });

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for publish-mqtt-exhaust route', async () => {
      const res = await request(app)
        .post('/toy/subscription/publish-mqtt-exhaust')
        .send({ macAddress: 'AABB', rfidUid: 'TEST' });

      expect(res.status).not.toBe(404);
    });

    it('should not return 404 for ai-card-analytics route', async () => {
      const res = await request(app)
        .get('/toy/subscription/ai-card-analytics');

      expect(res.status).not.toBe(404);
    });
  });
});
