/**
 * Auth Flow E2E Scenarios
 * Covers: 1.2-1.6 Authentication scenarios
 */

const pactum = require('pactum');
const { v4: uuidv4 } = require('uuid');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders, getInvalidHeaders } = require('../helpers/auth.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Auth Flow E2E', () => {

  describe('1.2 - Invalid credentials rejected', () => {
    it('should return error for wrong password', async () => {
      const captchaId = uuidv4();

      // Get captcha first
      await pactum.spec()
        .get('/user/captcha')
        .withQueryParams('uuid', captchaId)
        .expectStatus(200);

      // Login with wrong password
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
  });

  describe('1.4 - Service-to-service auth', () => {
    it('should accept valid service key', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getServiceKeyHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should reject invalid service key', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders({ 'X-Service-Key': 'invalid-key-xxx' })
        .expectStatus(401);
    });
  });

  describe('1.5 - Firebase auth on content routes', () => {
    it('should accept valid Bearer token on flex auth routes', async () => {
      await pactum.spec()
        .get('/content/library')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

  describe('1.6 - Unauthorized access blocked', () => {
    const protectedEndpoints = [
      { method: 'GET', path: '/device/list' },
      { method: 'GET', path: '/models/list' },
      { method: 'GET', path: '/admin/users/list' },
    ];

    for (const endpoint of protectedEndpoints) {
      it(`should return 401 for ${endpoint.method} ${endpoint.path} without auth`, async () => {
        const spec = pactum.spec();
        if (endpoint.method === 'GET') {
          spec.get(endpoint.path);
        } else {
          spec.post(endpoint.path);
        }
        await spec.expectStatus(401);
      });
    }

    it('should return 401 with invalid token', async () => {
      await pactum.spec()
        .get('/device/list')
        .withHeaders(getInvalidHeaders())
        .expectStatus(401);
    });
  });

});
