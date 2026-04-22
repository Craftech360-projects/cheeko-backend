describe('agent chat history voice-session compatibility', () => {
  let prisma;
  let agentService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      ai_agent_chat_history: {
        findMany: jest.fn(),
        create: jest.fn()
      },
      voice_sessions: {
        upsert: jest.fn()
      },
      voice_session_messages: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn()
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

  it('reads chat history from voice_session_messages first', async () => {
    prisma.voice_session_messages.findMany.mockResolvedValue([
      {
        created_at: new Date('2026-04-22T08:01:00.000Z'),
        role: 'user',
        content: 'Hello',
        audio_id: null,
        mac_address: 'AA:BB:CC:DD:EE:FF'
      },
      {
        created_at: new Date('2026-04-22T08:02:00.000Z'),
        role: 'assistant',
        content: 'Hi!',
        audio_id: 'audio-1',
        mac_address: 'AA:BB:CC:DD:EE:FF'
      }
    ]);

    const history = await agentService.getChatHistory('agent-id', 'session-1');

    expect(prisma.voice_session_messages.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agent_id: 'agent-id', session_id: 'session-1' },
      orderBy: { created_at: 'asc' }
    }));
    expect(prisma.ai_agent_chat_history.findMany).not.toHaveBeenCalled();
    expect(history).toEqual([
      {
        createdAt: '2026-04-22T08:01:00.000Z',
        chatType: 1,
        content: 'Hello',
        audioId: null,
        macAddress: 'AA:BB:CC:DD:EE:FF'
      },
      {
        createdAt: '2026-04-22T08:01:00.000Z',
        chatType: 2,
        content: 'Hi!',
        audioId: 'audio-1',
        macAddress: 'AA:BB:CC:DD:EE:FF'
      }
    ]);
  });

  it('falls back to legacy chat history when a session is not migrated', async () => {
    prisma.voice_session_messages.findMany.mockResolvedValue([]);
    prisma.ai_agent_chat_history.findMany.mockResolvedValue([
      {
        created_at: new Date('2026-04-22T08:01:00.000Z'),
        chat_type: 1,
        content: 'Legacy hello',
        audio_id: null,
        mac_address: 'AA:BB:CC:DD:EE:FF'
      }
    ]);

    const history = await agentService.getChatHistory('agent-id', 'legacy-session');

    expect(prisma.ai_agent_chat_history.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agent_id: 'agent-id', session_id: 'legacy-session' }
    }));
    expect(history).toEqual([
      {
        createdAt: '2026-04-22T08:01:00.000Z',
        chatType: 1,
        content: 'Legacy hello',
        audioId: null,
        macAddress: 'AA:BB:CC:DD:EE:FF'
      }
    ]);
  });

  it('writes reported messages to voice session tables with deterministic idempotency', async () => {
    prisma.voice_session_messages.findFirst.mockResolvedValue({ sequence: 4 });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_messages.create.mockResolvedValue({
      id: 'voice-msg-5',
      session_id: 'session-1',
      sequence: 5
    });

    const result = await agentService.reportChatMessage({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      agentId: 'agent-id',
      sessionId: 'session-1',
      chatType: 2,
      content: 'Hi!',
      audioId: 'audio-1'
    });

    expect(prisma.voice_sessions.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { session_id: 'session-1' }
    }));
    expect(prisma.voice_session_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        agent_id: 'agent-id',
        sequence: 5,
        role: 'assistant',
        content: 'Hi!',
        audio_id: 'audio-1',
        idempotency_key: 'session-1:5'
      })
    });
    expect(prisma.ai_agent_chat_history.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      id: 'voice-msg-5',
      session_id: 'session-1',
      sequence: 5
    }));
  });

  it('retries generated message sequence when concurrent reports race', async () => {
    const uniqueSequenceError = new Error('Unique constraint failed');
    uniqueSequenceError.code = 'P2002';
    uniqueSequenceError.meta = { target: ['session_id', 'sequence'] };

    prisma.voice_session_messages.findFirst
      .mockResolvedValueOnce({ sequence: 4 })
      .mockResolvedValueOnce({ sequence: 5 });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_messages.create
      .mockRejectedValueOnce(uniqueSequenceError)
      .mockResolvedValueOnce({
        id: 'voice-msg-6',
        session_id: 'session-1',
        sequence: 6
      });

    const result = await agentService.reportChatMessage({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      agentId: 'agent-id',
      sessionId: 'session-1',
      chatType: 1,
      content: 'Goodbye'
    });

    expect(prisma.voice_session_messages.create).toHaveBeenCalledTimes(2);
    expect(prisma.voice_session_messages.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        sequence: 5,
        idempotency_key: 'session-1:5'
      })
    });
    expect(prisma.voice_session_messages.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        sequence: 6,
        idempotency_key: 'session-1:6'
      })
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'voice-msg-6',
      sequence: 6
    }));
  });

  it('retries generated message sequence when Prisma exposes conflict as message text', async () => {
    const uniqueSequenceError = new Error('Unique constraint failed on the fields: (`session_id`, `sequence`)');

    prisma.voice_session_messages.findFirst
      .mockResolvedValueOnce({ sequence: 9 })
      .mockResolvedValueOnce({ sequence: 10 });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_messages.create
      .mockRejectedValueOnce(uniqueSequenceError)
      .mockResolvedValueOnce({
        id: 'voice-msg-11',
        session_id: 'session-1',
        sequence: 11
      });

    const result = await agentService.reportChatMessage({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      agentId: 'agent-id',
      sessionId: 'session-1',
      chatType: 2,
      content: 'Have a great day!'
    });

    expect(prisma.voice_session_messages.create).toHaveBeenCalledTimes(2);
    expect(prisma.voice_session_messages.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        sequence: 11,
        idempotency_key: 'session-1:11'
      })
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'voice-msg-11',
      sequence: 11
    }));
  });

  it('batch uploads session messages to voice_session_messages', async () => {
    prisma.voice_session_messages.findFirst.mockResolvedValue(null);
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-2' });
    prisma.voice_session_messages.createMany.mockResolvedValue({ count: 2 });

    const result = await agentService.batchUploadSession({
      macAddress: 'aa-bb-cc-dd-ee-ff',
      agentId: 'agent-id',
      sessionId: 'session-2',
      messages: [
        {
          chatType: 1,
          content: 'Hello',
          timestamp: '2026-04-22T08:01:00.000Z'
        },
        {
          chatType: 2,
          content: 'Hi!',
          audioId: 'audio-2',
          timestamp: '2026-04-22T08:02:00.000Z'
        }
      ]
    });

    expect(prisma.voice_sessions.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { session_id: 'session-2' }
    }));
    expect(prisma.voice_session_messages.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          session_id: 'session-2',
          sequence: 1,
          role: 'user',
          idempotency_key: 'session-2:1'
        }),
        expect.objectContaining({
          session_id: 'session-2',
          sequence: 2,
          role: 'assistant',
          audio_id: 'audio-2',
          idempotency_key: 'session-2:2'
        })
      ],
      skipDuplicates: true
    });
    expect(result).toEqual({
      sessionId: 'session-2',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      agentId: 'agent-id',
      insertedCount: 2
    });
  });
});
