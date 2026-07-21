/**
 * RevenueCat service unit tests (SUB-15): webhook auth compare, idempotent
 * ledger (transactional), INITIAL_PURCHASE/RENEWAL activation with the
 * forward-only anchor guard, unknown-product refusal, guarded EXPIRATION,
 * plan mapping by store_product_id, and the ledger-only default.
 */

const mockPrisma = {
  device_subscriptions: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  subscription_plans: {
    findFirst: jest.fn(),
  },
  subscription_events: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};
// Interactive transaction: run the callback against the same mock client.
mockPrisma.$transaction = jest.fn((fn) => fn(mockPrisma));
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
  mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ plan_id: 1n });
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
  test('ledgers with the rc: prefixed id, processed_at, and skipDuplicates inside a transaction', async () => {
    await service.processWebhookEvent(rcEvent());
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subscription_events.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          razorpay_event_id: 'rc:evt_rc_1',
          event_type: 'INITIAL_PURCHASE',
          mac_address: MAC,
          processed_at: expect.any(Date),
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

  test('a failed transition propagates so the transaction rolls the ledger row back', async () => {
    mockPrisma.device_subscriptions.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.processWebhookEvent(rcEvent())).rejects.toThrow('db down');
  });
});

describe('INITIAL_PURCHASE / RENEWAL → active', () => {
  test.each(['INITIAL_PURCHASE', 'RENEWAL'])('%s activates with store period anchors', async (type) => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ type }));
    expect(outcome).toBe('processed');

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

  test('no existing row (webhook beat the bind) creates one', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    const { outcome } = await service.processWebhookEvent(rcEvent());
    expect(outcome).toBe('processed');
    expect(mockPrisma.device_subscriptions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mac_address: MAC, status: 'active', plan_id: 2n }),
    });
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('stale event rejected by the guard is ledgered, not applied blind', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });
    const { outcome } = await service.processWebhookEvent(rcEvent({ type: 'RENEWAL' }));
    expect(outcome).toBe('ledgered');
  });

  test('missing purchased_at_ms is never applied (guard cannot run)', async () => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ purchased_at_ms: undefined }));
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.device_subscriptions.create).not.toHaveBeenCalled();
  });

  test('unknown product_id keeps the existing plan when the row has one', async () => {
    mockPrisma.subscription_plans.findFirst.mockResolvedValue(null);
    await service.processWebhookEvent(rcEvent());
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data.plan_id).toBeUndefined();
    expect(call.data.status).toBe('active');
  });

  test('unknown product_id with no existing plan refuses to activate (no fail-open)', async () => {
    mockPrisma.subscription_plans.findFirst.mockResolvedValue(null);
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    const { outcome } = await service.processWebhookEvent(rcEvent());
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.create).not.toHaveBeenCalled();
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('store values pass through lowercased and never overwrite with null', async () => {
    await service.processWebhookEvent(rcEvent({ store: 'PLAY_STORE' }));
    expect(mockPrisma.device_subscriptions.updateMany.mock.calls[0][0].data.store).toBe('play_store');

    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ plan_id: 1n });
    mockPrisma.subscription_plans.findFirst.mockResolvedValue({ id: 2n });
    await service.processWebhookEvent(rcEvent({ id: 'evt_rc_2', store: 'PROMOTIONAL' }));
    expect(mockPrisma.device_subscriptions.updateMany.mock.calls[0][0].data.store).toBe('promotional');

    await service.processWebhookEvent(rcEvent({ id: 'evt_rc_3', store: undefined }));
    expect(mockPrisma.device_subscriptions.updateMany.mock.calls[1][0].data.store).toBeUndefined();
  });

  test('invalid app_user_id (not a MAC) is ledgered only', async () => {
    const { outcome } = await service.processWebhookEvent(rcEvent({ app_user_id: 'anonymous-xyz' }));
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });
});

describe('ledger-only default', () => {
  test.each(['BILLING_ISSUE', 'TRANSFER', 'PRODUCT_CHANGE', 'SOME_FUTURE_TYPE'])(
    '%s is ledgered without transition',
    async (type) => {
      const { outcome } = await service.processWebhookEvent(rcEvent({ type }));
      expect(outcome).toBe('ledgered');
      expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
    }
  );
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

  test('EXPIRATION lapses the row with a period-end guard', async () => {
    await service.processWebhookEvent(rcEvent({ type: 'EXPIRATION' }));
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: 'lapsed' });
    expect(call.where.OR).toEqual([
      { current_period_end: null },
      { current_period_end: { lte: new Date(1755378400000) } },
    ]);
  });

  test('stale EXPIRATION rejected by the guard is ledgered', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });
    const { outcome } = await service.processWebhookEvent(rcEvent({ type: 'EXPIRATION' }));
    expect(outcome).toBe('ledgered');
  });

  test('EXPIRATION without any timestamp is ledgered, not applied blind', async () => {
    const { outcome } = await service.processWebhookEvent(
      rcEvent({ type: 'EXPIRATION', expiration_at_ms: undefined, event_timestamp_ms: undefined })
    );
    expect(outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });
});
