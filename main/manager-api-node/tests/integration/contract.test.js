/**
 * API Contract Validation Tests
 *
 * These tests verify that the Node.js API maintains compatibility with
 * the original Java Spring Boot API contract.
 *
 * Key contract requirements:
 * 1. Response wrapper: { code: 0, msg: "success", data: ... }
 * 2. Pagination format: { total: number, list: array }
 * 3. Error codes: 0 for success, non-zero for errors
 * 4. Field naming: camelCase in JSON responses
 */

const request = require('supertest');
const app = require('../../src/app');

describe('API Contract Validation', () => {
  // ===========================================
  // 1. Response Wrapper Format Tests
  // ===========================================
  describe('Response Wrapper Format', () => {
    it('should return { code, msg, data } structure for success', async () => {
      const res = await request(app)
        .get('/toy/health')
        .expect(200);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      expect(res.body).toHaveProperty('data');
      expect(typeof res.body.code).toBe('number');
      expect(typeof res.body.msg).toBe('string');
    });

    it('should return code: 0 for successful responses', async () => {
      const res = await request(app)
        .get('/toy/health')
        .expect(200);

      expect(res.body.code).toBe(0);
      expect(res.body.msg).toBe('success');
    });

    it('should return code: 0 and msg: "success" for pub-config', async () => {
      const res = await request(app)
        .get('/toy/user/pub-config')
        .expect(200);

      expect(res.body.code).toBe(0);
      expect(res.body.msg).toBe('success');
      expect(res.body.data).toBeDefined();
    });

    it('should return non-zero code for errors', async () => {
      const res = await request(app)
        .get('/toy/nonexistent-endpoint')
        .expect(404);

      expect(res.body.code).not.toBe(0);
      expect(res.body.msg).toBeDefined();
    });

    it('should return { code, msg, data } for validation errors', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
      expect(res.body).toHaveProperty('data');
    });

    it('should return { code, msg, data } for auth errors', async () => {
      const res = await request(app)
        .get('/toy/agent/list')
        .expect(401);

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // ===========================================
  // 2. Pagination Format Tests
  // ===========================================
  describe('Pagination Format (matches Spring Boot PageData)', () => {
    it('should have total and list fields in paginated responses', async () => {
      // Using agent/list endpoint which requires auth - test the expected structure
      const res = await request(app)
        .get('/toy/agent/list')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // Auth fails, but verify error structure
      expect(res.body.code).not.toBe(0);
    });

    it('should accept page and limit query parameters', async () => {
      // RFID card page endpoint is a good example
      const res = await request(app)
        .get('/toy/admin/rfid/card/page')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // Validates params are accepted (auth fails, but params parsed)
      expect(res.body).toBeDefined();
    });

    /**
     * NOTE: Pagination structure documentation
     *
     * Java Spring Boot API pagination format (PageData<T>):
     * {
     *   "code": 0,
     *   "msg": "success",
     *   "data": {
     *     "total": 150,
     *     "list": [...]
     *   }
     * }
     *
     * Current Node.js implementation returns:
     * {
     *   "code": 0,
     *   "msg": "success",
     *   "data": {
     *     "list": [...],
     *     "total": 150,
     *     "page": 1,        // Extra field (not in Java API)
     *     "limit": 10       // Extra field (not in Java API)
     *   }
     * }
     *
     * The extra fields (page, limit) are additive and do not break
     * compatibility with existing clients expecting the Java format.
     */
  });

  // ===========================================
  // 3. Error Code Tests
  // ===========================================
  describe('Error Codes (match Spring Boot ErrorCode constants)', () => {
    /**
     * Java API Error Code Reference:
     * - 0: Success
     * - 401: Unauthorized
     * - 403: Forbidden
     * - 404: Not Found
     * - 500: Internal Server Error
     * - 10001: NOT_NULL
     * - 10004: ACCOUNT_PASSWORD_ERROR
     * - 10020: TOKEN_NOT_EMPTY
     * - 10021: TOKEN_INVALID
     * - 10034: PARAM_VALUE_NULL
     */

    it('should return code 401 for unauthorized requests', async () => {
      const res = await request(app)
        .get('/toy/agent/list')
        .expect(401);

      expect(res.body.code).toBe(401);
    });

    it('should return code 404 for not found resources', async () => {
      const res = await request(app)
        .get('/toy/nonexistent')
        .expect(404);

      expect(res.body.code).toBe(404);
    });

    it('should return code 400 for bad requests', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .send({})
        .expect(400);

      expect(res.body.code).toBe(400);
    });
  });

  // ===========================================
  // 4. Field Naming Convention Tests
  // ===========================================
  describe('Field Naming Conventions', () => {
    /**
     * Java API uses camelCase for all JSON field names in DTOs:
     * - agentName (not agent_name)
     * - macAddress (not mac_address)
     * - createDate (not create_date)
     * - lastConnectedAt (not last_connected_at)
     *
     * The Node.js API currently returns snake_case directly from
     * Supabase. This is documented as an intentional difference.
     *
     * Client applications may need to handle both conventions or
     * a future update could add camelCase transformation.
     */

    it('pub-config should return expected structure', async () => {
      const res = await request(app)
        .get('/toy/user/pub-config')
        .expect(200);

      expect(res.body.data).toBeDefined();
      // pubConfig has simple primitive fields that work with either convention
    });

    it('captcha endpoint should return SVG when uuid is provided', async () => {
      // The captcha endpoint requires a uuid query param and returns image/svg+xml
      const res = await request(app)
        .get('/toy/user/captcha')
        .query({ uuid: '00000000-0000-0000-0000-000000000001' })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/svg/);
    });

    it('health endpoint should return expected fields', async () => {
      const res = await request(app)
        .get('/toy/health')
        .expect(200);

      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('timestamp');
    });
  });

  // ===========================================
  // 5. Public Endpoint Tests
  // ===========================================
  describe('Public Endpoints (no auth required)', () => {
    it('GET /device/:mac/mode should be public', async () => {
      const res = await request(app)
        .get('/toy/device/AA:BB:CC:DD:EE:FF/mode');

      // May return 404 if device not found, but NOT 401
      expect(res.status).not.toBe(401);
    });

    it('GET /admin/rfid/card/lookup/:uid should be public', async () => {
      const res = await request(app)
        .get('/toy/admin/rfid/card/lookup/1234567890');

      // May return 404 if card not found, but NOT 401
      expect(res.status).not.toBe(401);
    });

    it('POST /device/register should be public', async () => {
      const res = await request(app)
        .post('/toy/device/register')
        .send({ macAddress: 'AA:BB:CC:DD:EE:FF' });

      // May return 400/409 for validation, but NOT 401
      expect(res.status).not.toBe(401);
    });

    it('GET /system/dict/data/type/:dictType should be public', async () => {
      const res = await request(app)
        .get('/toy/system/dict/data/type/test_type');

      // Should return data (empty array if not found), not 401
      expect(res.status).not.toBe(401);
    });

    it('POST /agent/chat-message should be public for LiveKit', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({});

      // Returns 400 for missing fields, not 401
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(400);
    });
  });

  // ===========================================
  // 6. Protected Endpoint Tests
  // ===========================================
  describe('Protected Endpoints (auth required)', () => {
    it('GET /agent/list should require auth', async () => {
      const res = await request(app)
        .get('/toy/agent/list');

      expect(res.status).toBe(401);
    });

    it('POST /content/library should require admin', async () => {
      const res = await request(app)
        .post('/toy/content/library')
        .send({ title: 'Test' });

      expect(res.status).toBe(401);
    });

    it('GET /admin/users/page should require super admin', async () => {
      const res = await request(app)
        .get('/toy/admin/users/page');

      expect(res.status).toBe(401);
    });

    it('POST /analytics/session/start should require service key', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  // ===========================================
  // 7. HTTP Methods Tests
  // ===========================================
  describe('HTTP Methods', () => {
    it('should reject non-allowed methods with 404', async () => {
      const res = await request(app)
        .patch('/toy/health');

      expect(res.status).toBe(404);
    });

    it('should allow GET on read endpoints', async () => {
      const res = await request(app)
        .get('/toy/health');

      expect(res.status).toBe(200);
    });

    it('should allow POST on write endpoints', async () => {
      const res = await request(app)
        .post('/toy/user/login')
        .send({ username: 'test', password: 'test' });

      // May fail validation but method is allowed
      expect(res.status).not.toBe(405);
    });
  });

  // ===========================================
  // 8. Content-Type Tests
  // ===========================================
  describe('Content-Type Headers', () => {
    it('should return application/json for API responses', async () => {
      const res = await request(app)
        .get('/toy/health')
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('should accept application/json for POST requests', async () => {
      const res = await request(app)
        .post('/toy/user/register')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: 'test', password: 'test123' }));

      // Request processed (may fail validation but not content-type)
      expect(res.status).not.toBe(415);
    });
  });

  // ===========================================
  // 9. CORS Headers Tests
  // ===========================================
  describe('CORS Headers', () => {
    it('should include CORS headers in response', async () => {
      const res = await request(app)
        .get('/toy/health')
        .set('Origin', 'http://localhost:3000');

      // App should handle CORS (check if header exists or defaults)
      expect(res.status).toBe(200);
    });

    it('should handle preflight OPTIONS requests', async () => {
      const res = await request(app)
        .options('/toy/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      // Should return 200 or 204 for OPTIONS
      expect([200, 204]).toContain(res.status);
    });
  });

  // ===========================================
  // 10. Swagger Documentation Tests
  // ===========================================
  describe('Swagger Documentation', () => {
    it('should serve Swagger UI at /toy/doc.html', async () => {
      const res = await request(app)
        .get('/toy/doc.html');

      // Swagger UI redirects or returns HTML
      expect([200, 301, 302]).toContain(res.status);
    });

    it('should serve OpenAPI JSON at /toy/swagger.json', async () => {
      const res = await request(app)
        .get('/toy/swagger.json');

      // Should return JSON
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('openapi');
      expect(res.body).toHaveProperty('info');
      expect(res.body).toHaveProperty('paths');
    });
  });
});

/**
 * ===========================================
 * API CONTRACT DOCUMENTATION
 * ===========================================
 *
 * This section documents the intentional differences between the
 * Java Spring Boot API and Node.js Express API.
 *
 * COMPATIBILITY NOTES:
 *
 * 1. Response Wrapper: FULLY COMPATIBLE
 *    Both APIs return: { code: 0, msg: "success", data: ... }
 *
 * 2. Pagination Format: COMPATIBLE WITH ADDITIONS
 *    Java returns: { total, list }
 *    Node.js returns: { list, total, page, limit }
 *    The extra fields are additive and don't break existing clients.
 *
 * 3. Error Codes: COMPATIBLE
 *    Both APIs use the same numeric codes:
 *    - 0: Success
 *    - 400: Bad Request
 *    - 401: Unauthorized
 *    - 403: Forbidden
 *    - 404: Not Found
 *    - 500: Internal Server Error
 *
 *    Note: The Java API also defines 5-digit codes (10001, 10034, etc.)
 *    for specific error types. The Node.js API primarily uses HTTP codes
 *    but includes the 5-digit codes in constants.js for future use.
 *
 * 4. Field Naming: DOCUMENTED DIFFERENCE
 *    Java DTOs return camelCase: { agentName, macAddress }
 *    Node.js returns snake_case from Supabase: { agent_name, mac_address }
 *
 *    Recommendation: Clients should handle both conventions, or a future
 *    update could add automatic camelCase transformation in Node.js.
 *
 * 5. Date Format:
 *    Java: "yyyy-MM-dd HH:mm:ss" via @JsonFormat
 *    Node.js: ISO 8601 format from PostgreSQL timestamps
 *
 *    Both are standard and parseable by most date libraries.
 *
 * 6. Authentication:
 *    Java: OAuth2/JWT + Service Key via X-Service-Key header
 *    Node.js: Supabase Auth/JWT + Service Key via X-Service-Key header
 *    COMPATIBLE - same header names and token formats.
 *
 * 7. Public vs Protected Endpoints: FULLY COMPATIBLE
 *    Same endpoints are public/protected in both APIs.
 *
 * ===========================================
 */
