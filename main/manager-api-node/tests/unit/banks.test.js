/**
 * Bank routing.
 *
 * The whole quiz/riddle split hangs on bankFor: a wrong answer here sends a
 * child's riddle answers into the quiz answer log, where they would clear quiz
 * levels the child never played.
 */

jest.mock('../../src/config/database', () => ({
  prisma: {
    quiz_question: { name: 'quiz_question' },
    quiz_question_answer: { name: 'quiz_question_answer' },
    riddle_question: { name: 'riddle_question' },
    riddle_question_answer: { name: 'riddle_question_answer' },
  },
}));

const { bankFor, resolveBank, BANKS, CHARACTER_BANK } = require('../../src/services/banks');

describe('bankFor', () => {
  it('maps riddle_master to the riddle bank', () => {
    expect(bankFor('riddle_master')).toBe('riddle');
  });

  it('maps quiz_master to the quiz bank', () => {
    expect(bankFor('quiz_master')).toBe('quiz');
  });

  // Every caller today sends no character at all. They must keep getting quiz
  // data, so the API can ship before the worker does.
  // 'constructor' and 'toString' arrive straight off a query string. On a plain
  // object they resolve to inherited functions, which are truthy and would sail
  // past the fallback into resolveBank as a non-name.
  it.each([undefined, null, '', 'cheeko', 'quizzy', 'QUIZ_MASTER', 'constructor', 'toString', '__proto__'])(
    'falls back to quiz for %p',
    (character) => {
      expect(bankFor(character)).toBe('quiz');
    }
  );
});

describe('resolveBank', () => {
  it('returns the quiz tables for the quiz bank', () => {
    const bank = resolveBank('quiz');
    expect(bank.questions.name).toBe('quiz_question');
    expect(bank.answers.name).toBe('quiz_question_answer');
  });

  it('returns the riddle tables for the riddle bank', () => {
    const bank = resolveBank('riddle');
    expect(bank.questions.name).toBe('riddle_question');
    expect(bank.answers.name).toBe('riddle_question_answer');
  });

  it('defaults to quiz when given nothing', () => {
    expect(resolveBank().questions.name).toBe('quiz_question');
  });

  it('rejects an unknown bank rather than silently serving quiz', () => {
    // bankFor() already defaults unknown CHARACTERS to quiz. An unknown BANK
    // name reaching here means a caller invented one, which is a bug, not a
    // guest we should quietly seat at the quiz table.
    expect(() => resolveBank('trivia')).toThrow(/unknown bank/i);
  });

  it('names a distinct milestone subject per bank', () => {
    // kid_learning_progress is unique on (kid, subject, topic) and topic is
    // "<band> level <n>". Sharing a subject would make riddle level 1 collide
    // with quiz level 1 and overwrite the child's quiz achievement.
    expect(resolveBank('quiz').subject).not.toBe(resolveBank('riddle').subject);
  });

  it('names the answer table for raw SQL', () => {
    // clearDayGate cannot parameterise a table name; it interpolates this.
    expect(resolveBank('riddle').answerTable).toBe('riddle_question_answer');
    expect(resolveBank('quiz').answerTable).toBe('quiz_question_answer');
  });
});

describe('bank registry', () => {
  it('exposes exactly the two banks the character map points at', () => {
    expect(Object.keys(BANKS).sort()).toEqual(['quiz', 'riddle']);
    for (const bank of Object.values(CHARACTER_BANK)) {
      expect(BANKS[bank]).toBeDefined();
    }
  });

  // Raw SQL interpolation is only safe because these names are ours, not the
  // caller's. If one ever stops being a plain identifier, that stops holding.
  it('uses plain identifiers for every answer table', () => {
    for (const bank of Object.values(BANKS)) {
      expect(bank.answerTable).toMatch(/^[a-z_]+$/);
    }
  });
});
