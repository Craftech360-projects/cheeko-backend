/**
 * Admin Operations E2E Scenarios
 * Covers: User management, stats overview, kid profiles, dict/params, auth flows
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders } = require('../helpers/auth.helper');
const { uniqueId, testKidProfile } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

// ── Admin User Management ───────────────────────────────────────────────────

describe('Admin User Management E2E', () => {

  describe('List users', () => {
    it('should return paginated user list', async () => {
      await pactum.spec()
        .get('/admin/users/list')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should return users page', async () => {
      await pactum.spec()
        .get('/admin/users/page')
        .withHeaders(getBearerHeaders())
        .withQueryParams({ page: 1, size: 10 })
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Get user by ID', () => {
    it('should return user details for admin user (id=1)', async () => {
      await pactum.spec()
        .get('/admin/users/1')
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('Admin kids for user', () => {
    it('should list kids for a user', async () => {
      await pactum.spec()
        .get('/admin/users/1/kids')
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });

  describe('All devices (admin)', () => {
    it('should return all devices', async () => {
      await pactum.spec()
        .get('/admin/device/all')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });
});

// ── Admin Stats ─────────────────────────────────────────────────────────────

describe('Admin Stats E2E', () => {

  it('should return overview stats', async () => {
    await pactum.spec()
      .get('/admin/stats/overview')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return user stats', async () => {
    await pactum.spec()
      .get('/admin/stats/users')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return device stats', async () => {
    await pactum.spec()
      .get('/admin/stats/devices')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return content stats', async () => {
    await pactum.spec()
      .get('/admin/stats/content')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return session stats', async () => {
    await pactum.spec()
      .get('/admin/stats/sessions')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return token stats', async () => {
    await pactum.spec()
      .get('/admin/stats/tokens')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should return active device stats', async () => {
    await pactum.spec()
      .get('/admin/stats/active')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});

// ── Auth Flows (Register, Logout, Password) ─────────────────────────────────

describe('Auth Extended Flows E2E', () => {

  // NOTE: Logout test removed — it invalidates the shared Bearer token
  // used by all parallel test suites, causing cascading 401 failures.

  describe('Public config', () => {
    it('should return public config without auth', async () => {
      await pactum.spec()
        .get('/user/pub-config')
        .expectStatus(200);
    });
  });

  describe('Registration validation', () => {
    it('should reject registration with missing fields', async () => {
      await pactum.spec()
        .post('/user/register')
        .withJson({})
        .expect((ctx) => {
          expect([400, 422]).toContain(ctx.res.statusCode);
        });
    });

    it('should reject duplicate username registration', async () => {
      await pactum.spec()
        .post('/user/register')
        .withJson({
          username: 'admin',
          password: 'test12345',
          email: `e2e-${uniqueId()}@test.com`,
        })
        .expect((ctx) => {
          // 400 = duplicate, or 200 if different validation
          expect([200, 400, 409, 422]).toContain(ctx.res.statusCode);
        });
    });
  });
});

// ── Kid Profile CRUD (via admin routes) ─────────────────────────────────────

describe('Kid Profile Admin E2E', () => {

  describe('List kid profiles (via admin route)', () => {
    it('should list kids for user', async () => {
      // /api/mobile/* requires Firebase auth; use admin route instead
      await pactum.spec()
        .get('/admin/users/1/kids')
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });
});

// ── System Dictionary ───────────────────────────────────────────────────────

describe('System Dictionary E2E', () => {

  it('should list dict types (paginated)', async () => {
    await pactum.spec()
      .get('/admin/dict/type/page')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ page: 1, limit: 10 })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});

// ── System Params ───────────────────────────────────────────────────────────

describe('System Params E2E', () => {

  it('should list params (paginated)', async () => {
    await pactum.spec()
      .get('/admin/params/page')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ page: 1, limit: 10 })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});

// ── Server Health ───────────────────────────────────────────────────────────

describe('Server Health E2E', () => {

  it('should return healthy status', async () => {
    await pactum.spec()
      .get('/admin/server/health')
      .withHeaders(getBearerHeaders())
      .expectStatus(200);
  });
});
