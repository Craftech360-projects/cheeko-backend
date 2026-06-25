/**
 * AGENT.md save-time safety validator.
 *
 * The character persona is stored in the `system_prompt` column. As of the
 * "full AGENT.md in system_prompt" change, that column may hold the ENTIRE
 * AGENT.md (scaffold + persona baked together) with exactly one `<!-- LANGUAGE -->`
 * placeholder that the worker fills at session time.
 *
 * Discriminator: a value is treated as a "full" AGENT.md iff it contains
 * `<!-- LANGUAGE -->`. Legacy persona snippets (no language placeholder) are left
 * untouched so existing short personas keep saving.
 *
 * For full AGENT.md values we enforce a small set of safety invariants before
 * persisting, so a malformed prompt can never reach a child-facing session.
 */

const LANGUAGE_PLACEHOLDER = '<!-- LANGUAGE -->';

/**
 * Validate a value destined for an `ai_agent` / `ai_agent_template` `system_prompt`.
 *
 * No-op (returns the input unchanged) when:
 *   - the value is empty/blank, or
 *   - the value is a legacy persona snippet (does NOT contain `<!-- LANGUAGE -->`).
 *
 * When the value IS a full AGENT.md (contains `<!-- LANGUAGE -->`), it must:
 *   1. contain a `## Child-Safety Rules` heading,
 *   2. contain a `## Runtime Guardrails` heading,
 *   3. contain EXACTLY ONE `<!-- LANGUAGE -->` placeholder.
 *
 * @param {*} text - The system_prompt value to validate.
 * @returns {*} The same value, unchanged, when valid (or not applicable).
 * @throws {Error} with `statusCode = 400` listing what is missing, when invalid.
 */
function validateAgentMd(text) {
  if (typeof text !== 'string') {
    return text;
  }

  const occurrences = countOccurrences(text, LANGUAGE_PLACEHOLDER);

  // Legacy persona snippet (no language slot) -> not a full AGENT.md, pass through.
  if (occurrences === 0) {
    return text;
  }

  const problems = [];

  if (!/^##\s+Child-Safety Rules\s*$/m.test(text)) {
    problems.push('missing a "## Child-Safety Rules" heading');
  }
  if (!/^##\s+Runtime Guardrails\s*$/m.test(text)) {
    problems.push('missing a "## Runtime Guardrails" heading');
  }
  if (occurrences !== 1) {
    problems.push(
      `must contain exactly one "${LANGUAGE_PLACEHOLDER}" placeholder (found ${occurrences})`
    );
  }

  if (problems.length > 0) {
    const error = new Error(
      `Invalid AGENT.md system_prompt: ${problems.join('; ')}.`
    );
    error.statusCode = 400;
    throw error;
  }

  return text;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

module.exports = { validateAgentMd, LANGUAGE_PLACEHOLDER };
