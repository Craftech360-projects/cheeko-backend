/**
 * Agent Service
 *
 * Handles AI agent configuration, chat history, and device integration.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress, transformKeysToCamel } = require('../utils/helpers');
const mem0Service = require('./integrations/mem0.service');

/**
 * Create a new agent
 * @param {number} userId - User ID
 * @param {Object} data - Agent data
 * @returns {Promise<Object>} Created agent
 */
const createAgent = async (userId, data) => {
  const agent = await prisma.ai_agent.create({
    data: {
      user_id: BigInt(userId),
      agent_code: data.agentCode || null,
      agent_name: data.agentName,
      asr_model_id: data.asrModelId || null,
      vad_model_id: data.vadModelId || null,
      llm_model_id: data.llmModelId || null,
      vllm_model_id: data.vllmModelId || null,
      tts_model_id: data.ttsModelId || null,
      tts_voice_id: data.ttsVoiceId || null,
      mem_model_id: data.memModelId || null,
      intent_model_id: data.intentModelId || null,
      chat_history_conf: data.chatHistoryConf || 0,
      system_prompt: data.systemPrompt || null,
      summary_memory: data.summaryMemory || null,
      lang_code: data.langCode || 'en',
      language: data.language || 'English',
      sort: data.sort || 0,
      creator: BigInt(userId),
    },
  });
  return agent;
};

/**
 * Get agent by ID
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (optional, for ownership check)
 * @returns {Promise<Object>} Agent
 */
const getAgentById = async (agentId, userId = null) => {
  const agent = await prisma.ai_agent.findUnique({
    where: { id: agentId, ...(userId ? { user_id: BigInt(userId) } : {}) },
  });
  return agent || null;
};

/**
 * Update agent
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated agent
 */
const updateAgent = async (agentId, _userId, data) => {
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  const updateData = { updated_at: new Date() };
  if (data.agentCode !== undefined) updateData.agent_code = data.agentCode;
  if (data.agentName !== undefined) updateData.agent_name = data.agentName;
  if (data.asrModelId !== undefined) updateData.asr_model_id = data.asrModelId;
  if (data.vadModelId !== undefined) updateData.vad_model_id = data.vadModelId;
  if (data.llmModelId !== undefined) updateData.llm_model_id = data.llmModelId;
  if (data.vllmModelId !== undefined) updateData.vllm_model_id = data.vllmModelId;
  if (data.ttsModelId !== undefined) updateData.tts_model_id = data.ttsModelId;
  if (data.ttsVoiceId !== undefined) updateData.tts_voice_id = data.ttsVoiceId;
  if (data.memModelId !== undefined) updateData.mem_model_id = data.memModelId;
  if (data.intentModelId !== undefined) updateData.intent_model_id = data.intentModelId;
  if (data.chatHistoryConf !== undefined) updateData.chat_history_conf = data.chatHistoryConf;
  if (data.systemPrompt !== undefined) updateData.system_prompt = data.systemPrompt;
  if (data.summaryMemory !== undefined) updateData.summary_memory = data.summaryMemory;
  if (data.langCode !== undefined) updateData.lang_code = data.langCode;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.sort !== undefined) updateData.sort = data.sort;

  const agent = await prisma.ai_agent.update({ where: { id: agentId }, data: updateData });
  return agent;
};

/**
 * Delete agent and all associated records
 * Matches Spring Boot behavior: deletes devices, chat history, and plugins first
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 */
const deleteAgent = async (agentId, _userId) => {
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  // Unlink devices and unassign kids (set agent_id and kid_id to null rather than delete)
  await prisma.ai_device.updateMany({ where: { agent_id: agentId }, data: { agent_id: null, kid_id: null } });
  // Delete associated chat history
  await prisma.ai_agent_chat_history.deleteMany({ where: { agent_id: agentId } });
  // Delete plugin mappings via raw SQL (table not in Prisma schema)
  await prisma.$executeRawUnsafe(`DELETE FROM ai_agent_plugin_mapping WHERE agent_id = $1::uuid`, agentId).catch(() => {});
  // Delete the agent
  await prisma.ai_agent.delete({ where: { id: agentId } });
};

/**
 * List agents for user (paginated)
 * @param {number} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated agents
 */
const listAgents = async (userId, { page = 1, limit = 10 } = {}) => {
  const skip = (page - 1) * limit;
  const where = { user_id: BigInt(userId) };

  const [total, agents] = await Promise.all([
    prisma.ai_agent.count({ where }),
    prisma.ai_agent.findMany({
      where,
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  return {
    list: agents || [],
    total,
    page,
    limit
  };
};

/**
 * Get all agents for user (no pagination)
 * @param {number} userId - User ID
 * @returns {Promise<Array>} All agents
 */
const getAllAgents = async (userId) => {
  const agents = await prisma.ai_agent.findMany({
    where: { user_id: BigInt(userId) },
    orderBy: { sort: 'asc' },
  });
  return agents || [];
};

/**
 * Get agent sessions (unique session IDs from chat history) with pagination
 * Matches Spring Boot PageData<AgentChatSessionDTO> format
 * @param {string} agentId - Agent ID
 * @param {Object} options - Pagination options
 * @param {number} [options.page=1] - Page number (1-indexed)
 * @param {number} [options.limit=10] - Items per page
 * @returns {Promise<Object>} PageData with list, total
 */
const getAgentSessions = async (agentId, options = {}) => {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;

  // Get all messages for this agent to group by session
  const data = await prisma.ai_agent_chat_history.findMany({
    where: { agent_id: agentId },
    select: { session_id: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });

  // Group by session ID and track message counts and earliest timestamp
  const sessionGroups = new Map();
  (data).forEach(item => {
    const sessionId = item.session_id;
    if (!sessionGroups.has(sessionId)) {
      sessionGroups.set(sessionId, {
        sessionId,
        messages: [],
        earliestTime: new Date(item.created_at)
      });
    }
    const session = sessionGroups.get(sessionId);
    session.messages.push(item);
    const msgTime = new Date(item.created_at);
    if (msgTime < session.earliestTime) {
      session.earliestTime = msgTime;
    }
  });

  // Convert to array, ordered by latest message (already sorted from query)
  const sessionIds = Array.from(sessionGroups.keys());
  const totalSessions = sessionIds.length;

  // Calculate pagination
  const startIndex = (page - 1) * limit;
  const endIndex = Math.min(startIndex + limit, totalSessions);
  const paginatedSessionIds = sessionIds.slice(startIndex, endIndex);

  // Build result list matching AgentChatSessionDTO
  const list = paginatedSessionIds.map(sessionId => {
    const session = sessionGroups.get(sessionId);
    return {
      sessionId: session.sessionId,
      createdAt: session.earliestTime.toISOString(),
      chatCount: session.messages.length
    };
  });

  return {
    list,
    total: totalSessions
  };
};

/**
 * Get chat history for a session
 * Matches Spring Boot List<AgentChatHistoryDTO> format
 * @param {string} agentId - Agent ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Chat messages with camelCase fields
 */
const getChatHistory = async (agentId, sessionId) => {
  const messages = await prisma.ai_agent_chat_history.findMany({
    where: { agent_id: agentId, session_id: sessionId },
    select: { created_at: true, chat_type: true, content: true, audio_id: true, mac_address: true },
    orderBy: { created_at: 'asc' },
  });
  if (messages.length === 0) return [];

  const sessionCreationTime = messages.reduce((min, msg) => {
    const msgTime = new Date(msg.created_at);
    return msgTime < min ? msgTime : min;
  }, new Date(messages[0].created_at));

  // Transform to camelCase matching AgentChatHistoryDTO
  return messages.map(msg => ({
    createdAt: sessionCreationTime.toISOString(),
    chatType: msg.chat_type,
    content: msg.content,
    audioId: msg.audio_id,
    macAddress: msg.mac_address
  }));
};

/**
 * Add chat message to history
 * @param {Object} data - Message data
 * @returns {Promise<Object>} Created message
 */
const addChatMessage = async ({ macAddress, agentId, sessionId, chatType, content, audioId }) => {
  const normalizedMac = normalizeMacAddress(macAddress);

  const message = await prisma.ai_agent_chat_history.create({
    data: {
      mac_address: normalizedMac,
      agent_id: agentId,
      session_id: sessionId,
      chat_type: chatType, // 1=user, 2=agent
      content,
      audio_id: audioId,
    },
  });

  return message;
};

/**
 * Get agent prompt by device MAC
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent prompt config
 */
const getPromptByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    systemPrompt: agent.system_prompt,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    langCode: agent.lang_code,
    language: agent.language,
    chatHistoryConf: agent.chat_history_conf
  };
};

/**
 * Get agent ID by device MAC
 * @param {string} mac - Device MAC address
 * @returns {Promise<string>} Agent ID
 */
const getAgentIdByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });
  if (!device) throw new Error('Device not found');
  return device.agent_id;
};

/**
 * Cycle character (agent) for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} New agent info
 */
const cycleCharacter = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, user_id: true, agent_id: true },
  });

  if (!device) throw new Error('Device not found');

  const agents = await prisma.ai_agent.findMany({
    where: { user_id: device.user_id },
    select: { id: true, agent_name: true },
    orderBy: { sort: 'asc' },
  });

  if (!agents || agents.length === 0) {
    throw new Error('No agents available');
  }

  const currentIndex = agents.findIndex(a => a.id === device.agent_id);
  const nextIndex = (currentIndex + 1) % agents.length;
  const nextAgent = agents[nextIndex];

  await prisma.ai_device.update({
    where: { id: device.id },
    data: { agent_id: nextAgent.id },
  });

  return {
    agentId: nextAgent.id,
    agentName: nextAgent.agent_name,
    previousAgentId: device.agent_id
  };
};

/**
 * Set character (agent) for device
 * @param {string} mac - Device MAC address
 * @param {string} agentId - Agent ID to set
 * @returns {Promise<Object>} Agent info
 */
const setCharacter = async (mac, agentId) => {
  const normalizedMac = normalizeMacAddress(mac);

  const agent = await prisma.ai_agent.findUnique({
    where: { id: agentId },
    select: { id: true, agent_name: true },
  });

  if (!agent) throw new Error('Agent not found');

  await prisma.ai_device.update({
    where: { mac_address: normalizedMac },
    data: { agent_id: agentId },
  });

  return {
    agentId: agent.id,
    agentName: agent.agent_name
  };
};

/**
 * Set character (agent) for device by name
 * @param {string} mac - Device MAC address
 * @param {string} characterName - Agent name to set
 * @returns {Promise<Object>} Agent info
 */
const setCharacterByName = async (mac, characterName) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, user_id: true },
  });
  if (!device) throw new Error('Device not found');

  // Find existing agent by name (case-insensitive) for this user
  let agent = await prisma.ai_agent.findFirst({
    where: { user_id: device.user_id, agent_name: { equals: characterName, mode: 'insensitive' } },
    select: { id: true, agent_name: true },
  });

  if (!agent) {
    // Look up template by character name to copy full config
    const template = await prisma.ai_agent_template.findFirst({
      where: { agent_name: { equals: characterName, mode: 'insensitive' } },
    });

    if (template) {
      logger.info(`[setCharacterByName] Found template for "${characterName}", applying to new agent`);
    } else {
      logger.warn(`[setCharacterByName] No template found for "${characterName}", creating minimal agent`);
    }

    agent = await prisma.ai_agent.create({
      data: {
        user_id: device.user_id,
        agent_name: characterName,
        lang_code: template?.lang_code ?? 'en',
        language: template?.language ?? 'English',
        creator: device.user_id,
        ...(template && {
          agent_code: template.agent_code,
          asr_model_id: template.asr_model_id,
          vad_model_id: template.vad_model_id,
          llm_model_id: template.llm_model_id,
          vllm_model_id: template.vllm_model_id,
          tts_model_id: template.tts_model_id,
          tts_voice_id: template.tts_voice_id,
          mem_model_id: template.mem_model_id,
          intent_model_id: template.intent_model_id,
          chat_history_conf: template.chat_history_conf,
          system_prompt: template.system_prompt,
          summary_memory: template.summary_memory,
        }),
      },
      select: { id: true, agent_name: true },
    });
    logger.info(`[setCharacterByName] Auto-created agent "${characterName}" for user ${device.user_id}`);
  }

  await prisma.ai_device.update({ where: { id: device.id }, data: { agent_id: agent.id } });

  logger.info(`[setCharacterByName] Device ${normalizedMac} set to agent: ${agent.agent_name}`);
  return { agentId: agent.id, agentName: agent.agent_name };
};

/**
 * Get current character for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Current agent info
 */
const getCurrentCharacter = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  logger.info(`[getCurrentCharacter] Looking up device: ${mac} -> normalized: ${normalizedMac}`);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { id: true, mac_address: true, agent_id: true },
  });

  if (!device) {
    logger.info(`[getCurrentCharacter] Device not found for MAC: ${normalizedMac}`);
    throw new Error('Device not found');
  }

  logger.info(`[getCurrentCharacter] Device found: id=${device.id}, agent_id=${device.agent_id}`);

  if (!device.agent_id) {
    logger.info(`[getCurrentCharacter] Device has no agent assigned`);
    return { agentId: null, agentName: null, agentCode: null };
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
    select: { id: true, agent_name: true, agent_code: true },
  });

  if (!agent) {
    logger.info(`[getCurrentCharacter] Agent not found: ${device.agent_id}`);
    return { agentId: device.agent_id, agentName: null, agentCode: null };
  }

  logger.info(`[getCurrentCharacter] Agent found: ${agent.agent_name}`);
  return { agentId: agent.id, agentName: agent.agent_name, agentCode: agent.agent_code };
};

/**
 * Get memories for a device (for personalization)
 * @param {string} mac - Device MAC address
 * @param {Object} [options] - Options
 * @param {string} [options.query] - Custom search query
 * @param {number} [options.limit] - Max memories to return
 * @returns {Promise<Object>} Memory data with memories, relations, entities
 */
const getMemoriesByMac = async (mac, options = {}) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, returning empty memories');
    return { memories: [], relations: [], entities: [] };
  }

  try {
    const result = await mem0Service.searchMemories({
      userId: normalizedMac,
      query: options.query,
      limit: options.limit
    });

    return result;
  } catch (error) {
    logger.error('Failed to get memories by MAC:', { error: error.message, mac: normalizedMac });
    return { memories: [], relations: [], entities: [] };
  }
};

/**
 * Add conversation to memory for a device
 * @param {string} mac - Device MAC address
 * @param {Array} chatHistory - Array of {chatType: 1|2, content: string}
 * @param {string} [sessionId] - Session identifier
 * @returns {Promise<boolean>} True if successful
 */
const addConversationToMemory = async (mac, chatHistory, sessionId = null) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, skipping memory storage');
    return false;
  }

  if (!chatHistory || chatHistory.length === 0) {
    return false;
  }

  try {
    const result = await mem0Service.addConversation({
      userId: normalizedMac,
      chatHistory,
      sessionId
    });

    return result !== null;
  } catch (error) {
    logger.error('Failed to add conversation to memory:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

/**
 * Add a fact to memory for a device
 * @param {string} mac - Device MAC address
 * @param {string} fact - The fact to store
 * @returns {Promise<boolean>} True if successful
 */
const addFactToMemory = async (mac, fact) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    logger.debug('Mem0 not configured, skipping fact storage');
    return false;
  }

  if (!fact) {
    return false;
  }

  try {
    const result = await mem0Service.addFact({
      userId: normalizedMac,
      fact
    });

    return result !== null;
  } catch (error) {
    logger.error('Failed to add fact to memory:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

/**
 * Get agent prompt with memories included
 * @param {string} mac - Device MAC address
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeMemories=true] - Include memories in response
 * @returns {Promise<Object>} Agent prompt config with optional memories
 */
const getPromptWithMemories = async (mac, options = { includeMemories: true }) => {
  const promptConfig = await getPromptByMac(mac);

  if (!options.includeMemories || !mem0Service.isAvailable()) {
    return promptConfig;
  }

  try {
    const normalizedMac = normalizeMacAddress(mac);
    const memoryData = await mem0Service.searchMemories({
      userId: normalizedMac
    });

    // Format memories for prompt injection
    const memoriesText = mem0Service.formatForPrompt(memoryData);

    return {
      ...promptConfig,
      memories: memoryData,
      memoriesText
    };
  } catch (error) {
    logger.error('Failed to get memories for prompt:', { error: error.message, mac });
    return promptConfig;
  }
};

/**
 * Clear all memories for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<boolean>} True if successful
 */
const clearMemoriesByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  if (!mem0Service.isAvailable()) {
    return false;
  }

  try {
    return await mem0Service.deleteAllMemories({
      userId: normalizedMac
    });
  } catch (error) {
    logger.error('Failed to clear memories:', { error: error.message, mac: normalizedMac });
    return false;
  }
};

// =============================================
// Agent Memory and Mode Methods
// =============================================

/**
 * Save/update agent summary memory by device MAC
 * Used by LiveKit workers to persist conversation summary
 * @param {string} mac - Device MAC address
 * @param {string} summaryMemory - Summary memory content to save
 * @returns {Promise<Object>} Updated agent info
 */
const saveMemory = async (mac, summaryMemory) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const agent = await prisma.ai_agent.update({
    where: { id: device.agent_id },
    data: {
      summary_memory: summaryMemory,
      updated_at: new Date(),
    },
    select: { id: true, agent_name: true, summary_memory: true },
  });

  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    summaryMemory: agent.summary_memory
  };
};

/**
 * Update agent mode from template
 * Copies template settings to agent while optionally preserving some fields
 * @param {Object} data - Update data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} data.templateId - Template ID to apply
 * @param {boolean} [data.preserveMemory=true] - Keep existing summary_memory
 * @returns {Promise<Object>} Updated agent
 */
const updateModeFromTemplate = async (data) => {
  const { macAddress, templateId, preserveMemory = true } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true },
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  const updateData = {
    agent_code: template.agent_code,
    agent_name: template.agent_name,
    asr_model_id: template.asr_model_id,
    vad_model_id: template.vad_model_id,
    llm_model_id: template.llm_model_id,
    vllm_model_id: template.vllm_model_id,
    tts_model_id: template.tts_model_id,
    tts_voice_id: template.tts_voice_id,
    mem_model_id: template.mem_model_id,
    intent_model_id: template.intent_model_id,
    chat_history_conf: template.chat_history_conf,
    system_prompt: template.system_prompt,
    lang_code: template.lang_code,
    language: template.language,
    updated_at: new Date(),
  };

  if (!preserveMemory) {
    updateData.summary_memory = template.summary_memory;
  }

  const agent = await prisma.ai_agent.update({
    where: { id: device.agent_id },
    data: updateData,
  });

  return agent;
};

/**
 * Get agent name by device MAC
 * Used by game mode detection in LiveKit workers
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent name and code
 */
const getAgentNameByMac = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);

  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalizedMac },
    select: { agent_id: true, mode: true },
  });

  if (!device) {
    throw new Error('Device not found');
  }

  if (!device.agent_id) {
    return {
      agentId: null,
      agentName: null,
      agentCode: null,
      mode: device.mode
    };
  }

  const agent = await prisma.ai_agent.findUnique({
    where: { id: device.agent_id },
    select: { id: true, agent_name: true, agent_code: true },
  });

  return {
    agentId: agent ? agent.id : null,
    agentName: agent ? agent.agent_name : null,
    agentCode: agent ? agent.agent_code : null,
    mode: device.mode
  };
};

// =============================================
// Agent Chat History Batch Methods
// =============================================

/**
 * Report a single chat message (used by cheeko service)
 * Similar to addChatMessage but with slightly different structure
 * @param {Object} data - Message data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} [data.agentId] - Agent ID (optional)
 * @param {string} data.sessionId - Session ID
 * @param {number} data.chatType - Chat type (1=user, 2=agent)
 * @param {string} data.content - Message content
 * @param {string} [data.audioId] - Audio ID (optional)
 * @returns {Promise<Object>} Created message
 */
const reportChatMessage = async (data) => {
  const { macAddress, agentId, sessionId, chatType, content, audioId } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      resolvedAgentId = null;
    }
  }

  const message = await prisma.ai_agent_chat_history.create({
    data: {
      mac_address: normalizedMac,
      agent_id: resolvedAgentId,
      session_id: sessionId,
      chat_type: chatType,
      content,
      audio_id: audioId,
    },
  });

  return message;
};

/**
 * Batch upload all session messages (used by LiveKit workers at end of session)
 * @param {Object} data - Session data
 * @param {string} data.macAddress - Device MAC address
 * @param {string} [data.agentId] - Agent ID (optional)
 * @param {string} data.sessionId - Session ID
 * @param {Array} data.messages - Array of {chatType, content, audioId, timestamp}
 * @returns {Promise<Object>} Result with count of inserted messages
 */
const batchUploadSession = async (data) => {
  const { macAddress, agentId, sessionId, messages } = data;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  const normalizedMac = normalizeMacAddress(macAddress);

  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      resolvedAgentId = null;
    }
  }

  const insertData = messages.map((msg, index) => {
    let createdAt;
    if (msg.timestamp) {
      if (typeof msg.timestamp === 'number') {
        createdAt = new Date(msg.timestamp * 1000);
      } else {
        createdAt = new Date(msg.timestamp);
      }
    } else {
      createdAt = new Date(Date.now() + index);
    }

    return {
      mac_address: normalizedMac,
      agent_id: resolvedAgentId,
      session_id: sessionId,
      chat_type: msg.chatType,
      content: msg.content,
      audio_id: msg.audioId || null,
      created_at: createdAt,
    };
  });

  const result = await prisma.ai_agent_chat_history.createMany({
    data: insertData,
  });

  return {
    sessionId,
    macAddress: normalizedMac,
    agentId: resolvedAgentId,
    insertedCount: result.count || 0
  };
};

/**
 * Get recent chat history for user (mobile app)
 * Matches Spring Boot List<AgentChatHistoryUserVO> format
 * Returns only USER messages (chat_type=1) with audio_id
 * @param {string} agentId - Agent ID
 * @param {number} [limit=50] - Max messages to return (default 50)
 * @returns {Promise<Array>} Recent chat messages with only content and audioId
 */
const getRecentUserChatHistory = async (agentId, limit = 50) => {
  const messages = await prisma.ai_agent_chat_history.findMany({
    where: {
      agent_id: agentId,
      chat_type: 1, // USER messages only
      audio_id: { not: null }, // Only messages with audio
    },
    select: { content: true, audio_id: true },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  return (messages || []).map(msg => ({
    content: extractContentFromString(msg.content),
    audioId: msg.audio_id
  }));
};

/**
 * Extract chat content from content field
 * If content is JSON format (e.g., {"speaker": "...", "content": "..."}), extract the content field
 * If content is a plain string, return directly
 * @param {string} content - Original content
 * @returns {string} Extracted chat content
 */
const extractContentFromString = (content) => {
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return content;
  }

  // Try to parse as JSON
  try {
    const jsonObj = JSON.parse(content);
    if (jsonObj && typeof jsonObj === 'object' && jsonObj.content) {
      return String(jsonObj.content);
    }
  } catch {
    // If not valid JSON, return original content
  }

  return content;
};

/**
 * Get audio content by audio ID
 * Matches Spring Boot behavior: returns just the content string
 * Note: Spring Boot's endpoint uses the path param as audioId, not agentId
 * @param {string} audioId - Audio ID
 * @returns {Promise<string|null>} Content string or null
 */
const getAudioContent = async (audioId) => {
  const record = await prisma.ai_agent_chat_history.findFirst({
    where: { audio_id: audioId },
    select: { content: true },
  });

  return record ? record.content : null;
};

// =============================================
// Agent Template Methods
// =============================================

/**
 * Get all visible agent templates
 * @returns {Promise<Array>} List of visible templates (camelCase keys for Spring Boot compatibility)
 */
const getTemplates = async (includeHidden = false) => {
  const where = includeHidden ? {} : { is_visible: 1 };

  const templates = await prisma.ai_agent_template.findMany({
    where,
    orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
  });

  return (templates || []).map(transformKeysToCamel);
};

/**
 * Get agent template by ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template or null (camelCase keys for Spring Boot compatibility)
 */
const getTemplateById = async (templateId) => {
  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) return null;

  return transformKeysToCamel(template);
};

/**
 * Create a new agent template
 * @param {Object} data - Template data
 * @returns {Promise<string>} Created template ID (matches Spring Boot Result<String>)
 */
const createTemplate = async (data) => {
  const toNullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

  const template = await prisma.ai_agent_template.create({
    data: {
      agent_code: data.agentCode || null,
      agent_name: data.agentName,
      asr_model_id: toNullIfEmpty(data.asrModelId),
      vad_model_id: toNullIfEmpty(data.vadModelId),
      llm_model_id: toNullIfEmpty(data.llmModelId),
      vllm_model_id: toNullIfEmpty(data.vllmModelId),
      tts_model_id: toNullIfEmpty(data.ttsModelId),
      tts_voice_id: toNullIfEmpty(data.ttsVoiceId),
      mem_model_id: toNullIfEmpty(data.memModelId),
      intent_model_id: toNullIfEmpty(data.intentModelId),
      chat_history_conf: data.chatHistoryConf || 0,
      system_prompt: data.systemPrompt,
      summary_memory: data.summaryMemory,
      lang_code: data.langCode || 'en',
      language: data.language || 'English',
      is_visible: data.isVisible !== undefined ? data.isVisible : 1,
      sort: data.sort || 0,
    },
    select: { id: true },
  });

  return template.id;
};

/**
 * Update an agent template
 * @param {string} templateId - Template ID
 * @param {Object} data - Update data
 * @returns {Promise<null>} null (matches Spring Boot Result<Void>)
 */
const updateTemplate = async (templateId, data) => {
  const existing = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) throw new Error('Template not found');

  const toNullIfEmpty = (val) => (val === '' || val === undefined) ? null : val;

  const updateData = {
    updated_at: new Date(),
  };

  if (data.agentCode !== undefined) updateData.agent_code = data.agentCode || null;
  if (data.agentName !== undefined) updateData.agent_name = data.agentName;
  if (data.asrModelId !== undefined) updateData.asr_model_id = toNullIfEmpty(data.asrModelId);
  if (data.vadModelId !== undefined) updateData.vad_model_id = toNullIfEmpty(data.vadModelId);
  if (data.llmModelId !== undefined) updateData.llm_model_id = toNullIfEmpty(data.llmModelId);
  if (data.vllmModelId !== undefined) updateData.vllm_model_id = toNullIfEmpty(data.vllmModelId);
  if (data.ttsModelId !== undefined) updateData.tts_model_id = toNullIfEmpty(data.ttsModelId);
  if (data.ttsVoiceId !== undefined) updateData.tts_voice_id = toNullIfEmpty(data.ttsVoiceId);
  if (data.memModelId !== undefined) updateData.mem_model_id = toNullIfEmpty(data.memModelId);
  if (data.intentModelId !== undefined) updateData.intent_model_id = toNullIfEmpty(data.intentModelId);
  if (data.chatHistoryConf !== undefined) updateData.chat_history_conf = data.chatHistoryConf;
  if (data.systemPrompt !== undefined) updateData.system_prompt = data.systemPrompt;
  if (data.summaryMemory !== undefined) updateData.summary_memory = data.summaryMemory;
  if (data.langCode !== undefined) updateData.lang_code = data.langCode;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.isVisible !== undefined) updateData.is_visible = data.isVisible;
  if (data.sort !== undefined) updateData.sort = data.sort;

  await prisma.ai_agent_template.update({
    where: { id: templateId },
    data: updateData,
  });

  return null;
};

/**
 * Apply template changes to all agents using this template (by agent_code OR agent_name)
 * @param {string} templateId - Template ID
 * @returns {Promise<Object>} Result with updatedCount
 */
const applyTemplateToAgents = async (templateId) => {
  const template = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
  });

  if (!template) throw new Error('Template not found');

  // Build OR conditions for agent_code and agent_name
  const orConditions = [];
  if (template.agent_code) {
    orConditions.push({ agent_code: template.agent_code });
  }
  if (template.agent_name) {
    orConditions.push({ agent_name: template.agent_name });
  }

  if (orConditions.length === 0) {
    return { updatedCount: 0, agentCode: template.agent_code, agentName: template.agent_name };
  }

  const updateData = {
    agent_name: template.agent_name,
    asr_model_id: template.asr_model_id,
    vad_model_id: template.vad_model_id,
    llm_model_id: template.llm_model_id,
    vllm_model_id: template.vllm_model_id,
    tts_model_id: template.tts_model_id,
    tts_voice_id: template.tts_voice_id,
    mem_model_id: template.mem_model_id,
    intent_model_id: template.intent_model_id,
    chat_history_conf: template.chat_history_conf,
    system_prompt: template.system_prompt,
    lang_code: template.lang_code,
    language: template.language,
    updated_at: new Date(),
  };

  const result = await prisma.ai_agent.updateMany({
    where: { OR: orConditions },
    data: updateData,
  });

  logger.info(`Applied template "${template.agent_name}" (code: ${template.agent_code}) to ${result.count} agents`);
  return {
    updatedCount: result.count,
    agentCode: template.agent_code,
    agentName: template.agent_name
  };
};

/**
 * Delete an agent template
 * @param {string} templateId - Template ID
 * @returns {Promise<void>}
 */
const deleteTemplate = async (templateId) => {
  const existing = await prisma.ai_agent_template.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existing) throw new Error('Template not found');

  await prisma.ai_agent_template.delete({
    where: { id: templateId },
  });
};

// ==============================================
// MCP Access Point Methods (Spring Boot Compatible)
// ==============================================

const crypto = require('crypto');
const WebSocket = require('ws');

// System param key for MCP endpoint
const SERVER_MCP_ENDPOINT = 'server.mcp_endpoint';

// JSON-RPC 2.0 messages for MCP protocol
const MCP_JSON_RPC = {
  initialize: JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false },
        sampling: {}
      },
      clientInfo: {
        name: 'xz-mcp-broker',
        version: '0.0.1'
      }
    },
    id: 1
  }),
  notificationsInitialized: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  toolsList: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: null,
    id: 2
  })
};

/**
 * Pad AES key to 16, 24, or 32 bytes (matching Java AESUtils.padKey)
 * @param {Buffer} keyBytes - Key as buffer
 * @returns {Buffer} Padded key
 */
const padKey = (keyBytes) => {
  const keyLength = keyBytes.length;
  if (keyLength === 16 || keyLength === 24 || keyLength === 32) {
    return keyBytes;
  }
  // Pad to 32 bytes with zeros or truncate
  const paddedKey = Buffer.alloc(32);
  keyBytes.copy(paddedKey, 0, 0, Math.min(keyLength, 32));
  return paddedKey;
};

/**
 * AES ECB encrypt with PKCS5 padding (matching Java AESUtils.encrypt)
 * @param {string} key - Encryption key
 * @param {string} plainText - Text to encrypt
 * @returns {string} Base64 encoded ciphertext
 */
const aesEncrypt = (key, plainText) => {
  const keyBytes = padKey(Buffer.from(key, 'utf8'));
  const cipher = crypto.createCipheriv('aes-256-ecb', keyBytes, null);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};

/**
 * MD5 hash (matching Java HashEncryptionUtil.Md5hexDigest)
 * @param {string} text - Text to hash
 * @returns {string} MD5 hex digest
 */
const md5Hash = (text) => {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
};

/**
 * Get MCP access point URL for an agent
 * Matches Spring Boot AgentMcpAccessPointServiceImpl.getAgentMcpAccessAddress
 * @param {string} agentId - Agent ID
 * @returns {string|null} MCP WebSocket URL or null if not configured
 */
const getMcpAddress = async (agentId) => {
  const param = await prisma.sys_params.findFirst({
    where: { param_code: SERVER_MCP_ENDPOINT },
    select: { param_value: true },
  });

  if (!param || !param.param_value || param.param_value === 'null') {
    return null;
  }

  const url = param.param_value;

  try {
    // Parse the URL
    const parsedUrl = new URL(url);

    // Get the secret key from query params
    const key = parsedUrl.searchParams.get('key');
    if (!key) {
      logger.error('MCP endpoint URL missing key parameter');
      return null;
    }

    // Get WebSocket scheme (wss for https, ws for http)
    const wsScheme = parsedUrl.protocol === 'https:' ? 'wss' : 'ws';

    // Get path before the last /
    let path = parsedUrl.pathname;
    path = path.substring(0, path.lastIndexOf('/'));

    // Build agent MCP URL prefix
    const agentMcpUrl = `${wsScheme}://${parsedUrl.host}${path}`;

    // Create encrypted token
    // 1. MD5 hash the agentId
    const md5AgentId = md5Hash(agentId);
    // 2. Create JSON with the MD5 hash
    const json = JSON.stringify({ agentId: md5AgentId });
    // 3. AES encrypt
    const encryptedToken = aesEncrypt(key, json);
    // 4. URL encode
    const encodedToken = encodeURIComponent(encryptedToken);

    // Return the full MCP access URL
    return `${agentMcpUrl}/mcp/?token=${encodedToken}`;
  } catch (err) {
    logger.error('Failed to parse MCP endpoint URL:', err.message);
    throw new Error('MCP address error, please contact admin to update MCP access point address in parameter management');
  }
};

/**
 * Get MCP tools list for an agent via WebSocket JSON-RPC
 * Matches Spring Boot AgentMcpAccessPointServiceImpl.getAgentMcpToolsList
 * @param {string} agentId - Agent ID
 * @returns {array} List of tool names
 */
const getMcpTools = async (agentId) => {
  // Get the MCP address
  const wsUrl = await getMcpAddress(agentId);
  if (!wsUrl) {
    return [];
  }

  // Replace /mcp/ with /call/ for tools endpoint
  const callUrl = wsUrl.replace('/mcp/', '/call/');

  return new Promise((resolve) => {
    let ws;
    let initSucceeded = false;
    let resolved = false;

    // Cleanup function - defined first for reference
    const doCleanup = (timer) => {
      if (timer) clearTimeout(timer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };

    // Safe resolve that only resolves once
    const safeResolve = (value, timer) => {
      if (!resolved) {
        resolved = true;
        doCleanup(timer);
        resolve(value);
      }
    };

    // Set overall timeout
    const timeoutHandle = setTimeout(() => {
      logger.warn(`MCP tools request timeout for agent ${agentId}`);
      safeResolve([], timeoutHandle);
    }, 15000);

    try {
      ws = new WebSocket(callUrl, {
        handshakeTimeout: 8000
      });

      ws.on('open', () => {
        // Step 1: Send initialize message
        logger.info(`Sending MCP initialize message, AgentID: ${agentId}`);
        ws.send(MCP_JSON_RPC.initialize);
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          // Check for initialize response (id=1)
          if (response.id === 1) {
            if (response.result) {
              logger.info(`MCP initialize success, AgentID: ${agentId}`);
              initSucceeded = true;
              // Step 2: Send notifications/initialized
              logger.info(`Sending MCP initialize complete notification, AgentID: ${agentId}`);
              ws.send(MCP_JSON_RPC.notificationsInitialized);
              // Step 3: Send tools/list request
              logger.info(`Sending MCP tools list request, AgentID: ${agentId}`);
              ws.send(MCP_JSON_RPC.toolsList);
            } else if (response.error) {
              logger.error(`MCP initialize failure, AgentID: ${agentId}, Error:`, response.error);
              safeResolve([], timeoutHandle);
            }
          }
          // Check for tools/list response (id=2)
          else if (response.id === 2) {
            if (response.result && response.result.tools && Array.isArray(response.result.tools)) {
              const toolNames = response.result.tools
                .map(tool => tool.name)
                .filter(name => name !== null);
              logger.info(`Successfully got MCP tools list, AgentID: ${agentId}, Tools count: ${toolNames.length}`);
              safeResolve(toolNames, timeoutHandle);
            } else if (response.error) {
              logger.error(`Get tools list failure, AgentID: ${agentId}, Error:`, response.error);
              safeResolve([], timeoutHandle);
            }
          }
        } catch (err) {
          logger.warn(`Parse MCP response failure: ${data.toString()}`, err);
        }
      });

      ws.on('error', (err) => {
        logger.error(`Get agent MCP tools list failure, AgentID: ${agentId}, Error: ${err.message}`);
        safeResolve([], timeoutHandle);
      });

      ws.on('close', () => {
        if (!initSucceeded) {
          logger.warn(`MCP WebSocket closed before init succeeded, AgentID: ${agentId}`);
        }
      });
    } catch (err) {
      logger.error(`Failed to connect to MCP, AgentID: ${agentId}, Error: ${err.message}`);
      safeResolve([], timeoutHandle);
    }
  });
};

/**
 * Get user's agents list (Spring Boot /agent/list format)
 * Returns AgentDTO array with device counts, etc.
 * Admin sees all agents with owner info, user sees own agents
 * Optimized: batch fetches all device data in 1 query instead of N+1
 * @param {number} userId - User ID
 * @param {boolean} isSuperAdmin - Whether user is super admin
 * @param {Object} options - Pagination options
 * @param {number} [options.page=1] - Page number (1-indexed)
 * @param {number} [options.limit=20] - Items per page
 * @returns {Promise<Object>} Object with list and total
 */
const getAgentListForUser = async (userId, isSuperAdmin, options = {}) => {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const skip = (page - 1) * limit;
  const where = isSuperAdmin ? {} : { user_id: BigInt(userId) };

  const [totalCount, agents] = await Promise.all([
    prisma.ai_agent.count({ where }),
    prisma.ai_agent.findMany({
      where,
      select: {
        id: true, agent_name: true, mem_model_id: true, system_prompt: true,
        summary_memory: true, created_at: true, user_id: true,
        ...(isSuperAdmin ? { sys_user: { select: { username: true } } } : {}),
      },
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  if (!agents.length) return { list: [], total: totalCount };

  const agentIds = agents.map(a => a.id);
  const allDevices = await prisma.ai_device.findMany({
    where: { agent_id: { in: agentIds } },
    select: { agent_id: true, mac_address: true, last_connected_at: true },
  });

  const deviceStatsMap = {};
  allDevices.forEach(device => {
    const aid = device.agent_id;
    if (!deviceStatsMap[aid]) deviceStatsMap[aid] = { count: 0, macs: [], lastConnected: null };
    deviceStatsMap[aid].count++;
    deviceStatsMap[aid].macs.push(device.mac_address);
    if (device.last_connected_at) {
      const connTime = new Date(device.last_connected_at);
      if (!deviceStatsMap[aid].lastConnected || connTime > new Date(deviceStatsMap[aid].lastConnected)) {
        deviceStatsMap[aid].lastConnected = device.last_connected_at;
      }
    }
  });

  const list = agents.map(agent => {
    const stats = deviceStatsMap[agent.id] || { count: 0, macs: [], lastConnected: null };
    return {
      id: agent.id,
      agentName: agent.agent_name,
      memModelId: agent.mem_model_id,
      systemPrompt: agent.system_prompt,
      summaryMemory: agent.summary_memory,
      lastConnectedAt: stats.lastConnected,
      deviceCount: stats.count,
      deviceMacAddresses: stats.macs.join(','),
      ownerUsername: isSuperAdmin ? (agent.sys_user?.username || null) : undefined,
      createDate: agent.created_at,
    };
  });

  return { list, total: totalCount };
};

/**
 * Admin agent list with pagination (Spring Boot /agent/all format)
 * Returns PageData<AgentEntity> with pagination
 * @param {Object} params - Query parameters with page, limit
 * @returns {Promise<Object>} Paginated agents with {list, total, page, limit}
 */
const adminAgentListPaginated = async (params = {}) => {
  const page = parseInt(params.page) || 1;
  const limit = parseInt(params.limit) || 10;
  const skip = (page - 1) * limit;

  const [count, agents] = await Promise.all([
    prisma.ai_agent.count(),
    prisma.ai_agent.findMany({
      orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  const list = (agents || []).map(agent => ({
    id: agent.id,
    userId: agent.user_id,
    agentCode: agent.agent_code,
    agentName: agent.agent_name,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    vllmModelId: agent.vllm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    intentModelId: agent.intent_model_id,
    chatHistoryConf: agent.chat_history_conf,
    systemPrompt: agent.system_prompt,
    summaryMemory: agent.summary_memory,
    langCode: agent.lang_code,
    language: agent.language,
    sort: agent.sort,
    creator: agent.creator,
    createdAt: agent.created_at,
    updater: agent.updater,
    updatedAt: agent.updated_at
  }));

  return {
    list,
    total: count || 0
  };
};

/**
 * Get agent info by ID (Spring Boot AgentInfoVO format)
 * Returns agent with plugin mappings (functions) - no user filtering
 * @param {string} agentId - Agent ID
 * @returns {Promise<Object|null>} Agent info with functions or null
 */
const getAgentInfoById = async (agentId) => {
  const agent = await prisma.ai_agent.findUnique({ where: { id: agentId } });
  if (!agent) return null;

  // Plugin mappings table not in Prisma schema; use raw query
  let functions = [];
  try {
    const pluginMappings = await prisma.$queryRawUnsafe(
      `SELECT id, agent_id, plugin_id, param_info FROM ai_agent_plugin_mapping WHERE agent_id = $1::uuid`,
      agentId
    );
    functions = (pluginMappings || []).map(mapping => ({
      id: mapping.id,
      agentId: mapping.agent_id,
      pluginId: mapping.plugin_id,
      paramInfo: mapping.param_info,
    }));
  } catch (_) { /* table may not exist */ }

  // Transform agent to camelCase AgentInfoVO format
  return {
    id: agent.id,
    userId: agent.user_id,
    agentCode: agent.agent_code,
    agentName: agent.agent_name,
    asrModelId: agent.asr_model_id,
    vadModelId: agent.vad_model_id,
    llmModelId: agent.llm_model_id,
    vllmModelId: agent.vllm_model_id,
    ttsModelId: agent.tts_model_id,
    ttsVoiceId: agent.tts_voice_id,
    memModelId: agent.mem_model_id,
    intentModelId: agent.intent_model_id,
    chatHistoryConf: agent.chat_history_conf,
    systemPrompt: agent.system_prompt,
    summaryMemory: agent.summary_memory,
    langCode: agent.lang_code,
    language: agent.language,
    sort: agent.sort,
    creator: agent.creator,
    createdAt: agent.created_at,
    updater: agent.updater,
    updatedAt: agent.updated_at,
    functions: functions
  };
};

module.exports = {
  createAgent,
  getAgentById,
  getAgentInfoById,
  updateAgent,
  deleteAgent,
  listAgents,
  getAllAgents,
  getAgentListForUser,
  adminAgentListPaginated,
  getAgentSessions,
  getChatHistory,
  addChatMessage,
  getPromptByMac,
  getAgentIdByMac,
  cycleCharacter,
  setCharacter,
  setCharacterByName,
  getCurrentCharacter,
  // Memory integration
  getMemoriesByMac,
  addConversationToMemory,
  addFactToMemory,
  getPromptWithMemories,
  clearMemoriesByMac,
  // Agent memory and mode methods
  saveMemory,
  updateModeFromTemplate,
  getAgentNameByMac,
  // Chat history batch methods
  reportChatMessage,
  batchUploadSession,
  getRecentUserChatHistory,
  getAudioContent,
  // Template methods
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplateToAgents,
  // MCP Access Point methods
  getMcpAddress,
  getMcpTools
};
