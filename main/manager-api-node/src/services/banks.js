/**
 * Question bank registry.
 *
 * Quizzy and Riddler play the identical game against different content, so they
 * share one service and one set of endpoints. What differs is only which pair of
 * tables the queries point at — which is exactly what this file holds.
 *
 * The tables are separate rather than one table with a kind column, so a riddle
 * can never appear in Quizzy's deriveLevelState: the query is against a
 * different relation, not a filter someone can forget to apply.
 *
 * Both answer tables name their foreign key `question_id` and both question
 * tables name their text column `question_text`, so the shared service needs no
 * per-bank field mapping. `riddle_text` would have read better and cost an
 * indirection in every query, the importer and the admin page.
 *
 * Spec: picoclaw docs/issues/riddle-bank/000-design.md
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

const BANKS = {
  quiz: {
    questions: prisma.quiz_question,
    answers: prisma.quiz_question_answer,
    // clearDayGate needs a literal table name: a tagged template cannot
    // parameterise one. Interpolating this is safe only because it comes from
    // this map and never from a caller.
    answerTable: 'quiz_question_answer',
    // kid_learning_progress is unique on (kid_id, subject, topic) and topic is
    // "<band> level <n>". Without a distinct subject per bank, finishing riddle
    // level 1 would overwrite the child's quiz level 1 achievement.
    subject: 'quiz',
    // Log prefix. The two banks are debugged from the same log stream.
    label: 'QUIZ',
    // Does a revealed answer count the question as cleared?
    //
    // FALSE since ADR-0009: a question the child did not solve comes back
    // another day. This reverses quiz-bank ticket 006, which chose flow over
    // mastery on purpose — read that ADR before flipping it back.
    //
    // The flag exists because the two characters share one service, so without
    // it this line would have changed Riddler in the same commit.
    clearOnReveal: false,
  },
  riddle: {
    questions: prisma.riddle_question,
    answers: prisma.riddle_question_answer,
    answerTable: 'riddle_question_answer',
    subject: 'riddle',
    label: 'RIDDLE',
    // Stays true, deliberately. A riddle whose answer you already know is not a
    // riddle — repeating it until solved teaches nothing and only frustrates.
    // Riddler keeps flow; Quizzy takes mastery.
    clearOnReveal: true,
  },
};

const DEFAULT_BANK = 'quiz';

/**
 * The answer results that count a question as Cleared, for one bank.
 *
 * The single place either service may ask. `correct` always clears; `revealed`
 * clears only where the bank chose flow over mastery.
 *
 * @param {{clearOnReveal?: boolean}} bank - a BANKS entry, as resolveBank returns
 * @returns {string[]}
 */
const clearedResultsFor = (bank) => (bank?.clearOnReveal ? ['correct', 'revealed'] : ['correct']);

/**
 * Character `agent_code` -> bank. Note it is agent_code, not the display name.
 *
 * Null-prototype: `character` arrives straight off a query string, and a plain
 * object would answer `CHARACTER_BANK['constructor']` with a truthy function.
 */
const CHARACTER_BANK = Object.assign(Object.create(null), {
  quiz_master: 'quiz',
  riddle_master: 'riddle',
});

/**
 * Which bank a character plays from.
 *
 * Unknown or absent characters get the quiz bank: every caller today sends no
 * character at all, and they must keep working unchanged.
 *
 * @param {string} [character] the character's agent_code
 * @returns {'quiz'|'riddle'}
 */
const bankFor = (character) => CHARACTER_BANK[character] || DEFAULT_BANK;

/**
 * The table pair for a bank name.
 *
 * Unlike bankFor, an unrecognised name throws. A character we do not know is a
 * normal thing the API is asked about; a BANK we do not know means a caller
 * invented one, and serving quiz data instead would hide the bug.
 *
 * @param {'quiz'|'riddle'} [bank]
 */
const resolveBank = (bank = DEFAULT_BANK) => {
  const resolved = BANKS[bank];
  if (!resolved) {
    throw new Error(`unknown bank "${bank}" (have: ${Object.keys(BANKS).join(', ')})`);
  }
  return resolved;
};

// ai_agent_template.id is a Postgres uuid column. Handing Prisma a non-uuid
// string throws, so a junk metadata field would 500 every session rather than
// falling through to the quiz bank.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a bank from whatever identifies the character.
 *
 * The worker cannot send agent_code: it lives on the persona, and the quiz fetch
 * deliberately runs BEFORE the persona pull so the two overlap. Room metadata
 * carries only the character's uuid and its display name, so both arrive here
 * and this looks up the agent_code they point at.
 *
 * Never throws. A character-table hiccup must not take the quiz down for every
 * child, so anything unresolvable serves the quiz bank.
 *
 * @param {{character?: string, characterId?: string}} [ref]
 * @returns {Promise<'quiz'|'riddle'>}
 */
const bankForCharacterRef = async (ref = {}) => {
  const character = String(ref.character || '').trim();
  const characterId = String(ref.characterId || '').trim();

  // A caller that already knows the agent_code (curl, tests, a future worker)
  // skips the lookup entirely.
  if (character && CHARACTER_BANK[character]) {
    return CHARACTER_BANK[character];
  }

  // Tried in order, and a miss falls through to the next. The uuid is preferred
  // but is NOT authoritative: a live session on 2026-08-06 arrived with a
  // character_id that matched no row while the display name resolved fine, and
  // stopping at the uuid served Riddler the quiz bank.
  const candidates = [];
  if (UUID_RE.test(characterId)) candidates.push({ id: characterId });
  if (character) candidates.push({ agent_name: character });

  for (const where of candidates) {
    try {
      const row = await prisma.ai_agent_template.findFirst({
        where,
        select: { agent_code: true },
      });
      if (row?.agent_code) return bankFor(row.agent_code);
    } catch (error) {
      logger.warn(`[QUIZ] bank lookup failed for ${JSON.stringify(where)}: ${error.message}`);
    }
  }

  return DEFAULT_BANK;
};

module.exports = {
  BANKS,
  CHARACTER_BANK,
  DEFAULT_BANK,
  bankFor,
  bankForCharacterRef,
  clearedResultsFor,
  resolveBank,
};
