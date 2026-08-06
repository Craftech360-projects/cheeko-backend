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
  },
  riddle: {
    questions: prisma.riddle_question,
    answers: prisma.riddle_question_answer,
    answerTable: 'riddle_question_answer',
    subject: 'riddle',
    label: 'RIDDLE',
  },
};

const DEFAULT_BANK = 'quiz';

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

module.exports = { BANKS, CHARACTER_BANK, DEFAULT_BANK, bankFor, resolveBank };
