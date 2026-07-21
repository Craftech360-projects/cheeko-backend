/**
 * RC reconciliation job unit tests (SUB-7): deriveExpected state mapping and
 * the drift-repair sweep (repair + [DRIFT] alert, no-drift no-op, missing
 * API key skip). No live DB, no HTTP — prisma and axios are mocked.
 */

const mockPrisma = {
  device_subscriptions: {
    findMany: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  subscription_plans: {
    findMany: jest.fn(),
  },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const logger = require('../../src/utils/logger');
const { runRcReconciliation, deriveExpected } = require('../../src/jobs/rcReconciliation');

const NOW = new Date('2026-07-21T00:00:00Z');
const MAC = 'AA:BB:CC:DD:EE:FF';

const rcSubscriber = (sub) => ({ subscriber: { subscriptions: { cheeko_family_monthly: sub } } });

const dbRow = (overrides = {}) => ({
  mac_address: MAC,
  status: 'active',
  plan_id: 2n,
  current_period_end: new Date('2026-08-01T00:00:00Z'),
  grace_until: null,
  cancel_at_period_end: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscription_plans.findMany.mockResolvedValue([
    { id: 2n, store_product_id: 'cheeko_family_monthly' },
  ]);
  process.env.REVENUECAT_API_KEY = 'sk_test';
});

afterEach(() => {
  delete process.env.REVENUECAT_API_KEY;
});

describe('deriveExpected', () => {
  test('future expiry → active with RC anchors', () => {
    const expected = deriveExpected(
      rcSubscriber({ purchase_date: '2026-07-01T00:00:00Z', expires_date: '2026-08-01T00:00:00Z' }).subscriber,
      NOW
    );
    expect(expected).toMatchObject({
      status: 'active',
      current_period_end: new Date('2026-08-01T00:00:00Z'),
      grace_until: null,
      product_id: 'cheeko_family_monthly',
    });
  });

  test('live store grace window → grace', () => {
    const expected = deriveExpected(
      rcSubscriber({
        expires_date: '2026-07-20T00:00:00Z',
        grace_period_expires_date: '2026-07-23T00:00:00Z',
      }).subscriber,
      NOW
    );
    expect(expected.status).toBe('grace');
    expect(expected.grace_until).toEqual(new Date('2026-07-23T00:00:00Z'));
  });

  test('expired without unsubscribe → lapsed; with unsubscribe → cancelled', () => {
    const base = { expires_date: '2026-07-01T00:00:00Z' };
    expect(deriveExpected(rcSubscriber(base).subscriber, NOW).status).toBe('lapsed');
    expect(
      deriveExpected(rcSubscriber({ ...base, unsubscribe_detected_at: '2026-06-20T00:00:00Z' }).subscriber, NOW).status
    ).toBe('cancelled');
  });

  test('no subscriptions at all → lapsed (hard drift)', () => {
    expect(deriveExpected({ subscriptions: {} }, NOW).status).toBe('lapsed');
    expect(deriveExpected(undefined, NOW).status).toBe('lapsed');
  });

  test('picks the subscription with the latest expiry across product changes', () => {
    const expected = deriveExpected(
      {
        subscriptions: {
          cheeko_starter_monthly: { expires_date: '2026-07-01T00:00:00Z' },
          cheeko_premium_monthly: { expires_date: '2026-08-15T00:00:00Z' },
        },
      },
      NOW
    );
    expect(expected.product_id).toBe('cheeko_premium_monthly');
    expect(expected.status).toBe('active');
  });
});

describe('runRcReconciliation', () => {
  test('skips entirely when REVENUECAT_API_KEY is unset', async () => {
    delete process.env.REVENUECAT_API_KEY;
    const result = await runRcReconciliation({ now: NOW });
    expect(result).toEqual({ checked: 0, repaired: 0, failed: 0 });
    expect(mockPrisma.device_subscriptions.findMany).not.toHaveBeenCalled();
  });

  test('agreeing row is left alone', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([dbRow()]);
    axios.get.mockResolvedValue({
      data: rcSubscriber({ purchase_date: '2026-07-01T00:00:00Z', expires_date: '2026-08-01T00:00:00Z' }),
    });
    const result = await runRcReconciliation({ now: NOW });
    expect(result).toEqual({ checked: 1, repaired: 0, failed: 0 });
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('desynced row is repaired and the [DRIFT] alert fires', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    // DB says active until August; RC says it expired July 10 — repair to lapsed.
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([dbRow()]);
    axios.get.mockResolvedValue({ data: rcSubscriber({ expires_date: '2026-07-10T00:00:00Z' }) });

    const result = await runRcReconciliation({ now: NOW });
    expect(result).toEqual({ checked: 1, repaired: 1, failed: 0 });
    expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith({
      where: { mac_address: MAC },
      data: expect.objectContaining({
        status: 'lapsed',
        current_period_end: new Date('2026-07-10T00:00:00Z'),
        grace_until: null,
      }),
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[RC-RECONCILE][DRIFT]'));
    errorSpy.mockRestore();
  });

  test('plan drift alone is detected and repairs plan_id via store_product_id', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([dbRow({ plan_id: 1n })]);
    axios.get.mockResolvedValue({
      data: rcSubscriber({ purchase_date: '2026-07-01T00:00:00Z', expires_date: '2026-08-01T00:00:00Z' }),
    });
    mockPrisma.subscription_plans.findMany.mockResolvedValue([
      { id: 3n, store_product_id: 'cheeko_family_monthly' },
    ]);

    const result = await runRcReconciliation({ now: NOW });
    expect(result.repaired).toBe(1);
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data.plan_id).toBe(3n);
    expect(call.data.status).toBe('active');
  });

  test('app-layer grace is respected: RC plain expiry does not lapse a running grace window', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([
      dbRow({ status: 'grace', grace_until: new Date('2026-07-23T00:00:00Z') }),
    ]);
    axios.get.mockResolvedValue({ data: rcSubscriber({ expires_date: '2026-07-19T00:00:00Z' }) });

    const result = await runRcReconciliation({ now: NOW });
    expect(result.repaired).toBe(0);
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('a missed CANCELLATION webhook is repaired via unsubscribe_detected_at', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([dbRow()]);
    axios.get.mockResolvedValue({
      data: rcSubscriber({
        purchase_date: '2026-07-01T00:00:00Z',
        expires_date: '2026-08-01T00:00:00Z',
        unsubscribe_detected_at: '2026-07-15T00:00:00Z',
      }),
    });

    const result = await runRcReconciliation({ now: NOW });
    expect(result.repaired).toBe(1);
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: 'active', cancel_at_period_end: true });
  });

  test('hard drift (RC has no subscription) lapses without nulling anchors', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([dbRow()]);
    axios.get.mockResolvedValue({ data: { subscriber: { subscriptions: {} } } });

    const result = await runRcReconciliation({ now: NOW });
    expect(result.repaired).toBe(1);
    const call = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('lapsed');
    expect(call.data).not.toHaveProperty('current_period_end');
    expect(call.data).not.toHaveProperty('current_period_start');
  });

  test('one unreachable subscriber does not kill the sweep', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([
      dbRow(),
      dbRow({ mac_address: '11:22:33:44:55:66' }),
    ]);
    axios.get
      .mockRejectedValueOnce(new Error('rc down'))
      .mockResolvedValueOnce({ data: rcSubscriber({ expires_date: '2026-07-10T00:00:00Z' }) });

    const result = await runRcReconciliation({ now: NOW });
    expect(result).toEqual({ checked: 2, repaired: 1, failed: 1 });
  });
});
