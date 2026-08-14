const { toWireResult, quizMastery } = require('../../src/services/mobile.service');

// GET /toy/api/mobile/progress/quiz is published to app developers in
// docs/parent-app-quiz-analytics-api.md. These tests exist so the mastery work
// (ADR-0009) cannot change what an app already in the wild renders.
describe('parent-app quiz wire contract', () => {
  const PUBLISHED = ['correct', 'wrong', 'revealed'];

  describe('toWireResult', () => {
    test.each(PUBLISHED)('legacy %s passes through unchanged', (legacy) => {
      expect(toWireResult(legacy)).toBe(legacy);
    });

    test('the new vocabulary maps onto the published three', () => {
      // The corrected direction. The design document originally proposed
      // helped -> revealed and missed -> wrong, which is backwards: the live
      // prompt only emits correct|revealed, `revealed` already means the answer
      // was told to the child, and Quizzy never emits `wrong` at all.
      expect(toWireResult('solo')).toBe('correct');
      expect(toWireResult('helped')).toBe('correct');
      expect(toWireResult('missed')).toBe('revealed');
    });

    test('no verdict escapes the published enum', () => {
      for (const internal of ['solo', 'helped', 'missed', ...PUBLISHED]) {
        expect(PUBLISHED).toContain(toWireResult(internal));
      }
    });

    test('helped scores as correct, so no score drops overnight', () => {
      // points is 10 x correct. If helped mapped anywhere else, every child who
      // ever needed a hint would lose points for a change they cannot see.
      expect(toWireResult('helped')).toBe('correct');
    });
  });

  describe('quizMastery', () => {
    test('a revealed answer is practised, however many tries it took', () => {
      expect(quizMastery('revealed', 0)).toBe('practised');
      expect(quizMastery('revealed', 3)).toBe('practised');
      expect(quizMastery('missed', 2)).toBe('practised');
    });

    test('one recorded try is solo, more than one is helped', () => {
      expect(quizMastery('correct', 1)).toBe('solo');
      expect(quizMastery('correct', 2)).toBe('helped');
    });

    test('no attempt data is null, never a guess', () => {
      // A stored `correct` from before attempt logging conflates FIRST_TRY and
      // WITH_HINT. Defaulting to solo would overstate mastery to a parent.
      expect(quizMastery('correct', 0)).toBeNull();
      expect(quizMastery('correct', undefined)).toBeNull();
    });
  });
});
