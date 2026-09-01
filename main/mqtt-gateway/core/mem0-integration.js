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
function buildDispatchMetadata({ macAddress, deviceId, character, characterId = null, language = null, sarvamVoiceId = null, elevenlabsVoiceId = null, smallestVoiceId = null, childProfile, sessionConfig = {} }) {
  // ADR-0004: the worker reads a stable shape, so parent_rule is always present —
  // null when the child has no rule. Passing childProfile through verbatim left the
  // key `undefined`, and JSON.stringify drops undefined keys entirely.
  const parentRule = (childProfile && childProfile.parent_rule) ? String(childProfile.parent_rule) : null;
  logger.debug(`[PARENT-RULE] dispatch metadata for mac=${macAddress}: parent_rule ${parentRule ? `PRESENT (${parentRule.length} chars): "${parentRule.slice(0, 80)}"` : 'ABSENT'}`);

  // The child this device is PAIRED to, or null. The worker keys its workspace
  // directory on it, so it must be the pairing and not childProfile.id, which
  // the manager falls back to the owner's most recent child when there is no
  // pairing — that would give an unpaired toy a sibling's workspace.
  const pairedKidId = (childProfile && childProfile.pairedKidId) ? String(childProfile.pairedKidId) : null;

  return JSON.stringify({
    device_mac: macAddress,
    device_uuid: deviceId,
    kid_id: pairedKidId,
    character: character || "Cheeko",
    character_id: characterId,
    language: language,
    sarvam_voice_id: sarvamVoiceId,
    elevenlabs_voice_id: elevenlabsVoiceId,
    smallest_voice_id: smallestVoiceId,
    child_profile: childProfile ? { ...childProfile, parent_rule: parentRule } : null,
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
