describe('agent voice session lifecycle', () => {
  let prisma;
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      ai_agent: {
        update: jest.fn()
      },
      voice_sessions: {
        update: jest.fn(),
        upsert: jest.fn()
      },
      voice_session_summaries: {
        upsert: jest.fn()
      },
      ai_agent_chat_history: {
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

  it('marks a voice session ended for a device', async () => {
    prisma.voice_sessions.update.mockResolvedValue({
      session_id: 'session-1',
      status: 'ended'
    });

    const result = await agentService.endVoiceSession({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 'session-1',
      endedAt: '2026-04-22T11:05:00.000Z'
    });

    expect(prisma.voice_sessions.update).toHaveBeenCalledWith({
      where: { session_id: 'session-1' },
      data: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        status: 'ended',
        ended_at: new Date('2026-04-22T11:05:00.000Z'),
        last_event_at: new Date('2026-04-22T11:05:00.000Z')
      }
    });
    expect(result).toEqual(expect.objectContaining({
      session_id: 'session-1',
      status: 'ended'
    }));
  });

  it('persists a session summary and updates bootstrap summary memory', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id'
    });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_summaries.upsert.mockResolvedValue({
      session_id: 'session-1',
      summary: 'Child likes robot stories.'
    });
    prisma.ai_agent.update.mockResolvedValue({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: 'Child likes robot stories.'
    });

    const result = await agentService.saveVoiceSessionSummary({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 'session-1',
      summary: 'Child likes robot stories.',
      sourceMessageCount: 10,
      model: 'test-model'
    });

    expect(prisma.voice_session_summaries.upsert).toHaveBeenCalledWith({
      where: { session_id: 'session-1' },
      create: expect.objectContaining({
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        summary: 'Child likes robot stories.',
        source_message_count: 10,
        model: 'test-model'
      }),
      update: expect.objectContaining({
        summary: 'Child likes robot stories.',
        source_message_count: 10,
        model: 'test-model'
      })
    });
    expect(prisma.ai_agent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-id' },
      data: expect.objectContaining({
        summary_memory: 'Child likes robot stories.'
      })
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      summaryMemory: 'Child likes robot stories.'
    }));
  });
});
