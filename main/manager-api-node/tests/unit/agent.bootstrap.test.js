describe('agent bootstrap fallback', () => {
  let prisma;
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      ai_agent: {
        findUnique: jest.fn()
      },
      kid_profile: {
        findUnique: jest.fn()
      },
      ai_agent_chat_history: {
        findMany: jest.fn()
      },
      voice_session_messages: {
        findMany: jest.fn()
      },
      voice_sessions: {
        findMany: jest.fn()
      },
      voice_session_summaries: {
        findMany: jest.fn()
      },
      device_memory_documents: {
        findMany: jest.fn()
      }
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/services/integrations/mem0.service', () => ({
      isAvailable: jest.fn(() => false),
      searchMemories: jest.fn(),
      formatForPrompt: jest.fn(() => '')
    }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));

    agentService = require('../../src/services/agent.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/services/integrations/mem0.service');
    jest.dontMock('../../src/utils/logger');
  });

  it('builds deterministic manager fallback context for a device', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      user_id: 44n,
      mac_address: 'AA:BB:CC:DD:EE:FF',
      agent_id: 'agent-id',
      kid_id: 77n,
      mode: 'conversation',
      device_mode: 'auto',
      app_version: '1.2.3',
      last_connected_at: new Date('2026-04-22T08:00:00.000Z')
    });
    prisma.ai_agent.findUnique.mockResolvedValue({
      id: 'agent-id',
      user_id: 44n,
      agent_code: 'cheeko',
      agent_name: 'Cheeko',
      asr_model_id: 'asr-model',
      vad_model_id: 'vad-model',
      llm_model_id: 'llm-model',
      vllm_model_id: 'vllm-model',
      tts_model_id: 'tts-model',
      tts_voice_id: 'voice-id',
      mem_model_id: 'memory-model',
      intent_model_id: 'intent-model',
      chat_history_conf: 10,
      system_prompt: 'Be kind and playful.',
      summary_memory: 'Asha likes astronomy.',
      lang_code: 'en',
      language: 'English'
    });
    prisma.kid_profile.findUnique.mockResolvedValue({
      id: 77n,
      user_id: 44n,
      name: 'Asha',
      nickname: 'Ash',
      avatar_url: 'https://example.test/avatar.png',
      birth_date: new Date('2018-02-03T00:00:00.000Z'),
      gender: 'female',
      grade: '2',
      school: 'Moon School',
      interests: ['space', 'music'],
      language: 'en',
      timezone: 'Asia/Kolkata',
      preferences: { tone: 'gentle' }
    });
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([]);
    prisma.voice_session_messages.findMany.mockResolvedValue([
      {
        id: 'msg-2',
        session_id: 'session-1',
        role: 'assistant',
        content: 'Hi Asha!',
        audio_id: 'audio-2',
        created_at: new Date('2026-04-22T08:02:00.000Z')
      },
      {
        id: 'msg-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Hello',
        audio_id: null,
        created_at: new Date('2026-04-22T08:01:00.000Z')
      }
    ]);
    prisma.voice_sessions.findMany.mockResolvedValue([
      {
        session_id: 'session-1',
        status: 'ended',
        started_at: new Date('2026-04-22T08:00:00.000Z'),
        ended_at: new Date('2026-04-22T08:05:00.000Z'),
        last_event_at: new Date('2026-04-22T08:05:00.000Z'),
        _count: { voice_session_messages: 4 }
      }
    ]);
    prisma.voice_session_summaries.findMany.mockResolvedValue([
      {
        session_id: 'session-1',
        summary: 'Asha asked about planets yesterday.',
        model: 'summary-model',
        source_message_count: 4,
        updated_at: new Date('2026-04-22T08:06:00.000Z'),
        voice_sessions: {
          started_at: new Date('2026-04-22T08:00:00.000Z'),
          ended_at: new Date('2026-04-22T08:05:00.000Z'),
          status: 'ended'
        }
      }
    ]);
    prisma.device_memory_documents.findMany.mockResolvedValue([]);

    const result = await agentService.getDeviceBootstrap('aa-bb-cc-dd-ee-ff', {
      includeMemories: true,
      recentLimit: 2
    });

    expect(prisma.ai_device.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' }
    }));
    expect(prisma.voice_session_messages.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-id' },
      take: 2
    }));
    expect(prisma.voice_sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF', agent_id: 'agent-id' },
      take: 2
    }));
    expect(prisma.voice_session_summaries.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        voice_sessions: { agent_id: 'agent-id' }
      },
      take: 2
    }));
    expect(prisma.ai_agent_chat_history.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      bootstrapSource: 'manager_api_fallback',
      device: {
        id: 'device-id',
        userId: '44',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        agentId: 'agent-id',
        kidId: '77',
        mode: 'conversation',
        deviceMode: 'auto',
        appVersion: '1.2.3',
        lastConnectedAt: '2026-04-22T08:00:00.000Z'
      },
      agent: {
        agentId: 'agent-id',
        userId: '44',
        agentCode: 'cheeko',
        agentName: 'Cheeko',
        systemPrompt: 'Be kind and playful.',
        summaryMemory: 'Asha likes astronomy.',
        langCode: 'en',
        language: 'English',
        ttsVoiceId: 'voice-id'
      },
      childProfile: {
        id: '77',
        userId: '44',
        name: 'Asha',
        nickname: 'Ash',
        interests: ['space', 'music'],
        language: 'en',
        timezone: 'Asia/Kolkata'
      },
      recentMessages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Hello',
          audioId: null,
          createdAt: '2026-04-22T08:01:00.000Z'
        },
        {
          id: 'msg-2',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Hi Asha!',
          audioId: 'audio-2',
          createdAt: '2026-04-22T08:02:00.000Z'
        }
      ],
      recentSessions: [
        {
          sessionId: 'session-1',
          status: 'ended',
          startedAt: '2026-04-22T08:00:00.000Z',
          endedAt: '2026-04-22T08:05:00.000Z',
          lastEventAt: '2026-04-22T08:05:00.000Z',
          messageCount: 4
        }
      ],
      sessionSummaries: [
        {
          sessionId: 'session-1',
          summary: 'Asha asked about planets yesterday.',
          model: 'summary-model',
          sourceMessageCount: 4,
          updatedAt: '2026-04-22T08:06:00.000Z',
          startedAt: '2026-04-22T08:00:00.000Z',
          endedAt: '2026-04-22T08:05:00.000Z',
          status: 'ended'
        }
      ],
      memories: {
        memories: [],
        relations: [],
        entities: []
      }
    });
    expect(result.generatedAt).toEqual(expect.any(String));
  });
});

describe('agent bootstrap route', () => {
  it('protects the manager fallback endpoint with service-key auth', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../src/routes/agent.routes.js'), 'utf8');

    expect(source).toMatch(/const \{ requireAuth, requireServiceKey(, requireDualAuth)? \} = require\('\.\.\/middleware\/auth'\);/);
    expect(source).toMatch(/router\.get\('\/device\/:mac\/bootstrap',\s*requireServiceKey,/);
    expect(source).toMatch(/router\.put\('\/device\/:mac\/sessions\/:sessionId\/summary',\s*requireServiceKey,/);
    expect(source).toMatch(/router\.post\('\/device\/:mac\/sessions\/:sessionId\/end',\s*requireServiceKey,/);
  });

  it('protects the worker persona-pull endpoint with service-key auth', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../src/routes/agent.routes.js'), 'utf8');

    expect(source).toMatch(/router\.get\('\/character\/:id\/session',\s*\n?\s*requireServiceKey,/);
  });
});
