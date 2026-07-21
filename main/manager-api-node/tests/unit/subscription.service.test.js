const mockPrisma = {
  device_subscriptions: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    // The lapse repair is a guarded updateMany: only the caller that wins the
    // trial→lapsed transition gets count > 0, and only that one pushes.
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  subscription_plans: { findUnique: jest.fn() },
  device_token_usage_session: { aggregate: jest.fn() },
  device_image_generations: { count: jest.fn(), create: jest.fn() },
};
const mockSendPush = jest.fn().mockResolvedValue(true);
const mockFindToken = jest.fn().mockResolvedValue('tok-123');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/pushNotification.service', () => ({
  sendPushNotification: (...a) => mockSendPush(...a),
  findParentFcmToken: (...a) => mockFindToken(...a),
}));

/** The plan-gate push is fired without await, so let its microtasks settle. */
const flushPush = () => new Promise((resolve) => setImmediate(resolve));

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
      expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // Guarded on status: two concurrent verdicts both land on 'lapsed',
          // but only one wins the transition and pushes the parent.
          where: { mac_address: MAC, status: 'trial' },
          data: expect.objectContaining({ status: 'lapsed' }),
        })
      );
    });

    test('the plan-gate push fires once, on the trial→lapsed transition', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() - DAY_MS),
      });

      await service.getSessionVerdict(MAC);
      await flushPush();

      expect(mockSendPush).toHaveBeenCalledWith(
        'tok-123',
        expect.stringMatching(/trial has ended/i),
        expect.any(String)
      );
    });

    test('a device already lapsed does not push again on every refusal', async () => {
      // The child pressing the button ten times must not push Mum ten times.
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ status: 'lapsed' });

      const verdict = await service.getSessionVerdict(MAC);
      await flushPush();

      expect(verdict.allowed).toBe(false);
      expect(mockSendPush).not.toHaveBeenCalled();
    });

    test('losing the transition race pushes nothing', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() - DAY_MS),
      });
      mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });

      await service.getSessionVerdict(MAC);
      await flushPush();

      expect(mockSendPush).not.toHaveBeenCalled();
    });

    test('a parent with no token still gets a correct verdict', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'trial',
        trial_ends_at: new Date(Date.now() - DAY_MS),
      });
      mockFindToken.mockResolvedValue(null);

      const verdict = await service.getSessionVerdict(MAC);
      await flushPush();

      // Enforcement must never depend on whether a push could be delivered.
      expect(verdict.allowed).toBe(false);
      expect(mockSendPush).not.toHaveBeenCalled();
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

    test('an overrun grace window is refused and repaired to lapsed (SUB-7)', async () => {
      mockFindToken.mockResolvedValue('tok-123');
      mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'grace',
        grace_until: new Date(Date.now() - DAY_MS), // ran out yesterday
      });

      const verdict = await service.getSessionVerdict(MAC);
      await flushPush();

      expect(verdict.allowed).toBe(false);
      expect(mockPrisma.device_subscriptions.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { mac_address: MAC, status: 'grace' },
          data: expect.objectContaining({ status: 'lapsed', grace_until: null }),
        })
      );
      expect(mockSendPush).toHaveBeenCalledWith(
        'tok-123',
        expect.stringMatching(/plan has ended/i),
        expect.any(String)
      );
    });

    test('a grace window still running is allowed and left alone', async () => {
      mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
        status: 'grace',
        grace_until: new Date(Date.now() + DAY_MS),
      });

      const verdict = await service.getSessionVerdict(MAC);

      expect(verdict.allowed).toBe(true);
      expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
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

describe('istDayWindow', () => {
  // IST is UTC+5:30, no DST. Midnight IST = 18:30 UTC the previous day.
  test('just before IST midnight the window starts the previous 18:30Z', () => {
    const { start, end } = service.istDayWindow(new Date('2026-07-17T18:29:00Z'));
    expect(start.toISOString()).toBe('2026-07-16T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-07-17T18:30:00.000Z');
  });

  test('just after IST midnight the window rolls over', () => {
    const { start, end } = service.istDayWindow(new Date('2026-07-17T18:31:00Z'));
    expect(start.toISOString()).toBe('2026-07-17T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-07-18T18:30:00.000Z');
  });
});

describe('bucket enforcement (SUB-3)', () => {
  const PLAN = {
    tier: 'family',
    name: 'Family',
    price_inr: 299,
    monthly_question_limit: 300,
    daily_question_limit: 60,
    daily_minutes_limit: 15,
    monthly_image_limit: null,
    daily_image_limit: 25,
  };
  const PERIOD_START = new Date('2026-07-01T00:00:00Z');
  const NOW = new Date('2026-07-17T10:00:00Z');

  const subRow = (over = {}) => ({
    status: 'active',
    trial_ends_at: null,
    trial_started_at: null,
    current_period_start: PERIOD_START,
    current_period_end: new Date('2026-08-01T00:00:00Z'),
    bucket_alert_sent_at: null,
    subscription_plans: PLAN,
    ...over,
  });

  /** Route the two aggregate calls by shape: the daily window has an upper bound. */
  const setUsage = ({ monthQuestions = 0, dayQuestions = 0, daySeconds = 0, imagesToday = 0, imagesMonth = 0 } = {}) => {
    mockPrisma.device_token_usage_session.aggregate.mockImplementation(async ({ where }) =>
      where.created_at?.lt
        ? { _sum: { message_count: dayQuestions, session_duration_seconds: daySeconds } }
        : { _sum: { message_count: monthQuestions } }
    );
    mockPrisma.device_image_generations.count.mockImplementation(async ({ where }) =>
      where.created_at?.lt ? imagesToday : imagesMonth
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENFORCEMENT_ENABLED = 'true';
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow());
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
    setUsage();
  });
  afterEach(() => { delete process.env.ENFORCEMENT_ENABLED; });

  test('monthly bucket empty refuses with monthly_bucket_empty', async () => {
    setUsage({ monthQuestions: 300 });
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('monthly_bucket_empty');
  });

  test('daily question cap refuses with daily_questions', async () => {
    setUsage({ monthQuestions: 100, dayQuestions: 60 });
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('daily_questions');
  });

  test('daily minute cap refuses with daily_minutes', async () => {
    setUsage({ monthQuestions: 100, daySeconds: 15 * 60 });
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('daily_minutes');
  });

  test('fractional minutes: an allowed verdict never displays 0 minutes left', async () => {
    setUsage({ daySeconds: 14.5 * 60 }); // 0.5 min of 15 left
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining.minutes_today).toBe(1); // ceil: 0 remaining ⇔ refused
  });

  test('null image limits skip the image COUNT queries entirely', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({
      subscription_plans: { ...PLAN, daily_image_limit: null, monthly_image_limit: null },
    }));
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining.images_today).toBeNull(); // unlimited
    expect(mockPrisma.device_image_generations.count).not.toHaveBeenCalled();
  });

  test('under every bucket is allowed with real remaining numbers', async () => {
    setUsage({ monthQuestions: 100, dayQuestions: 10, daySeconds: 5 * 60, imagesToday: 3 });
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict).toEqual({
      allowed: true,
      reason: 'ok',
      remaining: { questions_month: 200, questions_today: 50, minutes_today: 10, images_today: 22 },
    });
  });

  test('image caps gate the imagine flow, never voice', async () => {
    setUsage({ imagesToday: 25 });

    expect((await service.getSessionVerdict(MAC, { now: NOW })).allowed).toBe(true);

    const imagine = await service.getSessionVerdict(MAC, { flow: 'imagine', now: NOW });
    expect(imagine.allowed).toBe(false);
    expect(imagine.reason).toBe('daily_images');
  });

  test('a monthly image limit also refuses the imagine flow', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({
      subscription_plans: { ...PLAN, monthly_image_limit: 150, daily_image_limit: null },
    }));
    setUsage({ imagesMonth: 150 });

    const imagine = await service.getSessionVerdict(MAC, { flow: 'imagine', now: NOW });
    expect(imagine.allowed).toBe(false);
    expect(imagine.reason).toBe('daily_images');
  });

  test('a plan-less allowed row fails open instead of guessing limits', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({ subscription_plans: null }));
    const verdict = await service.getSessionVerdict(MAC, { now: NOW });
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining.questions_month).toBeNull();
  });

  test('a trial meters from trial_started_at, not current_period_start', async () => {
    const trialStart = new Date('2026-07-10T00:00:00Z');
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({
      status: 'trial',
      trial_started_at: trialStart,
      trial_ends_at: new Date('2026-08-09T00:00:00Z'),
      current_period_start: null,
      current_period_end: null,
    }));

    await service.getSessionVerdict(MAC, { now: NOW });

    const monthCall = mockPrisma.device_token_usage_session.aggregate.mock.calls
      .map(([a]) => a).find((a) => !a.where.created_at.lt);
    expect(monthCall.where.created_at.gte).toEqual(trialStart);
  });

  test('IST midnight rollover swaps the daily window', async () => {
    await service.getSessionVerdict(MAC, { now: new Date('2026-07-17T18:29:00Z') });
    await service.getSessionVerdict(MAC, { now: new Date('2026-07-17T18:31:00Z') });

    const dayCalls = mockPrisma.device_token_usage_session.aggregate.mock.calls
      .map(([a]) => a).filter((a) => a.where.created_at.lt);
    expect(dayCalls[0].where.created_at.gte.toISOString()).toBe('2026-07-16T18:30:00.000Z');
    expect(dayCalls[1].where.created_at.gte.toISOString()).toBe('2026-07-17T18:30:00.000Z');
  });
});

describe('maybeSendBucketAlert (80% push)', () => {
  const PLAN = { monthly_question_limit: 300 };
  const PERIOD_START = new Date('2026-07-01T00:00:00Z');
  const NOW = new Date('2026-07-17T10:00:00Z');

  const subRow = (over = {}) => ({
    status: 'active',
    trial_started_at: null,
    current_period_start: PERIOD_START,
    bucket_alert_sent_at: null,
    subscription_plans: PLAN,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENFORCEMENT_ENABLED = 'true';
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow());
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.device_token_usage_session.aggregate.mockResolvedValue({ _sum: { message_count: 240 } });
    mockFindToken.mockResolvedValue('tok-123');
    mockSendPush.mockResolvedValue(true);
  });
  afterEach(() => { delete process.env.ENFORCEMENT_ENABLED; });

  test('fires at the 80% crossing with the used/limit copy', async () => {
    await service.maybeSendBucketAlert(MAC, { now: NOW });

    expect(mockSendPush).toHaveBeenCalledWith(
      'tok-123',
      expect.any(String),
      expect.stringContaining('240 of 300')
    );
  });

  test('the DB claim is what makes it once per period', async () => {
    await service.maybeSendBucketAlert(MAC, { now: NOW });

    const claim = mockPrisma.device_subscriptions.updateMany.mock.calls[0][0];
    // Eligible only when never sent or sent before this period's anchor —
    // a renewal re-arms the alert without any cron.
    expect(claim.where.OR).toEqual([
      { bucket_alert_sent_at: null },
      { bucket_alert_sent_at: { lt: PERIOD_START } },
    ]);

    // Losing the claim (already sent this period) pushes nothing.
    jest.clearAllMocks();
    mockPrisma.device_subscriptions.updateMany.mockResolvedValue({ count: 0 });
    await service.maybeSendBucketAlert(MAC, { now: NOW });
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  test('a missing FCM token defers instead of burning the once-per-period claim', async () => {
    mockFindToken.mockResolvedValue(null);

    await service.maybeSendBucketAlert(MAC, { now: NOW });

    // No claim written — when the parent registers later this period,
    // the next usage write still gets to send the alert.
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  test('an alert already sent this period short-circuits before the usage SUM', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({
      bucket_alert_sent_at: new Date('2026-07-10T00:00:00Z'), // after PERIOD_START
    }));

    await service.maybeSendBucketAlert(MAC, { now: NOW });

    expect(mockPrisma.device_token_usage_session.aggregate).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  test('an expired-but-unrepaired trial never gets an 80% nudge', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(subRow({
      status: 'trial',
      trial_started_at: new Date('2026-06-10T00:00:00Z'),
      trial_ends_at: new Date('2026-07-10T00:00:00Z'), // ended a week before NOW
      current_period_start: null,
    }));

    await service.maybeSendBucketAlert(MAC, { now: NOW });

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
  });

  test('below 80% neither claims nor pushes', async () => {
    mockPrisma.device_token_usage_session.aggregate.mockResolvedValue({ _sum: { message_count: 239 } });

    await service.maybeSendBucketAlert(MAC, { now: NOW });

    expect(mockPrisma.device_subscriptions.updateMany).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  test('enforcement off means no usage pushes either', async () => {
    delete process.env.ENFORCEMENT_ENABLED;

    await service.maybeSendBucketAlert(MAC, { now: NOW });

    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe('getSubscriptionSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.device_token_usage_session.aggregate.mockImplementation(async ({ where }) =>
      where.created_at?.lt
        ? { _sum: { message_count: 10, session_duration_seconds: 300 } }
        : { _sum: { message_count: 100 } }
    );
    mockPrisma.device_image_generations.count.mockResolvedValue(3);
  });

  test('returns status, plan, period, usage and trial countdown', async () => {
    const now = new Date('2026-07-17T10:00:00Z');
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
      status: 'trial',
      trial_started_at: new Date('2026-07-10T00:00:00Z'),
      trial_ends_at: new Date('2026-08-09T00:00:00Z'),
      current_period_start: null,
      current_period_end: null,
      subscription_plans: {
        tier: 'family', name: 'Family', price_inr: 299,
        monthly_question_limit: 300, daily_question_limit: 60,
        daily_minutes_limit: 15, monthly_image_limit: null, daily_image_limit: 25,
      },
    });

    const summary = await service.getSubscriptionSummary(MAC, { now });

    expect(summary.status).toBe('trial');
    expect(summary.plan.tier).toBe('family');
    expect(summary.trial.days_left).toBe(23);
    expect(summary.usage.used.questions_month).toBe(100);
    expect(summary.usage.remaining.questions_today).toBe(50);
    expect(summary.usage.remaining.minutes_today).toBe(10);
  });

  test('unknown MAC returns null', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);
    expect(await service.getSubscriptionSummary(MAC)).toBeNull();
  });
});

describe('recordImageGeneration', () => {
  test('writes one row per generated image, carrying where it landed', async () => {
    jest.clearAllMocks();
    await service.recordImageGeneration('aa-bb-cc-dd-ee-ff', 'https://cdn/x.jpg');
    expect(mockPrisma.device_image_generations.create).toHaveBeenCalledWith({
      data: { mac_address: MAC, url: 'https://cdn/x.jpg' },
    });
  });

  test('a malformed MAC writes nothing', async () => {
    jest.clearAllMocks();
    await service.recordImageGeneration('nope');
    expect(mockPrisma.device_image_generations.create).not.toHaveBeenCalled();
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

describe('heartbeatCutoff', () => {
  const originalFlag = process.env.ENFORCEMENT_ENABLED;
  const NOW = new Date('2026-07-17T10:00:00Z'); // IST day = 16T18:30Z .. 17T18:30Z

  const planned = (daily_minutes_limit) =>
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue({
      subscription_plans: { daily_minutes_limit },
    });
  const minutesToday = (min, messageCount = 0) =>
    mockPrisma.device_token_usage_session.aggregate.mockResolvedValue({
      _sum: { session_duration_seconds: min * 60, message_count: messageCount },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENFORCEMENT_ENABLED = 'true';
  });
  afterEach(() => { process.env.ENFORCEMENT_ENABLED = originalFlag; });

  test('kill-switch off: no cutoff, DB never consulted', async () => {
    delete process.env.ENFORCEMENT_ENABLED;

    expect(await service.heartbeatCutoff(MAC, { now: NOW })).toEqual({ cutoff: false });
    expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
  });

  test('malformed MAC: no cutoff, no DB', async () => {
    expect((await service.heartbeatCutoff('not-a-mac', { now: NOW })).cutoff).toBe(false);
    expect(mockPrisma.device_subscriptions.findUnique).not.toHaveBeenCalled();
  });

  test('no subscription row: never cut a session the verdict let start', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue(null);

    expect((await service.heartbeatCutoff(MAC, { now: NOW })).cutoff).toBe(false);
  });

  test('live status but no plan row: fail open, no cutoff', async () => {
    mockPrisma.device_subscriptions.findUnique.mockResolvedValue({ subscription_plans: null });

    expect((await service.heartbeatCutoff(MAC, { now: NOW })).cutoff).toBe(false);
  });

  test('under the daily minute cap: no cutoff', async () => {
    planned(15);
    minutesToday(10);

    expect((await service.heartbeatCutoff(MAC, { now: NOW })).cutoff).toBe(false);
  });

  test('daily minute cap breached mid-session: cutoff with reason daily_minutes', async () => {
    planned(15);
    minutesToday(16);

    expect(await service.heartbeatCutoff(MAC, { now: NOW }))
      .toEqual({ cutoff: true, reason: 'daily_minutes' });
  });

  test('exactly at the cap cuts (>= mirrors the verdict breach test)', async () => {
    planned(15);
    minutesToday(15);

    expect((await service.heartbeatCutoff(MAC, { now: NOW })).cutoff).toBe(true);
  });

  test('question buckets never cut mid-session', async () => {
    planned(15);
    minutesToday(1, 9999); // monthly/daily questions long gone; minutes fine

    expect((await service.heartbeatCutoff(MAC, { now: NOW })).cutoff).toBe(false);
  });

  test('minutes are summed over the IST calendar day', async () => {
    planned(15);
    minutesToday(0);

    await service.heartbeatCutoff(MAC, { now: NOW });

    expect(mockPrisma.device_token_usage_session.aggregate).toHaveBeenCalledWith({
      where: {
        mac_address: MAC,
        created_at: {
          gte: new Date('2026-07-16T18:30:00Z'),
          lt: new Date('2026-07-17T18:30:00Z'),
        },
      },
      _sum: { session_duration_seconds: true },
    });
  });
});
