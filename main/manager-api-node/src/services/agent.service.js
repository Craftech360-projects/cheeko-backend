/**
 * Agent Service
 *
 * Handles AI agent configuration, chat history, and device integration.
 */

const { supabaseAdmin } = require('../config/database');
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const agentData = {
    user_id: userId,
    agent_code: data.agentCode,
    agent_name: data.agentName,
    asr_model_id: data.asrModelId,
    vad_model_id: data.vadModelId,
    llm_model_id: data.llmModelId,
    vllm_model_id: data.vllmModelId,
    tts_model_id: data.ttsModelId,
    tts_voice_id: data.ttsVoiceId,
    mem_model_id: data.memModelId,
    intent_model_id: data.intentModelId,
    chat_history_conf: data.chatHistoryConf || 0,
    system_prompt: data.systemPrompt,
    summary_memory: data.summaryMemory,
    lang_code: data.langCode || 'en',
    language: data.language || 'English',
    sort: data.sort || 0,
    creator: userId
  };

  const { data: agent, error } = await supabaseAdmin
    .from('ai_agent')
    .insert(agentData)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create agent:', error);
    throw new Error('Failed to create agent');
  }

  return agent;
};

/**
 * Get agent by ID
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (optional, for ownership check)
 * @returns {Promise<Object>} Agent
 */
const getAgentById = async (agentId, userId = null) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_agent')
    .select('*')
    .eq('id', agentId);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data: agent, error } = await query.single();

  if (error || !agent) return null;

  return agent;
};

/**
 * Update agent
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated agent
 */
const updateAgent = async (agentId, _userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check if agent exists (Spring Boot doesn't filter by user ID)
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  const updateData = {
    updated_at: new Date().toISOString()
    // Note: ai_agent table doesn't have an 'updater' column (unlike ai_device)
  };

  // Map fields
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

  const { data: agent, error } = await supabaseAdmin
    .from('ai_agent')
    .update(updateData)
    .eq('id', agentId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update agent:', error);
    throw new Error('Failed to update agent');
  }

  return agent;
};

/**
 * Delete agent and all associated records
 * Matches Spring Boot behavior: deletes devices, chat history, and plugins first
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID (kept for backward compatibility but not used for filtering)
 */
const deleteAgent = async (agentId, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check if agent exists (Spring Boot doesn't filter by user ID)
  const existing = await getAgentById(agentId);
  if (!existing) throw new Error('Agent not found');

  // Delete associated devices first
  await supabaseAdmin
    .from('ai_device')
    .delete()
    .eq('agent_id', agentId);

  // Delete associated chat history
  await supabaseAdmin
    .from('ai_agent_chat_history')
    .delete()
    .eq('agent_id', agentId);

  // Delete associated plugin mappings
  await supabaseAdmin
    .from('ai_agent_plugin_mapping')
    .delete()
    .eq('agent_id', agentId);

  // Finally delete the agent
  const { error } = await supabaseAdmin
    .from('ai_agent')
    .delete()
    .eq('id', agentId);

  if (error) {
    logger.error('Failed to delete agent:', error);
    throw new Error('Failed to delete agent');
  }
};

/**
 * List agents for user (paginated)
 * @param {number} userId - User ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated agents
 */
const listAgents = async (userId, { page = 1, limit = 10 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Get total count
  const { count } = await supabaseAdmin
    .from('ai_agent')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Get agents
  const { data: agents, error } = await supabaseAdmin
    .from('ai_agent')
    .select('*')
    .eq('user_id', userId)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch agents');

  return {
    list: agents || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: agents, error } = await supabaseAdmin
    .from('ai_agent')
    .select('*')
    .eq('user_id', userId)
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch agents');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;

  // Get all messages for this agent to group by session
  const { data, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('session_id, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) throw new Error('Failed to fetch sessions');

  // Group by session ID and track message counts and earliest timestamp
  const sessionGroups = new Map();
  (data || []).forEach(item => {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('created_at, chat_type, content, audio_id, mac_address')
    .eq('agent_id', agentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error('Failed to fetch chat history');

  // Get session creation time (earliest message) to match Spring Boot behavior
  const messages = data || [];
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  const { data: message, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .insert({
      mac_address: normalizedMac,
      agent_id: agentId,
      session_id: sessionId,
      chat_type: chatType, // 1=user, 2=agent
      content,
      audio_id: audioId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to save chat message');

  return message;
};

/**
 * Get agent prompt by device MAC
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent prompt config
 */
const getPromptByMac = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  // Get device with agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent
  const { data: agent, error: agentError } = await supabaseAdmin
    .from('ai_agent')
    .select('*')
    .eq('id', device.agent_id)
    .single();

  if (agentError || !agent) {
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) throw new Error('Device not found');

  return device.agent_id;
};

/**
 * Cycle character (agent) for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} New agent info
 */
const cycleCharacter = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  // Get device with current agent
  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, user_id, agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (!device) throw new Error('Device not found');

  // Get all agents for user
  const { data: agents } = await supabaseAdmin
    .from('ai_agent')
    .select('id, agent_name')
    .eq('user_id', device.user_id)
    .order('sort', { ascending: true });

  if (!agents || agents.length === 0) {
    throw new Error('No agents available');
  }

  // Find next agent
  const currentIndex = agents.findIndex(a => a.id === device.agent_id);
  const nextIndex = (currentIndex + 1) % agents.length;
  const nextAgent = agents[nextIndex];

  // Update device
  await supabaseAdmin
    .from('ai_device')
    .update({ agent_id: nextAgent.id })
    .eq('id', device.id);

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  // Verify agent exists
  const { data: agent } = await supabaseAdmin
    .from('ai_agent')
    .select('id, agent_name')
    .eq('id', agentId)
    .single();

  if (!agent) throw new Error('Agent not found');

  // Update device
  const { error } = await supabaseAdmin
    .from('ai_device')
    .update({ agent_id: agentId })
    .eq('mac_address', normalizedMac);

  if (error) throw new Error('Failed to set character');

  return {
    agentId: agent.id,
    agentName: agent.agent_name
  };
};

/**
 * Get current character for device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Current agent info
 */
const getCurrentCharacter = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select(`
      agent_id,
      ai_agent:agent_id (id, agent_name, agent_code)
    `)
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) throw new Error('Device not found');

  if (!device.ai_agent) {
    return { agentId: null, agentName: null };
  }

  return {
    agentId: device.ai_agent.id,
    agentName: device.ai_agent.agent_name,
    agentCode: device.ai_agent.agent_code
  };
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  // Get device with agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Update agent's summary_memory field
  const { data: agent, error: updateError } = await supabaseAdmin
    .from('ai_agent')
    .update({
      summary_memory: summaryMemory,
      updated_at: new Date().toISOString()
    })
    .eq('id', device.agent_id)
    .select('id, agent_name, summary_memory')
    .single();

  if (updateError) {
    logger.error('Failed to save memory:', updateError);
    throw new Error('Failed to save memory');
  }

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { macAddress, templateId, preserveMemory = true } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with current agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get the template
  const { data: template, error: templateError } = await supabaseAdmin
    .from('ai_agent_template')
    .select('*')
    .eq('id', templateId)
    .single();

  if (templateError || !template) {
    throw new Error('Template not found');
  }

  // Build update data from template
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
    updated_at: new Date().toISOString()
  };

  // Optionally update summary_memory from template
  if (!preserveMemory) {
    updateData.summary_memory = template.summary_memory;
  }

  // Update the agent
  const { data: agent, error: updateError } = await supabaseAdmin
    .from('ai_agent')
    .update(updateData)
    .eq('id', device.agent_id)
    .select()
    .single();

  if (updateError) {
    logger.error('Failed to update mode from template:', updateError);
    throw new Error('Failed to update mode from template');
  }

  return agent;
};

/**
 * Get agent name by device MAC
 * Used by game mode detection in LiveKit workers
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Agent name and code
 */
const getAgentNameByMac = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);

  // Get device with agent name via join
  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select(`
      agent_id,
      mode,
      ai_agent:agent_id (id, agent_name, agent_code)
    `)
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) {
    throw new Error('Device not found');
  }

  if (!device.ai_agent) {
    return {
      agentId: null,
      agentName: null,
      agentCode: null,
      mode: device.mode
    };
  }

  return {
    agentId: device.ai_agent.id,
    agentName: device.ai_agent.agent_name,
    agentCode: device.ai_agent.agent_code,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { macAddress, agentId, sessionId, chatType, content, audioId } = data;
  const normalizedMac = normalizeMacAddress(macAddress);

  // If agentId not provided, try to get it from the device
  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      // Agent ID is optional, continue without it
      resolvedAgentId = null;
    }
  }

  const { data: message, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .insert({
      mac_address: normalizedMac,
      agent_id: resolvedAgentId,
      session_id: sessionId,
      chat_type: chatType,
      content,
      audio_id: audioId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to report chat message:', error);
    throw new Error('Failed to report chat message');
  }

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { macAddress, agentId, sessionId, messages } = data;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required and must not be empty');
  }

  const normalizedMac = normalizeMacAddress(macAddress);

  // If agentId not provided, try to get it from the device
  let resolvedAgentId = agentId;
  if (!resolvedAgentId) {
    try {
      resolvedAgentId = await getAgentIdByMac(normalizedMac);
    } catch {
      // Agent ID is optional, continue without it
      resolvedAgentId = null;
    }
  }

  // Prepare batch insert data
  const insertData = messages.map((msg, index) => ({
    mac_address: normalizedMac,
    agent_id: resolvedAgentId,
    session_id: sessionId,
    chat_type: msg.chatType,
    content: msg.content,
    audio_id: msg.audioId || null,
    // Use provided timestamp or current time with offset to maintain order
    created_at: msg.timestamp || new Date(Date.now() + index).toISOString()
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .insert(insertData)
    .select('id');

  if (error) {
    logger.error('Failed to batch upload session:', error);
    throw new Error('Failed to batch upload session messages');
  }

  return {
    sessionId,
    macAddress: normalizedMac,
    agentId: resolvedAgentId,
    insertedCount: inserted ? inserted.length : 0
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: messages, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('content, audio_id')
    .eq('agent_id', agentId)
    .eq('chat_type', 1) // USER messages only
    .not('audio_id', 'is', null) // Only messages with audio
    .order('id', { ascending: false }) // Use ID for efficient sorting
    .limit(limit);

  if (error) {
    logger.error('Failed to get recent chat history:', error);
    throw new Error('Failed to get recent chat history');
  }

  // Transform to camelCase and extract content from JSON if needed
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: record, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('content')
    .eq('audio_id', audioId)
    .single();

  if (error) {
    // Not found is not an error, return null
    if (error.code === 'PGRST116') {
      return null;
    }
    logger.error('Failed to get audio content:', error);
    throw new Error('Failed to get audio content');
  }

  return record ? record.content : null;
};

// =============================================
// Agent Template Methods
// =============================================

/**
 * Get all visible agent templates
 * @returns {Promise<Array>} List of visible templates (camelCase keys for Spring Boot compatibility)
 */
const getTemplates = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: templates, error } = await supabaseAdmin
    .from('ai_agent_template')
    .select('*')
    .eq('is_visible', 1)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to fetch templates:', error);
    throw new Error('Failed to fetch templates');
  }

  // Transform to camelCase for Spring Boot compatibility
  return (templates || []).map(transformKeysToCamel);
};

/**
 * Get agent template by ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template or null (camelCase keys for Spring Boot compatibility)
 */
const getTemplateById = async (templateId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: template, error } = await supabaseAdmin
    .from('ai_agent_template')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !template) return null;

  // Transform to camelCase for Spring Boot compatibility
  return transformKeysToCamel(template);
};

/**
 * Create a new agent template
 * @param {Object} data - Template data
 * @returns {Promise<string>} Created template ID (matches Spring Boot Result<String>)
 */
const createTemplate = async (data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const templateData = {
    agent_code: data.agentCode,
    agent_name: data.agentName,
    asr_model_id: data.asrModelId,
    vad_model_id: data.vadModelId,
    llm_model_id: data.llmModelId,
    vllm_model_id: data.vllmModelId,
    tts_model_id: data.ttsModelId,
    tts_voice_id: data.ttsVoiceId,
    mem_model_id: data.memModelId,
    intent_model_id: data.intentModelId,
    chat_history_conf: data.chatHistoryConf || 0,
    system_prompt: data.systemPrompt,
    summary_memory: data.summaryMemory,
    lang_code: data.langCode || 'en',
    language: data.language || 'English',
    is_visible: data.isVisible !== undefined ? data.isVisible : 1,
    sort: data.sort || 0
  };

  const { data: template, error } = await supabaseAdmin
    .from('ai_agent_template')
    .insert(templateData)
    .select('id')
    .single();

  if (error) {
    logger.error('Failed to create template:', error);
    throw new Error('Failed to create template');
  }

  // Return just the ID (matches Spring Boot Result<String>)
  return template.id;
};

/**
 * Update an agent template
 * @param {string} templateId - Template ID
 * @param {Object} data - Update data
 * @returns {Promise<null>} null (matches Spring Boot Result<Void>)
 */
const updateTemplate = async (templateId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify template exists (using raw query since getTemplateById now transforms)
  const { data: existing, error: existsError } = await supabaseAdmin
    .from('ai_agent_template')
    .select('id')
    .eq('id', templateId)
    .single();

  if (existsError || !existing) throw new Error('Template not found');

  const updateData = {
    updated_at: new Date().toISOString()
  };

  // Map fields conditionally
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
  if (data.isVisible !== undefined) updateData.is_visible = data.isVisible;
  if (data.sort !== undefined) updateData.sort = data.sort;

  const { error } = await supabaseAdmin
    .from('ai_agent_template')
    .update(updateData)
    .eq('id', templateId);

  if (error) {
    logger.error('Failed to update template:', error);
    throw new Error('Failed to update template');
  }

  // Return null (matches Spring Boot Result<Void>)
  return null;
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get MCP endpoint from sys_params
  const { data: param, error } = await supabaseAdmin
    .from('sys_params')
    .select('param_value')
    .eq('param_code', SERVER_MCP_ENDPOINT)
    .single();

  if (error || !param || !param.param_value || param.param_value === 'null') {
    // No MCP configured - return null (not an error)
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
 * Returns AgentDTO array with model names, device counts, etc.
 * Admin sees all agents with owner info, user sees own agents
 * @param {number} userId - User ID
 * @param {boolean} isSuperAdmin - Whether user is super admin
 * @returns {Promise<Array>} List of AgentDTO objects
 */
const getAgentListForUser = async (userId, isSuperAdmin) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query;

  if (isSuperAdmin) {
    // Admin sees all agents with owner information
    query = supabaseAdmin
      .from('ai_agent')
      .select(`
        *,
        sys_user:user_id (username)
      `)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false });
  } else {
    // Regular user sees only their own agents
    query = supabaseAdmin
      .from('ai_agent')
      .select('*')
      .eq('user_id', userId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false });
  }

  const { data: agents, error } = await query;
  if (error) {
    logger.error('Failed to fetch agents for list:', error);
    throw new Error('Failed to fetch agents');
  }

  // Transform to AgentDTO format with model names and device counts
  const result = await Promise.all((agents || []).map(async (agent) => {
    // Get model names
    let ttsModelName = null;
    let llmModelName = null;
    let vllmModelName = null;
    let ttsVoiceName = null;

    // Get TTS model name
    if (agent.tts_model_id) {
      const { data: ttsModel } = await supabaseAdmin
        .from('ai_model_config')
        .select('model_name')
        .eq('id', agent.tts_model_id)
        .single();
      ttsModelName = ttsModel?.model_name || null;
    }

    // Get LLM model name
    if (agent.llm_model_id) {
      const { data: llmModel } = await supabaseAdmin
        .from('ai_model_config')
        .select('model_name')
        .eq('id', agent.llm_model_id)
        .single();
      llmModelName = llmModel?.model_name || null;
    }

    // Get VLLM model name
    if (agent.vllm_model_id) {
      const { data: vllmModel } = await supabaseAdmin
        .from('ai_model_config')
        .select('model_name')
        .eq('id', agent.vllm_model_id)
        .single();
      vllmModelName = vllmModel?.model_name || null;
    }

    // Get TTS voice name
    if (agent.tts_voice_id) {
      const { data: ttsVoice } = await supabaseAdmin
        .from('ai_tts_voice')
        .select('voice_name')
        .eq('id', agent.tts_voice_id)
        .single();
      ttsVoiceName = ttsVoice?.voice_name || null;
    }

    // Get device count
    const { count: deviceCount } = await supabaseAdmin
      .from('ai_device')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agent.id);

    // Get device MAC addresses
    const { data: devices } = await supabaseAdmin
      .from('ai_device')
      .select('mac_address')
      .eq('agent_id', agent.id);
    const deviceMacAddresses = (devices || []).map(d => d.mac_address).join(',');

    // Get latest last connection time from devices
    const { data: latestDevice } = await supabaseAdmin
      .from('ai_device')
      .select('last_connected_at')
      .eq('agent_id', agent.id)
      .order('last_connected_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .single();

    return {
      id: agent.id,
      agentName: agent.agent_name,
      ttsModelName: ttsModelName,
      ttsVoiceName: ttsVoiceName,
      llmModelName: llmModelName,
      vllmModelName: vllmModelName,
      memModelId: agent.mem_model_id,
      systemPrompt: agent.system_prompt,
      summaryMemory: agent.summary_memory,
      lastConnectedAt: latestDevice?.last_connected_at || null,
      deviceCount: deviceCount || 0,
      deviceMacAddresses: deviceMacAddresses,
      ownerUsername: isSuperAdmin ? (agent.sys_user?.username || null) : undefined,
      createDate: agent.created_at
    };
  }));

  return result;
};

/**
 * Admin agent list with pagination (Spring Boot /agent/all format)
 * Returns PageData<AgentEntity> with pagination
 * @param {Object} params - Query parameters with page, limit
 * @returns {Promise<Object>} Paginated agents with {list, total, page, limit}
 */
const adminAgentListPaginated = async (params = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const page = parseInt(params.page) || 1;
  const limit = parseInt(params.limit) || 10;
  const offset = (page - 1) * limit;

  // Get total count
  const { count } = await supabaseAdmin
    .from('ai_agent')
    .select('id', { count: 'exact', head: true });

  // Get agents with pagination
  const { data: agents, error } = await supabaseAdmin
    .from('ai_agent')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch admin agent list:', error);
    throw new Error('Failed to fetch agents');
  }

  // Transform to camelCase AgentEntity format
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get agent without user filtering (matches Spring Boot behavior)
  const { data: agent, error } = await supabaseAdmin
    .from('ai_agent')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error || !agent) return null;

  // Get plugin mappings for this agent
  const { data: pluginMappings } = await supabaseAdmin
    .from('ai_agent_plugin_mapping')
    .select('id, agent_id, plugin_id, param_info')
    .eq('agent_id', agentId);

  // Transform plugin mappings to camelCase
  const functions = (pluginMappings || []).map(mapping => ({
    id: mapping.id,
    agentId: mapping.agent_id,
    pluginId: mapping.plugin_id,
    paramInfo: mapping.param_info
  }));

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
  // MCP Access Point methods
  getMcpAddress,
  getMcpTools
};
