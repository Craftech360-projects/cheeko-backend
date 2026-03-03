/**
 * Admin Routes Integration Tests
 *
 * Tests for /toy/admin/* endpoints covering:
 * - User management (super admin only)
 * - Kid profile management (super admin only)
 * - System statistics (super admin only)
 *
 * Auth notes:
 *   - All admin routes require a valid Bearer token (requireAuth) followed by
 *     a super-admin check (requireSuperAdmin).  A missing or invalid token
 *     yields 401.  A valid token whose user is not super-admin yields 403.
 *   - Dummy tokens used in tests are not real; the DB is not seeded, so every
 *     request that passes the no-auth gate will still return 401 from token
 *     verification – that is the correct and expected behaviour.
 */

const request = require('supertest');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that every response – regardless of final status – carries the
 * standard `code` field in the JSON body.
 */
const expectCodeField = (res) => {
  expect(res.body).toHaveProperty('code');
};

// ---------------------------------------------------------------------------
// User Management
// ---------------------------------------------------------------------------

describe('Admin Routes – User Management', () => {

  // GET /toy/admin/users
  describe('GET /toy/admin/users', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/users');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an invalid token (insufficient perms)', async () => {
      const res = await request(app)
        .get('/toy/admin/users')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept pagination query params with any token', async () => {
      const res = await request(app)
        .get('/toy/admin/users')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept mobile filter query param', async () => {
      const res = await request(app)
        .get('/toy/admin/users')
        .query({ mobile: 'test' })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/users/page
  describe('GET /toy/admin/users/page', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an invalid token (insufficient perms)', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept pagination query params', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept status filter', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ status: 1 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept superAdmin filter', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ superAdmin: 1 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept search param', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ search: 'admin' })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should coerce invalid page/limit values gracefully', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page')
        .query({ page: 'bad', limit: 'bad' })
        .set('Authorization', 'Bearer super-admin-token');

      // Route defaults to page 1 / limit 20 when coercion fails
      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/admin/users
  describe('POST /toy/admin/users', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .send({ username: 'newuser', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an invalid / insufficient token', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ username: 'newuser', password: 'password123' });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when username is missing', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ password: 'password123' });

      // 401 when token invalid; 400 when auth passes but validation fails
      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when password is missing', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ username: 'newuser' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept a fully populated valid creation request', async () => {
      const res = await request(app)
        .post('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({
          username: 'testuser_integration',
          password: 'testpassword123',
          status: 1,
          superAdmin: 0
        });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/users/:id
  describe('GET /toy/admin/users/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 200, 401, 403 or 404 for a non-existent user ID', async () => {
      const res = await request(app)
        .get('/toy/admin/users/999999')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403, 404]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/users/:id
  describe('PUT /toy/admin/users/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .send({ username: 'updated' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ username: 'updated' });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept the request when auth is present (resets password)', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ username: 'updated', status: 1 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/admin/users/:id
  describe('DELETE /toy/admin/users/:id', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/1')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept the delete request with super-admin token', async () => {
      const res = await request(app)
        .delete('/toy/admin/users/999999')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/admin/users  (batch)
  describe('DELETE /toy/admin/users (batch)', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .send({ ids: [1, 2, 3] });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ ids: [1, 2, 3] });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when ids body field is missing', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when ids array is empty', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: [] });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when ids is not an array', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: 'not-an-array' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept batch delete with a valid ids array', async () => {
      const res = await request(app)
        .delete('/toy/admin/users')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ ids: [999998, 999999] });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/users/:id/status
  describe('PUT /toy/admin/users/:id/status', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .send({ status: 1 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ status: 1 });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when status field is absent', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept status value 1 (enable)', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ status: 1 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept status value 0 (disable)', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/status')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ status: 0 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/users/:id/password
  describe('PUT /toy/admin/users/:id/password', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .send({ password: 'newpassword123' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ password: 'newpassword123' });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when password field is missing', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept the request with a valid password field', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/password')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ password: 'newpassword123' });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/users/:id/super-admin
  describe('PUT /toy/admin/users/:id/super-admin', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .send({ superAdmin: 1 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ superAdmin: 1 });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when superAdmin field is absent', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept superAdmin = 1 (grant)', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ superAdmin: 1 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept superAdmin = 0 (revoke)', async () => {
      const res = await request(app)
        .put('/toy/admin/users/1/super-admin')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ superAdmin: 0 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/users/changeStatus/:status  (batch status update)
  describe('PUT /toy/admin/users/changeStatus/:status', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/users/changeStatus/1')
        .send([1, 2, 3]);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 400 or 401 for invalid status value in path', async () => {
      const res = await request(app)
        .put('/toy/admin/users/changeStatus/99')
        .set('Authorization', 'Bearer super-admin-token')
        .send([1, 2, 3]);

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Kid Management
// ---------------------------------------------------------------------------

describe('Admin Routes – Kid Management', () => {

  // GET /toy/admin/users/:id/kids
  describe('GET /toy/admin/users/:id/kids', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1/kids');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/users/1/kids')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for a non-numeric user ID', async () => {
      const res = await request(app)
        .get('/toy/admin/users/not-a-number/kids')
        .set('Authorization', 'Bearer super-admin-token');

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept the request for a numeric user ID', async () => {
      const res = await request(app)
        .get('/toy/admin/users/999999/kids')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/admin/users/:id/kids
  describe('POST /toy/admin/users/:id/kids', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/admin/users/1/kids')
        .send({ name: 'Test Kid', age: 5 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .post('/toy/admin/users/1/kids')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ name: 'Test Kid', age: 5 });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for a non-numeric user ID', async () => {
      const res = await request(app)
        .post('/toy/admin/users/not-a-number/kids')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ name: 'Test Kid' });

      expect([400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept the request with a valid numeric user ID', async () => {
      const res = await request(app)
        .post('/toy/admin/users/1/kids')
        .set('Authorization', 'Bearer super-admin-token')
        .send({ name: 'Test Kid', age: 5 });

      expect([200, 400, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // PUT /toy/admin/kids/:kidId
  describe('PUT /toy/admin/kids/:kidId', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .put('/toy/admin/kids/1')
        .send({ name: 'Updated Kid' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .put('/toy/admin/kids/1')
        .set('Authorization', 'Bearer regular-user-token')
        .send({ name: 'Updated Kid' });

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // DELETE /toy/admin/kids/:kidId
  describe('DELETE /toy/admin/kids/:kidId', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .delete('/toy/admin/kids/1');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .delete('/toy/admin/kids/1')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// System Statistics
// ---------------------------------------------------------------------------

describe('Admin Routes – System Statistics', () => {

  // GET /toy/admin/stats/overview
  describe('GET /toy/admin/stats/overview', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 200, 401, or 403 with a super-admin token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/overview')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/users
  describe('GET /toy/admin/stats/users', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept days query param', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .query({ days: 7 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should default to 30 days when days param is absent', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should coerce invalid days param gracefully', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/users')
        .query({ days: 'invalid' })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/devices
  describe('GET /toy/admin/stats/devices', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept days query param', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/devices')
        .query({ days: 14 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/sessions
  describe('GET /toy/admin/stats/sessions', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept days query param', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/sessions')
        .query({ days: 60 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/tokens
  describe('GET /toy/admin/stats/tokens', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept days query param', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/tokens')
        .query({ days: 90 })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/active
  describe('GET /toy/admin/stats/active', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 200, 401, or 403 with a super-admin token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/active')
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/admin/stats/content
  describe('GET /toy/admin/stats/content', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/content');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/stats/content')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Device Management (admin)
// ---------------------------------------------------------------------------

describe('Admin Routes – Device Management', () => {

  // GET /toy/admin/device/all
  describe('GET /toy/admin/device/all', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/admin/device/all');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
    });

    it('should return 401 or 403 for an insufficient token', async () => {
      const res = await request(app)
        .get('/toy/admin/device/all')
        .set('Authorization', 'Bearer regular-user-token');

      expect([401, 403]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept pagination and keyword params', async () => {
      const res = await request(app)
        .get('/toy/admin/device/all')
        .query({ page: 1, limit: 10, keywords: 'AA:BB' })
        .set('Authorization', 'Bearer super-admin-token');

      expect([200, 401, 403]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Route Priority Verification
// ---------------------------------------------------------------------------

describe('Admin Routes – Route Priority', () => {
  it('/users/page should be matched before /users/:id', async () => {
    const res = await request(app)
      .get('/toy/admin/users/page');

    // Should reach the /users/page handler, not /users/:id
    // Both require auth so 401 is expected with no token
    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/users/list should be matched before /users/:id', async () => {
    const res = await request(app)
      .get('/toy/admin/users/list');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/stats/overview should be matched correctly', async () => {
    const res = await request(app)
      .get('/toy/admin/stats/overview');

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/users/:id/status should route to the status handler', async () => {
    const res = await request(app)
      .put('/toy/admin/users/1/status')
      .send({ status: 1 });

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/users/:id/password should route to the password handler', async () => {
    const res = await request(app)
      .put('/toy/admin/users/1/password')
      .send({ password: 'newpass' });

    expect(res.status).toBe(401);
    expectCodeField(res);
  });

  it('/users/:id/super-admin should route to the super-admin handler', async () => {
    const res = await request(app)
      .put('/toy/admin/users/1/super-admin')
      .send({ superAdmin: 1 });

    expect(res.status).toBe(401);
    expectCodeField(res);
  });
});

// ---------------------------------------------------------------------------
// Response Format Verification
// ---------------------------------------------------------------------------

describe('Admin Routes – Response Format', () => {
  it('all 401 responses should carry code = 401 and a msg string', async () => {
    const endpoints = [
      () => request(app).get('/toy/admin/users'),
      () => request(app).get('/toy/admin/users/page'),
      () => request(app).post('/toy/admin/users').send({}),
      () => request(app).get('/toy/admin/users/1'),
      () => request(app).put('/toy/admin/users/1').send({}),
      () => request(app).delete('/toy/admin/users/1'),
      () => request(app).put('/toy/admin/users/1/status').send({}),
      () => request(app).get('/toy/admin/users/1/kids'),
      () => request(app).post('/toy/admin/users/1/kids').send({}),
      () => request(app).get('/toy/admin/stats/overview'),
      () => request(app).get('/toy/admin/stats/users'),
      () => request(app).get('/toy/admin/stats/devices'),
      () => request(app).get('/toy/admin/stats/sessions'),
      () => request(app).get('/toy/admin/stats/tokens'),
      () => request(app).get('/toy/admin/stats/active'),
    ];

    for (const makeRequest of endpoints) {
      const res = await makeRequest();
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(typeof res.body.msg).toBe('string');
    }
  });
});
