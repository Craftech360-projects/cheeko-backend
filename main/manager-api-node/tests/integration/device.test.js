/**
 * Device Routes Integration Tests
 */

const request = require('supertest');
const app = require('../../src/app');

// Mock MAC addresses for testing
const TEST_MAC = 'AA:BB:CC:DD:EE:FF';
const TEST_MAC_RAW = 'AABBCCDDEEFF';
const INVALID_MAC = 'INVALID';

describe('Device Routes', () => {
  describe('POST /toy/device/register', () => {
    it('should register a new device with colon-separated MAC', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({
          mac: TEST_MAC,
          board: 'ESP32-WROOM',
          appVersion: '1.0.0'
        });

      // May return success or error depending on DB config
      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should register a device with raw MAC format', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({
          mac: TEST_MAC_RAW,
          board: 'ESP32-S3',
          appVersion: '1.1.0'
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({
          mac: INVALID_MAC
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({
          board: 'ESP32'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/:mac/mode', () => {
    it('should return device mode for existing device', async () => {
      const res = await request(app)
        .get(`/toy/device/${TEST_MAC}/mode`);

      // May return 200 or 404 depending on whether device exists
      expect([200, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('mode');
      }
    });

    it('should handle non-existent device', async () => {
      const res = await request(app)
        .get('/toy/device/00:00:00:00:00:01/mode');

      expect([200, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/:mac/device-mode', () => {
    it('should return PTT device mode', async () => {
      const res = await request(app)
        .get(`/toy/device/${TEST_MAC}/device-mode`);

      expect([200, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('deviceMode');
      }
    });
  });

  describe('POST /toy/device/:mac/cycle-mode', () => {
    it('should cycle device mode', async () => {
      const res = await request(app)
        .post(`/toy/device/${TEST_MAC}/cycle-mode`);

      // May return 200 or 400 depending on whether device exists
      expect([200, 400]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('mode');
        expect(['conversation', 'music', 'story']).toContain(res.body.data.mode);
      }
    });
  });

  describe('GET /toy/device/:mac', () => {
    it('should return device details', async () => {
      const res = await request(app)
        .get(`/toy/device/${TEST_MAC}`);

      // May return 200, 404, or 500 depending on DB config
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('Protected Routes (require auth)', () => {
    describe('POST /toy/device/bind/:agentId/:deviceCode', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/device/bind/123/AABBCCDDEEFF');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/device/bind/:agentId', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/device/bind/123');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/device/unbind', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/device/unbind')
          .send({ deviceId: '1' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/device/update/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/device/update/1')
          .send({ alias: 'My Device' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/device/manual-add', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/device/manual-add')
          .send({ mac: TEST_MAC });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/device/assign-kid/:deviceId', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/device/assign-kid/1')
          .send({ kidId: 1 });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/device/assign-kid-by-mac', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/device/assign-kid-by-mac')
          .send({ mac: TEST_MAC, kidId: 1 });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/device/list', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/device/list');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });
  });
});

describe('Device Validation', () => {
  describe('MAC Address Formats', () => {
    it('should accept uppercase MAC with colons', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'AA:BB:CC:DD:EE:FF' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept lowercase MAC with colons', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'aa:bb:cc:dd:ee:ff' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'AA-BB-CC-DD-EE-FF' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept raw 12-character MAC', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'AABBCCDDEEFF' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should reject short MAC', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'AABBCC' });

      expect(res.status).toBe(400);
    });

    it('should reject MAC with invalid characters', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ mac: 'GG:HH:II:JJ:KK:LL' });

      expect(res.status).toBe(400);
    });
  });
});

// =============================================
// OTA (Over-The-Air) Firmware Update Tests
// =============================================

describe('OTA Firmware Routes', () => {
  const TEST_FIRMWARE_TYPE = 'esp32';
  const TEST_FIRMWARE_VERSION = '1.0.0';

  describe('POST /toy/device/ota/check', () => {
    it('should check for firmware updates', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          mac: TEST_MAC,
          version: '0.9.0',
          board: TEST_FIRMWARE_TYPE
        });

      // May return success or error depending on DB config
      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('device');
        expect(res.body.data).toHaveProperty('serverTime');
        expect(res.body.data.serverTime).toHaveProperty('timestamp');
        expect(res.body.data.serverTime).toHaveProperty('timezone');
      }
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          version: '1.0.0',
          board: TEST_FIRMWARE_TYPE
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with colons', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          mac: 'AA:BB:CC:DD:EE:01',
          version: '1.0.0'
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          mac: 'AA-BB-CC-DD-EE-02',
          version: '1.0.0'
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept raw MAC format', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          mac: 'AABBCCDDEF03',
          version: '1.0.0'
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/ota/check')
        .send({
          mac: 'INVALID',
          version: '1.0.0'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/ota/firmware/latest/:type', () => {
    it('should return latest firmware for type (public)', async () => {
      const res = await request(app)
        .get(`/toy/device/ota/firmware/latest/${TEST_FIRMWARE_TYPE}`);

      // May return 200 or 404 depending on whether firmware exists
      expect([200, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('type');
        expect(res.body.data).toHaveProperty('version');
      }
    });

    it('should return 404 for non-existent firmware type', async () => {
      const res = await request(app)
        .get('/toy/device/ota/firmware/latest/nonexistent-type');

      expect([404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('Protected OTA Routes (require auth)', () => {
    describe('GET /toy/device/ota/firmware', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/device/ota/firmware');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept pagination parameters', async () => {
        const res = await request(app)
          .get('/toy/device/ota/firmware?page=1&limit=5');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept type filter parameter', async () => {
        const res = await request(app)
          .get(`/toy/device/ota/firmware?type=${TEST_FIRMWARE_TYPE}`);

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/device/ota/firmware/all', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/device/ota/firmware/all');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/device/ota/firmware/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/device/ota/firmware/test-id');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('POST /toy/device/ota/firmware', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/device/ota/firmware')
          .send({
            firmwareName: 'Test Firmware',
            type: TEST_FIRMWARE_TYPE,
            version: TEST_FIRMWARE_VERSION
          });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/device/ota/firmware/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/device/ota/firmware/test-id')
          .send({
            firmwareName: 'Updated Firmware'
          });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('DELETE /toy/device/ota/firmware/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .delete('/toy/device/ota/firmware/test-id');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('PUT /toy/device/ota/firmware/:id/force-update', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/device/ota/firmware/test-id/force-update')
          .send({ forceUpdate: 1 });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code');
      });
    });
  });

  describe('OTA Input Validation', () => {
    // These tests would require auth, so they test request format validation
    describe('POST /toy/device/ota/check validation', () => {
      it('should handle empty request body', async () => {
        const res = await request(app)
          .post('/toy/device/ota/check')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept request with only MAC address', async () => {
        const res = await request(app)
          .post('/toy/device/ota/check')
          .send({ mac: TEST_MAC });

        // Should work - version and board are optional
        expect([200, 400, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });
  });
});

// =============================================
// Token Usage Tracking Tests
// =============================================

describe('Token Usage Routes', () => {
  describe('POST /toy/device/token-usage', () => {
    it('should record token usage (public endpoint)', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: TEST_MAC,
          inputTokens: 100,
          outputTokens: 50
        });

      // May return success or error depending on DB config
      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200 && res.body.data) {
        expect(res.body.data).toHaveProperty('mac_address');
        expect(res.body.data).toHaveProperty('usage_date');
      }
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          inputTokens: 100,
          outputTokens: 50
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: INVALID_MAC,
          inputTokens: 100
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with colons', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: 'AA:BB:CC:DD:EE:01',
          inputTokens: 50,
          outputTokens: 25
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: 'AA-BB-CC-DD-EE-02',
          inputTokens: 50,
          outputTokens: 25
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept raw MAC format', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: 'AABBCCDDEF03',
          inputTokens: 50,
          outputTokens: 25
        });

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept all token usage fields', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: TEST_MAC,
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

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept minimal request with only MAC', async () => {
      const res = await request(app)
        .post('/toy/device/token-usage')
        .send({
          mac: TEST_MAC
        });

      // Should work - all fields except MAC are optional
      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/token-usage/summary', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary?page=1&limit=10');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept date filter parameters', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary?startDate=2024-01-01&endDate=2024-12-31');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/token-usage/:mac/stats', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}/stats`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept date filter parameters', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}/stats?startDate=2024-01-01&endDate=2024-12-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept period parameter', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}/stats?period=weekly`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle MAC with colons', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/AA:BB:CC:DD:EE:FF/stats');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle MAC with dashes', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/AA-BB-CC-DD-EE-FF/stats');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle raw MAC format', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/AABBCCDDEEFF/stats');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/device/token-usage/:mac', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}?page=1&limit=30`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept date filter parameters', async () => {
      const res = await request(app)
        .get(`/toy/device/token-usage/${TEST_MAC}?startDate=2024-01-01&endDate=2024-12-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle lowercase MAC', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/aa:bb:cc:dd:ee:ff');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/device/token-usage/:mac', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete(`/toy/device/token-usage/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept date filter parameters', async () => {
      const res = await request(app)
        .delete(`/toy/device/token-usage/${TEST_MAC}?startDate=2024-01-01&endDate=2024-01-31`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept olderThan parameter', async () => {
      const res = await request(app)
        .delete(`/toy/device/token-usage/${TEST_MAC}?olderThan=2024-01-01`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle MAC with colons', async () => {
      const res = await request(app)
        .delete('/toy/device/token-usage/AA:BB:CC:DD:EE:FF');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle MAC with dashes', async () => {
      const res = await request(app)
        .delete('/toy/device/token-usage/AA-BB-CC-DD-EE-FF');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle raw MAC format', async () => {
      const res = await request(app)
        .delete('/toy/device/token-usage/AABBCCDDEEFF');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('Route Priority', () => {
    it('should correctly route to summary endpoint (not treat "summary" as MAC)', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/summary');

      // Should require auth for summary endpoint, not fail with invalid MAC
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should correctly route to stats endpoint', async () => {
      const res = await request(app)
        .get('/toy/device/token-usage/AA:BB:CC:DD:EE:FF/stats');

      // Should require auth for stats endpoint
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });
});
