const { BANKS, clearedResultsFor } = require('../../src/services/banks');

// Quizzy and Riddler share one service, so before this flag existed a change to
// progression for one silently changed the other in the same commit. These tests
// are what stop that regressing.
describe('clearOnReveal', () => {
  test('today both banks clear on reveal — behaviour is unchanged by the flag', () => {
    // Ticket 006 introduces the seam only. Ticket 008 flips quiz.
    expect(clearedResultsFor(BANKS.quiz)).toEqual(['correct', 'revealed']);
    expect(clearedResultsFor(BANKS.riddle)).toEqual(['correct', 'revealed']);
  });

  test('the two banks can diverge — the whole point of the flag', () => {
    const mastery = clearedResultsFor({ clearOnReveal: false });
    const flow = clearedResultsFor({ clearOnReveal: true });

    expect(mastery).toEqual(['correct']);
    expect(flow).toEqual(['correct', 'revealed']);

    // The same revealed row clears in one bank and not the other.
    expect(flow.includes('revealed')).toBe(true);
    expect(mastery.includes('revealed')).toBe(false);
  });

  test('correct always clears, whatever the bank chose', () => {
    expect(clearedResultsFor({ clearOnReveal: true })).toContain('correct');
    expect(clearedResultsFor({ clearOnReveal: false })).toContain('correct');
  });

  test('a bank with no flag set does not clear on reveal', () => {
    // Fail safe towards mastery: a new bank that forgot to declare its intent
    // should repeat an unsolved question, not hand out a free pass.
    expect(clearedResultsFor({})).toEqual(['correct']);
    expect(clearedResultsFor(undefined)).toEqual(['correct']);
  });

  test('every registered bank declares its intent explicitly', () => {
    // The default above is a safety net, not somewhere a real bank should land.
    for (const [name, bank] of Object.entries(BANKS)) {
      expect(typeof bank.clearOnReveal).toBe('boolean');
      expect(name).toBeTruthy();
    }
  });
});
