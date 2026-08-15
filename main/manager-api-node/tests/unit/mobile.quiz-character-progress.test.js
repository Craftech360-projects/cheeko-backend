/**
 * Home-screen quiz card payload — the states live dev data does not reach.
 *
 * The in-progress case is covered end-to-end in mobile-api-sweep.test.js against
 * the real bank; what needs a stub is a band the child has finished, a bank that
 * is not deployed, and a parent with no toy yet.
 */

describe('mobile quiz character progress', () => {
  let prisma;
  let quizProgress;
  let mobileService;

  // Stored lower-case, handed to quiz.service normalised — resolveProgressScope
  // upper-cases, and the answer log is matched case-insensitively either way.
  const MAC = 'aa:bb:cc:dd:ee:ff';
  const NORMALISED_MAC = 'AA:BB:CC:DD:EE:FF';
  const NOW = new Date('2026-08-10T12:00:00Z');

  const standing = (over = {}) => ({
    age_band: '6-8',
    current_level: 2,
    levels_completed: 1,
    level_total: 10,
    level_cleared: 4,
    counts: {},
    last_played: null,
    ...over,
  });

  beforeEach(() => {
    jest.resetModules();

    quizProgress = jest.fn(async () => standing());
    prisma = {
      sys_user: { findUnique: jest.fn(async () => ({ id: 7, parent_profile: { timezone: 'UTC' } })) },
      ai_device: { findMany: jest.fn(async () => [{ mac_address: MAC, kid_id: 4n }]) },
    };

    jest.doMock('../../src/config/database', () => ({ prisma }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));
    jest.doMock('../../src/services/quiz.service', () => ({ progress: quizProgress }));

    mobileService = require('../../src/services/mobile.service');
  });

  test('reports each character against its own bank', async () => {
    const out = await mobileService.getQuizCharacterProgress('uid', { now: NOW });

    expect(quizProgress.mock.calls).toEqual([[NORMALISED_MAC, 'quiz'], [NORMALISED_MAC, 'riddle']]);
    expect(out.characters.map(c => c.character_id)).toEqual(['quizy', 'riddler']);
    expect(out.characters[0]).toMatchObject({
      character_name: 'Quizy', level: 2, questions_answered: 4, total_questions: 10, status: 'in_progress',
    });
    expect(out.total_questions_answered).toBe(8);
    expect(out.total_questions).toBe(20);
    expect(out.date).toBe('2026-08-10');
  });

  test('a finished band reads completed at the last level it cleared, not level 0', async () => {
    quizProgress.mockResolvedValue(standing({ current_level: null, levels_completed: 5, level_total: 0, level_cleared: 0 }));

    const out = await mobileService.getQuizCharacterProgress('uid', { now: NOW });

    expect(out.characters[0]).toMatchObject({ level: 5, status: 'completed', questions_answered: 0, total_questions: 0 });
  });

  test('an untouched level reads not_started rather than in_progress', async () => {
    quizProgress.mockResolvedValue(standing({ current_level: 1, levels_completed: 0, level_cleared: 0 }));

    const out = await mobileService.getQuizCharacterProgress('uid', { now: NOW });

    expect(out.characters.every(c => c.status === 'not_started')).toBe(true);
    expect(out.total_questions_answered).toBe(0);
  });

  test('a bank that is not deployed drops its character instead of failing the card', async () => {
    quizProgress.mockImplementation(async (_mac, bank) => {
      if (bank === 'riddle') throw new Error('relation "riddle_question" does not exist');
      return standing();
    });

    const out = await mobileService.getQuizCharacterProgress('uid', { now: NOW });

    expect(out.characters.map(c => c.character_id)).toEqual(['quizy']);
    expect(out.total_questions_answered).toBe(4);
  });

  test('a parent with no toy yet gets an empty card, not an error', async () => {
    prisma.ai_device.findMany.mockResolvedValue([]);

    const out = await mobileService.getQuizCharacterProgress('uid', { now: NOW });

    expect(out).toEqual({ date: '2026-08-10', characters: [], total_questions_answered: 0, total_questions: 0 });
    expect(quizProgress).not.toHaveBeenCalled();
  });

  test('a mac this parent does not own is refused rather than answered', async () => {
    await expect(mobileService.getQuizCharacterProgress('uid', { mac: '11:22:33:44:55:66', now: NOW }))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
