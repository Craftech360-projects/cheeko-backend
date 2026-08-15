/**
 * Reset day must simulate a NIGHT, not flatten the calendar.
 *
 * The anti-trap advances a child after ANTI_TRAP_DAY_CAP distinct days on one
 * level (`daysOnLevel`). Testing that cap means playing, pretending a day
 * passed, and playing again — which is what the admin Reset day button is for.
 *
 * The original version moved only rows dated today. Press it after a second
 * session and that session lands on the SAME backdated day as the first: the
 * distinct-day count sits at 1 forever and the cap becomes untestable, with no
 * error to say so. Sliding the whole log preserves the gaps between sessions.
 *
 * The prisma mock below applies the shift by reading the SQL the service
 * actually emits, so reintroducing an `answered_at >=` predicate changes what
 * the mock does and this test fails.
 */

const log = [];
const mockExecuteRaw = jest.fn();
const mockCount = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn().mockResolvedValue({ kid_id: null }) },
    kid_profile: { findUnique: jest.fn().mockResolvedValue(null) },
    quiz_question_answer: { count: (...a) => mockCount(...a) },
    $executeRawUnsafe: (...a) => mockExecuteRaw(...a),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const quizService = require('../../src/services/quiz.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const distinctDays = () => new Set(log.map((r) => dayKey(r.answered_at))).size;

beforeEach(() => {
  jest.clearAllMocks();
  log.length = 0;

  mockCount.mockImplementation(({ where }) =>
    Promise.resolve(log.filter((r) => r.answered_at >= where.answered_at.gte).length)
  );

  mockExecuteRaw.mockImplementation((sql) => {
    // Honour whatever predicate the service emitted. If it ever narrows to
    // today again, the rows from earlier sessions stop moving — which is the
    // bug, and shows up below as a collapsed day count.
    const todayOnly = /answered_at\s*>=/.test(sql);
    const from = startOfToday();
    let moved = 0;
    for (const row of log) {
      if (todayOnly && row.answered_at < from) continue;
      row.answered_at = new Date(row.answered_at.getTime() - DAY);
      moved += 1;
    }
    return Promise.resolve(moved);
  });
});

const playSession = (n = 1) => {
  for (let i = 0; i < n; i += 1) log.push({ answered_at: new Date() });
};

describe('clearDayGate', () => {
  it('keeps two sessions on two different days', async () => {
    playSession(10);
    await quizService.clearDayGate(MAC, 'quiz');
    playSession(1);

    // Before the second press the count is already right; the press must not
    // undo it. This is the assertion the old behaviour failed.
    expect(distinctDays()).toBe(2);
    await quizService.clearDayGate(MAC, 'quiz');
    expect(distinctDays()).toBe(2);
  });

  it('reaches the anti-trap cap after three simulated days', async () => {
    for (let day = 0; day < 3; day += 1) {
      playSession(day === 0 ? 10 : 1);
      await quizService.clearDayGate(MAC, 'quiz');
    }
    expect(distinctDays()).toBe(3);
    // And every row is in the past, so the next session's day gate is open.
    expect(log.every((r) => r.answered_at < startOfToday())).toBe(true);
  });

  it('does nothing when the day is already open', async () => {
    playSession(3);
    await quizService.clearDayGate(MAC, 'quiz');

    const result = await quizService.clearDayGate(MAC, 'quiz');
    expect(result.day_already_open).toBe(true);
    expect(result.backdated).toBe(0);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1); // only the first press
  });
});
