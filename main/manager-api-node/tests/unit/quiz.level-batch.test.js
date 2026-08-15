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
    ai_device: { findUnique: jest.fn() },
    kid_profile: { findUnique: jest.fn() },
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
