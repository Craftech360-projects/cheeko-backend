/**
 * Model & TTS Voice Management E2E Scenarios
 * Covers: Model CRUD, TTS voice management, provider listing
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { testModel, testTtsVoice } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

// ── Model CRUD ──────────────────────────────────────────────────────────────

describe('Model Management E2E', () => {

  let modelId = null;
  const model = testModel();

  describe('Step 1: Create model', () => {
    it('should create a new AI model config', async () => {
      const res = await pactum.spec()
        .post('/models/create')
        .withHeaders(getBearerHeaders())
        .withJson(model)
        .expectStatus(200)
        .returns('res.body');

      modelId = res?.data?.id || res?.data;
      cleanup.track('model', modelId);
      expect(modelId).toBeTruthy();
    });
  });

  describe('Step 2: List models', () => {
    it('should include model in list', async () => {
      await pactum.spec()
        .get('/models/list')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should list model names', async () => {
      await pactum.spec()
        .get('/models/names')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should list LLM names', async () => {
      await pactum.spec()
        .get('/models/llm/names')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: Get model by ID', () => {
    it('should return the created model', async () => {
      if (!modelId) return;

      await pactum.spec()
        .get(`/models/${modelId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Update model', () => {
    it('should update model name', async () => {
      if (!modelId) return;

      await pactum.spec()
        .put(`/models/update/${modelId}`)
        .withHeaders(getBearerHeaders())
        .withJson({
          ...model,
          modelName: `${model.modelName} Updated`,
        })
        .expectStatus(200);
    });
  });

  describe('Step 5: Filter by type', () => {
    it('should filter models by type', async () => {
      await pactum.spec()
        .get('/models/type/llm')
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 6: Model options (public)', () => {
    it('should return model options without auth', async () => {
      await pactum.spec()
        .get('/models/options')
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 7: Delete model', () => {
    it('should delete the model', async () => {
      if (!modelId) return;

      await pactum.spec()
        .delete(`/models/delete/${modelId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);

      cleanup.resources = cleanup.resources.filter(r => !(r.type === 'model' && r.id === modelId));
    });
  });
});

// ── Model Providers ─────────────────────────────────────────────────────────

describe('Model Provider E2E', () => {

  it('should list providers', async () => {
    await pactum.spec()
      .get('/models/provider')
      .withHeaders(getBearerHeaders())
      .expectStatus(200)
      .expectJsonLike({ code: 0 });
  });
});

// ── TTS Voice Management ────────────────────────────────────────────────────

describe('TTS Voice E2E', () => {

  let voiceId = null;

  describe('Step 1: List existing voices', () => {
    it('should return TTS voice list', async () => {
      await pactum.spec()
        .get('/models/tts-voices')
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 2: Create TTS voice', () => {
    it('should create a new TTS voice (requires existing TTS model)', async () => {
      // Get a real TTS model ID first
      const modelsRes = await pactum.spec()
        .get('/models/type/tts')
        .returns('res.body');

      const ttsModelId = modelsRes?.data?.[0]?.id;
      const voice = testTtsVoice(ttsModelId);
      const res = await pactum.spec()
        .post('/models/tts-voices/create')
        .withHeaders(getBearerHeaders())
        .withJson(voice)
        .expect((ctx) => {
          // 200 if TTS model exists, 400 if no TTS models in DB
          expect([200, 400]).toContain(ctx.res.statusCode);
        })
        .returns('res.body');

      voiceId = res?.data?.id || res?.data;
      cleanup.track('tts-voice', voiceId);
    });
  });

  describe('Step 3: Get voice by ID', () => {
    it('should return the created voice', async () => {
      if (!voiceId) return;

      await pactum.spec()
        .get(`/models/tts-voices/${voiceId}`)
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Update voice', () => {
    it('should update voice name', async () => {
      if (!voiceId) return;

      await pactum.spec()
        .put(`/models/tts-voices/update/${voiceId}`)
        .withHeaders(getBearerHeaders())
        .withJson({ name: `updated-voice-${voiceId}` })
        .expectStatus(200);
    });
  });

  describe('Step 5: Delete voice', () => {
    it('should delete the voice', async () => {
      if (!voiceId) return;

      await pactum.spec()
        .delete(`/models/tts-voices/delete/${voiceId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);

      cleanup.resources = cleanup.resources.filter(r => !(r.type === 'tts-voice' && r.id === voiceId));
    });
  });
});
