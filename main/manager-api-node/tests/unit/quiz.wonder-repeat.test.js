/**
 * The Wonder Question must not feed itself.
 *
 * The stored question is read back as the NEXT session's opening beat, so by the
 * time the model is asked for a new one it is already in context. On dev
 * (2026-08-15) a 31B model echoed it: the same bee question was stored twice
 * byte-for-byte, and the child heard it at both ends of every session — a fixed
 * point the mechanic reached on its own.
 *
 * The prompt now asks for something different. This is the backstop.
 */

const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockFindMany = jest.fn();
const mockBankFindMany = jest.fn();
const mockSeenFindMany = jest.fn();
const mockMarkSeen = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn().mockResolvedValue({ kid_id: 15n }) },
    kid_profile: { findUnique: jest.fn().mockResolvedValue({ birth_date: null, language: 'en' }) },
    kid_wonder_question: {
      create: (...a) => mockCreate(...a),
      findFirst: (...a) => mockFindFirst(...a),
      update: (...a) => mockUpdate(...a),
      findMany: (...a) => mockFindMany(...a),
    },
    wonder_bank: { findMany: (...a) => mockBankFindMany(...a) },
    kid_content_seen: { findMany: (...a) => mockSeenFindMany(...a) },
  },
}));

jest.mock('../../src/services/contentbank.service', () => ({
  markContentSeen: (...a) => mockMarkSeen(...a),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const quizService = require('../../src/services/quiz.service');

const MAC = '00:16:3E:7A:11:C4';
const BEE = 'I wonder if you can imagine what it would be like to see the world with eyes like a bee?';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 4n, asked_at: new Date('2026-08-15T09:00:00Z') });
  mockFindFirst.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({});
  mockFindMany.mockResolvedValue([]);
  mockBankFindMany.mockResolvedValue([]);
  mockSeenFindMany.mockResolvedValue([]);
  mockMarkSeen.mockResolvedValue(1);
});

// The dedupe read is now a list, so a test that used to seed "the previous one"
// seeds the history instead.
const history = (...questions) => mockFindMany.mockResolvedValue(questions.map((question) => ({ question })));

describe('recordWonderQuestion', () => {
  it('stores a genuinely new question', async () => {
    history(BEE);

    const result = await quizService.recordWonderQuestion(MAC, 'I wonder where rain goes after it lands?');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.duplicate).toBeUndefined();
  });

  it('refuses the same question twice', async () => {
    history(BEE);

    const result = await quizService.recordWonderQuestion(MAC, BEE);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(true);
  });

  it('sees through re-punctuation and casing', async () => {
    history(BEE);

    await quizService.recordWonderQuestion(MAC, '  I Wonder if you can imagine what it would be like to see the world with EYES like a bee!!  ');

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('stores the first one, when there is nothing to repeat', async () => {
    await quizService.recordWonderQuestion(MAC, BEE);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

/**
 * A question is recalled once, not at the top of every session until a
 * different one happens to be stored. Kid 21 heard the same one for eight days
 * because the write only fires in the after-Question-Ten MEMO.
 */
describe('takePendingWonderQuestion', () => {
  const context = { kidId: 15n, deviceMac: MAC };

  it('serves the pending question and retires it', async () => {
    mockFindFirst.mockResolvedValue({ id: 7n, question: BEE });

    const pending = await quizService.takePendingWonderQuestion(context);

    expect(pending).toEqual({ question: BEE, answer: null });
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ recalled_at: null }) })
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { recalled_at: expect.any(Date) },
    });
  });

  it('serves nothing when the only question was already recalled', async () => {
    mockFindFirst.mockResolvedValue(null);

    expect(await quizService.takePendingWonderQuestion(context)).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses to serve a question it could not retire', async () => {
    mockFindFirst.mockResolvedValue({ id: 7n, question: BEE });
    mockUpdate.mockRejectedValue(new Error('write failed'));

    await expect(quizService.takePendingWonderQuestion(context)).rejects.toThrow('write failed');
  });

  it('still dedupes against a question that has already been recalled', async () => {
    history(BEE);

    const result = await quizService.recordWonderQuestion(MAC, BEE);

    expect(result.duplicate).toBe(true);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ recalled_at: null }) })
    );
  });

  // Asked at 06:40:36, recalled at 06:40:45 on dev: the child finished a level,
  // started the next, and was "reminded" of the question from nine seconds ago.
  it('will not recall a question from the session that just ended', async () => {
    await quizService.takePendingWonderQuestion(context, new Date('2026-08-31T06:40:45Z'));

    const { where } = mockFindFirst.mock.calls[0][0];
    expect(where.asked_at.lt).toEqual(new Date('2026-08-31T03:40:45Z'));
  });
});

// "Leave them a different one" needs something to be different FROM. Without
// this list the model re-reads its own summaries and reworks the same question.
// A question the child ANSWERED is not one they are still wondering about.
// Prod 2026-09-01: "Pizza" at 05:47, the same question asked again the next
// morning, and the child's reply was "ask the direct question".
describe('the child answer', () => {
  const context = { kidId: 15n, deviceMac: MAC };

  it('is stored with the question', async () => {
    await quizService.recordWonderQuestion(MAC, BEE, '  Bubbles of juice  ');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ question: BEE, answer_text: 'Bubbles of juice' }),
    }));
  });

  it('is null when the child never answered', async () => {
    await quizService.recordWonderQuestion(MAC, BEE);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ answer_text: null }),
    }));
  });

  it('is capped like the question, so a runaway reply cannot fill the column', async () => {
    await quizService.recordWonderQuestion(MAC, BEE, 'x'.repeat(900));

    const { data } = mockCreate.mock.calls[0][0];
    expect(data.answer_text).toHaveLength(500);
  });

  it('comes back with the question it belongs to', async () => {
    mockFindFirst.mockResolvedValue({ id: 7n, question: BEE, answer_text: 'Pizza' });

    expect(await quizService.takePendingWonderQuestion(context)).toEqual({
      question: BEE, answer: 'Pizza',
    });
  });
});

describe('recentWonderQuestions', () => {
  const context = { kidId: 15n, deviceMac: MAC };

  it('returns the last few, recalled ones included', async () => {
    history(BEE, 'Why do stars come out at night?');

    expect(await quizService.recentWonderQuestions(context)).toEqual([
      BEE, 'Why do stars come out at night?',
    ]);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });

  it('refuses a repeat of any of them, not just the newest', async () => {
    history('Why do stars come out at night?', BEE);

    const result = await quizService.recordWonderQuestion(MAC, BEE);

    expect(result.duplicate).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// The server chooses the question. Every guard on the model's own choice was a
// string comparison with a five-item memory, and on prod 2026-09-11 it re-asked
// the food-house question from 2026-09-01 as "make a house" for "build a house".
describe('pickWonderToAsk', () => {
  const context = { kidId: 15n, deviceMac: MAC };
  const BANK = [
    { code: 'WQ-FOOD-01', question_text: 'If you could build a house out of any food, what would you use?', level: 1 },
    { code: 'WQ-MAGIC-02', question_text: 'If you could have any superpower, which one would you pick?', level: 1 },
    { code: 'WQ-SPACE-01', question_text: 'If you could visit the moon, what is the first thing you would do?', level: 1 },
  ];

  it('never serves a question this child has heard', async () => {
    mockBankFindMany.mockResolvedValue(BANK);
    mockSeenFindMany.mockResolvedValue([
      { code: 'WQ-FOOD-01', seen_at: new Date('2026-09-01') },
      { code: 'WQ-MAGIC-02', seen_at: new Date('2026-09-09') },
    ]);

    const pick = await quizService.pickWonderToAsk(context);

    expect(pick).toEqual({ code: 'WQ-SPACE-01', question_text: BANK[2].question_text, second_pass: false, previous_answer: null });
    expect(mockSeenFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bank: 'wonder', kid_id: 15n }),
    }));
  });

  it('is the same question all day, so a reconnect does not burn a second one', async () => {
    mockBankFindMany.mockResolvedValue(BANK);

    const a = await quizService.pickWonderToAsk(context);
    const b = await quizService.pickWonderToAsk(context);

    expect(a.code).toBe(b.code);
  });

  it('comes round to the question heard longest ago once the bank is exhausted, with what the child said', async () => {
    mockBankFindMany.mockResolvedValue(BANK);
    mockSeenFindMany.mockResolvedValue([
      { code: 'WQ-FOOD-01', seen_at: new Date('2026-06-01') },
      { code: 'WQ-MAGIC-02', seen_at: new Date('2026-07-01') },
      { code: 'WQ-SPACE-01', seen_at: new Date('2026-08-01') },
    ]);
    mockFindFirst.mockResolvedValue({ answer_text: 'biryani' });

    const pick = await quizService.pickWonderToAsk(context);

    expect(pick).toEqual({ code: 'WQ-FOOD-01', question_text: BANK[0].question_text, second_pass: true, previous_answer: 'biryani' });
  });

  it('is null when the bank is empty, so the worker falls back rather than breaking', async () => {
    expect(await quizService.pickWonderToAsk(context)).toBeNull();
  });
});

describe('recordWonderQuestion with a bank code', () => {
  it('stores the code, marks it seen, and skips the text dedupe', async () => {
    // The text is on the history list: the old dedupe would refuse it.
    history(BEE);
    mockFindFirst.mockResolvedValue(null);

    const result = await quizService.recordWonderQuestion(MAC, BEE, 'Bubbles', 'WQ-ANIMAL-04');

    expect(result.duplicate).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ code: 'WQ-ANIMAL-04', answer_text: 'Bubbles' }),
    }));
    expect(mockMarkSeen).toHaveBeenCalledWith({ deviceMac: MAC, bank: 'wonder', codes: ['WQ-ANIMAL-04'] });
  });

  it('reported twice in one day is one row, and the answer can arrive on the second report', async () => {
    mockFindFirst.mockResolvedValue({ id: 9n, answer_text: null });

    const result = await quizService.recordWonderQuestion(MAC, BEE, 'Bubbles', 'WQ-ANIMAL-04');

    expect(result.duplicate).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 9n }, data: { answer_text: 'Bubbles' } });
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});
