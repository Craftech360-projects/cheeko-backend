/**
 * Resolving a bank from what the worker actually knows.
 *
 * The worker cannot send agent_code: that lives on the persona, and the quiz
 * fetch deliberately runs before the persona pull so the two overlap. All it has
 * from room metadata is the character's uuid and its display name, so the API
 * resolves those to an agent_code and then to a bank.
 */

const mockFindFirst = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    quiz_question: {}, quiz_question_answer: {},
    riddle_question: {}, riddle_question_answer: {},
    ai_agent_template: { findFirst: (...a) => mockFindFirst(...a) },
  },
}));

const { bankForCharacterRef } = require('../../src/services/banks');

const UUID = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607';

beforeEach(() => jest.clearAllMocks());

describe('bankForCharacterRef', () => {
  it('uses a directly supplied agent_code without touching the database', async () => {
    expect(await bankForCharacterRef({ character: 'riddle_master' })).toBe('riddle');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('resolves a character uuid to its bank', async () => {
    mockFindFirst.mockResolvedValue({ agent_code: 'riddle_master' });

    expect(await bankForCharacterRef({ characterId: UUID })).toBe('riddle');
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: UUID } })
    );
  });

  it('resolves a display name when there is no uuid', async () => {
    // Room metadata carries "character": "Riddler" — the display name, not the
    // agent_code. Sessions bootstrapped without an id depend on this path.
    mockFindFirst.mockResolvedValue({ agent_code: 'riddle_master' });

    expect(await bankForCharacterRef({ character: 'Riddler' })).toBe('riddle');
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agent_name: 'Riddler' } })
    );
  });

  it('never queries a malformed uuid', async () => {
    // id is a Postgres uuid column: handing Prisma "not-a-uuid" throws, which
    // would turn a junk metadata field into a 500 on every session.
    expect(await bankForCharacterRef({ characterId: 'not-a-uuid' })).toBe('quiz');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to quiz for a character with no agent_code', async () => {
    mockFindFirst.mockResolvedValue({ agent_code: null });
    expect(await bankForCharacterRef({ characterId: UUID })).toBe('quiz');
  });

  it('falls back to quiz for an unknown character', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await bankForCharacterRef({ characterId: UUID })).toBe('quiz');
  });

  it('falls back to the display name when the uuid matches no row', async () => {
    // Observed live 2026-08-06: the session carried a well-formed character_id
    // that existed in no template row, while "riddler" resolved fine. Stopping
    // at the uuid served Riddler the quiz bank.
    mockFindFirst
      .mockResolvedValueOnce(null)                          // uuid miss
      .mockResolvedValueOnce({ agent_code: 'riddle_master' }); // name hit

    expect(await bankForCharacterRef({ characterId: UUID, character: 'riddler' })).toBe('riddle');
    expect(mockFindFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: UUID } }));
    expect(mockFindFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { agent_name: 'riddler' } }));
  });

  it('still falls back to the display name when the uuid lookup throws', async () => {
    mockFindFirst
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ agent_code: 'riddle_master' });

    expect(await bankForCharacterRef({ characterId: UUID, character: 'riddler' })).toBe('riddle');
  });

  it('falls back to quiz when nothing is supplied', async () => {
    expect(await bankForCharacterRef({})).toBe('quiz');
    expect(await bankForCharacterRef()).toBe('quiz');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('serves quiz rather than failing when the lookup errors', async () => {
    // A character-table hiccup must not take down the quiz for every child.
    mockFindFirst.mockRejectedValue(new Error('connection reset'));
    expect(await bankForCharacterRef({ characterId: UUID })).toBe('quiz');
  });

  it('tries the uuid first when both are sent, and stops once it hits', async () => {
    mockFindFirst.mockResolvedValue({ agent_code: 'riddle_master' });

    await bankForCharacterRef({ characterId: UUID, character: 'Riddler' });

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: UUID } })
    );
  });
});
