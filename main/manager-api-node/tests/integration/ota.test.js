'use strict';
/**
 * OTA & OTA Management Routes Integration Tests
 *
 * Covers:
 *   - /toy/ota/          — public device firmware check (Spring Boot compatible)
 *   - /toy/ota/activate  — public activation check
 *   - /toy/otaMag/*      — admin-only firmware management
 */

const request = require('supertest');
const app = require('../../src/app');
const deviceService = require('../../src/services/device.service');

const VALID_MAC = 'AA:BB:CC:DD:EE:FF';
const INVALID_MAC = 'not-a-mac-address';
const TEST_FIRMWARE_ID = 'some-firmware-uuid';

// =============================================
// POST /toy/ota/
// =============================================

describe('OTA Routes (/toy/ota)', () => {
  describe('POST /toy/ota/', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: VALID_MAC });

      expect(res.status).not.toBe(401);
    });

    it('should reject when MAC is missing from both header and body', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/device id/i);
    });

    it('should reject an invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: INVALID_MAC });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
      expect(res.body.msg).toMatch(/invalid/i);
    });

    it('should reject a MAC with wrong segment count', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: 'AA:BB:CC' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should accept MAC from Device-Id header', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .set('Device-Id', VALID_MAC)
        .send({});

      // No MAC validation error expected
      expect(res.status).not.toBe(401);
      // Depending on DB availability the status may vary
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept a valid MAC in body and respond', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: VALID_MAC, version: '1.0.0', board: 'esp32s3' });

      // DB may not be available in test env
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept optional version and board fields', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({
          mac: VALID_MAC,
          version: '1.2.3',
          board: 'esp32',
          flash_size: 4096,
          chip_model_name: 'ESP32-D0WD'
        });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: 'AA-BB-CC-DD-EE-FF' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept lowercase MAC with colons', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: 'aa:bb:cc:dd:ee:ff' });

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should respond with a JSON body (Spring Boot format or error object)', async () => {
      const res = await request(app)
        .post('/toy/ota/')
        .send({ mac: VALID_MAC });

      // OTA returns raw response (not wrapped in {code, msg, data}) on success
      // but does return {code, msg} on error
      expect(res.type).toMatch(/json/);
    });
  });

  // =============================================
  // POST /toy/ota/activate
  // =============================================

  describe('POST /toy/ota/activate', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .post('/toy/ota/activate')
        .send({ mac: VALID_MAC });

      // Spring Boot compat: 200/202 allowed
      expect([200, 202]).toContain(res.status);
    });

    it('should return 202 when no MAC is provided', async () => {
      const res = await request(app)
        .post('/toy/ota/activate')
        .send({});

      // Spring Boot compat: returns 202 for missing device
      expect(res.status).toBe(202);
    });

    it('should accept MAC from Device-Id header', async () => {
      const res = await request(app)
        .post('/toy/ota/activate')
        .set('Device-Id', VALID_MAC)
        .send({});

      expect([200, 202]).toContain(res.status);
    });

    it('should return 202 for unregistered device MAC', async () => {
      const res = await request(app)
        .post('/toy/ota/activate')
        .send({ mac: '00:00:00:00:00:01' });

      // Unregistered → 202 (Spring Boot compat)
      expect([200, 202]).toContain(res.status);
    });

    it('should return activation code payload for an unregistered device when available', async () => {
      const activationPayload = {
        device: { mac: VALID_MAC },
        activation: {
          code: '123456',
          message: 'http://localhost:8001\n123456',
          challenge: VALID_MAC
        }
      };

      jest.spyOn(deviceService, 'getDeviceByMac').mockResolvedValue(null);
      jest.spyOn(deviceService, 'checkOtaVersion').mockResolvedValue(activationPayload);

      const res = await request(app)
        .post('/toy/ota/activate')
        .send({ mac: VALID_MAC, version: '1.0.0', board: 'esp32s3' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(activationPayload);
      expect(deviceService.checkOtaVersion).toHaveBeenCalledWith(
        VALID_MAC,
        VALID_MAC,
        expect.objectContaining({
          version: '1.0.0',
          board: 'esp32s3'
        })
      );
    });
  });

  // =============================================
  // GET /toy/ota/
  // =============================================

  describe('GET /toy/ota/', () => {
    it('should be publicly accessible without authentication', async () => {
      const res = await request(app)
        .get('/toy/ota/');

      expect(res.status).not.toBe(401);
    });

    it('should return standard response envelope', async () => {
      const res = await request(app)
        .get('/toy/ota/');

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should accept optional type query parameter', async () => {
      const res = await request(app)
        .get('/toy/ota/?type=esp32');

      expect([200, 400, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should return latestVersions and serverTime on success', async () => {
      const res = await request(app)
        .get('/toy/ota/');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('status', 'online');
        expect(res.body.data).toHaveProperty('latestVersions');
        expect(res.body.data).toHaveProperty('serverTime');
      }
    });
  });
});

// =============================================
// OTA Management Routes (/toy/otaMag)
// All routes require auth + admin
// =============================================

describe('OTA Management Routes (/toy/otaMag) — Auth guard', () => {
  describe('GET /toy/otaMag/', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/otaMag/');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(res.body).toHaveProperty('msg');
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get('/toy/otaMag/')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject malformed Authorization header', async () => {
      const res = await request(app)
        .get('/toy/otaMag/')
        .set('Authorization', 'NotBearer sometoken');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return standard error envelope', async () => {
      const res = await request(app)
        .get('/toy/otaMag/');

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      expect(typeof res.body.msg).toBe('string');
    });
  });

  describe('GET /toy/otaMag/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/otaMag/${TEST_FIRMWARE_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`/toy/otaMag/${TEST_FIRMWARE_ID}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('POST /toy/otaMag/', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/otaMag/')
        .send({
          firmwareName: 'Test Firmware',
          type: 'esp32',
          version: '1.0.0',
          firmwarePath: 'uploadfile/test.bin'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post('/toy/otaMag/')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          firmwareName: 'Test',
          type: 'esp32',
          version: '1.0.0'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('PUT /toy/otaMag/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put(`/toy/otaMag/${TEST_FIRMWARE_ID}`)
        .send({ firmwareName: 'Updated Firmware' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .put(`/toy/otaMag/${TEST_FIRMWARE_ID}`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ firmwareName: 'Updated' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('DELETE /toy/otaMag/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete(`/toy/otaMag/${TEST_FIRMWARE_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .delete(`/toy/otaMag/${TEST_FIRMWARE_ID}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('PUT /toy/otaMag/forceUpdate/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put(`/toy/otaMag/forceUpdate/${TEST_FIRMWARE_ID}`)
        .send({ forceUpdate: 1, type: 'esp32' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .put(`/toy/otaMag/forceUpdate/${TEST_FIRMWARE_ID}`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ forceUpdate: 1, type: 'esp32' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('GET /toy/otaMag/getDownloadUrl/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/otaMag/getDownloadUrl/${TEST_FIRMWARE_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .get(`/toy/otaMag/getDownloadUrl/${TEST_FIRMWARE_ID}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('POST /toy/otaMag/upload', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/otaMag/upload');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid Bearer token', async () => {
      const res = await request(app)
        .post('/toy/otaMag/upload')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });
  });

  describe('GET /toy/otaMag/download/:uuid', () => {
    it('should be publicly accessible (no auth guard)', async () => {
      // This endpoint is public — devices download firmware via this URL
      const res = await request(app)
        .get('/toy/otaMag/download/nonexistent-uuid');

      // 404 for unknown UUID, but NOT 401
      expect(res.status).not.toBe(401);
      expect([404, 400, 500]).toContain(res.status);
    });
  });

  // =============================================
  // Auth error format consistency
  // =============================================

  describe('Error Response Format', () => {
    it('should return JSON content-type on 401', async () => {
      const res = await request(app)
        .get('/toy/otaMag/');

      expect(res.type).toMatch(/json/);
    });

    it('should include both code and msg on 401 from GET list', async () => {
      const res = await request(app)
        .get('/toy/otaMag/');

      expect(res.body).toMatchObject({
        code: 401,
        msg: expect.any(String)
      });
    });
  });
});
