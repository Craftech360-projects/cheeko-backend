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

jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_device: { findUnique: jest.fn().mockResolvedValue({ kid_id: 15n }) },
    kid_profile: { findUnique: jest.fn().mockResolvedValue({ birth_date: null, language: 'en' }) },
    kid_wonder_question: {
      create: (...a) => mockCreate(...a),
      findFirst: (...a) => mockFindFirst(...a),
      update: (...a) => mockUpdate(...a),
    },
  },
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
});

describe('recordWonderQuestion', () => {
  it('stores a genuinely new question', async () => {
    mockFindFirst.mockResolvedValue({ question: BEE });

    const result = await quizService.recordWonderQuestion(MAC, 'I wonder where rain goes after it lands?');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.duplicate).toBeUndefined();
  });

  it('refuses the same question twice', async () => {
    mockFindFirst.mockResolvedValue({ question: BEE });

    const result = await quizService.recordWonderQuestion(MAC, BEE);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.duplicate).toBe(true);
  });

  it('sees through re-punctuation and casing', async () => {
    mockFindFirst.mockResolvedValue({ question: BEE });

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

    const question = await quizService.takePendingWonderQuestion(context);

    expect(question).toBe(BEE);
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
    mockFindFirst.mockResolvedValue({ question: BEE });

    const result = await quizService.recordWonderQuestion(MAC, BEE);

    expect(result.duplicate).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ recalled_at: null }) })
    );
  });
});
