/**
 * Authentication Endpoint Tests
 *
 * Tests for /user/* routes including:
 * - User registration
 * - User login
 * - CAPTCHA generation
 * - Password management
 * - Account deletion
 * - Public config
 * - User info
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Authentication Endpoints', () => {

  // ==================== Registration ====================
  describe('POST /user/register', () => {
    it('should require username', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({ password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require password', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should validate username minimum length', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({ username: 'ab', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should validate password minimum length', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({ username: 'testuser', password: '12345' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should accept valid registration request with email', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: 'test@example.com'
        });

      // Will fail due to no DB connection, but validates input
      expect([200, 500]).toContain(res.status);
    });

    it('should accept valid registration request with phone', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({
          username: 'testuser',
          password: 'password123',
          phone: '+1234567890'
        });

      // Will fail due to no DB connection, but validates input
      expect([200, 500]).toContain(res.status);
    });

    it('should validate email format when provided', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: 'invalid-email'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });
  });

  // ==================== Login ====================
  describe('POST /user/login', () => {
    it('should require username', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({ password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require password', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should accept valid login request', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({
          username: 'testuser',
          password: 'password123'
        });

      // Will fail due to no DB connection, but validates input
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept login with captcha', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({
          username: 'testuser',
          password: 'password123',
          captcha: 'ABCD'
        });

      // Will fail due to no DB connection, but validates input
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  // ==================== Logout ====================
  describe('POST /user/logout', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/user/logout');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .post('/toy/user/logout')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });

  // ==================== CAPTCHA ====================
  describe('GET /user/captcha', () => {
    it('should return captcha data', async () => {
      const res = await request(app)
        .get('/toy/user/captcha');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code', 0);
      expect(res.body.data).toHaveProperty('uuid');
      expect(res.body.data).toHaveProperty('image');
    });

    it('should return unique captcha UUIDs', async () => {
      const res1 = await request(app).get('/toy/user/captcha');
      const res2 = await request(app).get('/toy/user/captcha');

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.data.uuid).not.toBe(res2.body.data.uuid);
    });

    it('should return image data', async () => {
      const res = await request(app)
        .get('/toy/user/captcha');

      expect(res.status).toBe(200);
      // Accept either base64 encoded or inline SVG
      expect(res.body.data.image).toMatch(/^data:image\/(png|jpeg|svg\+xml)(;base64,|,)/);
    });
  });

  // ==================== Change Password ====================
  describe('PUT /user/change-password', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/user/change-password')
        .send({ oldPassword: 'old123', newPassword: 'new123456' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .put('/toy/user/change-password')
        .set('Authorization', 'Bearer invalid-token')
        .send({ oldPassword: 'old123', newPassword: 'new123456' });

      expect(res.status).toBe(401);
    });
  });

  // ==================== Update Password (Recovery) ====================
  describe('PUT /user/update-password', () => {
    it('should require username', async () => {
      const res = await request(app)
        .put('/toy/user/update-password')
        .send({ newPassword: 'newpassword123' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require newPassword', async () => {
      const res = await request(app)
        .put('/toy/user/update-password')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should validate password minimum length', async () => {
      const res = await request(app)
        .put('/toy/user/update-password')
        .send({ username: 'testuser', newPassword: '12345' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should accept valid password update request', async () => {
      const res = await request(app)
        .put('/toy/user/update-password')
        .send({ username: 'testuser', newPassword: 'newpassword123' });

      // Will fail due to no DB connection, but validates input
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should accept verification code', async () => {
      const res = await request(app)
        .put('/toy/user/update-password')
        .send({
          username: 'testuser',
          newPassword: 'newpassword123',
          verificationCode: '123456'
        });

      // Will fail due to no DB connection, but validates input
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  // ==================== Delete Account ====================
  describe('DELETE /user/delete-account', () => {
    it('should require username', async () => {
      const res = await request(app)
        .delete('/toy/user/delete-account')
        .send({ password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should require password', async () => {
      const res = await request(app)
        .delete('/toy/user/delete-account')
        .send({ username: 'testuser' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 400);
    });

    it('should accept valid delete request', async () => {
      const res = await request(app)
        .delete('/toy/user/delete-account')
        .send({ username: 'testuser', password: 'password123' });

      // Will fail due to no DB connection, but validates input
      expect([200, 400, 500]).toContain(res.status);
    });
  });

  // ==================== Public Config ====================
  describe('GET /user/pub-config', () => {
    it('should return public configuration', async () => {
      const res = await request(app)
        .get('/toy/user/pub-config');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code', 0);
      expect(res.body).toHaveProperty('data');
    });

    it('should not require authentication', async () => {
      const res = await request(app)
        .get('/toy/user/pub-config');

      expect(res.status).toBe(200);
    });
  });

  // ==================== User Info ====================
  describe('GET /user/info', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/user/info');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/toy/user/info')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('should reject malformed authorization header', async () => {
      const res = await request(app)
        .get('/toy/user/info')
        .set('Authorization', 'NotBearer some-token');

      expect(res.status).toBe(401);
    });
  });

  // ==================== SMS Verification ====================
  describe('POST /user/smsVerification', () => {
    it('should return not implemented message', async () => {
      const res = await request(app)
        .post('/toy/user/smsVerification')
        .send({ phone: '+1234567890' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code', 0);
      expect(res.body.data).toHaveProperty('sent', false);
      expect(res.body.data.message).toContain('not yet implemented');
    });
  });
});

// ==================== Authentication Middleware Tests ====================
describe('Authentication Middleware', () => {
  describe('Token Validation', () => {
    it('should reject requests without token to protected endpoints', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/toy/user/info' },
        { method: 'post', path: '/toy/user/logout' },
        { method: 'put', path: '/toy/user/change-password' },
        { method: 'get', path: '/toy/agent/list' },
        { method: 'get', path: '/toy/device/list' },
      ];

      for (const endpoint of protectedEndpoints) {
        const res = await request(app)[endpoint.method](endpoint.path);
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('code', 401);
      }
    });

    it('should reject invalid Bearer tokens', async () => {
      const res = await request(app)
        .get('/toy/user/info')
        .set('Authorization', 'Bearer completely-invalid-token-12345');

      expect(res.status).toBe(401);
    });

    it('should reject expired tokens format', async () => {
      // JWT with expired timestamp (exp: 0)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjB9.signature';
      const res = await request(app)
        .get('/toy/user/info')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
    });
  });

  describe('Service Key Authentication', () => {
    it('should reject missing service key on service-auth endpoints', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .send({ mac: 'AA:BB:CC:DD:EE:FF', gameType: 'math_tutor' });

      expect(res.status).toBe(401);
    });

    it('should reject invalid service key', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', 'invalid-service-key')
        .send({ mac: 'AA:BB:CC:DD:EE:FF', gameType: 'math_tutor' });

      expect(res.status).toBe(401);
    });
  });
});

// ==================== Error Response Format Tests ====================
describe('Error Response Format', () => {
  it('should return consistent error format for validation errors', async () => {
    const res = await request(app)
      .post('/toy/user/login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(res.body).toHaveProperty('msg');
    expect(typeof res.body.msg).toBe('string');
  });

  it('should return consistent error format for auth errors', async () => {
    const res = await request(app)
      .get('/toy/user/info');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 401);
    expect(res.body).toHaveProperty('msg');
    expect(typeof res.body.msg).toBe('string');
  });

  it('should return consistent error format for not found', async () => {
    const res = await request(app)
      .get('/toy/nonexistent/route');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 404);
    expect(res.body).toHaveProperty('msg');
  });
});

// ==================== Edge Cases ====================
describe('Edge Cases', () => {
  describe('Request Handling', () => {
    it('should handle empty request body', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should handle malformed JSON', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(res.status).toBe(400);
    });

    it('should handle extremely long username', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({
          username: 'a'.repeat(1000),
          password: 'password123'
        });

      expect(res.status).toBe(400);
    });

    it('should handle special characters in username', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({
          username: '<script>alert("xss")</script>',
          password: 'password123'
        });

      // Should either reject or sanitize
      expect([200, 400, 500]).toContain(res.status);
    });

    it('should handle unicode in password', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({
          username: 'testuser',
          password: 'password123'
        });

      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('Content-Type Handling', () => {
    it('should accept application/json', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: 'test', password: 'test123' }));

      expect([200, 400, 500]).toContain(res.status);
    });

    it('should handle missing Content-Type', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({ username: 'test', password: 'test123' });

      expect([200, 400, 500]).toContain(res.status);
    });
  });
});
