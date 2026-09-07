// A one-glance answer to "what is this agent for?".
//
// The agents carry a full operating procedure in `system_prompt` - output
// contracts, memory format, safety rules, hundreds of words of it - and the
// Agents table was putting the whole thing in a hover tooltip, which covered
// half the screen and told you nothing quickly.
//
// There is no curated description on ai_agent or ai_agent_template to read
// instead, and there could not usefully be one: every family's agent is its
// own row with its own prompt. So the summary is derived from the prompt.
//
// These prompts share a house style - a markdown heading, then "You are
// <name>, <what they are>", then "Your job is <what they do>" - so those two
// sentences are the summary, and everything after them is procedure.

const MAX_CHARS = 240;
// Per sentence, so one long identity line cannot eat the whole budget and
// starve the responsibility line, which is the half worth reading.
const MAX_SENTENCE_CHARS = 132;

// Lines that are structure rather than prose: headings, bullets, the numbered
// section markers. Dropping them stops a heading running into the sentence
// after it once the newlines collapse.
const STRUCTURAL = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/;

/** The prompt as flowing prose: no headings, no bullets, no hard wraps. */
function toProse(prompt) {
  return String(prompt || '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !STRUCTURAL.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sentence boundaries, without a lookbehind: Safari only grew those in 16.4
 * and Babel cannot polyfill a regex feature.
 *
 * A terminator only ends a sentence when whitespace follows it, which is what
 * keeps `MEMORY.md` and `4-10.` from splitting mid-token.
 */
function sentences(text) {
  const out = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    const next = text[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;

    const sentence = text.slice(start, i + 1).trim();
    if (sentence) out.push(sentence);
    start = i + 1;
  }

  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Trims to a whole word and marks that there is more behind it. */
function clamp(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}...`;
}

/**
 * Shortens a sentence by dropping trailing clauses rather than cutting through
 * one. "You are Cheeko, a best friend for children aged 4-10, in the shape of
 * a small orange fox - the face of the whole toy." loses the apposition and
 * stays a whole sentence, instead of ending "in the shape of the...".
 */
function trimClauses(sentence, maxChars) {
  if (sentence.length <= maxChars) return sentence;

  let text = sentence.replace(/[.!?]+$/, '');
  // Longest separator first, so an em-dash clause goes before a comma clause.
  const separators = [' - ', ' \u2014 ', ' \u2013 ', '; ', ', '];

  for (const separator of separators) {
    while (text.length > maxChars) {
      const at = text.lastIndexOf(separator);
      if (at <= 0) break;
      text = text.slice(0, at);
    }
    if (text.length <= maxChars) break;
  }

  return text.length <= maxChars ? `${text}.` : clamp(text, maxChars);
}

/**
 * Two or three lines saying what an agent is and what it is responsible for.
 *
 * @param {string} prompt - the agent's system prompt
 * @param {number} [maxChars] - length budget for the result
 * @returns {string} the summary, or '' when there is no prompt to read
 */
export function summarizeAgentPrompt(prompt, maxChars = MAX_CHARS) {
  const prose = toProse(prompt);
  if (!prose) return '';

  const parts = sentences(prose);

  // The identity sentence and the responsibility sentence, in prompt order.
  const identity = parts.find(s => /^you are\b/i.test(s));
  const duty = parts.find(s => /^your (job|role|purpose|task)\b/i.test(s));

  const picked = [identity, duty]
    .filter(Boolean)
    .map(sentence => trimClauses(sentence, MAX_SENTENCE_CHARS));

  // A prompt that does not follow the house style still gets its opening,
  // which is where an author puts the premise either way.
  const chosen = picked.length
    ? picked
    : parts.slice(0, 2).map(sentence => trimClauses(sentence, MAX_SENTENCE_CHARS));

  // Newline-joined: the tooltip renders it pre-line, so identity and duty land
  // on their own lines instead of running together into a block.
  return clamp(chosen.join('\n'), maxChars);
}

export default summarizeAgentPrompt;
