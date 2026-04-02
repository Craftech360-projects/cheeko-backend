/**
 * Mem0 Integration Layer
 *
 * Handles memory fetching with timeout and graceful degradation.
 * Orchestrates Mem0 operations for the MQTT Gateway.
 * Keeps virtual-connection.js clean.
 */

const mem0Client = require('./mem0-client');
const logger = require('../utils/logger');

// Configuration
const MEM0_TIMEOUT_MS = 2000;  // 2 second timeout
const MEM0_MEMORY_LIMIT = 20;  // ~500 tokens max

/**
 * Fetch memories for a device with timeout protection
 * @param {string} deviceId - Device MAC address
 * @returns {Promise<{memories: string[], relations: Array, entities: Array}>} Memory data (empty on failure)
 */
async function fetchMemoriesWithTimeout(deviceId) {
  if (!deviceId) {
    return { memories: [], relations: [], entities: [] };
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Mem0 fetch timeout')), MEM0_TIMEOUT_MS)
    );

    const result = await Promise.race([
      mem0Client.getMemories(deviceId),
      timeoutPromise
    ]);

    // Handle both old format (array) and new format (object with memories/relations)
    if (Array.isArray(result)) {
      // Old format: just array of memory strings
      if (result.length > 0) {
        logger.info(`[MEM0-INT] Retrieved ${result.length} memories for ${deviceId}`);
      }
      return { memories: result, relations: [], entities: [] };
    } else if (result && typeof result === 'object') {
      // New format: object with memories, relations, entities
      const memories = result.memories || [];
      if (memories.length > 0) {
        logger.info(`[MEM0-INT] Retrieved ${memories.length} memories, ${result.relations?.length || 0} relations for ${deviceId}`);
      }
      return {
        memories: memories,
        relations: result.relations || [],
        entities: result.entities || []
      };
    }

    return { memories: [], relations: [], entities: [] };

  } catch (error) {
    // Graceful degradation - log and return empty
    logger.warn(`[MEM0-INT] Fetch failed for ${deviceId}: ${error.message}`);
    return { memories: [], relations: [], entities: [] };
  }
}

/**
 * Build enhanced context by merging child profile with Mem0 memories
 * @param {string} deviceId - Device MAC address
 * @param {object} childProfile - Child profile from database
 * @returns {Promise<object>} Enhanced context with memories
 */
async function buildEnhancedContext(deviceId, childProfile) {
  const memoryData = await fetchMemoriesWithTimeout(deviceId);

  return {
    child_profile: childProfile || null,
    long_term_memories: memoryData.memories,
    memory_relations: memoryData.relations,
    memory_entities: memoryData.entities,
    memory_count: memoryData.memories.length
  };
}

/**
 * Build dispatch metadata with memories included
 * @param {object} params - Parameters for metadata
 * @returns {string} JSON string for dispatch metadata
 */
function buildDispatchMetadata({ macAddress, deviceId, character, childProfile, memoryData, sessionConfig = {} }) {
  // Handle both old format (array) and new format (object)
  let memories = [];
  let relations = [];
  let entities = [];

  if (Array.isArray(memoryData)) {
    memories = memoryData;
  } else if (memoryData && typeof memoryData === 'object') {
    memories = memoryData.memories || [];
    relations = memoryData.relations || [];
    entities = memoryData.entities || [];
  }

  return JSON.stringify({
    device_mac: macAddress,
    device_uuid: deviceId,
    character: character || "Cheeko",
    child_profile: childProfile || null,
    session_language_code: sessionConfig.languageCode || null,
    session_language_name: sessionConfig.languageName || null,
    session_voice_id: sessionConfig.voiceId || null,
    session_agent_name: sessionConfig.agentName || null,
    long_term_memories: memories,
    memory_relations: relations,
    memory_entities: entities,
    timestamp: Date.now(),
  });
}

/**
 * Format memories for prompt injection
 * @param {Array} memories - Array of memory strings
 * @param {Array} entities - Array of entity objects
 * @returns {string} Formatted memory context for prompt
 */
function formatMemoriesForPrompt(memories, entities = []) {
  if (!memories || memories.length === 0) {
    return '';
  }

  let formatted = '## WHAT YOU REMEMBER ABOUT THIS CHILD:\n';

  // Add memory facts
  for (const memory of memories) {
    formatted += `- ${memory}\n`;
  }

  // Add key entities if available
  if (entities && entities.length > 0) {
    const people = entities.filter(e => e.type === 'person');
    const pets = entities.filter(e => e.type === 'pet' || e.type === 'dog' || e.type === 'cat');

    if (people.length > 0) {
      formatted += `\nKey people: ${people.map(p => p.name).join(', ')}\n`;
    }
    if (pets.length > 0) {
      formatted += `Pets: ${pets.map(p => p.name).join(', ')}\n`;
    }
  }

  return formatted;
}

module.exports = {
  fetchMemoriesWithTimeout,
  buildEnhancedContext,
  buildDispatchMetadata,
  formatMemoriesForPrompt,
  MEM0_TIMEOUT_MS,
  MEM0_MEMORY_LIMIT
};
