/**
 * Pure resolver for Character -> Runtime Agent routing and worker session contract.
 * No DB, no hashing (see ADR-0001/0002/0003). A "character" is an ai_agent row.
 */

// Characters are fixed personas (Cheeko, Bheem, Tenali, ...). Clients sometimes create
// per-onboarding instances with a numeric suffix ("Cheeko 2"), which have no matching
// template and get spoken literally ("Cheeko two" / "Cheeko do"). Strip a trailing
// number so both the persona lookup AND the spoken name collapse to the base character.
const normalizeCharacterName = (name) => {
  const raw = String(name || '').trim();
  const base = raw.replace(/\s+\d+$/, '').trim();
  return base || raw;
};

const resolveRuntimeAgentName = (character) =>
  character.runtime_agent_name || (process.env.LIVEKIT_DEFAULT_AGENT || 'cheeko-agent');

const resolveSessionForCharacter = (character, { language } = {}) => ({
  characterId: character.id,
  characterName: normalizeCharacterName(character.agent_name),
  runtimeAgentName: resolveRuntimeAgentName(character),
  language: language ?? character.language ?? null,
  systemPrompt: character.system_prompt ?? null,
  soul: character.soul ?? null,
});

module.exports = { resolveRuntimeAgentName, resolveSessionForCharacter, normalizeCharacterName };
