/**
 * Config Service
 *
 * Handles device configuration endpoints used by LiveKit workers.
 * Provides agent configuration, child profiles, templates, and system settings.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');

/**
 * Get server-side base configuration
 * Used by LiveKit workers to get server-side settings
 * @returns {Promise<Object>} Server configuration
 */
const getServerBaseConfig = async () => {
  // Get relevant system parameters
  const params = await prisma.sys_params.findMany({
    where: {
      param_code: {
        in: [
          'livekit_url',
          'livekit_api_key',
          'livekit_api_secret',
          'default_language',
          'default_tts_voice',
          'enable_memory',
          'enable_rag',
          'server_region'
        ]
      }
    },
    select: {
      param_code: true,
      param_value: true,
      value_type: true
    }
  });

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
  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { agent_id: true }
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent with model IDs
  const agent = await prisma.ai_agent.findFirst({
    where: { id: device.agent_id },
    select: {
      id: true,
      agent_name: true,
      asr_model_id: true,
      vad_model_id: true,
      llm_model_id: true,
      vllm_model_id: true,
      tts_model_id: true,
      tts_voice_id: true,
      mem_model_id: true,
      intent_model_id: true
    }
  });

  if (!agent) {
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
    const modelConfigs = await prisma.ai_model_config.findMany({
      where: { id: { in: modelIds } },
      select: {
        id: true,
        model_type: true,
        model_code: true,
        model_name: true,
        config_json: true
      }
    });

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
    const voiceData = await prisma.ai_tts_voice.findFirst({
      where: { id: agent.tts_voice_id },
      select: {
        id: true,
        tts_voice: true,
        name: true,
        languages: true
      }
    });

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
  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { agent_id: true, kid_id: true }
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent
  const agent = await prisma.ai_agent.findFirst({
    where: { id: device.agent_id },
    select: {
      id: true,
      agent_name: true,
      agent_code: true,
      system_prompt: true,
      summary_memory: true,
      lang_code: true,
      language: true
    }
  });

  if (!agent) {
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
    kidId: device.kid_id ? device.kid_id.toString() : null
  };
};

/**
 * Get child profile by device MAC address
 * Returns the kid profile associated with the device
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object|null>} Child profile or null
 */
const getChildProfileByMac = async (macAddress) => {
  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with kid_id and user_id
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { kid_id: true, user_id: true }
  });

  if (!device) {
    throw new Error('Device not found');
  }

  let kid = null;

  // Try direct kid_id first
  if (device.kid_id) {
    kid = await prisma.kid_profile.findFirst({
      where: { id: device.kid_id }
    });
  }

  // Fallback: find kid profile through device owner (user_id)
  if (!kid && device.user_id) {
    kid = await prisma.kid_profile.findFirst({
      where: { user_id: device.user_id },
      orderBy: { created_at: 'desc' }
    });
  }

  if (!kid) {
    return null;
  }

  // Calculate age from birth_date
  let age = null;
  const birthDate = kid.birth_date;
  if (birthDate) {
    const dob = new Date(birthDate);
    const now = new Date();
    age = Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000));
  }

  return {
    id: kid.id ? kid.id.toString() : null,
    name: kid.name,
    dateOfBirth: birthDate,
    age,
    gender: kid.gender,
    interests: kid.interests,
    primaryLanguage: kid.language,
    additionalNotes: null // not in current schema
  };
};

/**
 * Get agent template ID by device MAC address
 * Returns the template ID if the device's agent was created from a template
 * @param {string} macAddress - Device MAC address
 * @returns {Promise<Object>} Template ID info
 */
const getAgentTemplateIdByMac = async (macAddress) => {
  const normalizedMac = normalizeMacAddress(macAddress);

  // Get device with agent
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { agent_id: true }
  });

  if (!device || !device.agent_id) {
    throw new Error('Device or agent not found');
  }

  // Get agent to check for template info
  const agent = await prisma.ai_agent.findFirst({
    where: { id: device.agent_id },
    select: {
      id: true,
      agent_code: true,
      agent_name: true
    }
  });

  if (!agent) {
    throw new Error('Agent not found');
  }

  // Try to find matching template by agent_code
  let templateId = null;
  if (agent.agent_code) {
    const template = await prisma.ai_agent_template.findFirst({
      where: {
        agent_code: agent.agent_code,
        is_visible: 1
      },
      select: { id: true }
    });

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
  const template = await prisma.ai_agent_template.findFirst({
    where: { id: templateId }
  });

  if (!template) {
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
  const normalizedMac = normalizeMacAddress(macAddress);

  // Check if device has location info stored
  // Note: This could be extended to store location in a device_location table
  // For now, we return null and let the caller handle geolocation
  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { id: true, mac_address: true }
  });

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

/**
 * Create a kid profile and assign it to a device by MAC address.
 * Internal helper for service endpoint /config/assign-child-profile.
 *
 * @param {string} macAddress
 * @param {Object} payload
 * @param {string} payload.name
 * @param {string} [payload.dateOfBirth]
 * @param {string} [payload.gender]
 * @param {string[]} [payload.interests]
 * @param {string} [payload.additionalNotes]
 * @returns {Promise<Object>}
 */
const createAndAssignChildProfile = async (macAddress, payload = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    throw new Error('Invalid MAC address');
  }

  const name = String(payload.name || '').trim();
  if (!name) {
    throw new Error('Child name is required');
  }

  const interests = Array.isArray(payload.interests)
    ? payload.interests.map(item => String(item || '').trim()).filter(Boolean)
    : [];

  const preferences = payload.additionalNotes
    ? { additionalNotes: String(payload.additionalNotes).trim() }
    : {};

  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { id: true, user_id: true }
  });
  if (!device) {
    throw new Error('Device not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    const kid = await tx.kid_profile.create({
      data: {
        user_id: device.user_id || null,
        name,
        birth_date: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
        gender: payload.gender ? String(payload.gender).trim() : null,
        interests,
        language: 'en',
        preferences
      }
    });

    await tx.ai_device.update({
      where: { id: device.id },
      data: {
        kid_id: kid.id,
        update_date: new Date()
      }
    });

    return kid;
  });

  return {
    macAddress: normalizedMac,
    deviceId: device.id,
    kidId: result.id.toString(),
    name: result.name,
    gender: result.gender,
    interests: result.interests || [],
    additionalNotes: result.preferences?.additionalNotes || null
  };
};

module.exports = {
  getServerBaseConfig,
  getAgentModels,
  getAgentPrompt,
  getChildProfileByMac,
  createAndAssignChildProfile,
  getAgentTemplateIdByMac,
  getTemplateContent,
  getDeviceLocation,
  getWeather
};
