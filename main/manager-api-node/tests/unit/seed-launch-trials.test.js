/**
 * SUB-13 launch seed script: dry-run default, seeds only uncovered bound MACs,
 * and the coverage gate fails the process when a bound MAC is left uncovered.
 */

const mockPrisma = {
  ai_device: { findMany: jest.fn() },
  device_subscriptions: { findMany: jest.fn() },
  $disconnect: jest.fn(),
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const mockEnsureTrial = jest.fn();
jest.mock('../../src/services/subscription.service', () => ({
  ensureTrialForMac: (...a) => mockEnsureTrial(...a),
}));

const { main } = require('../../scripts/seed-launch-trials');

const BOUND = [
  { mac_address: 'AA:BB:CC:DD:EE:01', user_id: 1n },
  { mac_address: 'AA:BB:CC:DD:EE:02', user_id: 2n },
];

const argvWith = (...extra) => ['node', 'seed-launch-trials.js', ...extra];

describe('seed-launch-trials', () => {
  let argv;
  beforeEach(() => {
    jest.clearAllMocks();
    argv = process.argv;
    process.exitCode = undefined;
    mockPrisma.ai_device.findMany.mockResolvedValue(BOUND);
    mockEnsureTrial.mockImplementation(async (mac) => ({ mac_address: mac }));
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
  });

  test('dry run (default) writes nothing', async () => {
    process.argv = argvWith();
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([]);
    await main();
    expect(mockEnsureTrial).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('--apply seeds only bound MACs without a row; devices with rows untouched', async () => {
    process.argv = argvWith('--apply');
    // Device 01 already has a row (e.g. an active store sub); after seeding both exist.
    mockPrisma.device_subscriptions.findMany
      .mockResolvedValueOnce([{ mac_address: 'AA:BB:CC:DD:EE:01' }])
      .mockResolvedValueOnce([
        { mac_address: 'AA:BB:CC:DD:EE:01' },
        { mac_address: 'AA:BB:CC:DD:EE:02' },
      ]);
    await main();
    expect(mockEnsureTrial).toHaveBeenCalledTimes(1);
    expect(mockEnsureTrial).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02', 2n);
    expect(process.exitCode).toBeUndefined(); // coverage OK
  });

  test('--apply fails the coverage gate when a bound MAC is still uncovered', async () => {
    process.argv = argvWith('--apply');
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([]); // before AND after: nothing lands
    mockEnsureTrial.mockResolvedValue(null); // invalid MAC path
    await main();
    expect(process.exitCode).toBe(1);
  });
});
