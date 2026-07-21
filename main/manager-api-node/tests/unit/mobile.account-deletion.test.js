/**
 * Account deletion × subscriptions (SUB-7): store subscriptions cannot be
 * cancelled server-side, so deletion marks live rows cancel_at_period_end
 * and returns store-cancel instructions. No live DB — prisma is mocked.
 */

const mockPrisma = {
  sys_user: { findUnique: jest.fn(), delete: jest.fn() },
  kid_profile: { deleteMany: jest.fn() },
  parent_profile: { deleteMany: jest.fn() },
  ai_device: { deleteMany: jest.fn(), findMany: jest.fn() },
  device_subscriptions: { updateMany: jest.fn() },
  // Array-form transaction: resolve the already-invoked operation results.
  $transaction: jest.fn((ops) => Promise.all(ops)),
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { deleteUserAccount } = require('../../src/services/mobile.service');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.sys_user.findUnique.mockResolvedValue({ id: 7n });
  mockPrisma.ai_device.findMany.mockResolvedValue([{ mac_address: 'AA:BB:CC:DD:EE:FF' }]);
  mockPrisma.$transaction.mockImplementation((ops) => Promise.all(ops));
});

describe('deleteUserAccount (SUB-7)', () => {
  test('marks live subscriptions (by payer or bound device) inside the delete transaction', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
    const result = await deleteUserAccount('firebase-uid-1');

    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['active', 'grace'] },
        OR: [{ user_id: 7n }, { mac_address: { in: ['AA:BB:CC:DD:EE:FF'] } }],
      },
      data: expect.objectContaining({ cancel_at_period_end: true }),
    });
    // Marking rides the same $transaction as the deletes — a failed deletion
    // must not leave a surviving account flagged.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.subscription_notice).toMatch(/cancel the subscription in your store settings/i);
  });

  test('no live subscription → no notice', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteUserAccount('firebase-uid-1');
    expect(result.success).toBe(true);
    expect(result.subscription_notice).toBeUndefined();
  });
});
