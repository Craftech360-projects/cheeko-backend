const mockPrisma = {
  device_subscriptions: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  subscription_plans: { findUnique: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const service = require('../../src/services/subscription.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('getSessionVerdict', () => {
  const originalFlag = process.env.ENFORCEMENT_ENABLED;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { process.env.ENFORCEMENT_ENABLED = originalFlag; });

  describe('kill-switch off (default)', () => {
    beforeEach(() => { delete process.env.ENFORCEMENT_ENABLED; });

    test('unknown MAC is allowed and the DB is never consulted', async () => {
      const verdict = await service.getSessionVerdict('FF:FF:FF:FF:FF:FF');

      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBe('ok');
      expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
    });

    test('a lapsed device is still allowed', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'lapsed' });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
    });

    test('ENFORCEMENT_ENABLED=false short-circuits to allowed', async () => {
      process.env.ENFORCEMENT_ENABLED = 'false';
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'lapsed' });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
    });
  });

  describe('kill-switch on', () => {
    beforeEach(() => { process.env.ENFORCEMENT_ENABLED = 'true'; });

    test.each(['trial', 'active', 'grace'])('status %s may start a session', async (status) => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status });

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBe('ok');
    });

    test.each(['lapsed', 'cancelled'])('status %s is refused', async (status) => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status });

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('no_plan');
    });

    test('unknown MAC is refused with no_plan', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);

      const verdict = await service.getSessionVerdict(MAC);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('no_plan');
    });

    test('malformed MAC is refused without hitting the DB', async () => {
      const verdict = await service.getSessionVerdict('not-a-mac');

      expect(verdict.allowed).toBe(false);
      expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
    });

    test('MAC is normalised before lookup', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'active' });

      await service.getSessionVerdict('aa-bb-cc-dd-ee-ff');

      expect(mockPrisma.device_subscriptions.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { mac_address: MAC } })
      );
    });
  });

  test('remaining is unknown, not zero — SUB-3 computes the real buckets', async () => {
    delete process.env.ENFORCEMENT_ENABLED;

    expect((await service.getSessionVerdict(MAC)).remaining).toEqual({
      questions_month: null,
      questions_today: null,
      minutes_today: null,
      images_today: null,
    });
  });

  describe('lazy trial expiry', () => {
    beforeEach(() => { process.env.ENFORCEMENT_ENABLED = 'true'; });

    test('an expired trial is refused and the row is repaired to lapsed', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() - DAY_MS), // ended yesterday
      });

      const verdict = await service.getSessionVerdict(MAC);

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('no_plan');
      expect(mockPrisma.device_subscriptions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { mac_address: MAC },
          data: expect.objectContaining({ status: 'lapsed' }),
        })
      );
    });

    test('a trial still inside its window is allowed and left alone', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() + DAY_MS),
      });

      const verdict = await service.getSessionVerdict(MAC);

      expect(verdict.allowed).toBe(true);
      expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
    });

    test('expiry is enforced by the verdict even if no cron ever ran', async () => {
      // 31 days past start, cron never touched it — the read itself must gate.
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() - 1 * DAY_MS),
      });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(false);
    });

    test('a trial with no end date is not silently expired', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: null,
      });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
      expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
    });

    test('a non-trial status is never touched by expiry repair', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'active',
        trial_ends_at: new Date(Date.now() - 90 * DAY_MS),
      });

      expect((await service.getSessionVerdict(MAC)).allowed).toBe(true);
      expect(mockPrisma.device_subscriptions.update).not.toHaveBeenCalled();
    });
  });
});

describe('ensureTrialForMac', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.subscription_plans.findUnique.mockResolvedValue({ id: 2n });
    mockPrisma.device_subscriptions.upsert.mockImplementation(async ({ create }) => create);
  });

  test('grants a 30-day Family trial on a MAC that has never had one', async () => {
    await service.ensureTrialForMac(MAC, 42);

    const call = mockPrisma.device_subscriptions.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ mac_address: MAC });
    expect(call.create).toMatchObject({
      mac_address: MAC,
      status: 'trial',
      plan_id: 2n,
      trial_used: true,
    });
    expect(mockPrisma.subscription_plans.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tier: 'family' } })
    );

    const days = (call.create.trial_ends_at - call.create.trial_started_at) / DAY_MS;
    expect(days).toBe(service.TRIAL_DAYS);
  });

  test('a re-bind never re-grants: update is a no-op, so trial_used survives', async () => {
    await service.ensureTrialForMac(MAC, 42);

    // An empty `update` is what makes the upsert create-if-absent. If this ever
    // becomes non-empty, a second bind would overwrite a used trial.
    expect(mockPrisma.device_subscriptions.upsert.mock.calls[0][0].update).toEqual({});
  });

  test('normalises the MAC so a dashed re-bind hits the same row', async () => {
    await service.ensureTrialForMac('aa-bb-cc-dd-ee-ff', 42);

    expect(mockPrisma.device_subscriptions.upsert.mock.calls[0][0].where)
      .toEqual({ mac_address: MAC });
  });

  test('records the binding parent as the payer', async () => {
    await service.ensureTrialForMac(MAC, 42);

    expect(mockPrisma.device_subscriptions.upsert.mock.calls[0][0].create.user_id).toBe(42n);
  });

  test('a malformed MAC writes nothing', async () => {
    expect(await service.ensureTrialForMac('not-a-mac', 42)).toBeNull();
    expect(mockPrisma.device_subscriptions.upsert).not.toHaveBeenCalled();
  });

  test('survives a missing family plan rather than throwing mid-bind', async () => {
    mockPrisma.subscription_plans.findUnique.mockResolvedValue(null);

    await service.ensureTrialForMac(MAC, 42);

    expect(mockPrisma.device_subscriptions.upsert.mock.calls[0][0].create.plan_id).toBeNull();
  });
});
