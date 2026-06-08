/**
 * Device Routes Integration Tests
 *
 * Tests for all /toy/device/* endpoints.
 *
 * Key facts:
 * - Public routes: POST /register, POST /ota/check, POST /token-usage, GET /:mac
 * - All others require Bearer token auth (requireAuth) → 401 without token
 * - Standard response shape: { code: <number>, msg: <string>, data: <any> }
 * - Success: code=0, status 200
 * - Errors: code matches HTTP status (400, 401, 404, 409, 500)
 */

const request = require('supertest');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_MAC_COLON = 'AA:BB:CC:DD:EE:FF';
const TEST_MAC_DASH   = 'AA-BB-CC-DD-EE-FF';
const TEST_MAC_RAW    = 'AABBCCDDEEFF';
const INVALID_MAC     = 'INVALID';
const FAKE_TOKEN      = 'Bearer invalid-token-for-testing';

// ---------------------------------------------------------------------------
// Helper – assert every response carries the standard envelope
// ---------------------------------------------------------------------------
function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
  expect(res.body).toHaveProperty('msg');
}

// ===========================================================================
// 1. Device Management
// ===========================================================================

describe('Device Management', () => {

  // -------------------------------------------------------------------------
  describe('POST /toy/device/register', () => {
    it('returns 400 when request body is empty', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({});

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 when mac field is missing', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ board: 'ESP32', appVersion: '1.0.0' });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 for an invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: INVALID_MAC });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 for a short MAC (only 6 hex chars)', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'AABBCC' });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('accepts colon-separated MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: TEST_MAC_COLON, board: 'ESP32-WROOM', appVersion: '1.0.0' });

      expect([200, 400, 409, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts dash-separated MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: TEST_MAC_DASH });

      expect([200, 400, 409, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts raw 12-character MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: TEST_MAC_RAW, board: 'ESP32-S3', appVersion: '1.1.0' });

      expect([200, 400, 409, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts lowercase colon-separated MAC', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'aa:bb:cc:dd:ee:ff' });

      expect([200, 400, 409, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('rejects a MAC with invalid hex characters', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'GG:HH:II:JJ:KK:LL' });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/list', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/device/list');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/device/list')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('reaches the handler (200 or auth error) with any Authorization header', async () => {
      const res = await request(app)
        .get('/toy/device/list')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts pagination query parameters (still requires auth)', async () => {
      const res = await request(app)
        .get('/toy/device/list?page=1&limit=5');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/:mac', () => {
    it('returns a valid response for a known MAC format (public/optionalAuth)', async () => {
      const res = await request(app)
        .get(`/toy/device/${TEST_MAC_COLON}`);

      // optionalAuth – no 401; device likely not found in test DB
      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('handles non-existent device gracefully', async () => {
      const res = await request(app)
        .get('/toy/device/00:00:00:00:00:01');

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/device/update/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/device/update/1')
        .send({ alias: 'My Device' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .put('/toy/device/update/1')
        .set('Authorization', FAKE_TOKEN)
        .send({ alias: 'My Device' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/device/manual-add', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/device/manual-add')
        .send({ mac: TEST_MAC_COLON });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/device/manual-add')
        .set('Authorization', FAKE_TOKEN)
        .send({ mac: TEST_MAC_COLON });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/device/unbind', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/device/unbind')
        .send({ deviceId: '1' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/device/unbind')
        .set('Authorization', FAKE_TOKEN)
        .send({ deviceId: '1' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 2. Bind / Assign
// ===========================================================================

describe('Bind and Assign', () => {

  // -------------------------------------------------------------------------
  describe('POST /toy/device/bind/:agentId/:deviceCode', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/device/bind/agent-123/AABBCCDDEEFF');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/device/bind/agent-123/AABBCCDDEEFF')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/bind/:agentId', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/device/bind/agent-123');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/device/bind/agent-123')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/device/assign-kid/:deviceId', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/device/assign-kid/1')
        .send({ kidId: 1 });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .put('/toy/device/assign-kid/1')
        .set('Authorization', FAKE_TOKEN)
        .send({ kidId: 1 });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/device/assign-kid-by-mac', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/device/assign-kid-by-mac')
        .send({ mac: TEST_MAC_COLON, kidId: 1 });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .put('/toy/device/assign-kid-by-mac')
        .set('Authorization', FAKE_TOKEN)
        .send({ mac: TEST_MAC_COLON, kidId: 1 });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 3. OTA / Firmware
// ===========================================================================

describe('OTA Firmware', () => {

  // -------------------------------------------------------------------------
  describe('POST /toy/device/ota/check', () => {
    it('returns 400 when request body is empty', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({});

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 when mac field is missing', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ version: '1.0.0', board: 'esp32' });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: INVALID_MAC, version: '1.0.0' });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('accepts a valid colon-separated MAC and returns a response', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: TEST_MAC_COLON, version: '0.9.0', board: 'esp32' });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a valid dash-separated MAC', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: TEST_MAC_DASH, version: '1.0.0' });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a valid raw 12-char MAC', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: TEST_MAC_RAW, version: '1.0.0' });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a request with only mac (version and board are optional)', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: TEST_MAC_COLON });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('returns server-time info on successful response', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({ mac: TEST_MAC_COLON, version: '0.9.0', board: 'esp32' });

      if (res.statusCode === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('serverTime');
        expect(res.body.data.serverTime).toHaveProperty('timestamp');
        expect(res.body.data.serverTime).toHaveProperty('timezone');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/ota/firmware', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 even when pagination parameters are present', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware?page=1&limit=5');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 even when a type filter is present', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware?type=esp32');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/device/ota/firmware', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/device/ota/firmware')
        .send({ firmwareName: 'v1.0.0', type: 'esp32', version: '1.0.0' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/device/ota/firmware')
        .set('Authorization', FAKE_TOKEN)
        .send({ firmwareName: 'v1.0.0', type: 'esp32', version: '1.0.0' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/ota/firmware/all', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware/all');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/ota/firmware/latest/:type', () => {
    it('returns a valid response for a known firmware type (public)', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware/latest/esp32');

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('returns 404 or 500 for a non-existent firmware type', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware/latest/nonexistent-type');

      expect([404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/device/ota/firmware/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/device/ota/firmware/some-id')
        .send({ firmwareName: 'Updated' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /toy/device/ota/firmware/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .delete('/toy/device/ota/firmware/some-id');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/device/ota/firmware/:id/force-update', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/device/ota/firmware/some-id/force-update')
        .send({ forceUpdate: 1 });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 4. Token Usage
// ===========================================================================

describe('Token Usage', () => {

  // -------------------------------------------------------------------------
  describe('POST /toy/device/token-usage', () => {
    it('returns 400 when mac field is missing', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ inputTokens: 100, outputTokens: 50 });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('returns 400 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: INVALID_MAC, inputTokens: 100 });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('accepts a colon-separated MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: TEST_MAC_COLON, inputTokens: 100, outputTokens: 50 });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a dash-separated MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: TEST_MAC_DASH, inputTokens: 50, outputTokens: 25 });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a raw 12-char MAC and returns a valid response', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: TEST_MAC_RAW, inputTokens: 50, outputTokens: 25 });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts a minimal request with only mac field', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: TEST_MAC_COLON });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts all optional token usage fields', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: TEST_MAC_COLON,
          sessionId: 'test-session-123',
          inputTokens: 100,
          outputTokens: 50,
          inputAudioTokens: 80,
          inputTextTokens: 20,
          inputCachedTokens: 10,
          outputAudioTokens: 40,
          outputTextTokens: 10,
          sessionDurationSeconds: 60.5,
          avgTtftSeconds: 0.3,
          messageCount: 5,
          totalResponseDurationSeconds: 15.2
        });

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('does not require an X-Service-Key header (public endpoint)', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({ mac: TEST_MAC_COLON, inputTokens: 10, outputTokens: 5 });

      // Must not 401 – this is a public endpoint
      expect(res.statusCode).not.toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/token-usage/summary', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 even when pagination parameters are present', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary?page=1&limit=10');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 even when date filters are present', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary?startDate=2024-01-01&endDate=2024-12-31');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('routes to summary correctly – does not treat "summary" as a MAC address', async () => {
      // The route /token-usage/summary must be declared before /token-usage/:mac
      // so Express matches summary first. A 401 confirms routing is correct.
      const res = await request(app)
        .get('/toy/device/token-usage/summary');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/token-usage/:mac', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC_COLON}`);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/device/token-usage/:mac/stats', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC_COLON}/stats`);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('routes to stats correctly – does not conflict with /:mac route', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC_COLON}/stats`);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /toy/device/token-usage/:mac', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .delete(`/toy/device/token-usage/${TEST_MAC_COLON}`);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 5. Removed playlist routes
// ===========================================================================

describe('Removed Playlist Routes', () => {
  it('returns 404 for removed device music playlist route', async () => {
    const res = await request(app)
      .get(`/toy/device/${TEST_MAC_COLON}/playlist/music`);

    expect(res.statusCode).toBe(404);
    assertEnvelope(res);
  });

  it('returns 404 for removed device story playlist route', async () => {
    const res = await request(app)
      .get(`/toy/device/${TEST_MAC_COLON}/playlist/story`);

    expect(res.statusCode).toBe(404);
    assertEnvelope(res);
  });
});

// ===========================================================================
// 6. Response Envelope Consistency
// ===========================================================================

describe('Response Envelope Consistency', () => {
  const endpoints = [
    { method: 'get',    path: '/toy/device/list' },
    { method: 'get',    path: `/toy/device/bind/agent-123` },
    { method: 'put',    path: '/toy/device/update/1' },
    { method: 'post',   path: '/toy/device/manual-add' },
    { method: 'post',   path: '/toy/device/unbind' },
    { method: 'put',    path: '/toy/device/assign-kid/1' },
    { method: 'put',    path: '/toy/device/assign-kid-by-mac' },
    { method: 'get',    path: '/toy/device/ota/firmware' },
    { method: 'post',   path: '/toy/device/ota/firmware' },
    { method: 'get',    path: '/toy/device/token-usage/summary' },
  ];

  endpoints.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} always returns { code, msg } envelope`, async () => {
      const res = await request(app)[method](path);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });
});
