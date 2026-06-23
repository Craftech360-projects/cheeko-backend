/**
 * Pure resolver for Character -> Runtime Agent routing and worker session contract.
 * No DB, no hashing (see ADR-0001/0002/0003). A "character" is an ai_agent row.
 */

const resolveRuntimeAgentName = (character) =>
  character.runtime_agent_name || (process.env.LIVEKIT_DEFAULT_AGENT || 'cheeko-agent1');

const resolveSessionForCharacter = (character, { language } = {}) => ({
  characterId: character.id,
  characterName: character.agent_name,
  runtimeAgentName: resolveRuntimeAgentName(character),
  language: language ?? character.language ?? null,
  systemPrompt: character.system_prompt ?? null,
  soul: character.soul ?? null,
});

module.exports = { resolveRuntimeAgentName, resolveSessionForCharacter };
