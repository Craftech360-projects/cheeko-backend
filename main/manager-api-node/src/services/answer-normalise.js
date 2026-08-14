/**
 * STT Layer 1 — normalise a spoken answer before comparing it.
 *
 * Speech recognition runs BEFORE the model judges, so a child who said the right
 * word can be marked wrong for a machine's mistake. That used to cost one
 * question. Under ADR-0009 it costs the child another whole day on the same
 * level, which turns a microphone error into a punishment.
 *
 * Deliberately shallow: lowercase, strip punctuation and filler, and map spoken
 * numbers to digits. Phonetic matching (Double Metaphone, edit distance) is
 * Layer 2 and is NOT here — it carries false-accept risk that needs measuring
 * against real transcripts first, and a child credited for a wrong answer learns
 * nothing. Everything below only ever fires on an exact match after
 * normalisation, so it cannot invent a hit.
 */

// Spoken numbers, both directions. "ate" and "won" are here rather than in a
// phonetic layer because STT returns them constantly for "eight" and "one".
const NUMBER_WORDS = {
  zero: '0', oh: '0', nought: '0',
  one: '1', won: '1',
  two: '2', to: '2', too: '2',
  three: '3',
  four: '4', for: '4', fore: '4',
  five: '5',
  six: '6', sicks: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9',
  ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};

// Dropped before comparing. Kept short on purpose: every word here is one a
// child could conceivably answer with, so the list earns each entry.
const FILLER = new Set([
  'um', 'uh', 'er', 'hmm', 'ah', 'oh',
  'i', 'think', 'its', 'it', 'is', 'the', 'a', 'an',
  'answer', 'maybe', 'like', 'well', 'so', 'that', 'thats',
]);

/**
 * @param {string} raw - what speech recognition returned
 * @returns {string} comparable form, '' when nothing survives
 */
const normalizeSpokenAnswer = (raw) => {
  if (typeof raw !== 'string') return '';

  const words = raw
    .toLowerCase()
    // Apostrophes are DELETED, not spaced: "it's" must become "its" so the
    // filler list catches it. Spacing it leaves a stray "s" that survives as an
    // answer word. Both the ASCII and the curly form STT emits.
    .replace(/['’]/g, '')
    // Everything else punctuation becomes a separator. \p{M} is in the keep-set
    // alongside letters and digits: Devanagari vowel signs and nuqtas are marks,
    // not letters, so without it "पाँच" is shredded to "प च".
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const kept = words
    .filter((w) => !FILLER.has(w))
    .map((w) => NUMBER_WORDS[w] || w);

  // Everything was filler — "um, I think..." with no answer in it. Return empty
  // rather than a stray token, so the caller treats it as no answer at all.
  return kept.join(' ');
};

/**
 * Does a transcribed answer match the bank's answer once normalised?
 *
 * Exact match only, after normalisation on both sides. `accepted_answers` are
 * the author's alternatives and get the same treatment.
 *
 * @param {string} said
 * @param {string} answerText
 * @param {string[]} [acceptedAnswers]
 * @returns {boolean}
 */
const spokenAnswerMatches = (said, answerText, acceptedAnswers = []) => {
  const norm = normalizeSpokenAnswer(said);
  // An empty transcript matches nothing. Silence is not a correct answer, and
  // without this an unanswerable question with a blank answer would match it.
  if (!norm) return false;

  const candidates = [answerText, ...(Array.isArray(acceptedAnswers) ? acceptedAnswers : [])];
  return candidates.some((candidate) => {
    const normCandidate = normalizeSpokenAnswer(candidate);
    return normCandidate !== '' && normCandidate === norm;
  });
};

module.exports = { normalizeSpokenAnswer, spokenAnswerMatches, NUMBER_WORDS, FILLER };
