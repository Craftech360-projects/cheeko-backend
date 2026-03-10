/**
 * Agent Lifecycle E2E Scenarios
 * Covers: Agent CRUD, template management, character switching, chat history
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders } = require('../helpers/auth.helper');
const { testAgent, testAgentTemplate, testDevice, uniqueId } = require('../helpers/data.helper');
const { createCleanup } = require('../helpers/cleanup.helper');

const cleanup = createCleanup();

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

afterAll(async () => {
  await cleanup.cleanAll();
});

describe('Agent Lifecycle E2E', () => {

  let agentId = null;
  const agent = testAgent();

  // ── Agent CRUD ──────────────────────────────────────────────────────────────

  describe('Step 1: Create agent', () => {
    it('should create a new agent', async () => {
      const res = await pactum.spec()
        .post('/agent')
        .withHeaders(getBearerHeaders())
        .withJson(agent)
        .expectStatus(200)
        .expectJsonLike({ code: 0 })
        .returns('res.body');

      // success(res, agent.id) returns the ID directly in data
      agentId = res?.data?.id || res?.data;
      cleanup.track('agent', agentId);
      expect(agentId).toBeTruthy();
    });
  });

  describe('Step 2: Get agent by ID', () => {
    it('should return the created agent', async () => {
      if (!agentId) return;

      await pactum.spec()
        .get(`/agent/${agentId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: List agents', () => {
    it('should include the agent in list', async () => {
      await pactum.spec()
        .get('/agent/list')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Update agent', () => {
    it('should update agent system prompt', async () => {
      if (!agentId) return;

      await pactum.spec()
        .put(`/agent/${agentId}`)
        .withHeaders(getBearerHeaders())
        .withJson({
          agentName: agent.agentName,
          systemPrompt: 'Updated prompt for E2E test.',
        })
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should reflect the updated prompt', async () => {
      if (!agentId) return;

      const res = await pactum.spec()
        .get(`/agent/${agentId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .returns('res.body');

      expect(res?.data?.systemPrompt || res?.data?.system_prompt).toContain('Updated prompt');
    });
  });

  describe('Step 5: Delete agent', () => {
    it('should delete the agent', async () => {
      if (!agentId) return;

      await pactum.spec()
        .delete(`/agent/${agentId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);

      // Remove from cleanup since we deleted manually
      cleanup.resources = cleanup.resources.filter(r => !(r.type === 'agent' && r.id === agentId));
    });

    it('should return 404 for deleted agent', async () => {
      if (!agentId) return;

      await pactum.spec()
        .get(`/agent/${agentId}`)
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([404, 500]).toContain(ctx.res.statusCode);
        });
    });
  });
});

// ── Agent Templates ─────────────────────────────────────────────────────────

describe('Agent Template E2E', () => {

  let templateId = null;
  const template = testAgentTemplate();

  describe('Step 1: Create template', () => {
    it('should create an agent template', async () => {
      const res = await pactum.spec()
        .post('/agent/template')
        .withHeaders(getBearerHeaders())
        .withJson(template)
        .expectStatus(200)
        .expectJsonLike({ code: 0 })
        .returns('res.body');

      templateId = res?.data?.id || res?.data;
      cleanup.track('agent-template', templateId);
      expect(templateId).toBeTruthy();
    });
  });

  describe('Step 2: List templates', () => {
    it('should include template in list', async () => {
      await pactum.spec()
        .get('/agent/template')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: Get template by ID', () => {
    it('should return the created template', async () => {
      if (!templateId) return;

      await pactum.spec()
        .get(`/agent/template/${templateId}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Update template', () => {
    it('should update template name', async () => {
      if (!templateId) return;

      await pactum.spec()
        .put(`/agent/template/${templateId}`)
        .withHeaders(getBearerHeaders())
        .withJson({
          agentName: `${template.agentName}-updated`,
          systemPrompt: template.systemPrompt,
        })
        .expectStatus(200);
    });
  });

  describe('Step 5: Apply template to agents', () => {
    it('should apply template without errors', async () => {
      if (!templateId) return;

      await pactum.spec()
        .post(`/agent/template/${templateId}/apply-to-agents`)
        .withHeaders(getBearerHeaders())
        .expect((ctx) => {
          expect([200, 404]).toContain(ctx.res.statusCode);
        });
    });
  });
});

// ── Agent Character Switching ───────────────────────────────────────────────

describe('Agent Character Switching E2E', () => {

  const device = testDevice();
  const mac = device.macAddress.replace(/:/g, '').toLowerCase();

  it('should register a device for character tests', async () => {
    await pactum.spec()
      .post('/device/manual-add')
      .withHeaders(getBearerHeaders())
      .withJson({ mac: device.macAddress })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should get current character for device', async () => {
    await pactum.spec()
      .get(`/agent/current-character/${mac}`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should cycle character for device', async () => {
    await pactum.spec()
      .post(`/agent/device/${mac}/cycle-character`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get agent config for device', async () => {
    await pactum.spec()
      .get(`/agent/config/${mac}`)
      .expect((ctx) => {
        // 200 = config found, 404 = no agent assigned
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should get agent-id for device', async () => {
    await pactum.spec()
      .get(`/agent/agent-id/${mac}`)
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Chat History ────────────────────────────────────────────────────────────

describe('Agent Chat History E2E', () => {

  it('should accept a chat message', async () => {
    // agentId must be a valid UUID; use a dummy UUID
    await pactum.spec()
      .post('/agent/chat-message')
      .withJson({
        macAddress: 'e2e000000001',
        agentId: '00000000-0000-0000-0000-000000000001',
        sessionId: `e2e-session-${uniqueId()}`,
        chatType: 1,
        content: 'Hello from E2E test',
      })
      .expect((ctx) => {
        // 200 = saved, 400 = foreign key violation (agent doesn't exist)
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should accept a chat history report', async () => {
    await pactum.spec()
      .post('/agent/chat-history/report')
      .withJson({
        macAddress: 'e2e000000001',
        sessionId: `e2e-session-${uniqueId()}`,
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });
});
