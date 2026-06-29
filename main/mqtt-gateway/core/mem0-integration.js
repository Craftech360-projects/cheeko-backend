/**
 * Dispatch Metadata Builder
 *
 * Builds the LiveKit room/job dispatch metadata JSON for a device session.
 * (Long-term memory / Mem0 integration was removed; the metadata still carries
 * empty memory fields so the worker's contract stays stable.)
 */

const logger = require('../utils/logger');

// Single source of truth for the routing fallback agent. Used ONLY when the
// Manager API supplies no runtimeAgentName (failure/timeout, or an unset row).
// Must match the deployed worker's --agent-name (deploy/k8s/livekit-deployment.yaml).
const DEFAULT_RUNTIME_AGENT = process.env.LIVEKIT_DEFAULT_AGENT || "cheeko-agent";

/**
 * Build dispatch metadata for a device session.
 * @param {object} params - macAddress, deviceId, character, characterId, language, childProfile, sessionConfig
 * @returns {string} JSON string for dispatch metadata
 */
function buildDispatchMetadata({ macAddress, deviceId, character, characterId = null, language = null, childProfile, sessionConfig = {} }) {
  // ADR-0004: confirm whether a parent rule is being placed into room metadata.
  const _parentRule = (childProfile && childProfile.parent_rule) ? String(childProfile.parent_rule) : null;
  logger.debug(`[PARENT-RULE] dispatch metadata for mac=${macAddress}: parent_rule ${_parentRule ? `PRESENT (${_parentRule.length} chars): "${_parentRule.slice(0, 80)}"` : 'ABSENT'}`);

  return JSON.stringify({
    device_mac: macAddress,
    device_uuid: deviceId,
    character: character || "Cheeko",
    character_id: characterId,
    language: language,
    child_profile: childProfile || null,
    session_language_code: sessionConfig.languageCode || null,
    session_language_name: sessionConfig.languageName || null,
    session_voice_id: sessionConfig.voiceId || null,
    session_agent_name: sessionConfig.agentName || null,
    long_term_memories: [],
    memory_relations: [],
    memory_entities: [],
    timestamp: Date.now(),
  });
}

module.exports = {
  buildDispatchMetadata,
  DEFAULT_RUNTIME_AGENT,
};
