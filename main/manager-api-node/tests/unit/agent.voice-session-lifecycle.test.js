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
      device_memory_documents: {
        findFirst: jest.fn(),
        upsert: jest.fn()
      },
      device_memory_chunks: {
        deleteMany: jest.fn(),
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

  // The rolling memory document was never read by the prompt (picoclaw reads
  // MEMORY.md), so session end and summary saves no longer write one.
  const expectNoMemoryDocumentWrites = () => {
    expect(prisma.device_memory_documents.upsert).not.toHaveBeenCalled();
    expect(prisma.device_memory_chunks.createMany).not.toHaveBeenCalled();
    expect(prisma.ai_agent.update).not.toHaveBeenCalled();
  };

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
    expect(result).toEqual({ session_id: 'session-1', status: 'ended' });
    expectNoMemoryDocumentWrites();
  });

  it('persists a session summary without writing rolling memory', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 77n
    });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.voice_session_summaries.upsert.mockResolvedValue({
      session_id: 'session-1',
      summary: 'Child likes robot stories.',
      source_message_count: 10,
      model: 'test-model',
      updated_at: new Date('2026-04-22T11:00:00.000Z')
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
        kid_id: 77n,
        summary: 'Child likes robot stories.',
        source_message_count: 10,
        model: 'test-model'
      }),
      update: expect.objectContaining({
        kid_id: 77n,
        summary: 'Child likes robot stories.',
        source_message_count: 10,
        model: 'test-model'
      })
    });
    expect(result).toEqual({
      sessionId: 'session-1',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      agentId: 'agent-id',
      summaryMemory: 'Child likes robot stories.'
    });
    expectNoMemoryDocumentWrites();
  });

  it('acknowledges saveMemory without storing anything', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({ agent_id: 'agent-id' });

    const result = await agentService.saveMemory('aa-bb-cc-dd-ee-ff', 'Rahul asked for an elephant song.');

    expect(result).toEqual({ agentId: 'agent-id', agentName: null, summaryMemory: null });
    expectNoMemoryDocumentWrites();
  });

  it('still rejects saveMemory for an unknown device', async () => {
    prisma.ai_device.findUnique.mockResolvedValue(null);

    await expect(agentService.saveMemory('aa-bb-cc-dd-ee-ff', 'x')).rejects.toThrow('Device or agent not found');
  });
});
