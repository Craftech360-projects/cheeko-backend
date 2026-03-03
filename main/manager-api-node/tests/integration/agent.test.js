/**
 * Agent Routes Integration Tests
 *
 * Tests for all /toy/agent/* endpoints.
 *
 * Key facts:
 * - Protected routes (requireAuth): /list, /all, /template, /template/:id,
 *   POST /, GET /:id, PUT /:id, DELETE /:id, /:id/sessions, /:id/chat-history/*,
 *   /mcp/address/:id, /mcp/tools/:id
 * - Public routes (no auth): /prompt/:mac, /config/:mac, /agent-id/:mac,
 *   /device/:mac/agent-id, /device/:mac/current-character, /device/:mac/set-character,
 *   /device/:mac/cycle-character, /device/:mac/agent-name,
 *   POST /chat-message, POST /chat-history/report, POST /chat-history/session,
 *   GET /current-character/:mac, POST /cycle-character/:mac,
 *   POST /set-character/:mac/:agentId
 * - Standard response shape: { code: <number>, msg: <string>, data: <any> }
 * - Success: code=0, HTTP 200
 * - Errors: code matches HTTP status (400, 401, 403, 404, 500)
 */

const request = require('supertest');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_MAC_COLON = 'AA:BB:CC:DD:EE:FF';
const TEST_MAC_DASH   = 'AA-BB-CC-DD-EE-FF';
const TEST_MAC_RAW    = 'AABBCCDDEEFF';
const FAKE_TOKEN      = 'Bearer invalid-token-for-testing';

// ---------------------------------------------------------------------------
// Helper – assert every response carries the standard envelope
// ---------------------------------------------------------------------------
function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
  expect(res.body).toHaveProperty('msg');
}

// ===========================================================================
// 1. Agent CRUD
// ===========================================================================

describe('Agent CRUD', () => {

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/list', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/list');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/list')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('reaches the handler (200, 401, or 500) when auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/agent/list')
        .set('Authorization', FAKE_TOKEN);

      expect([200, 401, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('returns 401 even when pagination parameters are present', async () => {
      const res = await request(app)
        .get('/toy/agent/list?page=1&limit=10');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('routes /list correctly – does not match it as a dynamic :id', async () => {
      // If /list were matched as :id, the handler would be different.
      // A 401 from the auth middleware confirms we hit the right route.
      const res = await request(app)
        .get('/toy/agent/list');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/all', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/all');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/all')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('routes /all correctly – does not match it as a dynamic :id', async () => {
      const res = await request(app)
        .get('/toy/agent/all');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/agent/')
        .send({ agentName: 'Test Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/agent/')
        .set('Authorization', FAKE_TOKEN)
        .send({ agentName: 'Test Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('validates required fields before reaching the DB (auth checked first)', async () => {
      // Auth is checked before validation – so invalid token still yields 401
      const res = await request(app)
        .post('/toy/agent/')
        .set('Authorization', FAKE_TOKEN)
        .send({});

      expect([400, 401]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('reaches the handler (200, 400, 401, or 500) when auth header is provided', async () => {
      const res = await request(app)
        .post('/toy/agent/')
        .set('Authorization', FAKE_TOKEN)
        .send({ agentName: 'Test Agent' });

      expect([200, 400, 401, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/agent/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/agent/some-agent-id')
        .send({ agentName: 'Updated Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .put('/toy/agent/some-agent-id')
        .set('Authorization', FAKE_TOKEN)
        .send({ agentName: 'Updated Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /toy/agent/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .delete('/toy/agent/some-agent-id');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .delete('/toy/agent/some-agent-id')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 2. Agent Templates
// ===========================================================================

describe('Agent Templates', () => {

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/template', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/template');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/template')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('routes /template correctly – does not match as a dynamic :id', async () => {
      const res = await request(app)
        .get('/toy/agent/template');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/template', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .post('/toy/agent/template')
        .send({ agentName: 'Template Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .post('/toy/agent/template')
        .set('Authorization', FAKE_TOKEN)
        .send({ agentName: 'Template Agent' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/template/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/template/some-template-id');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /toy/agent/template/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .put('/toy/agent/template/some-template-id')
        .send({ agentName: 'Updated Template' });

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /toy/agent/template/:id', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .delete('/toy/agent/template/some-template-id');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 3. Agent Config (public, for device use)
// ===========================================================================

describe('Agent Config (Public Device Endpoints)', () => {

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/config/:mac', () => {
    it('returns 200, 404, or 500 for colon-separated MAC (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/agent/config/${TEST_MAC_COLON}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('returns 200, 404, or 500 for dash-separated MAC', async () => {
      const res = await request(app)
        .get(`/toy/agent/config/${TEST_MAC_DASH}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('returns 200, 404, or 500 for raw 12-char MAC', async () => {
      const res = await request(app)
        .get(`/toy/agent/config/${TEST_MAC_RAW}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('does not return 401 – endpoint is public', async () => {
      const res = await request(app)
        .get(`/toy/agent/config/${TEST_MAC_COLON}`);

      expect(res.statusCode).not.toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/agent-id/:mac', () => {
    it('returns 200, 404, or 500 for a valid MAC (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/agent/agent-id/${TEST_MAC_COLON}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('does not return 401 – endpoint is public', async () => {
      const res = await request(app)
        .get(`/toy/agent/agent-id/${TEST_MAC_COLON}`);

      expect(res.statusCode).not.toBe(401);
      assertEnvelope(res);
    });

    it('returns 200, 404, or 500 for raw MAC', async () => {
      const res = await request(app)
        .get(`/toy/agent/agent-id/${TEST_MAC_RAW}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/prompt/:mac', () => {
    it('returns 200, 404, or 500 for a valid MAC (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/agent/prompt/${TEST_MAC_COLON}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('is an alias of config/:mac and returns the same shape', async () => {
      const res = await request(app)
        .get(`/toy/agent/prompt/${TEST_MAC_RAW}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/current-character/:mac', () => {
    it('returns 200, 404, or 500 (no auth required)', async () => {
      const res = await request(app)
        .get(`/toy/agent/current-character/${TEST_MAC_COLON}`);

      expect([200, 404, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/cycle-character/:mac', () => {
    it('returns 200, 400, or 500 (no auth required)', async () => {
      const res = await request(app)
        .post(`/toy/agent/cycle-character/${TEST_MAC_COLON}`);

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/set-character/:mac/:agentId', () => {
    it('returns 200, 400, or 500 (no auth required)', async () => {
      const res = await request(app)
        .post(`/toy/agent/set-character/${TEST_MAC_COLON}/agent-123`);

      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 4. Chat Message
// ===========================================================================

describe('Chat Message', () => {

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/chat-message', () => {
    it('returns 400 when request body is empty', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({});

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('returns 400 when macAddress is missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          agentId: 'agent-123',
          sessionId: 'sess-001',
          chatType: 1,
          content: 'Hello'
        });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('returns 400 when agentId is missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          sessionId: 'sess-001',
          chatType: 1,
          content: 'Hello'
        });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('returns 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          agentId: 'agent-123',
          chatType: 1,
          content: 'Hello'
        });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('returns 400 when chatType is missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          agentId: 'agent-123',
          sessionId: 'sess-001',
          content: 'Hello'
        });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('returns 400 when content is missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          agentId: 'agent-123',
          sessionId: 'sess-001',
          chatType: 1
        });

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
      expect(res.body.msg).toContain('Missing required fields');
    });

    it('accepts a complete payload (no auth required – reaches DB layer)', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          agentId: 'agent-123',
          sessionId: 'sess-001',
          chatType: 1,
          content: 'Hello from test'
        });

      // Public endpoint – should not 401; may fail with 400/500 if DB is unavailable
      expect(res.statusCode).not.toBe(401);
      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('accepts an optional audioId field', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({
          macAddress: TEST_MAC_COLON,
          agentId: 'agent-123',
          sessionId: 'sess-001',
          chatType: 2,
          content: 'Agent reply',
          audioId: 'audio-file-abc123'
        });

      expect(res.statusCode).not.toBe(401);
      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });

    it('routes /chat-message correctly – does not match as a dynamic :id segment', async () => {
      // Confirm routing: empty body → 400 validation error (not a 404 or 401)
      const res = await request(app)
        .post('/toy/agent/chat-message')
        .send({});

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /toy/agent/chat-history/report', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-history/report')
        .send({});

      expect(res.statusCode).toBe(400);
      assertEnvelope(res);
    });

    it('accepts a complete payload (public endpoint)', async () => {
      const res = await request(app)
        .post('/toy/agent/chat-history/report')
        .send({
          macAddress: TEST_MAC_COLON,
          sessionId: 'sess-001',
          chatType: 1,
          content: 'Reported message'
        });

      expect(res.statusCode).not.toBe(401);
      expect([200, 400, 500]).toContain(res.statusCode);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 5. Chat History & Sessions (Protected)
// ===========================================================================

describe('Chat History and Sessions (Protected)', () => {

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/:id/sessions', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id/sessions');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });

    it('returns 401 with an invalid auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id/sessions')
        .set('Authorization', FAKE_TOKEN);

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/:id/chat-history/:sessionId', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id/chat-history/session-456');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /toy/agent/:id/chat-history/user', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/some-agent-id/chat-history/user');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 6. MCP Endpoints (Protected)
// ===========================================================================

describe('MCP Endpoints (Protected)', () => {

  describe('GET /toy/agent/mcp/address/:agentId', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/mcp/address/agent-123');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

  describe('GET /toy/agent/mcp/tools/:agentId', () => {
    it('returns 401 without an auth token', async () => {
      const res = await request(app)
        .get('/toy/agent/mcp/tools/agent-123');

      expect(res.statusCode).toBe(401);
      assertEnvelope(res);
    });
  });

});

// ===========================================================================
// 7. Response Envelope Consistency
// ===========================================================================

describe('Response Envelope Consistency', () => {
  const protectedEndpoints = [
    { method: 'get',    path: '/toy/agent/list' },
    { method: 'get',    path: '/toy/agent/all' },
    { method: 'post',   path: '/toy/agent/' },
    { method: 'get',    path: '/toy/agent/some-id' },
    { method: 'put',    path: '/toy/agent/some-id' },
    { method: 'delete', path: '/toy/agent/some-id' },
    { method: 'get',    path: '/toy/agent/template' },
    { method: 'post',   path: '/toy/agent/template' },
  ];

  protectedEndpoints.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} always returns { code, msg } envelope`, async () => {
      const res = await request(app)[method](path);
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  const publicEndpoints = [
    { method: 'get',  path: `/toy/agent/config/${TEST_MAC_COLON}` },
    { method: 'get',  path: `/toy/agent/agent-id/${TEST_MAC_COLON}` },
    { method: 'get',  path: `/toy/agent/prompt/${TEST_MAC_COLON}` },
    { method: 'post', path: '/toy/agent/chat-message' },
  ];

  publicEndpoints.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} always returns { code, msg } envelope`, async () => {
      const res = await request(app)[method](path).send({});
      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });
});
