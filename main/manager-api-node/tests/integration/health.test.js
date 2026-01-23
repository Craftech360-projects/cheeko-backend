/**
 * Health Endpoint Tests
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Health Endpoints', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'healthy');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('GET /toy/health', () => {
    it('should return API health status', async () => {
      const res = await request(app).get('/toy/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code', 0);
      expect(res.body).toHaveProperty('msg', 'success');
      expect(res.body.data).toHaveProperty('status', 'healthy');
      expect(res.body.data).toHaveProperty('version', '1.0.0');
    });
  });

  describe('GET /toy/pub-config', () => {
    it('should return public configuration', async () => {
      const res = await request(app).get('/toy/pub-config');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code', 0);
      expect(res.body.data).toHaveProperty('apiVersion', 'v1');
      expect(res.body.data).toHaveProperty('platform', 'node');
      expect(res.body.data.features).toHaveProperty('rfid', true);
    });
  });
});

describe('Error Handling', () => {
  describe('GET /toy/nonexistent', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/toy/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 404);
      expect(res.body).toHaveProperty('msg');
    });
  });
});
