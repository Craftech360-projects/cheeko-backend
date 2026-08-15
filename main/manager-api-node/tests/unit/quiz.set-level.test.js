/**
 * setLevel reads ONE language bank.
 *
 * Regression from the age_band drop (quizzy-redesign 013): setLevel still passed
 * the retired `context.ageBand` as loadBank's first argument, which after the
 * signature shrank to (tables, language) meant the language filter arrived as
 * `undefined`. Prisma drops an undefined `where` key rather than matching null,
 * so the "bank" silently became every language at once — and Set level in the
 * admin dashboard backdated 'correct' rows for the Hindi and Malayalam copies of
 * every question below the target.
 *
 * Nothing errors when that happens, which is why it needs a test: the button
 * reports a plausible row count and the damage only shows up as a device that
 * cannot be put back on a lower level.
 */

const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockCreateMany = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn().mockResolvedValue({ kid_id: null }) },
    kid_profile: { findUnique: jest.fn().mockResolvedValue(null) },
    quiz_question: { findMany: (...a) => mockFindMany(...a) },
    quiz_question_answer: {
      deleteMany: (...a) => mockDeleteMany(...a),
      createMany: (...a) => mockCreateMany(...a),
    },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const quizService = require('../../src/services/quiz.service');

// Two levels in English; the Hindi rows are the ones that must never be touched.
const BANK = [
  { id: 1n, level: 1, language: 'en' },
  { id: 2n, level: 2, language: 'en' },
  { id: 11n, level: 1, language: 'hi' },
  { id: 12n, level: 2, language: 'hi' },
];

beforeEach(() => {
  jest.clearAllMocks();
  // Prisma's semantics, which are the whole bug: an `undefined` value is a key
  // that was never written, so the filter DISAPPEARS and every row comes back.
  // A mock that treats it as "match nothing" hides the failure — the first
  // version of this test did exactly that and passed against the broken code.
  mockFindMany.mockImplementation(({ where }) =>
    Promise.resolve(
      where.language === undefined
        ? [...BANK]
        : BANK.filter((q) => q.language === where.language)
    )
  );
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockCreateMany.mockResolvedValue({ count: 1 });
});

describe('setLevel', () => {
  it('clears only the levels below the target, in the device language only', async () => {
    const result = await quizService.setLevel('AA:BB:CC:DD:EE:FF', 2, 'quiz');

    // 11n is the Hindi level 1. Its presence here is the bug, and it is the only
    // externally visible symptom: no error, just extra rows.
    const [{ data }] = mockCreateMany.mock.calls[0];
    expect(data.map((r) => r.question_id)).toEqual([1n]);
    expect(result.level).toBe(2);
  });

  it('rejects a level the bank does not have', async () => {
    await expect(quizService.setLevel('AA:BB:CC:DD:EE:FF', 99, 'quiz'))
      .rejects.toThrow(/level 99 does not exist/);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
