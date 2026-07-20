/**
 * Razorpay service unit tests (SUB-6): webhook signature verification, the
 * idempotent event ledger, activation/charge transitions incl. the
 * webhook-before-checkout race and out-of-order delivery, and checkout's
 * "never touch status" contract.
 */

const crypto = require('crypto');

const mockPrisma = {
  device_subscriptions: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  subscription_plans: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  subscription_events: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const mockAxios = { post: jest.fn(), get: jest.fn() };
jest.mock('axios', () => mockAxios);

const service = require('../../src/services/razorpay.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const { normalizeMacAddress } = require('../../src/utils/helpers');

const SECRET = 'whsec-test';
const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

const subEntity = (overrides = {}) => ({
  id: 'sub_123',
  entity: 'subscription',
  plan_id: 'plan_family',
  customer_id: 'cust_123',
  status: 'active',
  current_start: 1752700000,
  current_end: 1755378400,
  notes: { mac_address: MAC },
  ...overrides,
});

const webhookBody = (event, entity) => ({
  event,
  payload: { subscription: { entity } },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription_events.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription_plans.findFirst.mockResolvedValue({ id: 2n });
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp-secret';
});

afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

describe('verifyWebhookSignature', () => {
  test('accepts the correct HMAC of the raw body', () => {
    const raw = Buffer.from('{"event":"subscription.activated"}');
    expect(service.verifyWebhookSignature(raw, sign(raw))).toBe(true);
  });

  test('rejects a wrong signature', () => {
    const raw = Buffer.from('{"event":"subscription.activated"}');
    expect(service.verifyWebhookSignature(raw, 'deadbeef')).toBe(false);
  });

  test('rejects a signature for a different body', () => {
    const raw = Buffer.from('{"a":1}');
    expect(service.verifyWebhookSignature(Buffer.from('{"a":2}'), sign(raw))).toBe(false);
  });

  test('rejects when the secret is unset', () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const raw = Buffer.from('x');
    expect(service.verifyWebhookSignature(raw, sign(raw))).toBe(false);
  });
});

describe('processWebhookEvent — ledger idempotency', () => {
  test('replayed event id is a no-op: no state write, outcome duplicate', async () => {
    mockPrisma.subscription_events.createMany.mockResolvedValue({ count: 0 });

    const result = await service.processWebhookEvent(
      'evt_dup',
      webhookBody('subscription.activated', subEntity())
    );

    expect(result.outcome).toBe('duplicate');
    expect(mockPrisma.device_subscriptions.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('ledger row carries event id, type, mac and subscription id', async () => {
    await service.processWebhookEvent(
      'evt_1',
      webhookBody('subscription.activated', subEntity())
    );

    const row = mockPrisma.subscription_events.createMany.mock.calls[0][0].data[0];
    expect(row.razorpay_event_id).toBe('evt_1');
    expect(row.event_type).toBe('subscription.activated');
    expect(row.mac_address).toBe(normalizeMacAddress(MAC));
    expect(row.razorpay_subscription_id).toBe('sub_123');
  });
});

describe('processWebhookEvent — activation', () => {
  test('activated sets status=active with the period anchored to the billing date', async () => {
    const entity = subEntity();
    await service.processWebhookEvent('evt_2', webhookBody('subscription.activated', entity));

    const update = mockPrisma.device_subscriptions.updateMany.mock.calls.find(
      ([args]) => args.data.status === 'active'
    )[0];
    expect(update.data.current_period_start).toEqual(new Date(entity.current_start * 1000));
    expect(update.data.current_period_end).toEqual(new Date(entity.current_end * 1000));
    expect(update.data.plan_id).toBe(2n);
    expect(update.data.grace_until).toBeNull();
  });

  test('activated before checkout wrote anything still lands (upsert creates the row)', async () => {
    await service.processWebhookEvent('evt_3', webhookBody('subscription.activated', subEntity()));

    const upsert = mockPrisma.device_subscriptions.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ mac_address: normalizeMacAddress(MAC) });
    expect(upsert.create.status).toBe('active');
    expect(upsert.create.razorpay_subscription_id).toBe('sub_123');
    // update is {} — the guarded updateMany right after does the real write,
    // so an existing row is never blind-overwritten by the upsert itself.
    expect(upsert.update).toEqual({});
  });

  test('stale event (period guard rejects) re-fetches live state and derives', async () => {
    // updateMany count 0 = the row has a newer period anchor than the event.
    mockPrisma.device_subscriptions.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guarded write rejected
      .mockResolvedValue({ count: 1 }); // unguarded write from live state
    mockAxios.get.mockResolvedValue({ data: subEntity({ status: 'active' }) });

    await service.processWebhookEvent('evt_4', webhookBody('subscription.activated', subEntity()));

    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/subscriptions/sub_123',
      expect.anything()
    );
  });

  test('live state that is not active applies no transition (SUB-7 scope)', async () => {
    mockPrisma.device_subscriptions.updateMany.mockResolvedValueOnce({ count: 0 });
    mockAxios.get.mockResolvedValue({ data: subEntity({ status: 'cancelled' }) });

    await service.processWebhookEvent('evt_5', webhookBody('subscription.charged', subEntity()));

    // one guarded attempt, then only the ledger processed_at update — no forced write
    const activeWrites = mockPrisma.device_subscriptions.updateMany.mock.calls.filter(
      ([args]) => args.data?.status === 'active'
    );
    expect(activeWrites).toHaveLength(1);
  });

  test('charged advances the period like activated', async () => {
    const entity = subEntity({ current_start: 1755378400, current_end: 1758056800 });
    await service.processWebhookEvent('evt_6', webhookBody('subscription.charged', entity));

    const update = mockPrisma.device_subscriptions.updateMany.mock.calls.find(
      ([args]) => args.data.status === 'active'
    )[0];
    expect(update.data.current_period_start).toEqual(new Date(entity.current_start * 1000));
    // guard: anchors only move forward
    expect(update.where.OR).toEqual([
      { current_period_start: null },
      { current_period_start: { lte: new Date(entity.current_start * 1000) } },
    ]);
  });

  test('authenticated stores razorpay ids without changing status', async () => {
    await service.processWebhookEvent(
      'evt_7',
      webhookBody('subscription.authenticated', subEntity({ status: 'authenticated' }))
    );

    const [args] = mockPrisma.device_subscriptions.updateMany.mock.calls[0];
    expect(args.data.razorpay_subscription_id).toBe('sub_123');
    expect(args.data.status).toBeUndefined();
    expect(mockPrisma.device_subscriptions.upsert).not.toHaveBeenCalled();
  });

  test('unhandled lifecycle events are ledgered only', async () => {
    const result = await service.processWebhookEvent(
      'evt_8',
      webhookBody('subscription.halted', subEntity({ status: 'halted' }))
    );

    expect(result.outcome).toBe('ledgered');
    expect(mockPrisma.device_subscriptions.upsert).not.toHaveBeenCalled();
  });
});

describe('createCheckout', () => {
  const plan = {
    id: 2n,
    tier: 'family',
    name: 'Family',
    price_inr: 499,
    is_active: true,
    razorpay_plan_id: 'plan_family',
  };

  beforeEach(() => {
    mockPrisma.subscription_plans.findUnique.mockResolvedValue(plan);
    mockAxios.post
      .mockResolvedValueOnce({ data: { id: 'cust_9' } })
      .mockResolvedValueOnce({ data: { id: 'sub_9' } });
  });

  test('creates customer + subscription and returns checkout params', async () => {
    const result = await service.createCheckout(MAC, 42, 'family', {
      name: 'Parent',
      email: 'p@example.com',
    });

    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    const [, subBody] = mockAxios.post.mock.calls[1];
    expect(subBody.plan_id).toBe('plan_family');
    expect(subBody.total_count).toBe(service.SUBSCRIPTION_TOTAL_COUNT);
    expect(subBody.notes.mac_address).toBe(normalizeMacAddress(MAC));

    expect(result.razorpay_subscription_id).toBe('sub_9');
    expect(result.key_id).toBe('rzp_test_key');
    expect(result.plan.tier).toBe('family');
  });

  test('records the pending purchase without touching status or period', async () => {
    await service.createCheckout(MAC, 42, 'family');

    const upsert = mockPrisma.device_subscriptions.upsert.mock.calls[0][0];
    expect(upsert.update.status).toBeUndefined();
    expect(upsert.update.current_period_start).toBeUndefined();
    expect(upsert.update.razorpay_subscription_id).toBe('sub_9');
    expect(upsert.update.user_id).toBe(42n);
  });

  test('rejects an unknown or inactive tier with a 400', async () => {
    mockPrisma.subscription_plans.findUnique.mockResolvedValue(null);
    await expect(service.createCheckout(MAC, 42, 'gold')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test('rejects a plan with no razorpay_plan_id with a 503', async () => {
    mockPrisma.subscription_plans.findUnique.mockResolvedValue({
      ...plan,
      razorpay_plan_id: null,
    });
    await expect(service.createCheckout(MAC, 42, 'family')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  test('rejects when Razorpay keys are unset with a 503', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    await expect(service.createCheckout(MAC, 42, 'family')).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
