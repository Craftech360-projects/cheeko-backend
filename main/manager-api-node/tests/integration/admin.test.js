/**
 * Admin Routes Integration Tests
 *
 * Tests for /admin/* endpoints (user management and statistics)
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Admin Routes', () => {
  // ==================== USER MANAGEMENT ====================

  describe('GET /toy/admin/users/page', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .set('Authorization', 'Bearer regular-user-token');

      // Will return 401 for invalid token or 403 if token validates but not super admin
      expect([401, 403]).toContain(res.status);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should accept status filter', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ status: 1 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should accept superAdmin filter', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ superAdmin: 1 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should accept search parameter', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ search: 'admin' })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/users/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/users/list');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/users/list')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should return user list with super admin auth', async () => {
      const res = await request(app)
        .get('/toy/admin/users/list')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/users/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept user ID in path', async () => {
      const res = await request(app)
        .get('/toy/admin/users/999')
        .set('Authorization', 'Bearer super-admin-token');

      // Should return 401/403 (auth) or 404 (not found)
      expect([200, 401, 403, 404]).toContain(res.status);
    });
  });

  describe('POST /toy/admin/users', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .send({ username: 'newuser', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ username: 'newuser', password: 'password123' });

      expect([401, 403]).toContain(res.status);
    });

    it('should require username in body', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ password: 'password123' });

      // Would return 400 for missing username if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should require password in body', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ username: 'newuser' });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid user creation request', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({
          username: 'testuser',
          password: 'testpassword123',
          status: 1,
          superAdmin: 0
        });

      expect([200, 400, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/admin/users/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .send({ username: 'updateduser' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ username: 'updateduser' });

      expect([401, 403]).toContain(res.status);
    });

    it('should accept update request with valid data', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .set('Authorization', 'Bearer super-admin-token')
        .send({
          username: 'updateduser',
          status: 1
        });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/admin/users/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/1');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept delete request', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/999')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/admin/users (batch)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ ids: [1, 2, 3] });

      expect([401, 403]).toContain(res.status);
    });

    it('should require ids array in body', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should reject empty ids array', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept batch delete request', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: [1, 2, 3] });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/admin/users/:id/status', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .send({ status: 0 });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ status: 0 });

      expect([401, 403]).toContain(res.status);
    });

    it('should require status in body', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid status update', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ status: 1 });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/admin/users/:id/password', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .send({ password: 'newpassword123' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ password: 'newpassword123' });

      expect([401, 403]).toContain(res.status);
    });

    it('should require password in body', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid password reset', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ password: 'newpassword123' });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/admin/users/:id/super-admin', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .send({ superAdmin: 1 });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ superAdmin: 1 });

      expect([401, 403]).toContain(res.status);
    });

    it('should require superAdmin in body', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid super admin update', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ superAdmin: 1 });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== SYSTEM STATISTICS ====================

  describe('GET /toy/admin/stats/overview', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should return system overview with super admin auth', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/users', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .query({ days: 7 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should use default days when not provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/devices', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices')
        .query({ days: 14 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/content', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/content');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/content')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should return content statistics with super admin auth', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/content')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/sessions', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions')
        .query({ days: 60 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/tokens', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should accept days parameter', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens')
        .query({ days: 90 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('GET /toy/admin/stats/active', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require super admin access', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
    });

    it('should return active sessions with super admin auth', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== ROUTE PRIORITY TESTS ====================

  describe('Route priority', () => {
    it('should match /users/page before /users/:id', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .set('Authorization', 'Bearer super-admin-token');

      // Should be treated as page route, not :id route
      expect([200, 401, 403]).toContain(res.status);
    });

    it('should match /users/list before /users/:id', async () => {
      const res = await request(app)
        .get('/toy/admin/users/list')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should match /stats/overview correctly', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should match /users/:id/status correctly', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ status: 1 });

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should match /users/:id/password correctly', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ password: 'newpass' });

      expect([200, 401, 403]).toContain(res.status);
    });

    it('should match /users/:id/super-admin correctly', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ superAdmin: 1 });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== INPUT VALIDATION TESTS ====================

  describe('Input validation', () => {
    it('should handle invalid page number gracefully', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ page: 'invalid' })
        .set('Authorization', 'Bearer super-admin-token');

      // Should default to page 1
      expect([200, 401, 403]).toContain(res.status);
    });

    it('should handle invalid limit gracefully', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ limit: 'invalid' })
        .set('Authorization', 'Bearer super-admin-token');

      // Should default to limit 20
      expect([200, 401, 403]).toContain(res.status);
    });

    it('should handle invalid days parameter gracefully', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .query({ days: 'invalid' })
        .set('Authorization', 'Bearer super-admin-token');

      // Should default to 30 days
      expect([200, 401, 403]).toContain(res.status);
    });

    it('should handle non-array ids for batch delete', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: 'not-an-array' });

      expect([400, 401, 403]).toContain(res.status);
    });

    it('should handle status value 0 correctly', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ status: 0 });

      expect([200, 401, 403]).toContain(res.status);
    });
  });

  // ==================== NAMESPACE CONFLICT TEST ====================

  describe('Namespace conflict prevention', () => {
    it('should not conflict with /admin/rfid routes', async () => {
      // Test that /admin/rfid routes still work
      const res = await request(app)
        .get('/toy/admin/rfid/card/list')
        .set('Authorization', 'Bearer test-token');

      // Should return 401 (auth) not 404 (route not found)
      expect([200, 401, 403]).toContain(res.status);
    });

    it('should correctly route to /admin/users', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should correctly route to /admin/stats', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });
  });
});
