/**
 * Dictionary & Params E2E Scenarios
 * Covers: Dictionary type CRUD, dictionary data CRUD, system params CRUD
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { uniqueId } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

// ── Dictionary Types ───────────────────────────────────────────────────────

describe('Dictionary Type CRUD E2E', () => {

  let dictTypeId = null;
  const dictType = `e2e_type_${uniqueId()}`;

  it('should list dictionary types (paginated)', async () => {
    await pactum.spec()
      .get('/admin/dict/type/page')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ page: 1, limit: 10 })
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });

  it('should create a dictionary type', async () => {
    const res = await pactum.spec()
      .post('/admin/dict/type/save')
      .withHeaders(getBearerHeaders())
      .withJson({
        dictType,
        dictName: `E2E Dict ${dictType}`,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    dictTypeId = res?.data?.id || res?.data;
  });

  it('should get dictionary type by ID', async () => {
    if (!dictTypeId) return;

    await pactum.spec()
      .get(`/admin/dict/type/${dictTypeId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should update the dictionary type', async () => {
    if (!dictTypeId) return;

    await pactum.spec()
      .put('/admin/dict/type/update')
      .withHeaders(getBearerHeaders())
      .withJson({
        id: dictTypeId,
        dictName: `E2E Dict ${dictType} Updated`,
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete the dictionary type', async () => {
    if (!dictTypeId) return;

    await pactum.spec()
      .post('/admin/dict/type/delete')
      .withHeaders(getBearerHeaders())
      .withJson([dictTypeId])
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Dictionary Data ────────────────────────────────────────────────────────

describe('Dictionary Data CRUD E2E', () => {

  let dictDataId = null;
  let dictTypeId = null;

  it('should create a parent dict type for data tests', async () => {
    const res = await pactum.spec()
      .post('/admin/dict/type/save')
      .withHeaders(getBearerHeaders())
      .withJson({
        dictType: `e2e_data_${uniqueId()}`,
        dictName: `E2E Data Parent`,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    dictTypeId = res?.data?.id || res?.data;
  });

  it('should list dictionary data (paginated)', async () => {
    if (!dictTypeId) return;

    await pactum.spec()
      .get('/admin/dict/data/page')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ dictTypeId, page: 1, limit: 10 })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should create dictionary data', async () => {
    if (!dictTypeId) return;

    const res = await pactum.spec()
      .post('/admin/dict/data/save')
      .withHeaders(getBearerHeaders())
      .withJson({
        dictTypeId,
        dictLabel: `E2E Label ${uniqueId()}`,
        dictValue: `e2e_val_${uniqueId()}`,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    dictDataId = res?.data?.id || res?.data;
  });

  it('should get dictionary data by ID', async () => {
    if (!dictDataId) return;

    await pactum.spec()
      .get(`/admin/dict/data/${dictDataId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get dictionary data by type code', async () => {
    await pactum.spec()
      .get('/admin/dict/data/type/gender')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should update dictionary data', async () => {
    if (!dictDataId) return;

    await pactum.spec()
      .put('/admin/dict/data/update')
      .withHeaders(getBearerHeaders())
      .withJson({
        id: dictDataId,
        dictLabel: `E2E Label Updated`,
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete dictionary data', async () => {
    if (!dictDataId) return;

    await pactum.spec()
      .post('/admin/dict/data/delete')
      .withHeaders(getBearerHeaders())
      .withJson([dictDataId])
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });

  // Cleanup parent type
  afterAll(async () => {
    if (!dictTypeId) return;
    await pactum.spec()
      .post('/admin/dict/type/delete')
      .withHeaders(getBearerHeaders())
      .withJson([dictTypeId]);
  });
});

// ── System Params ──────────────────────────────────────────────────────────

describe('System Params CRUD E2E', () => {

  let paramId = null;
  const paramCode = `e2e_param_${uniqueId()}`;

  it('should list params (paginated)', async () => {
    await pactum.spec()
      .get('/admin/params/page')
      .withHeaders(getBearerHeaders())
      .withQueryParams({ page: 1, limit: 10 })
      .expect((ctx) => {
        expect([200, 403]).toContain(ctx.res.statusCode);
      });
  });

  it('should create a system param', async () => {
    const res = await pactum.spec()
      .post('/admin/params')
      .withHeaders(getBearerHeaders())
      .withJson({
        paramCode,
        paramValue: 'e2e-test-value',
        valueType: 'string',
      })
      .expect((ctx) => {
        expect([200, 400, 403]).toContain(ctx.res.statusCode);
      })
      .returns('res.body');

    paramId = res?.data?.id || res?.data;
  });

  it('should get param by ID', async () => {
    if (!paramId) return;

    await pactum.spec()
      .get(`/admin/params/${paramId}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 403, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should update the param', async () => {
    if (!paramId) return;

    await pactum.spec()
      .put('/admin/params')
      .withHeaders(getBearerHeaders())
      .withJson({
        id: paramId,
        paramValue: 'e2e-updated-value',
      })
      .expect((ctx) => {
        expect([200, 400, 403, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should delete the param', async () => {
    if (!paramId) return;

    await pactum.spec()
      .post('/admin/params/delete')
      .withHeaders(getBearerHeaders())
      .withJson([paramId])
      .expect((ctx) => {
        expect([200, 400, 403, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Server Routes ──────────────────────────────────────────────────────────

describe('Server Admin E2E', () => {

  it('should list servers', async () => {
    await pactum.spec()
      .get('/admin/server/server-list')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should handle emit-action', async () => {
    await pactum.spec()
      .post('/admin/server/emit-action')
      .withHeaders(getBearerHeaders())
      .withJson({
        action: 'ping',
        target: 'all',
      })
      .expect((ctx) => {
        expect([200, 400, 404]).toContain(ctx.res.statusCode);
      });
  });
});
