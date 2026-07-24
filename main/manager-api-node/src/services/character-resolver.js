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
