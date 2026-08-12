/**
 * Whose conversations are these?
 *
 * The bootstrap replays recent messages, sessions and summaries into the prompt.
 * Scoped by MAC, a child who changed toys lost all of it and a sibling on a
 * hand-me-down had the previous child's conversations read back to them.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn() },
    ai_agent: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'agent-id', agent_name: 'Cheeko', system_prompt: '', language: 'English',
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

const bootstrapFor = async (kidId) => {
  prisma.ai_device.findUnique.mockResolvedValue({
    id: 'device-id', user_id: 1n, mac_address: MAC, agent_id: 'agent-id',
    kid_id: kidId, mode: 'conversation', device_mode: 'manual',
    app_version: '1.0', last_connected_at: new Date(),
  });
  await agentService.getDeviceBootstrap(MAC, { includeMemories: false, recentLimit: 5 });
};

const whereOf = (mockFn) => mockFn.mock.calls[0][0].where;

beforeEach(() => jest.clearAllMocks());

describe('a paired device reads its child', () => {
  it('scopes sessions, messages and summaries to the child, never the MAC', async () => {
    await bootstrapFor(77n);

    expect(whereOf(prisma.voice_sessions.findMany).kid_id).toBe(77n);
    expect(whereOf(prisma.voice_sessions.findMany).mac_address).toBeUndefined();

    // Messages and summaries have no child column; they are reached through the
    // session, which is the thing that carries the child.
    expect(whereOf(prisma.voice_session_messages.findMany).voice_sessions.kid_id).toBe(77n);
    expect(whereOf(prisma.voice_session_summaries.findMany).voice_sessions.kid_id).toBe(77n);
    expect(whereOf(prisma.voice_session_summaries.findMany).mac_address).toBeUndefined();
  });
});

describe('an unpaired device falls back to its own MAC', () => {
  it('requires the session to have no child, so a sibling inherits nothing', async () => {
    await bootstrapFor(null);

    const sessions = whereOf(prisma.voice_sessions.findMany);
    expect(sessions.mac_address).toBe(MAC);
    // Without this, a toy handed on before the parent picks a child would replay
    // the previous child's conversations. The guard is in the where clause.
    expect(sessions.kid_id).toBeNull();

    expect(whereOf(prisma.voice_session_messages.findMany).voice_sessions).toEqual({
      mac_address: MAC, kid_id: null,
    });
  });
});
