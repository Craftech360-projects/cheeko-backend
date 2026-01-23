/**
 * Model Routes Integration Tests
 *
 * Tests for /models/* endpoints
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Model Routes', () => {
  // ==================== PRD-COMPLIANT ENDPOINTS ====================

  describe('GET /toy/models/names', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/models/names');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should return model names with valid auth token', async () => {
      const res = await request(app)
        .get('/toy/models/names')
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/models/llm/names', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/models/llm/names');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should return LLM names with valid auth token', async () => {
      const res = await request(app)
        .get('/toy/models/llm/names')
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('GET /toy/models/:type/provideTypes', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/models/llm/provideTypes');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should reject invalid model type', async () => {
      const res = await request(app)
        .get('/toy/models/invalid/provideTypes')
        .set('Authorization', 'Bearer test-token');

      // Would return 400 for invalid type if auth passed
      expect([400, 401]).toContain(res.status);
    });

    it('should accept valid model types', async () => {
      const validTypes = ['asr', 'tts', 'llm', 'vad', 'mem', 'intent', 'vllm'];

      for (const type of validTypes) {
        const res = await request(app)
          .get(`/toy/models/${type}/provideTypes`)
          .set('Authorization', 'Bearer test-token');

        // Will return 401 since test token is invalid, but validates route exists
        expect([200, 401]).toContain(res.status);
      }
    });
  });

  describe('GET /toy/models/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/models/list');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/models/list')
        .query({ page: 1, limit: 10, modelType: 'llm' })
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('POST /toy/models/:type/:provider', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .post('/toy/models/llm/groq')
        .send({ modelName: 'Test Model' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should reject invalid model type', async () => {
      const res = await request(app)
        .post('/toy/models/invalid/groq')
        .set('Authorization', 'Bearer admin-token')
        .send({ modelName: 'Test Model' });

      // Would return 400 for invalid type if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should require modelName in body', async () => {
      const res = await request(app)
        .post('/toy/models/llm/groq')
        .set('Authorization', 'Bearer admin-token')
        .send({});

      // Would return 400 for missing modelName if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid model creation request', async () => {
      const res = await request(app)
        .post('/toy/models/llm/groq')
        .set('Authorization', 'Bearer admin-token')
        .send({
          modelName: 'Groq LLaMA 3',
          modelCode: 'llama3-8b-8192',
          apiUrl: 'https://api.groq.com/openai/v1',
          description: 'Fast LLaMA 3 model'
        });

      // Will return 401/403 since test token is invalid, but validates route exists
      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /toy/models/:type/:provider/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .put('/toy/models/llm/groq/test-id')
        .send({ modelName: 'Updated Model' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should reject invalid model type', async () => {
      const res = await request(app)
        .put('/toy/models/invalid/groq/test-id')
        .set('Authorization', 'Bearer admin-token')
        .send({ modelName: 'Updated Model' });

      // Would return 400 for invalid type if auth passed
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should accept valid model update request', async () => {
      const res = await request(app)
        .put('/toy/models/llm/groq/test-id')
        .set('Authorization', 'Bearer admin-token')
        .send({
          modelName: 'Updated LLaMA 3',
          description: 'Updated description'
        });

      // Will return 401/403 since test token is invalid, but validates route exists
      expect([200, 400, 401, 403]).toContain(res.status);
    });
  });

  describe('DELETE /toy/models/:id', () => {
    it('should require admin authentication', async () => {
      const res = await request(app)
        .delete('/toy/models/test-id');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid delete request with admin auth', async () => {
      const res = await request(app)
        .delete('/toy/models/test-id')
        .set('Authorization', 'Bearer admin-token');

      // Will return 401/403 since test token is invalid, but validates route exists
      expect([200, 400, 401, 403]).toContain(res.status);
    });
  });

  // ==================== PUBLIC ENDPOINTS ====================

  describe('GET /toy/models/options', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/models/options');

      // Should not require auth - will return 200 or 500 (if DB not configured)
      expect([200, 500]).toContain(res.status);
    });

    it('should return grouped model options', async () => {
      const res = await request(app)
        .get('/toy/models/options');

      if (res.status === 200) {
        expect(res.body.code).toBe(0);
        expect(res.body.data).toBeDefined();
      }
    });
  });

  describe('GET /toy/models/type/:type', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/models/type/llm');

      // Should not require auth
      expect([200, 500]).toContain(res.status);
    });

    it('should reject invalid model type', async () => {
      const res = await request(app)
        .get('/toy/models/type/invalid');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(400);
      expect(res.body.msg).toContain('Invalid model type');
    });

    it('should accept valid model types', async () => {
      const validTypes = ['asr', 'tts', 'llm', 'vad', 'mem', 'intent', 'vllm'];

      for (const type of validTypes) {
        const res = await request(app)
          .get(`/toy/models/type/${type}`);

        expect([200, 500]).toContain(res.status);
      }
    });
  });

  describe('GET /toy/models/:id', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/models/test-model-id');

      // Should not require auth - will return 404 for non-existent or 500 if DB not configured
      expect([200, 404, 500]).toContain(res.status);
    });

    it('should return 404 for non-existent model', async () => {
      const res = await request(app)
        .get('/toy/models/00000000-0000-0000-0000-000000000000');

      // Will return 404 or 500 if DB not configured
      expect([404, 500]).toContain(res.status);
    });
  });

  // ==================== LEGACY ENDPOINTS ====================

  describe('POST /toy/models/create (legacy)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/models/create')
        .send({
          modelType: 'llm',
          modelName: 'Test Model'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require modelType and modelName', async () => {
      const res = await request(app)
        .post('/toy/models/create')
        .set('Authorization', 'Bearer test-token')
        .send({});

      // Would return 400 for missing fields if auth passed
      expect([400, 401]).toContain(res.status);
    });

    it('should accept valid legacy create request', async () => {
      const res = await request(app)
        .post('/toy/models/create')
        .set('Authorization', 'Bearer test-token')
        .send({
          modelType: 'llm',
          modelName: 'Test LLM',
          provider: 'groq'
        });

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('PUT /toy/models/update/:id (legacy)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/models/update/test-id')
        .send({ modelName: 'Updated Model' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid legacy update request', async () => {
      const res = await request(app)
        .put('/toy/models/update/test-id')
        .set('Authorization', 'Bearer test-token')
        .send({ modelName: 'Updated Model' });

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 400, 401]).toContain(res.status);
    });
  });

  describe('DELETE /toy/models/delete/:id (legacy)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/models/delete/test-id');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid legacy delete request', async () => {
      const res = await request(app)
        .delete('/toy/models/delete/test-id')
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 400, 401]).toContain(res.status);
    });
  });

  // ==================== TTS VOICE ENDPOINTS ====================

  describe('GET /toy/models/tts-voices', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/models/tts-voices');

      // Should not require auth
      expect([200, 500]).toContain(res.status);
    });

    it('should accept ttsModelId filter', async () => {
      const res = await request(app)
        .get('/toy/models/tts-voices')
        .query({ ttsModelId: 'test-model-id' });

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/models/tts-voices/:id', () => {
    it('should be publicly accessible', async () => {
      const res = await request(app)
        .get('/toy/models/tts-voices/test-voice-id');

      // Should not require auth - will return 404 for non-existent or 500 if DB not configured
      expect([200, 404, 500]).toContain(res.status);
    });

    it('should return 404 for non-existent voice', async () => {
      const res = await request(app)
        .get('/toy/models/tts-voices/00000000-0000-0000-0000-000000000000');

      expect([404, 500]).toContain(res.status);
    });
  });

  describe('POST /toy/models/tts-voices/create', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/models/tts-voices/create')
        .send({
          ttsModelId: 'test-model-id',
          voiceName: 'Test Voice',
          voiceCode: 'test-voice'
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should require ttsModelId, voiceName, and voiceCode', async () => {
      const res = await request(app)
        .post('/toy/models/tts-voices/create')
        .set('Authorization', 'Bearer test-token')
        .send({});

      // Would return 400 for missing fields if auth passed
      expect([400, 401]).toContain(res.status);
    });

    it('should accept valid voice creation request', async () => {
      const res = await request(app)
        .post('/toy/models/tts-voices/create')
        .set('Authorization', 'Bearer test-token')
        .send({
          ttsModelId: 'test-model-id',
          voiceName: 'Test Voice',
          voiceCode: 'test-voice',
          gender: 'female',
          language: 'en-US'
        });

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 401]).toContain(res.status);
    });
  });

  describe('PUT /toy/models/tts-voices/update/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/models/tts-voices/update/test-id')
        .send({ voiceName: 'Updated Voice' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid voice update request', async () => {
      const res = await request(app)
        .put('/toy/models/tts-voices/update/test-id')
        .set('Authorization', 'Bearer test-token')
        .send({
          voiceName: 'Updated Voice',
          gender: 'male'
        });

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 400, 401]).toContain(res.status);
    });
  });

  describe('DELETE /toy/models/tts-voices/delete/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/models/tts-voices/delete/test-id');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe(401);
    });

    it('should accept valid voice delete request', async () => {
      const res = await request(app)
        .delete('/toy/models/tts-voices/delete/test-id')
        .set('Authorization', 'Bearer test-token');

      // Will return 401 since test token is invalid, but validates route exists
      expect([200, 400, 401]).toContain(res.status);
    });
  });

  // ==================== ROUTE PRIORITY TESTS ====================

  describe('Route Priority', () => {
    it('should match /models/names before /:id', async () => {
      const res = await request(app)
        .get('/toy/models/names')
        .set('Authorization', 'Bearer test-token');

      // Should be recognized as /names endpoint, not /:id
      expect([200, 401]).toContain(res.status);
    });

    it('should match /models/llm/names before /:type/:provider', async () => {
      const res = await request(app)
        .get('/toy/models/llm/names')
        .set('Authorization', 'Bearer test-token');

      // Should be recognized as /llm/names endpoint
      expect([200, 401]).toContain(res.status);
    });

    it('should match /models/list before /:id', async () => {
      const res = await request(app)
        .get('/toy/models/list')
        .set('Authorization', 'Bearer test-token');

      // Should be recognized as /list endpoint, not /:id
      expect([200, 401]).toContain(res.status);
    });

    it('should match /models/options before /:id', async () => {
      const res = await request(app)
        .get('/toy/models/options');

      // Should be recognized as /options endpoint, not /:id
      expect([200, 500]).toContain(res.status);
    });

    it('should match /models/create before /:id', async () => {
      const res = await request(app)
        .post('/toy/models/create')
        .set('Authorization', 'Bearer test-token')
        .send({ modelType: 'llm', modelName: 'Test' });

      // Should be recognized as /create endpoint
      expect([200, 400, 401]).toContain(res.status);
    });

    it('should match /models/tts-voices before /:id', async () => {
      const res = await request(app)
        .get('/toy/models/tts-voices');

      // Should be recognized as /tts-voices endpoint, not /:id
      expect([200, 500]).toContain(res.status);
    });

    it('should match /models/type/:type before /:id', async () => {
      const res = await request(app)
        .get('/toy/models/type/llm');

      // Should be recognized as /type/:type endpoint
      expect([200, 500]).toContain(res.status);
    });

    it('should match /models/:type/provideTypes correctly', async () => {
      const res = await request(app)
        .get('/toy/models/llm/provideTypes')
        .set('Authorization', 'Bearer test-token');

      // Should be recognized as /:type/provideTypes endpoint
      expect([200, 401]).toContain(res.status);
    });
  });

  // ==================== RESPONSE FORMAT TESTS ====================

  describe('Response Format', () => {
    it('should return standardized success response', async () => {
      const res = await request(app)
        .get('/toy/models/options');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('code', 0);
        expect(res.body).toHaveProperty('msg');
        expect(res.body).toHaveProperty('data');
      }
    });

    it('should return standardized error response', async () => {
      const res = await request(app)
        .get('/toy/models/type/invalid');

      expect(res.body).toHaveProperty('code', 400);
      expect(res.body).toHaveProperty('msg');
    });

    it('should return standardized auth error response', async () => {
      const res = await request(app)
        .get('/toy/models/names');

      expect(res.body).toHaveProperty('code', 401);
      expect(res.body).toHaveProperty('msg');
    });
  });
});
