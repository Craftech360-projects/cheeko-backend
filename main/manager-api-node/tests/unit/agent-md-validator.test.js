/**
 * AGENT.md save-time validator unit tests.
 *
 * Discriminator: a value is a "full" AGENT.md iff it contains `<!-- LANGUAGE -->`.
 * Full values must carry the two safety headings and exactly one language slot;
 * legacy persona snippets (no language slot) always pass.
 */

const { validateAgentMd } = require('../../src/utils/agent-md-validator');

const FULL_VALID = [
  '# Cheeko',
  '',
  'You are Cheeko, a playful buddy.',
  '',
  '## Child-Safety Rules',
  'Be kind, never scary.',
  '',
  '## Runtime Guardrails',
  'Stay in character.',
  '',
  'Respond in: <!-- LANGUAGE -->.',
  '',
].join('\n');

describe('validateAgentMd', () => {
  test('full + valid AGENT.md passes and returns the input unchanged', () => {
    expect(validateAgentMd(FULL_VALID)).toBe(FULL_VALID);
  });

  test('safety headings with a "(Critical)" qualifier still pass (real scaffold)', () => {
    const withQualifier = FULL_VALID
      .replace('## Child-Safety Rules', '## Child-Safety Rules (Critical)')
      .replace('## Runtime Guardrails', '## Runtime Guardrails (Critical)');
    expect(validateAgentMd(withQualifier)).toBe(withQualifier);
  });

  test('full AGENT.md missing a safety heading throws 400', () => {
    const missingGuardrails = FULL_VALID.replace('## Runtime Guardrails', '## Other Section');
    expect.assertions(2);
    try {
      validateAgentMd(missingGuardrails);
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/Runtime Guardrails/);
    }
  });

  test('full AGENT.md missing Child-Safety Rules throws 400', () => {
    const missingSafety = FULL_VALID.replace('## Child-Safety Rules', '## Random Heading');
    expect(() => validateAgentMd(missingSafety)).toThrow(/Child-Safety Rules/);
  });

  test('full AGENT.md with zero language slots is NOT treated as full (legacy) and passes', () => {
    // Removing the only slot makes it a legacy snippet by the discriminator -> no-op.
    const noSlot = FULL_VALID.replace('Respond in: <!-- LANGUAGE -->.', 'Respond in English.');
    expect(validateAgentMd(noSlot)).toBe(noSlot);
  });

  test('full AGENT.md with two language slots throws 400', () => {
    const twoSlots = FULL_VALID.replace(
      'Respond in: <!-- LANGUAGE -->.',
      'Respond in: <!-- LANGUAGE -->. Also: <!-- LANGUAGE -->.'
    );
    expect.assertions(2);
    try {
      validateAgentMd(twoSlots);
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toMatch(/exactly one/);
    }
  });

  test('legacy persona snippet (no language slot) passes unchanged', () => {
    const snippet = 'You are Cheeko, a playful buddy who loves songs.';
    expect(validateAgentMd(snippet)).toBe(snippet);
  });

  test('non-string / empty values are passed through untouched', () => {
    expect(validateAgentMd('')).toBe('');
    expect(validateAgentMd(null)).toBeNull();
    expect(validateAgentMd(undefined)).toBeUndefined();
  });
});
