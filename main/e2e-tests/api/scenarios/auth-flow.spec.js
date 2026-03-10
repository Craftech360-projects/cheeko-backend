/**
 * Auth Flow E2E Scenarios
 * Covers: Full authentication testing — login, tokens, service keys, protected routes
 */

const pactum = require('pactum');
const { v4: uuidv4 } = require('uuid');
const config = require('../../test.config');
const { loadAuth, getBearerHeaders, getServiceKeyHeaders, getInvalidHeaders } = require('../helpers/auth.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Auth Flow E2E', () => {

  // ── Captcha ────────────────────────────────────────────────────────────────

  describe('Captcha endpoint', () => {
    it('should return captcha data', async () => {
      const captchaId = uuidv4();
      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);
    });
  });

  // ── Successful Login ───────────────────────────────────────────────────────

  describe('Successful login', () => {
    it('should return token and user info on valid credentials', async () => {
      const captchaId = uuidv4();

      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      await pactum.spec()
        .post('/user/login')
        .withJson({
          username: config.auth.adminUser,
          password: config.auth.adminPass,
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: captchaId,
        })
        .expectStatus(200)
        .expectJsonLike({ code: 0 })
        .expect((ctx) => {
          expect(ctx.res.body.data).toHaveProperty('token');
          expect(ctx.res.body.data.token).toBeTruthy();
        });
    });
  });

  // ── Invalid Credentials ────────────────────────────────────────────────────

  describe('Invalid credentials rejected', () => {
    it('should return 400 for wrong password', async () => {
      const captchaId = uuidv4();

      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      await pactum.spec()
        .post('/user/login')
        .withJson({
          username: 'admin',
          password: 'wrong-password-xxx',
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: captchaId,
        })
        .expectStatus(400);
    });

    it('should reject login with empty username', async () => {
      const captchaId = uuidv4();

      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      await pactum.spec()
        .post('/user/login')
        .withJson({
          username: '',
          password: 'admin123',
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: captchaId,
        })
        .expect((ctx) => {
          // Either HTTP error status or 200 with error code in body
          const status = ctx.res.statusCode;
          const code = ctx.res.body?.code;
          expect(status === 400 || status === 422 || status === 500 || code !== 0).toBeTruthy();
        });
    });

    it('should reject login with empty password', async () => {
      const captchaId = uuidv4();

      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      await pactum.spec()
        .post('/user/login')
        .withJson({
          username: 'admin',
          password: '',
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: captchaId,
        })
        .expect((ctx) => {
          const status = ctx.res.statusCode;
          const code = ctx.res.body?.code;
          expect(status === 400 || status === 422 || status === 500 || code !== 0).toBeTruthy();
        });
    });

    it('should reject login with non-existent username', async () => {
      const captchaId = uuidv4();

      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      await pactum.spec()
        .post('/user/login')
        .withJson({
          username: 'nonexistent_user_xyz_999',
          password: 'somepassword',
          captcha: 'MOBILE_APP_BYPASS',
          captchaId: captchaId,
        })
        .expectStatus(400);
    });
  });

  // ── User Info with Token ───────────────────────────────────────────────────

  describe('User info endpoint', () => {
    it('should return user profile with valid Bearer token', async () => {
      await pactum.spec()
        .get('/user/info')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should return 401 without auth token', async () => {
      await pactum.spec()
        .get('/user/info')
        .expectStatus(401);
    });
  });

  // ── Service Key Auth ───────────────────────────────────────────────────────

  describe('Service-to-service auth', () => {
    it('should accept valid service key on requireAdmin route', async () => {
      await pactum.spec()
        .get('/models/provider')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should reject service key on requireAuth route (no god mode)', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(401);
    });

    it('should reject service key on flexAuth route (no god mode)', async () => {
      await pactum.spec()
        .get('/content/library')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(401);
    });

    it('should reject invalid service key', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders({ 'X-Service-Key': 'invalid-key-xxx' })
        .expectStatus(401);
    });
  });

  // ── Bearer Token Auth ─────────────────────────────────────────────────────

  describe('Bearer token auth', () => {
    it('should accept valid Bearer on requireAuth route', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should accept valid Bearer on flexAuth route', async () => {
      await pactum.spec()
        .get('/content/library')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

  // ── Token Reuse ────────────────────────────────────────────────────────────

  describe('Token reuse across endpoints', () => {
    it('should work on multiple endpoints with the same token', async () => {
      const headers = getBearerHeaders();

      await pactum.spec()
        .get('/device/list')
        .withHeaders(headers)
        .expectStatus(200);

      await pactum.spec()
        .get('/models/list')
        .withHeaders(headers)
        .expectStatus(200);

      await pactum.spec()
        .get('/user/info')
        .withHeaders(headers)
        .expectStatus(200);
    });
  });

  // ── Malformed / Invalid Tokens ─────────────────────────────────────────────

  describe('Malformed and invalid tokens', () => {
    it('should reject completely invalid token', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getInvalidHeaders())
        .expectStatus(401);
    });

    it('should reject empty Bearer header', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders({ Authorization: 'Bearer ' })
        .expectStatus(401);
    });

    it('should reject Authorization header without Bearer prefix', async () => {
      const auth = loadAuth();
      await pactum.spec()
        .get('/device/list')
        .withHeaders({ Authorization: auth.bearerToken || 'some-token' })
        .expectStatus(401);
    });

    it('should reject random JWT-like string', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake' })
        .expectStatus(401);
    });
  });

  // ── Unauthorized Access on Protected Endpoints ─────────────────────────────

  describe('Unauthorized access blocked', () => {
    const protectedEndpoints = [
      { method: 'GET', path: '/device/list', guard: 'requireAuth' },
      { method: 'GET', path: '/models/list', guard: 'requireAuth' },
      { method: 'GET', path: '/admin/users/list', guard: 'requireAdmin' },
      { method: 'GET', path: '/user/info', guard: 'requireAuth' },
      { method: 'GET', path: '/content/library', guard: 'flexAuth' },
    ];

    for (const endpoint of protectedEndpoints) {
      it(`should return 401 for ${endpoint.path} (${endpoint.guard}) without auth`, async () => {
        const spec = pactum.spec();
        if (endpoint.method === 'GET') {
          spec.get(endpoint.path);
        } else {
          spec.post(endpoint.path);
        }
        await spec.expectStatus(401);
      });
    }
  });

});
