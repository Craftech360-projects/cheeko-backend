const { normalizeSpokenAnswer, spokenAnswerMatches } = require('../../src/services/answer-normalise');

// Under ADR-0009 a mis-scored answer costs a child a whole day on the level, so
// a microphone error becomes a punishment. These are the shallow errors that
// cause most of it.
describe('normalizeSpokenAnswer', () => {
  test('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeSpokenAnswer('  EIGHT!  ')).toBe('8');
    expect(normalizeSpokenAnswer('Eight,   legs')).toBe('8 legs');
  });

  test('maps spoken numbers to digits', () => {
    expect(normalizeSpokenAnswer('eight')).toBe('8');
    expect(normalizeSpokenAnswer('twenty')).toBe('20');
    expect(normalizeSpokenAnswer('8')).toBe('8');
  });

  test('maps the homophones STT returns constantly', () => {
    // "ate" for eight, "won" for one, "for" for four, "to" for two.
    expect(normalizeSpokenAnswer('ate')).toBe('8');
    expect(normalizeSpokenAnswer('won')).toBe('1');
    expect(normalizeSpokenAnswer('for')).toBe('4');
    expect(normalizeSpokenAnswer('to')).toBe('2');
  });

  test('strips filler around a real answer', () => {
    expect(normalizeSpokenAnswer("um, I think it's eight")).toBe('8');
    expect(normalizeSpokenAnswer('the answer is a spider')).toBe('spider');
  });

  test('an all-filler utterance normalises to empty, not to a stray token', () => {
    expect(normalizeSpokenAnswer('um, uh, I think...')).toBe('');
    expect(normalizeSpokenAnswer('   ')).toBe('');
    expect(normalizeSpokenAnswer(null)).toBe('');
  });

  test('non-English answers survive normalisation', () => {
    // Children answer in any Indian language; the prompt judges meaning, not
    // language, and this must not strip a script it does not recognise.
    expect(normalizeSpokenAnswer('पाँच')).toBe('पाँच');
    expect(normalizeSpokenAnswer('  पाँच!  ')).toBe('पाँच');
  });
});

describe('spokenAnswerMatches', () => {
  test('the misheard-but-correct case', () => {
    // The child said eight. STT returned "ate". Today this is marked wrong and
    // costs them the day.
    expect(spokenAnswerMatches('ate', 'eight')).toBe(true);
    expect(spokenAnswerMatches("um, it's ate", 'eight')).toBe(true);
    expect(spokenAnswerMatches('8', 'eight')).toBe(true);
  });

  test('matches an authored alternative, normalised the same way', () => {
    expect(spokenAnswerMatches('EIGHT LEGS!', 'eight', ['eight legs'])).toBe(true);
  });

  test('a genuinely wrong answer still misses', () => {
    // False accepts are worse than misses: a child credited for a wrong answer
    // learns nothing. Layer 1 only ever fires on an exact normalised match.
    expect(spokenAnswerMatches('six', 'eight')).toBe(false);
    expect(spokenAnswerMatches('spider', 'eight')).toBe(false);
    expect(spokenAnswerMatches('eighteen', 'eight')).toBe(false);
  });

  test('silence matches nothing, even a blank answer', () => {
    expect(spokenAnswerMatches('', 'eight')).toBe(false);
    expect(spokenAnswerMatches('um', 'eight')).toBe(false);
    expect(spokenAnswerMatches('   ', '')).toBe(false);
  });

  test('a blank bank answer is never a match', () => {
    expect(spokenAnswerMatches('eight', '', [])).toBe(false);
    expect(spokenAnswerMatches('eight', '', ['', '  '])).toBe(false);
  });
});
