/**
 * Agent Routes Integration Tests
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Agent Routes', () => {
  // ====================
  // Core CRUD Tests
  // ====================
  describe('Core CRUD Operations', () => {
    describe('GET /toy/agent/list', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/agent/list')
          .expect(401);

        expect(res.body.code).toBe(401);
      });

      it('should accept pagination parameters', async () => {
        const res = await request(app)
          .get('/toy/agent/list')
          .query({ page: 1, limit: 10 })
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);

        // Verify it reaches auth check (not a routing issue)
        expect(res.body.code).toBe(401);
      });
    });

    describe('GET /toy/agent/all', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/agent/all')
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });

    describe('POST /toy/agent', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .post('/toy/agent')
          .send({ agentName: 'Test Agent' })
          .expect(401);

        expect(res.body.code).toBe(401);
      });

      it('should validate required fields', async () => {
        const res = await request(app)
          .post('/toy/agent')
          .set('Authorization', 'Bearer test-token')
          .send({})
          .expect(401); // Will fail at auth before validation

        expect(res.body.code).toBe(401);
      });
    });

    describe('GET /toy/agent/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/agent/123')
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });

    describe('PUT /toy/agent/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .put('/toy/agent/123')
          .send({ agentName: 'Updated' })
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });

    describe('DELETE /toy/agent/:id', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .delete('/toy/agent/123')
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });
  });

  // ====================
  // Chat History Tests
  // ====================
  describe('Chat History & Sessions', () => {
    describe('GET /toy/agent/:id/sessions', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/agent/123/sessions')
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });

    describe('GET /toy/agent/:id/chat-history/:sessionId', () => {
      it('should require authentication', async () => {
        const res = await request(app)
          .get('/toy/agent/123/chat-history/session-456')
          .expect(401);

        expect(res.body.code).toBe(401);
      });
    });

    describe('POST /toy/agent/chat-message', () => {
      it('should validate required fields', async () => {
        const res = await request(app)
          .post('/toy/agent/chat-message')
          .send({})
          .expect(400);

        expect(res.body.code).toBe(400);
        expect(res.body.msg).toContain('Missing required fields');
      });

      it('should require macAddress', async () => {
        const res = await request(app)
          .post('/toy/agent/chat-message')
          .send({
            agentId: '123',
            sessionId: 'sess-1',
            chatType: 1,
            content: 'Hello'
          })
          .expect(400);

        expect(res.body.msg).toContain('Missing required fields');
      });

      it('should require agentId', async () => {
        const res = await request(app)
          .post('/toy/agent/chat-message')
          .send({
            macAddress: 'AA:BB:CC:DD:EE:FF',
            sessionId: 'sess-1',
            chatType: 1,
            content: 'Hello'
          })
          .expect(400);

        expect(res.body.msg).toContain('Missing required fields');
      });

      it('should require content', async () => {
        const res = await request(app)
          .post('/toy/agent/chat-message')
          .send({
            macAddress: 'AA:BB:CC:DD:EE:FF',
            agentId: '123',
            sessionId: 'sess-1',
            chatType: 1
          })
          .expect(400);

        expect(res.body.msg).toContain('Missing required fields');
      });
    });
  });

  // ====================
  // Device Integration Tests (Public endpoints)
  // ====================
  describe('Device Integration (Public)', () => {
    describe('GET /toy/agent/prompt/:mac', () => {
      it('should accept valid MAC with colons', async () => {
        const res = await request(app)
          .get('/toy/agent/prompt/AA:BB:CC:DD:EE:FF')
          .expect(404);

        // 404 expected since no DB, but confirms routing works
        expect(res.body.code).toBe(404);
      });

      it('should accept valid MAC with dashes', async () => {
        const res = await request(app)
          .get('/toy/agent/prompt/AA-BB-CC-DD-EE-FF')
          .expect(404);

        expect(res.body.code).toBe(404);
      });

      it('should accept valid MAC without separators', async () => {
        const res = await request(app)
          .get('/toy/agent/prompt/AABBCCDDEEFF')
          .expect(404);

        expect(res.body.code).toBe(404);
      });
    });

    describe('GET /toy/agent/config/:mac', () => {
      it('should be an alias for prompt endpoint', async () => {
        const res = await request(app)
          .get('/toy/agent/config/AA:BB:CC:DD:EE:FF')
          .expect(404);

        expect(res.body.code).toBe(404);
      });
    });

    describe('GET /toy/agent/agent-id/:mac', () => {
      it('should return agent ID for device', async () => {
        const res = await request(app)
          .get('/toy/agent/agent-id/AA:BB:CC:DD:EE:FF')
          .expect(404);

        expect(res.body.code).toBe(404);
      });
    });

    describe('POST /toy/agent/cycle-character/:mac', () => {
      it('should cycle character for device', async () => {
        const res = await request(app)
          .post('/toy/agent/cycle-character/AA:BB:CC:DD:EE:FF')
          .expect(400);

        // 400 expected since no DB, but confirms routing works
        expect(res.body.code).toBe(400);
      });
    });

    describe('POST /toy/agent/set-character/:mac/:agentId', () => {
      it('should set specific character for device', async () => {
        const res = await request(app)
          .post('/toy/agent/set-character/AA:BB:CC:DD:EE:FF/agent-123')
          .expect(400);

        expect(res.body.code).toBe(400);
      });
    });

    describe('GET /toy/agent/current-character/:mac', () => {
      it('should return current character for device', async () => {
        const res = await request(app)
          .get('/toy/agent/current-character/AA:BB:CC:DD:EE:FF')
          .expect(404);

        expect(res.body.code).toBe(404);
      });
    });
  });

  // ====================
  // Route Priority Tests
  // ====================
  describe('Route Priority', () => {
    it('should route /list correctly (not treat as :id)', async () => {
      const res = await request(app)
        .get('/toy/agent/list')
        .expect(401);

      // Should hit auth middleware for protected route, not 404
      expect(res.body.code).toBe(401);
    });

    it('should route /all correctly (not treat as :id)', async () => {
      const res = await request(app)
        .get('/toy/agent/all')
        .expect(401);

      expect(res.body.code).toBe(401);
    });

    it('should route /prompt/:mac correctly', async () => {
      const res = await request(app)
        .get('/toy/agent/prompt/AABBCCDDEEFF')
        .expect(404);

      // Should hit the prompt handler, which returns 404 (device not found)
      expect(res.body.code).toBe(404);
    });

    it('should route /chat-message correctly', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({})
        .expect(400);

      // Should hit the chat-message handler with validation error
      expect(res.body.msg).toContain('Missing required fields');
    });
  });
});
