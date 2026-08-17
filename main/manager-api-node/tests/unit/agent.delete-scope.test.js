/**
 * Deleting an agent is scoped to the requesting account.
 *
 * The user id was accepted and thrown away — the parameter was literally named
 * `_userId` and the doc comment said so — which made possession of an agent id
 * sufficient authority to run the most destructive call in the mobile API
 * against somebody else's account: it unbinds every device attached to the agent
 * and clears the child from each one. An agent id is a UUID, but a UUID is not a
 * secret; it is handed to the client on every bind.
 */

const mockFindUnique = jest.fn();
const mockDeviceUpdateMany = jest.fn();
const mockAgentDelete = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_agent: {
      findUnique: (...a) => mockFindUnique(...a),
      delete: (...a) => mockAgentDelete(...a),
    },
    ai_device: { updateMany: (...a) => mockDeviceUpdateMany(...a) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const agentService = require('../../src/services/agent.service');

const AGENT = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceUpdateMany.mockResolvedValue({ count: 0 });
  mockAgentDelete.mockResolvedValue({});
});

describe('deleteAgent', () => {
  it('scopes the lookup to the calling account', async () => {
    mockFindUnique.mockResolvedValue({ id: AGENT, user_id: 6n });

    await agentService.deleteAgent(AGENT, 6);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: AGENT, user_id: 6n },
    });
    expect(mockAgentDelete).toHaveBeenCalled();
  });

  it('refuses an agent belonging to another account, and touches nothing', async () => {
    // The scoped lookup finds nothing, which is what "not yours" looks like.
    mockFindUnique.mockResolvedValue(null);

    await expect(agentService.deleteAgent(AGENT, 999)).rejects.toThrow('Agent not found');

    // The important half: no devices were unbound and no children unpaired on
    // the way to discovering it was not theirs.
    expect(mockDeviceUpdateMany).not.toHaveBeenCalled();
    expect(mockAgentDelete).not.toHaveBeenCalled();
  });

  it('says "not found" rather than "not yours", so ids cannot be probed', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(agentService.deleteAgent(AGENT, 999)).rejects.toThrow(/not found/i);
    await expect(agentService.deleteAgent(AGENT, 999)).rejects.not.toThrow(/permission|yours|another/i);
  });

  it('requires a user at all', async () => {
    await expect(agentService.deleteAgent(AGENT, null)).rejects.toThrow(/user is required/i);

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockDeviceUpdateMany).not.toHaveBeenCalled();
  });

  it('lets a super admin through unscoped', async () => {
    mockFindUnique.mockResolvedValue({ id: AGENT, user_id: 6n });

    await agentService.deleteAgent(AGENT, 999, true);

    // No user_id predicate: the operator asked deliberately, the same shape
    // unbindDevice already uses.
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: AGENT } });
    expect(mockAgentDelete).toHaveBeenCalled();
  });
});
