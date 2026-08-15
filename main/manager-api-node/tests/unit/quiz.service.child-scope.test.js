/**
 * Whose progress is it?
 *
 * Quiz and riddle answers used to be keyed on device_mac alone, so a child who
 * changed toys restarted at Level 1 and a sibling inheriting a toy resumed at
 * the older child's level. Reads now resolve by child; an unpaired device falls
 * back to its own MAC AND to rows with no child, which is the guard that stops
 * the hand-me-down leak.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn() },
    kid_profile: { findUnique: jest.fn() },
    quiz_question: { findUnique: jest.fn(), findMany: jest.fn() },
    quiz_question_answer: {
      create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(),
    },
    kid_learning_progress: { upsert: jest.fn() },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { prisma } = require('../../src/config/database');
const quizService = require('../../src/services/quiz.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const BANK = [
  { id: 1n, level: 1, question_text: 'q1', answer_text: 'a', accepted_answers: [], age_band: '6', language: 'en' },
  { id: 2n, level: 1, question_text: 'q2', answer_text: 'a', accepted_answers: [], age_band: '6', language: 'en' },
];

const pairTo = (kidId) => {
  prisma.ai_device.findUnique.mockResolvedValue({ kid_id: kidId });
  prisma.kid_profile.findUnique.mockResolvedValue({ birth_date: null, language: 'en' });
};

/** The `where` of the first answer-log read, whichever helper issued it. */
const firstAnswerWhere = () => prisma.quiz_question_answer.findMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.quiz_question.findMany.mockResolvedValue(BANK);
  prisma.quiz_question_answer.findMany.mockResolvedValue([]);
  prisma.quiz_question_answer.groupBy.mockResolvedValue([]);
  prisma.quiz_question_answer.create.mockResolvedValue({ id: 9n, answered_at: new Date() });
  prisma.quiz_question.findUnique.mockResolvedValue({ id: 1n, age_band: '6', level: 1, language: 'en' });
});

describe('reads are scoped to the child', () => {
  it('reads a paired device by child, ignoring the MAC entirely', async () => {
    pairTo(42n);

    await quizService.nextQuestions(MAC);

    const where = firstAnswerWhere();
    expect(where.kid_id).toBe(42n);
    expect(where.device_mac).toBeUndefined();
  });

  it('falls back to the MAC for an unpaired device, but only for rows with no child', async () => {
    pairTo(null);

    await quizService.nextQuestions(MAC);

    const where = firstAnswerWhere();
    expect(where.kid_id).toBeNull();
    expect(where.device_mac).toEqual({ equals: MAC, mode: 'insensitive' });
  });

  it('scopes the day gate the same way as the cleared lookup', async () => {
    pairTo(42n);

    await quizService.nextQuestions(MAC);

    for (const call of prisma.quiz_question_answer.findMany.mock.calls) {
      expect(call[0].where.kid_id).toBe(42n);
      expect(call[0].where.device_mac).toBeUndefined();
    }
  });

  it('scopes the lifetime counts on the progress endpoint', async () => {
    pairTo(42n);

    await quizService.progress(MAC);

    const where = prisma.quiz_question_answer.groupBy.mock.calls[0][0].where;
    expect(where.kid_id).toBe(42n);
    expect(where.device_mac).toBeUndefined();
  });
});

describe('writes carry the child', () => {
  it('stamps the child on a recorded answer, alongside the device that asked', async () => {
    pairTo(42n);

    await quizService.recordAnswer(MAC, '1', 'correct');

    expect(prisma.quiz_question_answer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ device_mac: MAC, question_id: 1n, kid_id: 42n }),
      }),
    );
  });

  it('records a null child for an unpaired device, so pairing can adopt it later', async () => {
    pairTo(null);

    await quizService.recordAnswer(MAC, '1', 'correct');

    expect(prisma.quiz_question_answer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ device_mac: MAC, kid_id: null }),
      }),
    );
  });
});

describe('the behaviour all of this exists for', () => {
  it('a child on a new toy resumes at the level they reached on the old one', async () => {
    pairTo(42n);
    // One question per level, so the level the child lands on is visible in the
    // batch. A sitting now serves the whole level whether or not its questions
    // were cleared, so "was q1 skipped?" no longer distinguishes anything — the
    // LEVEL is what carries the child's history between toys.
    prisma.quiz_question.findMany.mockResolvedValue([
      { ...BANK[0], level: 1 },
      { ...BANK[1], level: 2 },
    ]);
    // Rows written from a different MAC entirely — the previous toy.
    prisma.quiz_question_answer.findMany.mockResolvedValue([{ question_id: 1n }]);

    const result = await quizService.nextQuestions('11:22:33:44:55:66');

    expect(result.level).toBe(2);
    expect(result.questions.map((q) => q.id)).toEqual(['2']);
  });

  it('a sibling on an unpaired hand-me-down does not inherit the previous child', async () => {
    pairTo(null);

    await quizService.nextQuestions(MAC);

    // The previous child's rows carry a kid_id, so this read cannot reach them.
    expect(firstAnswerWhere().kid_id).toBeNull();
  });
});
