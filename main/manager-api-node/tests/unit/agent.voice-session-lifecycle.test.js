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
        findUnique: jest.fn(),
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
        findFirst: jest.fn(),
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
    prisma.device_memory_documents.findFirst.mockResolvedValue({
      content: 'Rahul is 10 years old and likes playful learning.'
    });
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.ai_agent.update.mockResolvedValue({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and playful learning with Cheeko.\n- Recent recurring topics include elephants.'
    });
    prisma.device_memory_documents.upsert
      .mockResolvedValueOnce({
        id: 'summary-doc-id',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        document_key: 'summary',
        memory_type: 'summary',
        content: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and playful learning with Cheeko.\n- Recent recurring topics include elephants.',
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
        content: expect.stringContaining('Overall memory:'),
        source: 'session_end_consolidation',
        session_id: 'session-1'
      })
    }));
    expect(prisma.device_memory_documents.upsert.mock.calls[0][0].create.content).toContain(
      'Rahul enjoys songs and playful learning with Cheeko.'
    );
    expect(prisma.device_memory_documents.upsert.mock.calls[0][0].create.content).toContain('elephants');
    expect(prisma.device_memory_documents.upsert.mock.calls[0][0].create.content).not.toContain('Recent durable context:');
    expect(prisma.ai_agent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-id' },
      data: expect.objectContaining({
        summary_memory: expect.stringContaining('Overall memory:')
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
        content: expect.stringContaining('Session summary:\nRahul likes elephant songs and wants them read aloud.'),
        source: 'session_end_consolidation',
        session_id: 'session-1'
      })
    }));
    expect(prisma.device_memory_documents.upsert.mock.calls[1][0].create.content).not.toContain('User: My name is Rahul.');
    expect(prisma.device_memory_documents.upsert.mock.calls[1][0].create.content).not.toContain('Assistant:');
    expect(result.memoryConsolidation).toEqual(expect.objectContaining({
      consolidated: true,
      documentKeys: ['summary', 'session:session-1']
    }));
  });

  it('persists a session summary and rolls it into overall memory', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.findFirst.mockResolvedValue({
      content: 'Rahul is 10 years old and likes drawing.'
    });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_summaries.upsert.mockResolvedValue({
      session_id: 'session-1',
      summary: 'Child likes robot stories.'
    });
    prisma.ai_agent.update.mockResolvedValue({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys short stories and drawing with Cheeko.\n- Recent recurring topics include robot stories.'
    });
    prisma.device_memory_documents.upsert.mockResolvedValue({
      id: 'memory-doc-id',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      document_key: 'summary',
      memory_type: 'summary',
      content: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys short stories and drawing with Cheeko.\n- Recent recurring topics include robot stories.',
      source: 'rolling_session_summary',
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
        summary_memory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys short stories and drawing with Cheeko.\n- Recent recurring topics include robot stories.'
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
        content: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys short stories and drawing with Cheeko.\n- Recent recurring topics include robot stories.',
        source: 'rolling_session_summary',
        session_id: 'session-1'
      })
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      summaryMemory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys short stories and drawing with Cheeko.\n- Recent recurring topics include robot stories.'
    }));
  });

  it('keeps saveMemory as rolling overall memory instead of replacing it', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.findFirst.mockResolvedValue({
      content: 'Rahul is 10 years old and likes drawing.'
    });
    prisma.ai_agent.update.mockResolvedValue({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and drawing with Cheeko.\n- Recent recurring topics include elephants.'
    });
    prisma.device_memory_documents.upsert.mockResolvedValue({
      id: 'memory-doc-id',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      document_key: 'summary',
      memory_type: 'summary',
      content: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and drawing with Cheeko.\n- Recent recurring topics include elephants.',
      source: 'save_memory',
      updated_at: new Date('2026-04-22T11:00:00.000Z')
    });
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

    const result = await agentService.saveMemory(
      'aa-bb-cc-dd-ee-ff',
      'Rahul asked for an elephant song.'
    );

    expect(prisma.ai_agent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-id' },
      data: expect.objectContaining({
        summary_memory: 'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and drawing with Cheeko.\n- Recent recurring topics include elephants.'
      })
    }));
    expect(prisma.ai_agent.update.mock.calls[0][0].data.summary_memory).not.toBe(
      'Rahul asked for an elephant song.'
    );
    expect(result.summaryMemory).toBe(
      'Overall memory:\n- Rahul is 10 years old.\n- Rahul enjoys songs and drawing with Cheeko.\n- Recent recurring topics include elephants.'
    );
  });

  it('keeps rolling overall memory bounded without dropping core identity', async () => {
    const existingMemory = `Rahul is 10 years old and likes drawing. ${'older detail '.repeat(180)}`;

    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.findFirst.mockResolvedValue({
      content: existingMemory
    });
    prisma.ai_agent.update.mockImplementation(async ({ data }) => ({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: data.summary_memory
    }));
    prisma.device_memory_documents.upsert.mockImplementation(async ({ create }) => ({
      id: 'memory-doc-id',
      ...create
    }));
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

    const result = await agentService.saveMemory(
      'aa-bb-cc-dd-ee-ff',
      'Rahul recently asked Cheeko to remember elephant songs.'
    );

    expect(result.summaryMemory.length).toBeLessThanOrEqual(1500);
    expect(result.summaryMemory).toContain('Rahul is 10 years old');
    expect(result.summaryMemory).toContain('Rahul expects Cheeko to remember previous conversations.');
    expect(result.summaryMemory).toContain('elephants');
    expect(result.summaryMemory).not.toContain('Recent durable context:');
  });

  it('rewrites stacked session narratives into one clean overall memory', async () => {
    const stackedMemory = `After reconnecting, Rahul asks Cheeko if he remembers their previous conversation about writing a song. Although Cheeko cannot recall the specific song, he enthusiastically agrees to write a new one. At Rahul's request, Cheeko sings a short song about elephants and offers to save it. The segment ends with Rahul asking if he can sing another song.

Recent durable context:
Cheeko greets Rahul enthusiastically, and after some initial back-and-forth, Rahul asks for a story. Cheeko suggests a tale about a rocket ship visiting a chocolate planet, which Rahul accepts. Cheeko then tells a short story about Zoomy the rocket, who discovers Choco-Planet and meets a friendly marshmallow king.

Recent durable context:
Cheeko greets Rahul and tells him a joke about a tomato. When Rahul asks if Cheeko remembers their previous conversations, Cheeko recalls their discussions about elephants and Zoomy the rocket ship. The segment concludes with Rahul asking for another joke.`;

    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.device_memory_documents.findFirst.mockResolvedValue({
      content: stackedMemory
    });
    prisma.ai_agent.update.mockImplementation(async ({ data }) => ({
      id: 'agent-id',
      agent_name: 'Cheeko',
      summary_memory: data.summary_memory
    }));
    prisma.device_memory_documents.upsert.mockImplementation(async ({ create }) => ({
      id: 'memory-doc-id',
      ...create
    }));
    prisma.device_memory_chunks.deleteMany.mockResolvedValue({ count: 0 });
    prisma.device_memory_chunks.createMany.mockResolvedValue({ count: 1 });

    const result = await agentService.saveMemory(
      'aa-bb-cc-dd-ee-ff',
      'Rahul asks Cheeko for another silly joke about bananas.'
    );

    expect(result.summaryMemory).toContain('Overall memory:');
    expect(result.summaryMemory).toContain('Rahul enjoys songs, jokes, and short stories with Cheeko.');
    expect(result.summaryMemory).toContain('Rahul expects Cheeko to remember previous conversations.');
    expect(result.summaryMemory).toContain('Recent recurring topics include elephants, Zoomy the rocket, chocolate planet, tomato jokes, and banana jokes.');
    expect((result.summaryMemory.match(/Recent durable context:/g) || [])).toHaveLength(0);
    expect(result.summaryMemory).not.toContain('After reconnecting');
    expect(result.summaryMemory).not.toContain('The segment concludes');
  });
});
