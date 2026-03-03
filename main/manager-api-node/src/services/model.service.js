/**
 * Model Service
 *
 * Handles AI model configuration (ASR, TTS, LLM, VAD, etc.)
 * Uses ai_model_config table to match Spring Boot structure
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// Helper to transform snake_case to camelCase
const transformToCamelCase = (obj) => {
  if (!obj) return null;
  return {
    id: obj.id,
    modelType: obj.model_type,
    modelCode: obj.model_code,
    modelName: obj.model_name,
    isDefault: obj.is_default,
    isEnabled: obj.is_enabled,
    configJson: obj.config_json,
    docLink: obj.doc_link,
    remark: obj.remark,
    sort: obj.sort,
    creator: obj.creator,
    createDate: obj.create_date,
    updater: obj.updater,
    updateDate: obj.update_date
  };
};

/**
 * Get all models by type
 * @param {string} modelType - Model type (asr, tts, llm, vad, mem, intent, vllm)
 * @returns {Promise<Array>} Models
 */
const getModelsByType = async (modelType) => {
  const models = await prisma.ai_model_config.findMany({
    where: {
      model_type: modelType,
      is_enabled: 1
    },
    orderBy: { sort: 'asc' }
  });

  return (models || []).map(transformToCamelCase);
};

/**
 * Get model by ID
 * @param {string} modelId - Model ID
 * @returns {Promise<Object>} Model
 */
const getModelById = async (modelId) => {
  const model = await prisma.ai_model_config.findFirst({
    where: { id: modelId }
  });

  if (!model) return null;

  return transformToCamelCase(model);
};

/**
 * Get all models (paginated)
 * Matches Spring Boot: PageData<ModelConfigDTO>
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated models
 */
const listModels = async ({ page = 1, limit = 20, modelType, modelName } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (modelType) {
    where.model_type = modelType;
  }

  if (modelName) {
    where.model_name = { contains: modelName, mode: 'insensitive' };
  }

  const [total, models] = await Promise.all([
    prisma.ai_model_config.count({ where }),
    prisma.ai_model_config.findMany({
      where,
      orderBy: { sort: 'asc' },
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: (models || []).map(transformToCamelCase),
    total: total || 0,
    page,
    limit
  };
};

/**
 * Create model
 * @param {number} userId - User ID
 * @param {Object} data - Model data
 * @returns {Promise<Object>} Created model (camelCase)
 */
const createModel = async (userId, data) => {
  const model = await prisma.ai_model_config.create({
    data: {
      model_type: data.modelType,
      model_name: data.modelName,
      model_code: data.modelCode || data.modelName,
      is_default: data.isDefault || 0,
      is_enabled: data.isEnabled !== undefined ? data.isEnabled : 1,
      config_json: data.configJson || {},
      doc_link: data.docLink,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId ? BigInt(userId) : null
    }
  });

  return transformToCamelCase(model);
};

/**
 * Update model
 * @param {string} modelId - Model ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated model (camelCase)
 */
const updateModel = async (modelId, data) => {
  const updateData = { update_date: new Date() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.isDefault !== undefined) updateData.is_default = data.isDefault;
  if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;
  if (data.configJson !== undefined) updateData.config_json = data.configJson;
  if (data.docLink !== undefined) updateData.doc_link = data.docLink;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = BigInt(data.updater);

  const model = await prisma.ai_model_config.update({
    where: { id: modelId },
    data: updateData
  });

  return transformToCamelCase(model);
};

/**
 * Delete model
 * Matches Spring Boot: checks for default model and agent references before deleting
 * @param {string} modelId - Model ID
 */
const deleteModel = async (modelId) => {
  // First, check if the model exists and if it's a default model
  const model = await prisma.ai_model_config.findFirst({
    where: { id: modelId },
    select: { id: true, model_type: true, is_default: true }
  });

  if (!model) {
    throw new Error('Model not found');
  }

  // Check if it's the default model - Spring Boot: "This is a default model, please set another model as default first"
  if (model.is_default === 1) {
    throw new Error('This is a default model, please set another model as default first');
  }

  // Check if any agents reference this model
  const agents = await prisma.ai_agent.findMany({
    where: {
      OR: [
        { vad_model_id: modelId },
        { asr_model_id: modelId },
        { llm_model_id: modelId },
        { tts_model_id: modelId },
        { mem_model_id: modelId },
        { vllm_model_id: modelId },
        { intent_model_id: modelId }
      ]
    },
    select: { id: true, agent_name: true }
  });

  if (agents && agents.length > 0) {
    const agentNames = agents.map(a => a.agent_name).join('、');
    throw new Error(`This model configuration is referenced by agent(s) [${agentNames}] and cannot be deleted`);
  }

  // Check if this LLM is referenced by any intent configurations
  if (model.model_type && model.model_type.toLowerCase() === 'llm') {
    const intentConfigs = await prisma.ai_model_config.findMany({
      where: {
        model_type: 'intent',
        config_json: {
          string_contains: modelId
        }
      },
      select: { id: true }
    });

    if (intentConfigs && intentConfigs.length > 0) {
      throw new Error('This LLM model is referenced by intent recognition configuration and cannot be deleted');
    }
  }

  // All checks passed, delete the model
  await prisma.ai_model_config.delete({ where: { id: modelId } });
};

/**
 * Get TTS voices
 * @param {string} ttsModelId - TTS model ID (optional)
 * @returns {Promise<Array>} TTS voices
 */
const getTtsVoices = async (ttsModelId = null) => {
  const where = {};
  if (ttsModelId) {
    where.tts_model_id = ttsModelId;
  }

  const voices = await prisma.ai_tts_voice.findMany({
    where,
    orderBy: { sort: 'asc' }
  });

  return voices || [];
};

/**
 * Get TTS voice by ID
 * @param {string} voiceId - Voice ID
 * @returns {Promise<Object>} TTS voice
 */
const getTtsVoiceById = async (voiceId) => {
  const voice = await prisma.ai_tts_voice.findFirst({
    where: { id: voiceId }
  });

  if (!voice) return null;

  return voice;
};

/**
 * Create TTS voice
 * @param {number} userId - User ID
 * @param {Object} data - Voice data
 * @returns {Promise<Object>} Created voice
 */
const createTtsVoice = async (userId, data) => {
  const voice = await prisma.ai_tts_voice.create({
    data: {
      tts_model_id: data.ttsModelId,
      tts_voice: data.ttsVoice || data.voiceCode,
      name: data.name || data.voiceName,
      languages: data.languages || data.language,
      remark: data.remark,
      reference_audio: data.referenceAudio,
      reference_text: data.referenceText,
      voice_demo: data.voiceDemo || data.previewUrl,
      sort: data.sort || 0,
      creator: userId ? BigInt(userId) : null
    }
  });

  return voice;
};

/**
 * Update TTS voice
 * @param {string} voiceId - Voice ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated voice
 */
const updateTtsVoice = async (voiceId, data) => {
  const updateData = { update_date: new Date() };

  if (data.ttsVoice !== undefined || data.voiceCode !== undefined) {
    updateData.tts_voice = data.ttsVoice || data.voiceCode;
  }
  if (data.name !== undefined || data.voiceName !== undefined) {
    updateData.name = data.name || data.voiceName;
  }
  if (data.languages !== undefined || data.language !== undefined) {
    updateData.languages = data.languages || data.language;
  }
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.referenceAudio !== undefined) updateData.reference_audio = data.referenceAudio;
  if (data.referenceText !== undefined) updateData.reference_text = data.referenceText;
  if (data.voiceDemo !== undefined || data.previewUrl !== undefined) {
    updateData.voice_demo = data.voiceDemo || data.previewUrl;
  }
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = BigInt(data.updater);

  const voice = await prisma.ai_tts_voice.update({
    where: { id: voiceId },
    data: updateData
  });

  return voice;
};

/**
 * Delete TTS voice
 * @param {string} voiceId - Voice ID
 */
const deleteTtsVoice = async (voiceId) => {
  await prisma.ai_tts_voice.delete({ where: { id: voiceId } });
};

/**
 * Get model options for dropdown (grouped by type)
 * @returns {Promise<Object>} Grouped model options
 */
const getModelOptions = async () => {
  const models = await prisma.ai_model_config.findMany({
    where: { is_enabled: 1 },
    select: { id: true, model_type: true, model_name: true, model_code: true },
    orderBy: [{ model_type: 'asc' }, { sort: 'asc' }]
  });

  // Group by type
  const grouped = {};
  (models || []).forEach(model => {
    if (!grouped[model.model_type]) {
      grouped[model.model_type] = [];
    }
    grouped[model.model_type].push({
      id: model.id,
      name: model.model_name,
      code: model.model_code
    });
  });

  return grouped;
};

/**
 * Get model names (simple list of all model names)
 * Matches Spring Boot: List<ModelBasicInfoDTO>
 * @param {string} modelType - Model type (required by Spring Boot)
 * @param {string} modelName - Optional model name filter
 * @returns {Promise<Array>} Model names with {id, modelName}
 */
const getModelNames = async (modelType, modelName) => {
  const where = { is_enabled: 1 };

  if (modelType) {
    where.model_type = modelType;
  }

  if (modelName) {
    where.model_name = { contains: modelName, mode: 'insensitive' };
  }

  const models = await prisma.ai_model_config.findMany({
    where,
    select: { id: true, model_name: true },
    orderBy: { sort: 'asc' }
  });

  // Return format matching ModelBasicInfoDTO: {id, modelName}
  return (models || []).map(model => ({
    id: model.id,
    modelName: model.model_name
  }));
};

/**
 * Get LLM model names
 * Matches Spring Boot: List<LlmModelBasicInfoDTO>
 * @param {string} modelName - Optional model name filter
 * @returns {Promise<Array>} LLM model names with {id, modelName, type}
 */
const getLlmNames = async (modelName) => {
  const where = {
    model_type: 'llm',
    is_enabled: 1
  };

  if (modelName) {
    where.model_name = { contains: modelName, mode: 'insensitive' };
  }

  const models = await prisma.ai_model_config.findMany({
    where,
    select: { id: true, model_name: true, config_json: true },
    orderBy: { sort: 'asc' }
  });

  // Return format matching LlmModelBasicInfoDTO: {id, modelName, type}
  return (models || []).map(model => ({
    id: model.id,
    modelName: model.model_name,
    type: model.config_json?.type || null
  }));
};

/**
 * Get provider types for a given model type
 * Matches Spring Boot: List<ModelProviderDTO>
 * @param {string} modelType - Model type (asr, tts, llm, vad, mem, intent, vllm)
 * @returns {Promise<Array>} Provider types
 */
const getProviderTypes = async (modelType) => {
  const providers = await prisma.ai_model_provider.findMany({
    where: { model_type: modelType },
    orderBy: { sort: 'asc' }
  });

  // Return full provider objects matching ModelProviderDTO
  return (providers || []).map(p => ({
    id: p.id,
    modelType: p.model_type,
    providerCode: p.provider_code,
    name: p.name,
    fields: p.fields,
    sort: p.sort
  }));
};

/**
 * Create model with type and provider in path
 * Matches Spring Boot: ModelConfigDTO
 * @param {number} userId - User ID
 * @param {string} modelType - Model type
 * @param {string} provideCode - Provider code
 * @param {Object} data - Model data (ModelConfigBodyDTO)
 * @returns {Promise<Object>} Created model
 */
const createModelByTypeProvider = async (userId, modelType, provideCode, data) => {
  // First verify if provider exists (matching Spring Boot behavior)
  const providers = await prisma.ai_model_provider.findMany({
    where: {
      model_type: modelType,
      provider_code: provideCode
    },
    select: { id: true }
  });

  if (!providers || providers.length === 0) {
    throw new Error('Provider does not exist');
  }

  const model = await prisma.ai_model_config.create({
    data: {
      model_type: modelType,
      model_name: data.modelName,
      model_code: data.modelCode || data.modelName,
      is_default: 0, // New models are never default
      is_enabled: data.isEnabled !== undefined ? data.isEnabled : 1,
      config_json: data.configJson || {},
      doc_link: data.docLink,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId ? BigInt(userId) : null
    }
  });

  return transformToCamelCase(model);
};

/**
 * Update model with type and provider in path
 * Matches Spring Boot: validates provider, checks intent LLM config
 * @param {string} modelId - Model ID
 * @param {string} modelType - Model type
 * @param {string} provideCode - Provider code
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated model
 */
const updateModelByTypeProvider = async (modelId, modelType, provideCode, data) => {
  // First verify if provider exists (matching Spring Boot behavior)
  const providers = await prisma.ai_model_provider.findMany({
    where: {
      model_type: modelType,
      provider_code: provideCode
    },
    select: { id: true }
  });

  if (!providers || providers.length === 0) {
    throw new Error('Provider does not exist');
  }

  // Then verify the model exists
  const existing = await prisma.ai_model_config.findFirst({
    where: { id: modelId },
    select: { id: true }
  });

  if (!existing) {
    throw new Error('Model not found');
  }

  // Spring Boot: validate intent LLM configuration
  // If configJson contains "llm" key, verify the referenced LLM is valid
  if (data.configJson && data.configJson.llm) {
    const llmId = data.configJson.llm;
    const llmModel = await prisma.ai_model_config.findFirst({
      where: { id: llmId },
      select: { id: true, model_type: true, config_json: true }
    });

    if (!llmModel) {
      throw new Error('The configured LLM does not exist');
    }

    if (!llmModel.model_type || llmModel.model_type.toLowerCase() !== 'llm') {
      throw new Error('The configured LLM does not exist');
    }

    // Check if the LLM type is openai or ollama
    const llmType = llmModel.config_json?.type;
    if (llmType !== 'openai' && llmType !== 'ollama') {
      throw new Error('The configured LLM is not openai or ollama');
    }
  }

  const updateData = { update_date: new Date() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;
  if (data.configJson !== undefined) updateData.config_json = data.configJson;
  if (data.docLink !== undefined) updateData.doc_link = data.docLink;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;

  const model = await prisma.ai_model_config.update({
    where: { id: modelId },
    data: updateData
  });

  return transformToCamelCase(model);
};

/**
 * Enable/disable model configuration
 * @param {string} modelId - Model ID
 * @param {number} status - Enable status (0 or 1)
 * @returns {Promise<void>}
 */
const enableModel = async (modelId, status) => {
  const model = await prisma.ai_model_config.findFirst({
    where: { id: modelId },
    select: { id: true }
  });

  if (!model) {
    throw new Error('Model configuration does not exist');
  }

  await prisma.ai_model_config.update({
    where: { id: modelId },
    data: {
      is_enabled: status,
      update_date: new Date()
    }
  });
};

/**
 * Set default model
 * @param {string} modelId - Model ID
 * @returns {Promise<void>}
 */
const setDefaultModel = async (modelId) => {
  const model = await prisma.ai_model_config.findFirst({
    where: { id: modelId },
    select: { id: true, model_type: true }
  });

  if (!model) {
    throw new Error('Model configuration does not exist');
  }

  // Set other models of the same type as non-default
  await prisma.ai_model_config.updateMany({
    where: { model_type: model.model_type },
    data: { is_default: 0, update_date: new Date() }
  });

  // Set this model as default and enabled
  await prisma.ai_model_config.update({
    where: { id: modelId },
    data: {
      is_default: 1,
      is_enabled: 1,
      update_date: new Date()
    }
  });
};

// =============================================
// Model Provider CRUD Methods
// =============================================

// Helper to transform provider to camelCase (matching ModelProviderDTO)
const transformProviderToCamelCase = (obj) => {
  if (!obj) return null;
  return {
    id: obj.id,
    modelType: obj.model_type,
    providerCode: obj.provider_code,
    name: obj.name,
    fields: obj.fields,
    sort: obj.sort,
    creator: obj.creator,
    createDate: obj.create_date,
    updater: obj.updater,
    updateDate: obj.update_date
  };
};

/**
 * Get model providers with pagination
 * Matches Spring Boot: supports modelType filter and name search (LIKE on name OR provider_code)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated providers
 */
const getProviders = async ({ page = 1, limit = 20, modelType, name } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (modelType) {
    where.model_type = modelType;
  }

  // Spring Boot: filters by name OR provider_code (LIKE search)
  if (name) {
    where.OR = [
      { name: { contains: name, mode: 'insensitive' } },
      { provider_code: { contains: name, mode: 'insensitive' } }
    ];
  }

  const [total, providers] = await Promise.all([
    prisma.ai_model_provider.count({ where }),
    prisma.ai_model_provider.findMany({
      where,
      orderBy: [{ model_type: 'asc' }, { sort: 'asc' }],
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: (providers || []).map(transformProviderToCamelCase),
    total: total || 0,
    page,
    limit
  };
};

/**
 * Get provider by ID
 * @param {string} providerId - Provider ID
 * @returns {Promise<Object|null>} Provider or null
 */
const getProviderById = async (providerId) => {
  const provider = await prisma.ai_model_provider.findFirst({
    where: { id: providerId }
  });

  if (!provider) return null;

  return provider;
};

/**
 * Create model provider
 * Matches Spring Boot: returns ModelProviderDTO in camelCase
 * @param {number} userId - User ID (creator)
 * @param {Object} data - Provider data
 * @returns {Promise<Object>} Created provider
 */
const createProvider = async (userId, data) => {
  let provider;
  try {
    provider = await prisma.ai_model_provider.create({
      data: {
        model_type: data.modelType,
        provider_code: data.providerCode,
        name: data.name,
        fields: data.fields || [],
        sort: data.sort || 0,
        creator: userId ? BigInt(userId) : null
      }
    });
  } catch (error) {
    logger.error('Failed to create provider:', error);
    throw new Error('Failed to add data');
  }

  return transformProviderToCamelCase(provider);
};

/**
 * Update model provider
 * Matches Spring Boot: returns ModelProviderDTO in camelCase
 * @param {string} providerId - Provider ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated provider
 */
const updateProvider = async (providerId, data) => {
  const updateData = { update_date: new Date() };

  if (data.modelType !== undefined) updateData.model_type = data.modelType;
  if (data.providerCode !== undefined) updateData.provider_code = data.providerCode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.fields !== undefined) updateData.fields = data.fields;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = BigInt(data.updater);

  let provider;
  try {
    provider = await prisma.ai_model_provider.update({
      where: { id: providerId },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update provider:', error);
    throw new Error('Failed to update data');
  }

  return transformProviderToCamelCase(provider);
};

/**
 * Delete model provider
 * @param {string} providerId - Provider ID
 */
const deleteProvider = async (providerId) => {
  try {
    await prisma.ai_model_provider.delete({ where: { id: providerId } });
  } catch (error) {
    logger.error('Failed to delete provider:', error);
    throw new Error('Failed to delete data');
  }
};

/**
 * Delete multiple model providers (batch delete)
 * Matches Spring Boot: accepts array of IDs
 * @param {Array<string>} ids - Provider IDs to delete
 */
const deleteProviders = async (ids) => {
  try {
    await prisma.ai_model_provider.deleteMany({
      where: { id: { in: ids } }
    });
  } catch (error) {
    logger.error('Failed to delete providers:', error);
    throw new Error('Failed to delete data');
  }
};

/**
 * Get provider plugin names
 * Returns unique provider codes grouped by model type
 * @returns {Promise<Array>} Plugin names
 */
const getProviderPluginNames = async () => {
  const providers = await prisma.ai_model_provider.findMany({
    select: { id: true, model_type: true, provider_code: true, name: true },
    orderBy: [{ model_type: 'asc' }, { sort: 'asc' }]
  });

  // Return as simple list with model type context
  return (providers || []).map(p => ({
    id: p.id,
    modelType: p.model_type,
    providerCode: p.provider_code,
    name: p.name
  }));
};

/**
 * Get voices for a model (for Spring Boot /models/{modelId}/voices)
 * @param {string} modelId - Model ID
 * @param {string} voiceName - Optional voice name filter
 * @returns {Promise<Array>} Voice list
 */
const getVoicesByModelId = async (modelId, voiceName) => {
  const where = { tts_model_id: modelId };

  if (voiceName) {
    where.name = { contains: voiceName, mode: 'insensitive' };
  }

  const voices = await prisma.ai_tts_voice.findMany({
    where,
    select: {
      id: true,
      tts_voice: true,
      name: true,
      languages: true,
      remark: true,
      voice_demo: true,
      sort: true
    },
    orderBy: { sort: 'asc' }
  });

  // Return format matching VoiceDTO
  return (voices || []).map(v => ({
    id: v.id,
    ttsVoice: v.tts_voice,
    name: v.name,
    languages: v.languages,
    remark: v.remark,
    voiceDemo: v.voice_demo,
    sort: v.sort
  }));
};

/**
 * Get TTS voices with pagination (for /ttsVoice endpoint)
 * Matches Spring Boot TimbreService.page()
 * @param {string} ttsModelId - TTS model ID (required)
 * @param {string} name - Timbre name filter (optional, fuzzy match)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} PageData with list, total
 */
const getTtsVoicesPage = async (ttsModelId, name, page = 1, limit = 10) => {
  const offset = (page - 1) * limit;

  const where = { tts_model_id: ttsModelId };

  // Fuzzy match on name if provided
  if (name) {
    where.name = { contains: name, mode: 'insensitive' };
  }

  const [total, voices] = await Promise.all([
    prisma.ai_tts_voice.count({ where }),
    prisma.ai_tts_voice.findMany({
      where,
      orderBy: { sort: 'asc' },
      skip: offset,
      take: limit
    })
  ]);

  return {
    list: voices || [],
    total: total || 0
  };
};

/**
 * Create timbre (for /ttsVoice POST endpoint)
 * Matches Spring Boot TimbreService.save()
 * @param {number} userId - User ID (creator)
 * @param {Object} dto - TimbreDataDTO
 */
const createTimbre = async (userId, dto) => {
  await prisma.ai_tts_voice.create({
    data: {
      tts_model_id: dto.ttsModelId,
      tts_voice: dto.ttsVoice,
      name: dto.name,
      languages: dto.languages,
      remark: dto.remark,
      reference_audio: dto.referenceAudio,
      reference_text: dto.referenceText,
      voice_demo: dto.voiceDemo,
      sort: dto.sort || 0,
      creator: userId ? BigInt(userId) : null,
      create_date: new Date()
    }
  });
};

/**
 * Update timbre (for /ttsVoice/{id} PUT endpoint)
 * Matches Spring Boot TimbreService.update()
 * @param {string} timbreId - Timbre ID
 * @param {number} userId - User ID (updater)
 * @param {Object} dto - TimbreDataDTO
 */
const updateTimbre = async (timbreId, userId, dto) => {
  await prisma.ai_tts_voice.update({
    where: { id: timbreId },
    data: {
      tts_model_id: dto.ttsModelId,
      tts_voice: dto.ttsVoice,
      name: dto.name,
      languages: dto.languages,
      remark: dto.remark,
      reference_audio: dto.referenceAudio,
      reference_text: dto.referenceText,
      voice_demo: dto.voiceDemo,
      sort: dto.sort || 0,
      updater: userId ? BigInt(userId) : null,
      update_date: new Date()
    }
  });
};

/**
 * Delete timbres in batch (for /ttsVoice/delete POST endpoint)
 * Matches Spring Boot TimbreService.delete()
 * @param {string[]} ids - Array of timbre IDs to delete
 */
const deleteTimbreBatch = async (ids) => {
  await prisma.ai_tts_voice.deleteMany({
    where: { id: { in: ids } }
  });
};

module.exports = {
  getModelsByType,
  getModelById,
  listModels,
  createModel,
  updateModel,
  deleteModel,
  getTtsVoices,
  getTtsVoiceById,
  createTtsVoice,
  updateTtsVoice,
  deleteTtsVoice,
  getModelOptions,
  getModelNames,
  getLlmNames,
  getProviderTypes,
  createModelByTypeProvider,
  updateModelByTypeProvider,
  enableModel,
  setDefaultModel,
  // Provider CRUD
  getProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  deleteProviders,
  getProviderPluginNames,
  // Voice by model
  getVoicesByModelId,
  // Timbre management (Spring Boot compatible)
  getTtsVoicesPage,
  createTimbre,
  updateTimbre,
  deleteTimbreBatch
};
