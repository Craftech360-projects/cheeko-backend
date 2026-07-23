const mockPrisma = {
  ai_device: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  device_subscriptions: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  subscription_plans: { findUnique: jest.fn() },
  subscription_admin_audit: { create: jest.fn(), findMany: jest.fn() },
  subscription_events: { groupBy: jest.fn(), findMany: jest.fn() },
  subscription_gate_hits: { groupBy: jest.fn(), findFirst: jest.fn() },
};
// $transaction(cb) runs the callback with the same mock as tx.
mockPrisma.$transaction = jest.fn((cb) => cb(mockPrisma));

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

// getDetail reuses the real metering helpers — mock them so the drawer's
// numbers come straight from subscription.service (no bucket math re-run here).
const mockSubService = {
  getSubscriptionSummary: jest.fn(),
  getSessionVerdict: jest.fn(),
  isEnforcementEnabled: jest.fn(() => true),
};
jest.mock('../../src/services/subscription.service', () => mockSubService);

const service = require('../../src/services/subscriptionAdmin.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const DAY_MS = 24 * 60 * 60 * 1000;

const baseRow = (over = {}) => ({
  mac_address: MAC,
  status: 'active',
  plan_id: 2n,
  trial_started_at: new Date('2026-06-01T00:00:00Z'),
  trial_ends_at: new Date('2026-07-01T00:00:00Z'),
  trial_used: true,
  current_period_start: new Date('2026-07-01T00:00:00Z'),
  current_period_end: new Date('2026-08-01T00:00:00Z'),
  grace_until: null,
  cancel_at_period_end: false,
  subscription_plans: { tier: 'family', name: 'Family', price_inr: 499 },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((cb) => cb(mockPrisma));
});

describe('compExtend', () => {
  test('active row extends current_period_end and writes an audit row', async () => {
    const row = baseRow();
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(row);
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.compExtend(MAC, 7, 'admin', 'goodwill');

    const updateArg = mockPrisma.device_subscriptions.update.mock.calls[0][0];
    expect(updateArg.data.current_period_end).toEqual(
      new Date(row.current_period_end.getTime() + 7 * DAY_MS)
    );
    const audit = mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data;
    expect(audit.admin_user).toBe('admin');
    expect(audit.action).toBe('comp_extend:7d');
    expect(audit.reason).toBe('goodwill');
    expect(audit.before_state.current_period_end).toEqual(row.current_period_end);
    expect(audit.after_state).toBeTruthy();
  });

  test('trial row extends trial_ends_at instead', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow({ status: 'trial' }));
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ status: 'trial', ...data }))
    );

    await service.compExtend(MAC, 3, 'admin');

    const updateArg = mockPrisma.device_subscriptions.update.mock.calls[0][0];
    expect(updateArg.data.trial_ends_at).toBeInstanceOf(Date);
    expect(updateArg.data.current_period_end).toBeUndefined();
  });

  test('unknown MAC 404s and writes no audit', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    await expect(service.compExtend(MAC, 7, 'admin')).rejects.toMatchObject({ statusCode: 404 });
    expect(mockPrisma.subscription_admin_audit.create).not.toHaveBeenCalled();
  });

  test('zero days is rejected', async () => {
    await expect(service.compExtend(MAC, 0, 'admin')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('regrantTrial', () => {
  test('sets a fresh trial window but leaves trial_used=true', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(
      baseRow({ status: 'lapsed', trial_used: true })
    );
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.regrantTrial(MAC, 14, 'admin', 'support gesture');

    const data = mockPrisma.device_subscriptions.update.mock.calls[0][0].data;
    expect(data.status).toBe('trial');
    expect(data.trial_used).toBe(true); // the permanent flag is never cleared
    expect(data.trial_ends_at.getTime() - data.trial_started_at.getTime()).toBe(14 * DAY_MS);
    expect(data.grace_until).toBeNull();

    const audit = mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data;
    expect(audit.action).toBe('trial_regrant:14d');
    expect(audit.before_state.status).toBe('lapsed');
  });

  test('repoints plan_id to the family plan when the row lost it', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow({ plan_id: null }));
    mockPrisma.subscription_plans.findUnique.mockResolvedValue({ id: 2n });
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.regrantTrial(MAC, 30, 'admin');

    expect(mockPrisma.subscription_plans.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tier: 'family' } })
    );
    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.plan_id).toBe(2n);
  });
});

describe('setCancelAtPeriodEnd (SUB-19)', () => {
  test('cancel=true sets the flag and audits cancel_set:on with the reason', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow());
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    const out = await service.setCancelAtPeriodEnd(MAC, true, 'admin', 'store desync');

    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.cancel_at_period_end).toBe(true);
    const audit = mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data;
    expect(audit.action).toBe('cancel_set:on');
    expect(audit.reason).toBe('store desync');
    expect(audit.before_state.cancel_at_period_end).toBe(false);
    expect(out.cancel_at_period_end).toBe(true);
  });

  test('cancel=false clears the flag and audits cancel_set:off', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow({ cancel_at_period_end: true }));
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.setCancelAtPeriodEnd(MAC, false, 'admin', 'parent changed mind');

    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.cancel_at_period_end).toBe(false);
    expect(mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data.action).toBe('cancel_set:off');
  });

  test('blank reason is rejected with 400 and nothing is written', async () => {
    await expect(service.setCancelAtPeriodEnd(MAC, true, 'admin', '  ')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscription_admin_audit.create).not.toHaveBeenCalled();
  });

  test('non-boolean cancel is rejected with 400', async () => {
    await expect(service.setCancelAtPeriodEnd(MAC, 'yes', 'admin', 'r')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('unknown MAC 404s', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    await expect(service.setCancelAtPeriodEnd(MAC, true, 'admin', 'r')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('setStatusOverride (SUB-19)', () => {
  test('forces lapsed, clears grace_until, audits with before/after', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(
      baseRow({ status: 'grace', grace_until: new Date('2026-07-25T00:00:00Z') })
    );
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.setStatusOverride(MAC, 'lapsed', 'admin', 'refund confirmed');

    const data = mockPrisma.device_subscriptions.update.mock.calls[0][0].data;
    expect(data.status).toBe('lapsed');
    expect(data.grace_until).toBeNull();
    const audit = mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data;
    expect(audit.action).toBe('status_override:lapsed');
    expect(audit.before_state.status).toBe('grace');
    expect(audit.after_state.status).toBe('lapsed');
  });

  test('reactivates a lapsed row to active', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow({ status: 'lapsed' }));
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.setStatusOverride(MAC, 'active', 'admin', 'missed RENEWAL webhook');

    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.status).toBe('active');
  });

  test('forcing trial with an ended trial window is refused (use re-grant)', async () => {
    // baseRow trial_ends_at is 2026-07-01, already past.
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow({ status: 'lapsed' }));

    await expect(service.setStatusOverride(MAC, 'trial', 'admin', 'r')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
  });

  test('forcing trial with a live trial window works', async () => {
    const future = new Date(Date.now() + 10 * DAY_MS);
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(
      baseRow({ status: 'lapsed', trial_ends_at: future })
    );
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.setStatusOverride(MAC, 'trial', 'admin', 'webhook lapsed it wrongly');

    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.status).toBe('trial');
  });

  test('disallowed target status is rejected with 400', async () => {
    await expect(service.setStatusOverride(MAC, 'grace', 'admin', 'r')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('blank reason is rejected with 400', async () => {
    await expect(service.setStatusOverride(MAC, 'active', 'admin', '')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('changePlan (SUB-19)', () => {
  test('re-points plan_id to the tier and audits plan_change', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow());
    mockPrisma.subscription_plans.findUnique.mockResolvedValue({ id: 9n, tier: 'premium', is_active: true });
    mockPrisma.device_subscriptions.update.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ ...data }))
    );

    await service.changePlan(MAC, 'premium', 'admin', 'mis-mapped product');

    expect(mockPrisma.subscription_plans.findUnique).toHaveBeenCalledWith({ where: { tier: 'premium' } });
    expect(mockPrisma.device_subscriptions.update.mock.calls[0][0].data.plan_id).toBe(9n);
    const audit = mockPrisma.subscription_admin_audit.create.mock.calls[0][0].data;
    expect(audit.action).toBe('plan_change:premium');
    expect(audit.reason).toBe('mis-mapped product');
  });

  test('unknown tier is rejected with 400 and no update happens', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow());
    mockPrisma.subscription_plans.findUnique.mockResolvedValue(null);

    await expect(service.changePlan(MAC, 'platinum', 'admin', 'r')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
  });

  test('inactive tier is rejected with 400', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(baseRow());
    mockPrisma.subscription_plans.findUnique.mockResolvedValue({ id: 9n, tier: 'starter', is_active: false });

    await expect(service.changePlan(MAC, 'starter', 'admin', 'r')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('blank reason is rejected with 400', async () => {
    await expect(service.changePlan(MAC, 'family', 'admin', null)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('unknown MAC 404s', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    await expect(service.changePlan(MAC, 'family', 'admin', 'r')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('searchSubscriptions', () => {
  test('joins devices to subscriptions and marks sub-less devices as none', async () => {
    mockPrisma.ai_device.findMany.mockResolvedValue([
      { mac_address: MAC, alias: 'Toy', sys_user: { email: 'p@x.in', nickname: 'P', phone: '9' } },
      { mac_address: '11:22:33:44:55:66', alias: null, sys_user: null },
    ]);
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([baseRow()]);

    const out = await service.searchSubscriptions('p@x.in');

    expect(out).toHaveLength(2);
    expect(out[0].status).toBe('active');
    expect(out[0].device.parent_email).toBe('p@x.in');
    expect(out[1].status).toBe('none');
  });

  test('empty query returns []', async () => {
    expect(await service.searchSubscriptions('  ')).toEqual([]);
    expect(mockPrisma.ai_device.findMany).not.toHaveBeenCalled();
  });

  test('finds a device by its RevenueCat txn id (SUB-18 refund lookup)', async () => {
    // No parent/MAC hit, but the RC txn id matches a subscription row.
    mockPrisma.ai_device.findMany
      .mockResolvedValueOnce([]) // main search
      .mockResolvedValueOnce([
        { mac_address: MAC, alias: 'Toy', sys_user: { email: 'p@x.in', nickname: 'P', phone: '9' } },
      ]); // rc-matched macs
    mockPrisma.device_subscriptions.findMany
      .mockResolvedValueOnce([{ mac_address: MAC }]) // rc match
      .mockResolvedValueOnce([baseRow()]); // sub join

    const out = await service.searchSubscriptions('1000000999');

    expect(mockPrisma.device_subscriptions.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { rc_original_transaction_id: { contains: '1000000999', mode: 'insensitive' } },
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].mac_address).toBe(MAC);
    expect(out[0].device.parent_email).toBe('p@x.in');
  });
});

describe('getDetail', () => {
  const summary = {
    status: 'active',
    plan: { tier: 'family', name: 'Family', price_inr: 499, monthly_question_limit: 300, daily_question_limit: 30, daily_minutes_limit: 60, monthly_image_limit: null, daily_image_limit: 10 },
    usage: { used: { questions_month: 120, questions_today: 5, minutes_today: 12, images_today: 2 }, remaining: { questions_month: 180 } },
  };

  test('assembles verdict + metered usage + raw fields + events + audit', async () => {
    mockSubService.getSubscriptionSummary.mockResolvedValue(summary);
    mockSubService.getSessionVerdict.mockResolvedValue({ allowed: false, reason: 'daily_questions' });
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
      trial_started_at: new Date('2026-06-01T00:00:00Z'),
      trial_ends_at: new Date('2026-07-01T00:00:00Z'),
      trial_used: true,
      current_period_start: new Date('2026-07-01T00:00:00Z'),
      current_period_end: new Date('2026-08-01T00:00:00Z'),
      grace_until: null,
      cancel_at_period_end: true,
      billing_cycle: 'monthly',
      store: 'app_store',
      rc_original_transaction_id: '1000000999',
    });
    mockPrisma.ai_device.findFirst.mockResolvedValue({
      alias: 'Toy',
      sys_user: { email: 'p@x.in', nickname: 'P', phone: '99999' },
    });
    mockPrisma.subscription_events.findMany.mockResolvedValue([
      { id: 7n, event_type: 'CANCELLATION', processed_at: new Date(), created_at: new Date() },
    ]);
    mockPrisma.subscription_admin_audit.findMany.mockResolvedValue([]);

    const out = await service.getDetail(MAC);

    expect(mockSubService.getSessionVerdict).toHaveBeenCalledWith(
      MAC,
      expect.objectContaining({ dryRun: true })
    );
    expect(out.status).toBe('active');
    expect(out.gate).toEqual({ allowed: false, reason: 'daily_questions' });
    expect(out.plan).toBe(summary.plan);
    expect(out.usage).toBe(summary.usage);
    expect(out.store).toEqual({ store: 'app_store', rc_original_transaction_id: '1000000999' });
    expect(out.cancel_at_period_end).toBe(true);
    expect(out.events[0].id).toBe(7); // BigInt serialised
    expect(out.device.parent_phone).toBe('99999');
  });

  test('unknown MAC (no device, no sub row, no gate hits) 404s', async () => {
    mockSubService.getSubscriptionSummary.mockResolvedValue(null);
    mockSubService.getSessionVerdict.mockResolvedValue({ allowed: false, reason: 'no_plan' });
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    mockPrisma.ai_device.findFirst.mockResolvedValue(null);
    mockPrisma.subscription_gate_hits.findFirst.mockResolvedValue(null);

    await expect(service.getDetail(MAC)).rejects.toMatchObject({ statusCode: 404 });
  });

  test('unbound MAC whose only record is the gate-hit ledger gets the none shell', async () => {
    // The SUB-20 drill-down lists these; the drawer must open, not 404.
    mockSubService.getSubscriptionSummary.mockResolvedValue(null);
    mockSubService.getSessionVerdict.mockResolvedValue({ allowed: false, reason: 'no_plan' });
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    mockPrisma.ai_device.findFirst.mockResolvedValue(null);
    mockPrisma.subscription_gate_hits.findFirst.mockResolvedValue({ id: 1n });
    mockPrisma.subscription_events.findMany.mockResolvedValue([]);
    mockPrisma.subscription_admin_audit.findMany.mockResolvedValue([]);

    const out = await service.getDetail(MAC);

    expect(out.status).toBe('none');
    expect(out.gate.reason).toBe('no_plan');
    expect(out.device).toBeNull();
    expect(out.plan).toBeNull();
  });

  test('bound device with no subscription row → empty (status none) shell', async () => {
    mockSubService.getSubscriptionSummary.mockResolvedValue(null);
    mockSubService.getSessionVerdict.mockResolvedValue({ allowed: false, reason: 'no_plan' });
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    mockPrisma.ai_device.findFirst.mockResolvedValue({ alias: 'Toy', sys_user: { email: 'p@x.in', nickname: 'P', phone: '9' } });
    mockPrisma.subscription_events.findMany.mockResolvedValue([]);
    mockPrisma.subscription_admin_audit.findMany.mockResolvedValue([]);

    const out = await service.getDetail(MAC);

    expect(out.status).toBe('none');
    expect(out.plan).toBeNull();
    expect(out.usage).toBeNull();
    expect(out.gate.reason).toBe('no_plan');
    expect(out.device.parent_email).toBe('p@x.in');
    expect(out.events).toEqual([]);
  });
});

describe('listByStatus', () => {
  test('lists rows in a status joined to their devices', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([baseRow({ status: 'lapsed' })]);
    mockPrisma.ai_device.findMany.mockResolvedValue([
      { mac_address: MAC, alias: 'Toy', sys_user: { email: 'p@x.in', nickname: 'P', phone: '9' } },
    ]);

    const out = await service.listByStatus('lapsed');

    expect(mockPrisma.device_subscriptions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'lapsed' } })
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('lapsed');
    expect(out[0].device.parent_email).toBe('p@x.in');
  });

  test('device row missing from ai_device still returns the subscription', async () => {
    mockPrisma.device_subscriptions.findMany.mockResolvedValue([baseRow()]);
    mockPrisma.ai_device.findMany.mockResolvedValue([]);

    const out = await service.listByStatus('active');
    expect(out[0].device).toBeNull();
  });

  test('unknown status is rejected with 400', async () => {
    await expect(service.listByStatus('paid')).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.device_subscriptions.findMany).not.toHaveBeenCalled();
  });
});

describe('getMetrics', () => {
  const NOW = new Date('2026-07-23T12:00:00Z');

  const primeMocks = () => {
    mockPrisma.ai_device.count.mockResolvedValue(100);
    mockPrisma.device_subscriptions.groupBy.mockResolvedValue([
      { status: 'trial', _count: { _all: 10 } },
      { status: 'active', _count: { _all: 20 } },
      { status: 'lapsed', _count: { _all: 5 } },
    ]);
    // First findMany = active rows with plans, second = trial starts in range.
    mockPrisma.device_subscriptions.findMany
      .mockResolvedValueOnce([
        { subscription_plans: { tier: 'family', price_inr: 499 } },
        { subscription_plans: { tier: 'starter', price_inr: 199 } },
        { subscription_plans: { tier: 'family', price_inr: 499 } },
        { subscription_plans: null },
      ])
      .mockResolvedValueOnce([
        { trial_started_at: new Date('2026-07-22T05:00:00Z') },
        { trial_started_at: new Date('2026-07-22T09:00:00Z') },
      ]);
    mockPrisma.device_subscriptions.count.mockResolvedValue(40);
    mockPrisma.subscription_events.findMany.mockResolvedValue([
      { event_type: 'EXPIRATION', created_at: new Date('2026-07-21T10:00:00Z') },
      { event_type: 'EXPIRATION', created_at: new Date('2026-07-21T11:00:00Z') },
      { event_type: 'CANCELLATION', created_at: new Date('2026-07-20T10:00:00Z') },
      { event_type: 'RENEWAL', created_at: new Date('2026-07-22T10:00:00Z') },
      { event_type: 'INITIAL_PURCHASE', created_at: new Date('2026-07-19T10:00:00Z') },
    ]);
    mockPrisma.subscription_gate_hits.groupBy.mockResolvedValue([
      { reason: 'no_plan', _count: { _all: 12 } },
      { reason: 'daily_questions', _count: { _all: 4 } },
    ]);
  };

  test('assembles funnel, ranged churn, per-plan MRR, gate hits and trends', async () => {
    primeMocks();

    const m = await service.getMetrics({ now: NOW });

    expect(m.funnel).toMatchObject({
      devices_bound: 100,
      trials_started: 40,
      trial_now: 10,
      paid_now: 20,
      lapsed_now: 5,
    });
    expect(m.churn).toEqual({ EXPIRATION: 2, CANCELLATION: 1 });
    expect(m.mrr_inr).toBe(1197);
    expect(m.mrr_by_tier).toEqual({ family: 998, starter: 199 });
    // per-plan breakdown sums to the aggregate
    expect(Object.values(m.mrr_by_tier).reduce((a, b) => a + b, 0)).toBe(m.mrr_inr);
    expect(m.gate_hits).toEqual({ no_plan: 12, daily_questions: 4 });

    // 30d default range → 31 day buckets, and the bumps land on their days
    expect(m.trends.days).toHaveLength(31);
    const i22 = m.trends.days.indexOf('2026-07-22');
    expect(m.trends.trials[i22]).toBe(2);
    expect(m.trends.paid[i22]).toBe(1);
    expect(m.trends.lapsed[m.trends.days.indexOf('2026-07-21')]).toBe(2);
    expect(m.trends.lapsed[m.trends.days.indexOf('2026-07-20')]).toBe(1);
  });

  test('a custom range is passed through to the range-driven queries', async () => {
    primeMocks();
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-07-08T00:00:00Z');

    const m = await service.getMetrics({ from, to, now: NOW });

    expect(m.range).toEqual({ from, to });
    expect(m.trends.days[0]).toBe('2026-07-01');
    expect(m.trends.days).toHaveLength(8);
    expect(mockPrisma.subscription_events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ created_at: { gte: from, lte: to } }) })
    );
  });

  test('inverted range falls back to 30d before `to`', async () => {
    primeMocks();
    const m = await service.getMetrics({
      from: new Date('2026-07-30T00:00:00Z'),
      to: new Date('2026-07-08T00:00:00Z'),
      now: NOW,
    });
    expect(m.range.to.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(m.range.from.getTime()).toBe(m.range.to.getTime() - 30 * DAY_MS);
  });
});

describe('getGateHits', () => {
  test('groups hits per device+flow with count/last-hit and joins the parent', async () => {
    mockPrisma.subscription_gate_hits.groupBy.mockResolvedValue([
      { mac_address: MAC, flow: 'voice', _count: { _all: 7 }, _max: { created_at: new Date('2026-07-22T10:00:00Z') } },
      { mac_address: '11:22:33:44:55:66', flow: 'imagine', _count: { _all: 2 }, _max: { created_at: new Date('2026-07-21T10:00:00Z') } },
    ]);
    mockPrisma.ai_device.findMany.mockResolvedValue([
      { mac_address: MAC, alias: 'Toy', sys_user: { email: 'p@x.in', nickname: 'P' } },
    ]);

    const out = await service.getGateHits({ reason: 'daily_questions' });

    expect(mockPrisma.subscription_gate_hits.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['mac_address', 'flow'],
        where: expect.objectContaining({ reason: 'daily_questions' }),
      })
    );
    expect(out.devices).toHaveLength(2);
    expect(out.devices[0]).toMatchObject({ mac_address: MAC, flow: 'voice', hits: 7, parent: 'p@x.in', alias: 'Toy' });
    expect(out.devices[1].parent).toBeNull(); // device row gone → MAC still listed
  });

  test('missing reason is rejected with 400', async () => {
    await expect(service.getGateHits({})).rejects.toMatchObject({ statusCode: 400 });
    expect(mockPrisma.subscription_gate_hits.groupBy).not.toHaveBeenCalled();
  });

  test('empty range returns a clean empty state', async () => {
    mockPrisma.subscription_gate_hits.groupBy.mockResolvedValue([]);
    const out = await service.getGateHits({ reason: 'no_plan' });
    expect(out.devices).toEqual([]);
    expect(mockPrisma.ai_device.findMany).not.toHaveBeenCalled();
  });
});

describe('getAuditLog', () => {
  test('serialises BigInt ids', async () => {
    mockPrisma.subscription_admin_audit.findMany.mockResolvedValue([
      { id: 7n, admin_user: 'a', action: 'comp_extend:7d', mac_address: MAC, reason: null, before_state: {}, after_state: {}, created_at: new Date() },
    ]);
    const rows = await service.getAuditLog({});
    expect(rows[0].id).toBe(7);
  });
});
