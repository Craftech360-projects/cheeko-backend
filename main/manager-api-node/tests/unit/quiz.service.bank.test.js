/**
 * Bank isolation in the service layer.
 *
 * The acceptance criterion this covers: an answer recorded against the riddle
 * bank lands in riddle_question_answer and NOT in quiz_question_answer. A
 * regression here is silent — the write succeeds, it just lands in the wrong
 * child's progress.
 */

const mockAnswerCreate = { quiz: jest.fn(), riddle: jest.fn() };
const mockQuestionFind = { quiz: jest.fn(), riddle: jest.fn() };

jest.mock('../../src/config/database', () => ({
  prisma: {
    // No kid on the device, so the milestone write no-ops early and the test
    // stays about routing rather than about kid_learning_progress.
    ai_device: { findUnique: jest.fn().mockResolvedValue(null) },
    kid_profile: { findUnique: jest.fn().mockResolvedValue(null) },
    quiz_question: { findUnique: (...a) => mockQuestionFind.quiz(...a) },
    riddle_question: { findUnique: (...a) => mockQuestionFind.riddle(...a) },
    quiz_question_answer: { create: (...a) => mockAnswerCreate.quiz(...a) },
    riddle_question_answer: { create: (...a) => mockAnswerCreate.riddle(...a) },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const quizService = require('../../src/services/quiz.service');

const row = { id: 900n, answered_at: new Date('2026-08-06T10:00:00Z') };

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ['quiz', 'riddle']) {
    mockQuestionFind[key].mockResolvedValue({ id: 7n });
    mockAnswerCreate[key].mockResolvedValue(row);
  }
});

describe('recordAnswer bank routing', () => {
  it('writes a riddle answer to riddle_question_answer only', async () => {
    await quizService.recordAnswer('AA:BB:CC:DD:EE:FF', '7', 'correct', 'riddle');

    expect(mockAnswerCreate.riddle).toHaveBeenCalledTimes(1);
    expect(mockAnswerCreate.quiz).not.toHaveBeenCalled();
    expect(mockQuestionFind.riddle).toHaveBeenCalled();
    expect(mockQuestionFind.quiz).not.toHaveBeenCalled();
  });

  it('writes a quiz answer to quiz_question_answer only', async () => {
    await quizService.recordAnswer('AA:BB:CC:DD:EE:FF', '7', 'correct', 'quiz');

    expect(mockAnswerCreate.quiz).toHaveBeenCalledTimes(1);
    expect(mockAnswerCreate.riddle).not.toHaveBeenCalled();
  });

  // The worker shipped before this change sends no bank at all.
  it('defaults to the quiz bank when no bank is given', async () => {
    await quizService.recordAnswer('AA:BB:CC:DD:EE:FF', '7', 'correct');

    expect(mockAnswerCreate.quiz).toHaveBeenCalledTimes(1);
    expect(mockAnswerCreate.riddle).not.toHaveBeenCalled();
  });

  it('validates an unknown question against the bank it was claimed in', async () => {
    mockQuestionFind.riddle.mockResolvedValue(null);

    await expect(
      quizService.recordAnswer('AA:BB:CC:DD:EE:FF', '7', 'correct', 'riddle')
    ).rejects.toThrow(/unknown question_id/);
    expect(mockAnswerCreate.riddle).not.toHaveBeenCalled();
    expect(mockAnswerCreate.quiz).not.toHaveBeenCalled();
  });

  it('still rejects a bad result before touching any bank', async () => {
    await expect(
      quizService.recordAnswer('AA:BB:CC:DD:EE:FF', '7', 'nearly', 'riddle')
    ).rejects.toThrow(/result must be one of/);
    expect(mockAnswerCreate.riddle).not.toHaveBeenCalled();
  });
});
