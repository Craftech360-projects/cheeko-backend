/**
 * Model Routes Integration Tests
 *
 * Covers: /toy/models/*
 *
 * Auth model:
 *   - requireAuth  : /names, /llm/names, /list, /:type/provideTypes
 *   - requireAdmin : POST /:type/:provider, PUT /:type/:provider/:id,
 *                    DELETE /:id, GET /:id
 *   - public       : /options, /type/:type, /tts-voices
 *
 * Standard success response: { code: 0, msg: 'success', data: {...} }
 * Auth failure returns a body with a non-zero `code`.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');

const MOCK_TOKEN = 'Bearer test-token';

// ============================================================
// Helper
// ============================================================
function expectStandardBody(res) {
  expect(res.body).toHaveProperty('code');
}

// ============================================================
// Read endpoints that require auth (requireAuth)
// ============================================================

describe('GET /toy/models/list', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/models/list');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with auth returns 200 or a server-side error', async () => {
    const res = await request(app)
      .get('/toy/models/list')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('accepts pagination and modelType filter', async () => {
    const res = await request(app)
      .get('/toy/models/list')
      .query({ page: 1, limit: 10, modelType: 'llm' })
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('GET /toy/models/names', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/models/names');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with auth returns 200 or 401', async () => {
    const res = await request(app)
      .get('/toy/models/names')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('GET /toy/models/llm/names', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/models/llm/names');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with auth returns 200 or 401', async () => {
    const res = await request(app)
      .get('/toy/models/llm/names')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('GET /toy/models/asr/provideTypes', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/toy/models/asr/provideTypes');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with auth returns 200 or 401', async () => {
    const res = await request(app)
      .get('/toy/models/asr/provideTypes')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('GET /toy/models/:type/provideTypes — all valid types', () => {
  const validTypes = ['asr', 'tts', 'llm', 'vad', 'mem', 'intent', 'vllm'];

  it.each(validTypes)(
    'GET /toy/models/%s/provideTypes returns 401 without auth',
    async (type) => {
      const res = await request(app).get(`/toy/models/${type}/provideTypes`);
      expect(res.status).toBe(401);
    }
  );
});

// ============================================================
// Write endpoints that require admin (requireAdmin)
// ============================================================

describe('POST /toy/models/llm/openai', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/toy/models/llm/openai')
      .send({ modelName: 'GPT-4o', modelCode: 'gpt-4o' });
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with fake token returns 401 or 403', async () => {
    const res = await request(app)
      .post('/toy/models/llm/openai')
      .set('Authorization', MOCK_TOKEN)
      .send({ modelName: 'GPT-4o', modelCode: 'gpt-4o' });
    expect([401, 403]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('PUT /toy/models/llm/openai/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/toy/models/llm/openai/test-model-id')
      .send({ modelName: 'Updated GPT-4' });
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with fake token returns 401 or 403', async () => {
    const res = await request(app)
      .put('/toy/models/llm/openai/test-model-id')
      .set('Authorization', MOCK_TOKEN)
      .send({ modelName: 'Updated GPT-4' });
    expect([401, 403]).toContain(res.status);
    expectStandardBody(res);
  });
});

describe('DELETE /toy/models/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .delete('/toy/models/test-model-id');
    expect(res.status).toBe(401);
    expectStandardBody(res);
    expect(res.body.code).toBe(401);
  });

  it('with fake token returns 401 or 403', async () => {
    const res = await request(app)
      .delete('/toy/models/test-model-id')
      .set('Authorization', MOCK_TOKEN);
    expect([401, 403]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Public endpoints
// ============================================================

describe('GET /toy/models/options (public)', () => {
  it('does not require auth', async () => {
    const res = await request(app).get('/toy/models/options');
    expect([200, 500]).toContain(res.status);
    expectStandardBody(res);
  });

  it('on success returns grouped model data', async () => {
    const res = await request(app).get('/toy/models/options');
    if (res.status === 200) {
      expect(res.body.code).toBe(0);
      expect(res.body.data).toBeDefined();
    }
  });
});

describe('GET /toy/models/type/:type (public)', () => {
  it('returns 400 for an invalid model type', async () => {
    const res = await request(app).get('/toy/models/type/invalid-type');
    expect(res.status).toBe(400);
    expectStandardBody(res);
  });

  it('returns 200 or 500 for valid type llm', async () => {
    const res = await request(app).get('/toy/models/type/llm');
    expect([200, 500]).toContain(res.status);
    expectStandardBody(res);
  });
});

// ============================================================
// Route priority — named routes must not be swallowed by /:id
// ============================================================

describe('Route priority checks', () => {
  it('/models/names is recognised before /:id', async () => {
    const res = await request(app)
      .get('/toy/models/names')
      .set('Authorization', MOCK_TOKEN);
    // Returns 200 (real data) or 401 (token rejected), never 404
    expect([200, 401]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  it('/models/list is recognised before /:id', async () => {
    const res = await request(app)
      .get('/toy/models/list')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  it('/models/options is recognised before /:id', async () => {
    const res = await request(app).get('/toy/models/options');
    expect([200, 500]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });

  it('/models/llm/names is recognised before /:type/:provider', async () => {
    const res = await request(app)
      .get('/toy/models/llm/names')
      .set('Authorization', MOCK_TOKEN);
    expect([200, 401]).toContain(res.status);
    expect(res.status).not.toBe(404);
  });
});

// ============================================================
// Response format sanity check
// ============================================================

describe('Response format', () => {
  it('auth failure has code = 401 in body', async () => {
    const res = await request(app).get('/toy/models/names');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 401);
    expect(res.body).toHaveProperty('msg');
  });

  it('public 400 error has code = 400 in body', async () => {
    const res = await request(app).get('/toy/models/type/invalid-type');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(res.body).toHaveProperty('msg');
  });
});
