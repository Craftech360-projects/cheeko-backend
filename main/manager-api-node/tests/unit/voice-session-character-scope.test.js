/**
 * Which character's conversations are these?
 *
 * The bootstrap filters on the device's default agent. Once the worker started
 * stamping the character that actually spoke, that default stopped matching the
 * running session — a Quizzy bootstrap hydrated from Cheeko's messages. The
 * caller names the character it is running instead.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn() },
    ai_agent: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cheeko-id', agent_name: 'Cheeko', system_prompt: '', language: 'English',
      }),
    },
    kid_profile: { findUnique: jest.fn().mockResolvedValue(null) },
    voice_sessions: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    voice_session_messages: { findMany: jest.fn().mockResolvedValue([]) },
    voice_session_summaries: { findMany: jest.fn().mockResolvedValue([]) },
    device_memory_documents: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { prisma } = require('../../src/config/database');
const agentService = require('../../src/services/agent.service');

const MAC = 'AA:BB:CC:DD:EE:FF';

const bootstrapWith = async (options) => {
  prisma.ai_device.findUnique.mockResolvedValue({
    id: 'device-id', user_id: 1n, mac_address: MAC, agent_id: 'cheeko-id',
    kid_id: 77n, mode: 'conversation', device_mode: 'manual',
    app_version: '1.0', last_connected_at: new Date(),
  });
  await agentService.getDeviceBootstrap(MAC, { includeMemories: false, recentLimit: 5, ...options });
};

const whereOf = (mockFn) => mockFn.mock.calls[0][0].where;

beforeEach(() => jest.clearAllMocks());

describe('the caller names the running character', () => {
  it('replays that character, not the toy\'s default', async () => {
    await bootstrapWith({ agentId: 'quizzy-id' });

    expect(whereOf(prisma.voice_session_messages.findMany).agent_id).toBe('quizzy-id');
    expect(whereOf(prisma.voice_sessions.findMany).agent_id).toBe('quizzy-id');
    expect(whereOf(prisma.voice_session_summaries.findMany).voice_sessions.agent_id).toBe('quizzy-id');
  });
});

describe('no character named', () => {
  it('keeps the device default, so callers that never sent one do not change', async () => {
    await bootstrapWith({});

    expect(whereOf(prisma.voice_session_messages.findMany).agent_id).toBe('cheeko-id');
    expect(whereOf(prisma.voice_sessions.findMany).agent_id).toBe('cheeko-id');
    expect(whereOf(prisma.voice_session_summaries.findMany).voice_sessions.agent_id).toBe('cheeko-id');
  });
});
