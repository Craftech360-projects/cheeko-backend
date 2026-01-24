/**
 * Agent Service
 *
 * Handles AI agent configuration, chat history, and device integration.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');
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
 * @param {number} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated agent
 */
const updateAgent = async (agentId, userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getAgentById(agentId, userId);
  if (!existing) throw new Error('Agent not found');

  const updateData = {
    updated_at: new Date().toISOString(),
    updater: userId
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

  if (error) throw new Error('Failed to update agent');

  return agent;
};

/**
 * Delete agent
 * @param {string} agentId - Agent ID
 * @param {number} userId - User ID
 */
const deleteAgent = async (agentId, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getAgentById(agentId, userId);
  if (!existing) throw new Error('Agent not found');

  const { error } = await supabaseAdmin
    .from('ai_agent')
    .delete()
    .eq('id', agentId);

  if (error) throw new Error('Failed to delete agent');
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
 * Get agent sessions (unique session IDs from chat history)
 * @param {string} agentId - Agent ID
 * @returns {Promise<Array>} Sessions
 */
const getAgentSessions = async (agentId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('session_id, mac_address, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });

  if (error) throw new Error('Failed to fetch sessions');

  // Get unique sessions
  const sessionsMap = new Map();
  (data || []).forEach(item => {
    if (!sessionsMap.has(item.session_id)) {
      sessionsMap.set(item.session_id, {
        sessionId: item.session_id,
        macAddress: item.mac_address,
        startedAt: item.created_at
      });
    }
  });

  return Array.from(sessionsMap.values());
};

/**
 * Get chat history for a session
 * @param {string} agentId - Agent ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Chat messages
 */
const getChatHistory = async (agentId, sessionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data, error } = await supabaseAdmin
    .from('ai_agent_chat_history')
    .select('*')
    .eq('agent_id', agentId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error('Failed to fetch chat history');

  return data || [];
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
// Agent Template Methods
// =============================================

/**
 * Get all visible agent templates
 * @returns {Promise<Array>} List of visible templates
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

  return templates || [];
};

/**
 * Get agent template by ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template or null
 */
const getTemplateById = async (templateId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: template, error } = await supabaseAdmin
    .from('ai_agent_template')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !template) return null;

  return template;
};

/**
 * Create a new agent template
 * @param {Object} data - Template data
 * @returns {Promise<Object>} Created template
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
    .select()
    .single();

  if (error) {
    logger.error('Failed to create template:', error);
    throw new Error('Failed to create template');
  }

  return template;
};

/**
 * Update an agent template
 * @param {string} templateId - Template ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated template
 */
const updateTemplate = async (templateId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify template exists
  const existing = await getTemplateById(templateId);
  if (!existing) throw new Error('Template not found');

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

  const { data: template, error } = await supabaseAdmin
    .from('ai_agent_template')
    .update(updateData)
    .eq('id', templateId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update template:', error);
    throw new Error('Failed to update template');
  }

  return template;
};

module.exports = {
  createAgent,
  getAgentById,
  updateAgent,
  deleteAgent,
  listAgents,
  getAllAgents,
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
  // Template methods
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate
};
