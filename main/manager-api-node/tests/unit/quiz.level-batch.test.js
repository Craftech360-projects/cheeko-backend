/**
 * A sitting is the whole level.
 *
 * Serving only the questions still outstanding made the session as short as the
 * number left: clear nine of ten and the next day was a ONE question session.
 * Seen live 2026-08-15 — after that single question the model had nothing left
 * to ask and invented one by walking to the next question id, which landed on a
 * Level 2 question the child had not reached.
 *
 * The rule that must NOT change with it: re-asking a cleared question cannot
 * un-clear it. `cleared` means a clearing answer row exists, so a later miss
 * adds a row rather than removing one (ADR-0009, mastery is cumulative).
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn(), findMany: jest.fn() },
    kid_profile: { findUnique: jest.fn(), findMany: jest.fn() },
    quiz_question: { findMany: jest.fn() },
    quiz_question_answer: { findMany: jest.fn(), groupBy: jest.fn() },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { prisma } = require('../../src/config/database');
const quizService = require('../../src/services/quiz.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const q = (id, level) => ({
  id: BigInt(id), level, question_text: `q${id}`, answer_text: 'a',
  accepted_answers: [], language: 'en', teach_text: null, distractors: [],
});
// Ten on level 1, ten on level 2 — the real shape of the re-levelled bank.
const BANK = [
  ...Array.from({ length: 10 }, (_, i) => q(i + 1, 1)),
  ...Array.from({ length: 10 }, (_, i) => q(i + 11, 2)),
];

/** Cleared answer rows for the given question ids. */
const cleared = (...ids) => ids.map((id) => ({
  question_id: BigInt(id), result: 'correct', answered_at: new Date('2026-08-01'),
}));

beforeEach(() => {
  jest.clearAllMocks();
  prisma.ai_device.findUnique.mockResolvedValue({ kid_id: 42n });
  prisma.kid_profile.findUnique.mockResolvedValue({ birth_date: null, language: 'en' });
  prisma.quiz_question.findMany.mockResolvedValue(BANK);
  prisma.quiz_question_answer.findMany.mockResolvedValue([]);
  prisma.quiz_question_answer.groupBy.mockResolvedValue([]);
});

describe('the batch is the whole current level', () => {
  it('serves ten even when nine are already cleared', async () => {
    prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1, 2, 3, 4, 5, 6, 7, 8, 9));

    const result = await quizService.nextQuestions(MAC);

    // The bug: this used to be ['10'], a one-question session.
    expect(result.level).toBe(1);
    expect(result.questions).toHaveLength(10);
    expect(result.questions.map((x) => x.id)).toContain('10');
  });

  it('still moves on once the last outstanding question clears', async () => {
    prisma.quiz_question_answer.findMany.mockResolvedValue(
      cleared(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    );

    const result = await quizService.nextQuestions(MAC);

    expect(result.level).toBe(2);
    expect(result.questions).toHaveLength(10);
  });

  it('a fresh device gets the full level too', async () => {
    const result = await quizService.nextQuestions(MAC);

    expect(result.level).toBe(1);
    expect(result.questions).toHaveLength(10);
  });
});

/**
 * A level the cap moved the child past is FINISHED, and they do not return.
 *
 * `deriveLevelState` answers "lowest level with anything uncleared", so an
 * abandoned level stayed the current level forever: every session dragged the
 * child back to it and the cap had to fire again to push them out. The panel
 * printed that pulled-back level while the toy was serving the next one.
 */
describe('a level aged out by the cap', () => {
  // q10 missed on three separate days; the other nine cleared.
  const stuck = [
    ...cleared(1, 2, 3, 4, 5, 6, 7, 8, 9),
    ...['2026-08-13', '2026-08-14', '2026-08-15'].map((d) => ({
      question_id: 10n, result: 'revealed', answered_at: new Date(`${d}T06:00:00`),
    })),
  ];

  it('is not offered again, and the next level is', async () => {
    prisma.quiz_question_answer.findMany.mockResolvedValue(stuck);

    const result = await quizService.nextQuestions(MAC);

    expect(result.level).toBe(2);
    expect(result.anti_trap_advanced).toBe(true);
    // Ten scored from level 2, plus the unmastered one as an unscored bonus.
    expect(result.questions.filter((q) => !q.bonus)).toHaveLength(10);
    expect(result.questions.filter((q) => q.bonus).map((q) => q.id)).toEqual(['10']);
  });

  it('counts as completed, but not as mastered', async () => {
    prisma.ai_device.findMany.mockResolvedValue([{ mac_address: MAC, kid_id: 42n }]);
    prisma.kid_profile.findMany.mockResolvedValue([{ id: 42n, name: 'K', birth_date: null, language: 'en' }]);
    prisma.quiz_question_answer.findMany.mockResolvedValue(
      stuck.map((r) => ({ ...r, device_mac: MAC, kid_id: 42n }))
    );

    const [row] = await quizService.allDeviceProgress('quiz');

    // The panel must name the level the next session actually serves.
    expect(row.current_level).toBe(2);
    expect(row.levels_completed).toBe(1);
    expect(row.levels_mastered).toBe(0);
    expect(row.levels_aged_out).toBe(1);
  });

  it('still sends the child back when a NEW question reopens a finished level', async () => {
    // Level 1 fully cleared, then a question is added to it. The addition has no
    // days against it, so it is not aged out and the pull-back survives.
    prisma.quiz_question.findMany.mockResolvedValue([...BANK, q(21, 1)]);
    prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));

    const result = await quizService.nextQuestions(MAC);

    expect(result.level).toBe(1);
    expect(result.anti_trap_advanced).toBe(false);
  });
});

/**
 * The advance is announced once, not on every request afterwards.
 *
 * Applying the cap by SKIPPING the level (rather than re-firing it each session)
 * made "is there an aged-out level behind me?" permanently true. Used directly
 * as the advanced flag, it would have lied on every later response and written a
 * warn line on every single request.
 */
describe('anti_trap_advanced', () => {
  const stuck = [
    ...cleared(1, 2, 3, 4, 5, 6, 7, 8, 9),
    ...['2026-08-13', '2026-08-14', '2026-08-15'].map((d) => ({
      question_id: 10n, result: 'revealed', answered_at: new Date(`${d}T06:00:00`),
    })),
  ];

  it('is false once the child has started answering the new level', async () => {
    prisma.quiz_question_answer.findMany.mockResolvedValue([
      ...stuck,
      { question_id: 11n, result: 'correct', answered_at: new Date('2026-08-16T06:00:00') },
    ]);

    const result = await quizService.nextQuestions(MAC);

    expect(result.level).toBe(2);
    expect(result.anti_trap_advanced).toBe(false);
    // Practice from the level below keeps riding along while they are on level 2.
    expect(result.questions.filter((q) => q.bonus).map((q) => q.id)).toEqual(['10']);
  });
});

/**
 * The batch is capped at the day's target, outstanding questions first.
 *
 * "A sitting is the whole level" was written for a level of ten, where the cap
 * never bites. Riddle levels hold eighty, so the uncapped rule put all eighty in
 * every payload — five times the prompt for a Daily Ten that scores ten. Seen on
 * prod 2026-08-17: 15,775 bytes against quiz's 2,996.
 */
describe('a level bigger than the daily target', () => {
  // Eighty on level 1, the real shape of the riddle bank.
  const BIG = Array.from({ length: 80 }, (_, i) => q(i + 1, 1));

  beforeEach(() => {
    prisma.quiz_question.findMany.mockResolvedValue(BIG);
  });

  it('serves ten, not eighty', async () => {
    const result = await quizService.nextQuestions(MAC);

    expect(result.questions).toHaveLength(10);
  });

  it('puts the outstanding ones first, so the level stays finishable', async () => {
    // The first 75 are cleared. In bank order the batch would be all practice
    // and the child could never finish the level.
    prisma.quiz_question_answer.findMany.mockResolvedValue(
      cleared(...Array.from({ length: 75 }, (_, i) => i + 1))
    );

    const result = await quizService.nextQuestions(MAC);
    const ids = result.questions.map((x) => Number(x.id));

    expect(result.questions).toHaveLength(10);
    // 76..80 are the uncleared ones and must all be in the batch.
    for (const id of [76, 77, 78, 79, 80]) expect(ids).toContain(id);
  });
});

/**
 * The served ORDER is the order selectedIds was built in.
 *
 * The response used to be assembled by filtering the bank, which returns rows in
 * bank order and silently threw away the outstanding-first ordering. The cap
 * still picked the right ten; the child just got asked the wrong one first.
 *
 * Seen on prod 2026-08-17: a child cleared "What colour is a banana?" and was
 * asked it again as the opening question twenty minutes later, because it sorts
 * first in the bank. Every test here counted questions and none checked order,
 * which is exactly how it shipped.
 */
describe('the order questions are served in', () => {
  it('puts an outstanding question before one already cleared', async () => {
    // q1 cleared, q2..q10 outstanding. In bank order q1 comes first.
    prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1));

    const result = await quizService.nextQuestions(MAC);
    const ids = result.questions.map((x) => Number(x.id));

    expect(ids).toHaveLength(10);
    expect(ids[0]).not.toBe(1);
    expect(ids[ids.length - 1]).toBe(1);
  });

  it('keeps every outstanding question ahead of every cleared one', async () => {
    prisma.quiz_question_answer.findMany.mockResolvedValue(cleared(1, 3, 5));

    const ids = (await quizService.nextQuestions(MAC)).questions.map((x) => Number(x.id));
    const lastOutstanding = Math.max(...ids.map((id, i) => ([2, 4, 6, 7, 8, 9, 10].includes(id) ? i : -1)));
    const firstCleared = Math.min(...ids.map((id, i) => ([1, 3, 5].includes(id) ? i : Infinity)));

    expect(lastOutstanding).toBeLessThan(firstCleared);
  });
});
