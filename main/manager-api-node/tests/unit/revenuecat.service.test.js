/**
 * RevenueCat service unit tests (SUB-15): webhook auth compare, idempotent
 * ledger, INITIAL_PURCHASE/RENEWAL activation with the forward-only anchor
 * guard, plan mapping by store_product_id, and the ledger-only default.
 */

const mockPrisma = {
  device_subscriptions: {
    upsert: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  subscription_plans: {
    findFirst: jest.fn(),
  },
  subscription_events: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/revenuecat.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const AUTH = 'rc-webhook-secret';

const rcEvent = (overrides = {}) => ({
  id: 'evt_rc_1',
  type: 'INITIAL_PURCHASE',
  app_user_id: MAC,
  product_id: 'cheeko_family_monthly',
  purchased_at_ms: 1752700000000,
  expiration_at_ms: 1755378400000,
  store: 'APP_STORE',
  original_transaction_id: 'txn_1',
  environment: 'SANDBOX',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription_events.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription_plans.findFirst.mockResolvedValue({ id: 2n });
  process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
});

afterEach(() => {
  delete process.env.REVENUECAT_WEBHOOK_AUTH;
});

describe('verifyWebhookAuth', () => {
  test('accepts the exact configured value', () => {
    expect(service.verifyWebhookAuth(AUTH)).toBe(true);
  });
  test('rejects a wrong value', () => {
    expect(service.verifyWebhookAuth('nope')).toBe(false);
  });
  test('rejects when unset or header missing', () => {
    expect(service.verifyWebhookAuth(undefined)).toBe(false);
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect(service.verifyWebhookAuth(AUTH)).toBe(false);
  });
});

describe('processWebhookEvent — ledger', () => {
  test('ledgers with the rc: prefixed id and skipDuplicates', async () => {
    await service.processWebhookEvent(rcEvent());
    expect(mockPrisma.subscription_events.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          razorpay_event_id: 'rc:evt_rc_1',
          event_type: 'INITIAL_PURCHASE',
          mac_address: MAC,
        }),
      ],
      skipDuplicates: true,
    });
  });

  test('duplicate event id is a no-op', async () => {
    mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 0 });
    const { outcome } = await service.processWebhookEvent(rcEvent());
    expect(outcome).toBe('duplicate');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });
});

describe('INITIAL_PURCHASE / RENEWAL → active', () => {
  test.each(['INITIAL_PURCHASE', 'RENEWAL'])('%s activates with store period anchors', async (type) => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ type }));
    expect(outcome).toBe('processed');

    // Upsert first: webhook-before-bind still lands a row.
    expect(mockPrisma.device_subscriptions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mac_address: MAC } })
    );

    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({
      status: 'active',
      current_period_start: new Date(1752700000000),
      current_period_end: new Date(1755378400000),
      store: 'app_store',
      rc_original_transaction_id: 'txn_1',
      plan_id: 2n,
      grace_until: null,
      cancel_at_period_end: false,
    });
    // Forward-only anchor guard present.
    expect(call.where.OR).toEqual([
      { current_period_start: null },
      { current_period_start: { lte: new Date(1752700000000) } },
    ]);
  });

  test('stale event rejected by the guard is ledgered, not applied blind', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });
    const { outcome } = await service.processWebhookEvent(rcEvent({ type: 'RENEWAL' }));
    expect(outcome).toBe('ledgered');
  });

  test('unknown product_id keeps the existing plan', async () => {
    mockPrisma.subscription_plans.findFirst.mockResolvedValue(null);
    await service.processWebhookEvent(rcEvent());
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data.plan_id).toBeUndefined();
  });

  test('PLAY_STORE maps to play_store', async () => {
    await service.processWebhookEvent(rcEvent({ store: 'PLAY_STORE' }));
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data.store).toBe('play_store');
  });

  test('invalid app_user_id (not a MAC) is ledgered only', async () => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ app_user_id: 'anonymous-xyz' }));
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });
});

describe('ledger-only default', () => {
  test.each(['BILLING_ISSUE', 'TRANSFER', 'SOME_FUTURE_TYPE'])('%s is ledgered without transition', async (type) => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ type }));
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });
});

describe('lifecycle transitions', () => {
  test('CANCELLATION sets cancel_at_period_end only', async () => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ type: 'CANCELLATION' }));
    expect(outcome).toBe('processed');
    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: { mac_address: MAC },
      data: expect.objectContaining({ cancel_at_period_end: true }),
    });
    const data = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
  });

  test('UNCANCELLATION clears cancel_at_period_end', async () => {
    await service.processWebhookEvent(rcEvent({ type: 'UNCANCELLATION' }));
    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: { mac_address: MAC },
      data: expect.objectContaining({ cancel_at_period_end: false }),
    });
  });

  test('PRODUCT_CHANGE swaps plan_id by new_product_id', async () => {
    mockPrisma.subscription_plans.findFirst.mockResolvedValue({ id: 3n });
    const { outcome } = await service.processWebhookEvent(
      rcEvent({ type: 'PRODUCT_CHANGE', new_product_id: 'cheeko_premium_monthly' })
    );
    expect(outcome).toBe('processed');
    expect(mockPrisma.subscription_plans.findFirst).toHaveBeenCalledWith({
      where: { store_product_id: 'cheeko_premium_monthly' },
      select: { id: true },
    });
    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: { mac_address: MAC },
      data: expect.objectContaining({ plan_id: 3n }),
    });
  });

  test('PRODUCT_CHANGE to an unknown product is ledgered, no swap', async () => {
    mockPrisma.subscription_plans.findFirst.mockResolvedValue(null);
    const { outcome } = await service.processWebhookEvent(
      rcEvent({ type: 'PRODUCT_CHANGE', new_product_id: 'unknown_product' })
    );
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('EXPIRATION lapses the row', async () => {
    await service.processWebhookEvent(rcEvent({ type: 'EXPIRATION' }));
    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: { mac_address: MAC },
      data: expect.objectContaining({ status: 'lapsed' }),
    });
  });
});
