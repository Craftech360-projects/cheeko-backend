/**
 * SUB-2 criterion 5 — reminder job sends day 23/27/30 exactly once each.
 *
 * Integration tests here run without .env or a live DB by design (tests/setup.js),
 * so the DB is mocked and the claim's atomicity is asserted at the query level:
 * the WHERE must be the guard, because that is what makes a restart safe.
 */

const mockUpdateMany = jest.fn();
const mockFindMany = jest.fn();
const mockFindToken = jest.fn();
const mockSendPush = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    device_subscriptions: {
      findMany: (...a) => mockFindMany(...a),
      updateMany: (...a) => mockUpdateMany(...a),
    },
  },
}));
jest.mock('../../src/services/pushNotification.service', () => ({
  sendPushNotification: (...a) => mockSendPush(...a),
  findParentFcmToken: (...a) => mockFindToken(...a),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

const {
  runTrialReminders,
  dueReminderDay,
  daysElapsed,
  buildCopy,
} = require('../../src/jobs/trialReminderNotification');

const MAC = '00:16:3E:AC:B5:38';
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  mockFindToken.mockResolvedValue('tok-123');
  mockUpdateMany.mockResolvedValue({ count: 1 });
  // Mirrors the real contract: sendPushNotification RETURNS false on failure,
  // it never throws. Mocking a rejection here would test a fiction.
  mockSendPush.mockResolvedValue(true);
});

describe('dueReminderDay', () => {
  test.each([
    [22, null, null, 'day 22: nothing due yet'],
    [23, null, 23, 'day 23: first milestone'],
    [26, 23, null, 'day 26: 23 already sent, 27 not reached'],
    [27, 23, 27, 'day 27: next milestone'],
    [30, 27, 30, 'day 30: final milestone'],
    [31, 30, null, 'day 31: all sent, nothing left'],
    [40, 30, null, 'long past: never re-sends'],
  ])('elapsed=%s lastSent=%s -> %s (%s)', (elapsed, lastSent, expected) => {
    expect(dueReminderDay(elapsed, lastSent)).toBe(expected);
  });

  test('a device offline past several milestones gets only the newest', () => {
    // Not three pushes in one evening — the older copy is stale anyway.
    expect(dueReminderDay(30, null)).toBe(30);
  });
});

describe('daysElapsed', () => {
  test('counts whole days since trial start', () => {
    expect(daysElapsed(daysAgo(23), new Date())).toBe(23);
  });
});

describe('buildCopy', () => {
  test('day 23 says 7 days left', () => {
    expect(buildCopy(23).title).toMatch(/7 days/);
  });
  test('day 30 says ends today, not "0 days"', () => {
    expect(buildCopy(30).title).toMatch(/today/);
    expect(buildCopy(30).title).not.toMatch(/0 day/);
  });
});

describe('runTrialReminders', () => {
  const candidate = (lastSent = null, startedDaysAgo = 23) => [{
    mac_address: MAC,
    trial_started_at: daysAgo(startedDaysAgo),
    last_reminder_day: lastSent,
  }];

  test('sends the day-23 push and claims the day', async () => {
    mockFindMany.mockResolvedValue(candidate());

    const result = await runTrialReminders();

    expect(result.sent).toBe(1);
    expect(mockSendPush).toHaveBeenCalledWith('tok-123', expect.stringMatching(/7 days/), expect.any(String));
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ last_reminder_day: 23 }),
    }));
  });

  test('the claim is guarded in the WHERE, so a concurrent run cannot double-send', async () => {
    mockFindMany.mockResolvedValue(candidate());

    await runTrialReminders();

    const { where } = mockUpdateMany.mock.calls[0][0];
    expect(where.mac_address).toBe(MAC);
    expect(where.status).toBe('trial');
    // Without this OR the UPDATE would match unconditionally and every run
    // would re-push. This assertion is the exactly-once guarantee.
    expect(where.OR).toEqual([
      { last_reminder_day: null },
      { last_reminder_day: { lt: 23 } },
    ]);
  });

  test('losing the claim race sends nothing', async () => {
    mockFindMany.mockResolvedValue(candidate());
    mockUpdateMany.mockResolvedValue({ count: 0 }); // another instance won

    const result = await runTrialReminders();

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  test('does not re-send a day already sent', async () => {
    mockFindMany.mockResolvedValue(candidate(23, 25)); // day 25, 23 already sent

    const result = await runTrialReminders();

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  test('a parent with no token is skipped without burning the milestone', async () => {
    mockFindMany.mockResolvedValue(candidate());
    mockFindToken.mockResolvedValue(null); // no token / push_notifications off

    const result = await runTrialReminders();

    // Claiming here would consume day 23 for a parent we never reached.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  test('a failed push is not counted as sent, and does not abort the run', async () => {
    mockFindMany.mockResolvedValue([
      { mac_address: 'AA:AA:AA:AA:AA:AA', trial_started_at: daysAgo(23), last_reminder_day: null },
      { mac_address: MAC, trial_started_at: daysAgo(27), last_reminder_day: 23 },
    ]);
    mockSendPush.mockResolvedValueOnce(false); // FCM rejected the first token

    const result = await runTrialReminders();

    expect(mockSendPush).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(1); // only the delivered one counts
  });

  test('a trial inside day 22 is left alone', async () => {
    mockFindMany.mockResolvedValue(candidate(null, 22));

    const result = await runTrialReminders();

    expect(mockSendPush).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});
