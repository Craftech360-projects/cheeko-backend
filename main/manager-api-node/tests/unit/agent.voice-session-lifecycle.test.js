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
        upsert: jest.fn(),
        findUnique: jest.fn()
      },
      voice_session_messages: {
        findMany: jest.fn()
      },
      device_memory_documents: {
        upsert: jest.fn()
      },
      device_memory_chunks: {
        deleteMany: jest.fn(),
        createMany: jest.fn()
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
    prisma.voice_session_summaries.findUnique.mockResolvedValue(null);
    prisma.voice_session_messages.findMany.mockResolvedValue([]);

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
      status: 'ended',
      memoryConsolidation: expect.objectContaining({
        consolidated: false,
        reason: 'no_session_memory_inputs'
      })
    }));
  });

  it('consolidates session summary and transcript into device memory after session end', async () => {
    prisma.voice_sessions.update.mockResolvedValue({
      session_id: 'session-1',
      status: 'ended'
    });
    prisma.voice_session_summaries.findUnique.mockResolvedValue({
      session_id: 'session-1',
      summary: 'Rahul likes elephant songs and wants them read aloud.',
      model: 'summary-model',
      source_message_count: 6
    });
    prisma.voice_session_messages.findMany.mockResolvedValue([
      { sequence: 1, role: 'user', content: 'My name is Rahul.' },
      { sequence: 2, role: 'assistant', content: 'Nice to meet you, Rahul.' }
    ]);
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.upsert
      .mockResolvedValueOnce({
        id: 'summary-doc-id',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        document_key: 'summary',
        memory_type: 'summary',
        content: 'Rahul likes elephant songs and wants them read aloud.',
        source: 'session_end_consolidation',
        session_id: 'session-1',
        updated_at: new Date('2026-04-22T11:05:00.000Z')
      })
      .mockResolvedValueOnce({
        id: 'episode-doc-id',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        document_key: 'session:session-1',
        memory_type: 'episode',
        content: 'Session summary:\nRahul likes elephant songs and wants them read aloud.',
        source: 'session_end_consolidation',
        session_id: 'session-1',
        updated_at: new Date('2026-04-22T11:05:00.000Z')
      });
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

    const result = await agentService.endVoiceSession({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      sessionId: 'session-1',
      endedAt: '2026-04-22T11:05:00.000Z'
    });

    expect(prisma.voice_session_summaries.findUnique).toHaveBeenCalledWith({
      where: { session_id: 'session-1' },
      select: {
        summary: true,
        model: true,
        source_message_count: true
      }
    });
    expect(prisma.voice_session_messages.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { session_id: 'session-1' },
      orderBy: { sequence: 'asc' }
    }));
    expect(prisma.device_memory_documents.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        mac_address_document_key: {
          mac_address: 'AA:BB:CC:DD:EE:FF',
          document_key: 'summary'
        }
      },
      create: expect.objectContaining({
        memory_type: 'summary',
        content: 'Rahul likes elephant songs and wants them read aloud.',
        source: 'session_end_consolidation',
        session_id: 'session-1'
      })
    }));
    expect(prisma.device_memory_documents.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        mac_address_document_key: {
          mac_address: 'AA:BB:CC:DD:EE:FF',
          document_key: 'session:session-1'
        }
      },
      create: expect.objectContaining({
        memory_type: 'episode',
        content: expect.stringContaining('User: My name is Rahul.'),
        source: 'session_end_consolidation',
        session_id: 'session-1'
      })
    }));
    expect(result.memoryConsolidation).toEqual(expect.objectContaining({
      consolidated: true,
      documentKeys: ['summary', 'session:session-1']
    }));
  });

  it('persists a session summary and updates bootstrap summary memory', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
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
    prisma.device_memory_documents.upsert.mockResolvedValue({
      id: 'memory-doc-id',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      document_key: 'summary',
      memory_type: 'summary',
      content: 'Child likes robot stories.',
      source: 'session_summary',
      updated_at: new Date('2026-04-22T11:00:00.000Z')
    });
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

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
    expect(prisma.device_memory_documents.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        mac_address_document_key: {
          mac_address: 'AA:BB:CC:DD:EE:FF',
          document_key: 'summary'
        }
      },
      create: expect.objectContaining({
        memory_type: 'summary',
        content: 'Child likes robot stories.',
        source: 'session_summary',
        session_id: 'session-1'
      })
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      summaryMemory: 'Child likes robot stories.'
    }));
  });
});
