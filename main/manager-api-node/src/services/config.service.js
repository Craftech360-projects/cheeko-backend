/**
 * Config Service
 *
 * Handles device configuration endpoints used by LiveKit workers.
 * Provides agent configuration, child profiles, templates, and system settings.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');

/**
 * Get server-side base configuration
 * Used by LiveKit workers to get server-side settings
 * @returns {Promise<Object>} Server configuration
 */
const getServerBaseConfig = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get relevant system parameters
  const { data: params } = await supabaseAdmin
    .from('sys_params')
    .select('param_code, param_value, value_type')
    .in('param_code', [
      'livekit_url',
      'livekit_api_key',
      'livekit_api_secret',
      'default_language',
      'default_tts_voice',
      'enable_memory',
      'enable_rag',
      'server_region'
    ]);

  // Convert to key-value object
  const config = {};
  (params || []).forEach(param => {
    let value = param.param_value;
    // Parse based on value type
    if (param.value_type === 'number') {
      value = Number(value);
    } else if (param.value_type === 'boolean') {
      value = value === 'true' || value === '1';
    } else if (param.value_type === 'object' || param.value_type === 'array') {
      try {
        value = JSON.parse(value);
      } catch {
        // Keep as string if parsing fails
      }
    }
    config[param.param_code] = value;
  });

  return {
    serverVersion: '1.0.0',
    platform: 'node',
    config
  };
};

/**
 * Get agent models configuration for a device
 * Returns all model IDs configured for the device's agent
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object>} Agent model configuration
 */
const getAgentModels = async (macAddress) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent with model IDs
  const { data: agent, error: agentError } = await supabaseAdmin
    .from('ai_agent')
    .select(`
      id,
      agent_name,
      asr_model_id,
      vad_model_id,
      llm_model_id,
      vllm_model_id,
      tts_model_id,
      tts_voice_id,
      mem_model_id,
      intent_model_id
    `)
    .eq('id', device.agent_id)
    .single();

  if (agentError || !agent) {
    throw new Error('Agent not found');
  }

  // Get model configurations for each model ID
  const modelIds = [
    agent.asr_model_id,
    agent.vad_model_id,
    agent.llm_model_id,
    agent.vllm_model_id,
    agent.tts_model_id,
    agent.mem_model_id,
    agent.intent_model_id
  ].filter(Boolean);

  const models = {};
  if (modelIds.length > 0) {
    const { data: modelConfigs } = await supabaseAdmin
      .from('ai_model_config')
      .select('id, model_type, model_code, model_name, config_json')
      .in('id', modelIds);

    (modelConfigs || []).forEach(m => {
      models[m.model_type] = {
        id: m.id,
        modelCode: m.model_code,
        modelName: m.model_name,
        config: m.config_json
      };
    });
  }

  // Get TTS voice if configured
  let voice = null;
  if (agent.tts_voice_id) {
    const { data: voiceData } = await supabaseAdmin
      .from('ai_tts_voice')
      .select('id, tts_voice, name, languages')
      .eq('id', agent.tts_voice_id)
      .single();

    if (voiceData) {
      voice = {
        id: voiceData.id,
        voiceCode: voiceData.tts_voice,
        voiceName: voiceData.name,
        languages: voiceData.languages
      };
    }
  }

  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    models,
    voice
  };
};

/**
 * Get agent prompt by MAC address
 * Returns the system prompt for the device's agent
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object>} Agent prompt configuration
 */
const getAgentPrompt = async (macAddress) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id, kid_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent
  const { data: agent, error: agentError } = await supabaseAdmin
    .from('ai_agent')
    .select('id, agent_name, agent_code, system_prompt, summary_memory, lang_code, language')
    .eq('id', device.agent_id)
    .single();

  if (agentError || !agent) {
    throw new Error('Agent not found');
  }

  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    agentCode: agent.agent_code,
    systemPrompt: agent.system_prompt,
    summaryMemory: agent.summary_memory,
    langCode: agent.lang_code,
    language: agent.language,
    kidId: device.kid_id
  };
};

/**
 * Get child profile by device MAC address
 * Returns the kid profile associated with the device
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object|null>} Child profile or null
 */
const getChildProfileByMac = async (macAddress) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with kid_id
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('kid_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device) {
    throw new Error('Device not found');
  }

  if (!device.kid_id) {
    return null;
  }

  // Get kid profile
  const { data: kid, error: kidError } = await supabaseAdmin
    .from('kid_profile')
    .select('*')
    .eq('id', device.kid_id)
    .single();

  if (kidError || !kid) {
    return null;
  }

  // Calculate age from date_of_birth
  let age = null;
  if (kid.date_of_birth) {
    const dob = new Date(kid.date_of_birth);
    const now = new Date();
    age = Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000));
  }

  return {
    id: kid.id,
    name: kid.name,
    dateOfBirth: kid.date_of_birth,
    age,
    gender: kid.gender,
    interests: kid.interests,
    primaryLanguage: kid.primary_language,
    additionalNotes: kid.additional_notes
  };
};

/**
 * Get agent template ID by device MAC address
 * Returns the template ID if the device's agent was created from a template
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object>} Template ID info
 */
const getAgentTemplateIdByMac = async (macAddress) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const { data: device, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('agent_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (deviceError || !device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent to check for template info
  const { data: agent, error: agentError } = await supabaseAdmin
    .from('ai_agent')
    .select('id, agent_code, agent_name')
    .eq('id', device.agent_id)
    .single();

  if (agentError || !agent) {
    throw new Error('Agent not found');
  }

  // Try to find matching template by agent_code
  let templateId = null;
  if (agent.agent_code) {
    const { data: template } = await supabaseAdmin
      .from('ai_agent_template')
      .select('id')
      .eq('agent_code', agent.agent_code)
      .eq('is_visible', 1)
      .single();

    if (template) {
      templateId = template.id;
    }
  }

  return {
    agentId: agent.id,
    agentCode: agent.agent_code,
    agentName: agent.agent_name,
    templateId
  };
};

/**
 * Get template content (personality) by template ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template content or null
 */
const getTemplateContent = async (templateId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: template, error } = await supabaseAdmin
    .from('ai_agent_template')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !template) {
    return null;
  }

  return {
    id: template.id,
    agentCode: template.agent_code,
    agentName: template.agent_name,
    systemPrompt: template.system_prompt,
    summaryMemory: template.summary_memory,
    langCode: template.lang_code,
    language: template.language,
    ttsModelId: template.tts_model_id,
    ttsVoiceId: template.tts_voice_id,
    llmModelId: template.llm_model_id,
    asrModelId: template.asr_model_id,
    vadModelId: template.vad_model_id
  };
};

/**
 * Get device location info
 * Returns cached location or null if not available
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object|null>} Location info or null
 */
const getDeviceLocation = async (macAddress) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(macAddress);

  // Check if device has location info stored
  // Note: This could be extended to store location in a device_location table
  // For now, we return null and let the caller handle geolocation
  const { data: device } = await supabaseAdmin
    .from('ai_device')
    .select('id, mac_address')
    .eq('mac_address', normalizedMac)
    .single();

  if (!device) {
    throw new Error('Device not found');
  }

  // Location data could be stored in sys_params or a separate table
  // For now, return minimal info
  return {
    macAddress: normalizedMac,
    deviceId: device.id,
    location: null,
    timezone: null
  };
};

/**
 * Get weather forecast by location
 * Note: This is a stub - actual implementation would call a weather API
 * @param {Object} params - Location parameters
 * @param {number} params.latitude - Latitude
 * @param {number} params.longitude - Longitude
 * @param {string} [params.city] - City name (optional)
 * @returns {Promise<Object>} Weather info
 */
const getWeather = async ({ latitude, longitude, city }) => {
  // This would typically call an external weather API
  // For now, return a stub response
  logger.debug('Weather request:', { latitude, longitude, city });

  return {
    available: false,
    message: 'Weather service not configured',
    location: {
      latitude,
      longitude,
      city
    },
    forecast: null
  };
};

module.exports = {
  getServerBaseConfig,
  getAgentModels,
  getAgentPrompt,
  getChildProfileByMac,
  getAgentTemplateIdByMac,
  getTemplateContent,
  getDeviceLocation,
  getWeather
};
