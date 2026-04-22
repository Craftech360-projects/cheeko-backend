describe('device token usage session persistence', () => {
  let prisma;
  let deviceService;

  beforeEach(() => {
    jest.resetModules();

    prisma = {
      ai_device: {
        findUnique: jest.fn()
      },
      voice_sessions: {
        upsert: jest.fn()
      },
      device_token_usage: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      device_token_usage_session: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      }
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));

    deviceService = require('../../src/services/device.service');
  });

  afterEach(() => {
    jest.dontMock('../../src/config/database');
    jest.dontMock('../../src/utils/logger');
  });

  it('writes exact per-session token usage and daily aggregate total tokens', async () => {
    prisma.ai_device.findUnique.mockResolvedValue({
      id: 'device-id',
      agent_id: 'agent-id',
      kid_id: 1n
    });
    prisma.voice_sessions.upsert.mockResolvedValue({ session_id: 'session-1' });
    prisma.device_token_usage_session.findUnique.mockResolvedValue(null);
    prisma.device_token_usage_session.create.mockResolvedValue({
      session_id: 'session-1',
      total_tokens: 5162
    });
    prisma.device_token_usage.findFirst.mockResolvedValue(null);
    prisma.device_token_usage.create.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      total_tokens: 5162
    });

    const result = await deviceService.recordTokenUsage({
      mac: 'aa-bb-cc-dd-ee-ff',
      sessionId: 'session-1',
      inputTokens: 2000,
      outputTokens: 3000,
      totalTokens: 5162,
      messageCount: 8,
      sessionDurationSeconds: 91.25
    });

    expect(prisma.voice_sessions.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { session_id: 'session-1' },
      create: expect.objectContaining({
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-id',
        agent_id: 'agent-id'
      })
    }));
    expect(prisma.device_token_usage_session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: 'session-1',
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-id',
        agent_id: 'agent-id',
        total_tokens: 5162,
        message_count: 8,
        session_duration_seconds: 91.25
      })
    });
    expect(prisma.device_token_usage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mac_address: 'AA:BB:CC:DD:EE:FF',
        session_id: 'session-1',
        total_tokens: 5162,
        message_count: 8
      })
    });
    expect(result.total_tokens).toBe(5162);
  });
});
