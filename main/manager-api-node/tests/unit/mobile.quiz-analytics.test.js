describe('mobile quiz analytics', () => {
  let prisma;
  let mobileService;

  const MAC = 'aa:bb:cc:dd:ee:ff';
  const NOW = new Date('2026-08-10T12:00:00Z');

  // Level 3 was fully cleared before the window, so answers on it this week are
  // a replay pass. Level 4 is first contact and still open.
  const activeBank = [
    { id: 301n, level: 3, question_text: 'L3 one', answer_text: 'a', age_band: '6-8', language: 'en', active: true },
    { id: 302n, level: 3, question_text: 'L3 two', answer_text: 'b', age_band: '6-8', language: 'en', active: true },
    { id: 401n, level: 4, question_text: 'L4 one', answer_text: 'c', age_band: '6-8', language: 'en', active: true },
    { id: 402n, level: 4, question_text: 'L4 two', answer_text: 'd', age_band: '6-8', language: 'en', active: true },
  ];

  const answerRows = [
    // Before the window: level 3 cleared outright.
    { question_id: 301n, result: 'correct', answered_at: new Date('2026-07-01T09:00:00Z') },
    { question_id: 302n, result: 'revealed', answered_at: new Date('2026-07-01T09:05:00Z') },
    // In the window.
    { question_id: 301n, result: 'correct', answered_at: new Date('2026-08-05T09:00:00Z') },
    { question_id: 401n, result: 'wrong', answered_at: new Date('2026-08-06T09:00:00Z') },
    { question_id: 401n, result: 'correct', answered_at: new Date('2026-08-07T09:00:00Z') },
    { question_id: 402n, result: 'revealed', answered_at: new Date('2026-08-08T09:00:00Z') },
  ];

  beforeEach(() => {
    jest.resetModules();

    const answers = {
      findMany: jest.fn(async ({ where, select }) => {
        // The real rows carry mixed-case MACs, so the filter must be an
        // insensitive OR rather than a case-sensitive `in`.
        expect(where.OR).toBeDefined();
        expect(where.device_mac).toBeUndefined();
        for (const clause of where.OR) {
          expect(clause.device_mac.mode).toBe('insensitive');
        }
        let rows = answerRows;
        if (where.answered_at?.gte) rows = rows.filter(r => r.answered_at >= where.answered_at.gte);
        if (where.answered_at?.lt) rows = rows.filter(r => r.answered_at < where.answered_at.lt);
        if (where.result?.in) rows = rows.filter(r => where.result.in.includes(r.result));
        if (where.question_id?.in) {
          const ids = where.question_id.in.map(String);
          rows = rows.filter(r => ids.includes(String(r.question_id)));
        }
        if (select?.question_id && !select.result) return rows.map(r => ({ question_id: r.question_id }));
        return rows;
      }),
    };

    const questions = {
      findMany: jest.fn(async ({ where }) => {
        if (where.id?.in) {
          const ids = where.id.in.map(String);
          return activeBank.filter(q => ids.includes(String(q.id)));
        }
        return activeBank;
      }),
    };

    prisma = {
      sys_user: { findUnique: jest.fn(async () => ({ id: 7, parent_profile: { timezone: 'UTC' } })) },
      ai_device: { findMany: jest.fn(async () => [{ mac_address: MAC }]) },
      quiz_question: questions,
      quiz_question_answer: answers,
      riddle_question: { findMany: jest.fn(async () => []) },
      riddle_question_answer: { findMany: jest.fn(async () => { throw new Error('relation does not exist'); }) },
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

    mobileService = require('../../src/services/mobile.service');
  });

  test('counts attempts, so a wrong-then-right question counts twice', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    const quiz = out.banks.find(b => b.bank === 'quiz');
    const level4 = quiz.levels.find(l => l.level === 4);

    expect(level4.attempted).toBe(3);
    expect(level4.wrong).toBe(1);
    expect(level4.correct).toBe(1);
    expect(level4.revealed).toBe(1);
    // 1 of 3 attempts correct — not 1 of 2 questions.
    expect(level4.accuracy).toBe(33);
    expect(level4.points).toBe(10);
  });

  test('flags a level as replay only when every answered question was already cleared', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    const quiz = out.banks.find(b => b.bank === 'quiz');

    expect(quiz.levels.find(l => l.level === 3).replay).toBe(true);
    expect(quiz.levels.find(l => l.level === 4).replay).toBe(false);
  });

  test('revealed clears a question, so level 4 reads cleared once both are seen', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    const quiz = out.banks.find(b => b.bank === 'quiz');

    expect(quiz.levels.find(l => l.level === 3).cleared).toBe(true);
    expect(quiz.levels.find(l => l.level === 4).cleared).toBe(true);
    // Every level cleared means no level is current.
    expect(quiz.current_level).toBeNull();
  });

  test('a missing riddle table reports unavailable instead of failing the screen', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    const riddle = out.banks.find(b => b.bank === 'riddle');

    expect(riddle.available).toBe(false);
    expect(riddle.levels).toEqual([]);
  });

  // The client should never have to tell "key absent" from "zero", so every bank
  // entry carries the same keys whatever happened.
  test('every bank entry has the same keys, played or not', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    const expected = ['bank', 'available', 'current_level', 'attempted', 'correct', 'points', 'levels'];

    expect(out.banks.length).toBeGreaterThan(1);
    for (const bank of out.banks) {
      expect(Object.keys(bank).sort()).toEqual([...expected].sort());
    }
    // The riddle bank is the unavailable one here — zeros, not missing keys.
    const riddle = out.banks.find(b => b.bank === 'riddle');
    expect(riddle.attempted).toBe(0);
    expect(riddle.correct).toBe(0);
    expect(riddle.points).toBe(0);
    expect(riddle.current_level).toBeNull();
  });

  test('trend compares this week with the one before it', async () => {
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });

    // This week: 4 attempts, 2 correct = 50%. Previous week (Jul 28 - Aug 3):
    // no attempts, so there is no baseline to claim improvement over.
    expect(out.trend.accuracy).toBe(50);
    expect(out.trend.direction).toBe('new');
    expect(out.trend.previous_accuracy).toBeNull();
  });

  test('trend reports up when the previous period was worse', async () => {
    // Previous week 0 of 2 correct (0%); this week is 2 of 4 (50%).
    answerRows.push(
      { question_id: 301n, result: 'wrong', answered_at: new Date('2026-07-30T09:00:00Z') },
      { question_id: 302n, result: 'wrong', answered_at: new Date('2026-07-30T09:05:00Z') },
    );
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    answerRows.length -= 2;

    expect(out.trend.previous_accuracy).toBe(0);
    expect(out.trend.accuracy).toBe(50);
    expect(out.trend.direction).toBe('up');
    expect(out.trend.delta).toBe(50);
  });

  test('a small swing stays flat rather than claiming progress', async () => {
    // Previous week 1 of 2 correct (50%) against this week's 50% — no change.
    answerRows.push(
      { question_id: 301n, result: 'correct', answered_at: new Date('2026-07-30T09:00:00Z') },
      { question_id: 302n, result: 'wrong', answered_at: new Date('2026-07-30T09:05:00Z') },
    );
    const out = await mobileService.getQuizAnalytics('uid', { period: 'week', now: NOW });
    answerRows.length -= 2;

    expect(out.trend.direction).toBe('flat');
  });

  test('rejects an unknown period', async () => {
    await expect(mobileService.getQuizAnalytics('uid', { period: 'fortnight' }))
      .rejects.toThrow(/period must be one of/);
  });
});
