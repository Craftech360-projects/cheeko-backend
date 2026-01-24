/**
 * Model Service
 *
 * Handles AI model configuration (ASR, TTS, LLM, VAD, etc.)
 * Uses ai_model_config table to match Spring Boot structure
 */

const { supabaseAdmin } = require('../config/database');
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model_config')
    .select('*')
    .eq('model_type', modelType)
    .eq('is_enabled', 1)
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch models');

  return (models || []).map(transformToCamelCase);
};

/**
 * Get model by ID
 * @param {string} modelId - Model ID
 * @returns {Promise<Object>} Model
 */
const getModelById = async (modelId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error } = await supabaseAdmin
    .from('ai_model_config')
    .select('*')
    .eq('id', modelId)
    .single();

  if (error || !model) return null;

  return transformToCamelCase(model);
};

/**
 * Get all models (paginated)
 * Matches Spring Boot: PageData<ModelConfigDTO>
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated models
 */
const listModels = async ({ page = 1, limit = 20, modelType, modelName } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_model_config')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_model_config')
    .select('*')
    .order('sort', { ascending: true });

  if (modelType) {
    countQuery = countQuery.eq('model_type', modelType);
    dataQuery = dataQuery.eq('model_type', modelType);
  }

  if (modelName) {
    countQuery = countQuery.ilike('model_name', `%${modelName}%`);
    dataQuery = dataQuery.ilike('model_name', `%${modelName}%`);
  }

  const { count } = await countQuery;
  const { data: models, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch models');

  return {
    list: (models || []).map(transformToCamelCase),
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error } = await supabaseAdmin
    .from('ai_model_config')
    .insert({
      model_type: data.modelType,
      model_name: data.modelName,
      model_code: data.modelCode || data.modelName,
      is_default: data.isDefault || 0,
      is_enabled: data.isEnabled !== undefined ? data.isEnabled : 1,
      config_json: data.configJson || {},
      doc_link: data.docLink,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create model');

  return transformToCamelCase(model);
};

/**
 * Update model
 * @param {string} modelId - Model ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated model (camelCase)
 */
const updateModel = async (modelId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.isDefault !== undefined) updateData.is_default = data.isDefault;
  if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;
  if (data.configJson !== undefined) updateData.config_json = data.configJson;
  if (data.docLink !== undefined) updateData.doc_link = data.docLink;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: model, error } = await supabaseAdmin
    .from('ai_model_config')
    .update(updateData)
    .eq('id', modelId)
    .select()
    .single();

  if (error) throw new Error('Failed to update model');

  return transformToCamelCase(model);
};

/**
 * Delete model
 * Matches Spring Boot: checks for default model and agent references before deleting
 * @param {string} modelId - Model ID
 */
const deleteModel = async (modelId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First, check if the model exists and if it's a default model
  const { data: model, error: fetchError } = await supabaseAdmin
    .from('ai_model_config')
    .select('id, model_type, is_default')
    .eq('id', modelId)
    .single();

  if (fetchError || !model) {
    throw new Error('Model not found');
  }

  // Check if it's the default model - Spring Boot: "This is a default model, please set another model as default first"
  if (model.is_default === 1) {
    throw new Error('This is a default model, please set another model as default first');
  }

  // Check if any agents reference this model
  const { data: agents, error: agentError } = await supabaseAdmin
    .from('ai_agent')
    .select('id, agent_name')
    .or(`vad_model_id.eq.${modelId},asr_model_id.eq.${modelId},llm_model_id.eq.${modelId},tts_model_id.eq.${modelId},mem_model_id.eq.${modelId},vllm_model_id.eq.${modelId},intent_model_id.eq.${modelId}`);

  if (!agentError && agents && agents.length > 0) {
    const agentNames = agents.map(a => a.agent_name).join('、');
    throw new Error(`This model configuration is referenced by agent(s) [${agentNames}] and cannot be deleted`);
  }

  // Check if this LLM is referenced by any intent configurations
  if (model.model_type && model.model_type.toLowerCase() === 'llm') {
    const { data: intentConfigs, error: intentError } = await supabaseAdmin
      .from('ai_model_config')
      .select('id')
      .eq('model_type', 'intent')
      .ilike('config_json', `%${modelId}%`);

    if (!intentError && intentConfigs && intentConfigs.length > 0) {
      throw new Error('This LLM model is referenced by intent recognition configuration and cannot be deleted');
    }
  }

  // All checks passed, delete the model
  const { error } = await supabaseAdmin
    .from('ai_model_config')
    .delete()
    .eq('id', modelId);

  if (error) throw new Error('Failed to delete model');
};

/**
 * Get TTS voices
 * @param {string} ttsModelId - TTS model ID (optional)
 * @returns {Promise<Array>} TTS voices
 */
const getTtsVoices = async (ttsModelId = null) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_tts_voice')
    .select('*')
    .order('sort', { ascending: true });

  if (ttsModelId) {
    query = query.eq('tts_model_id', ttsModelId);
  }

  const { data: voices, error } = await query;

  if (error) throw new Error('Failed to fetch TTS voices');

  return voices || [];
};

/**
 * Get TTS voice by ID
 * @param {string} voiceId - Voice ID
 * @returns {Promise<Object>} TTS voice
 */
const getTtsVoiceById = async (voiceId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: voice, error } = await supabaseAdmin
    .from('ai_tts_voice')
    .select('*')
    .eq('id', voiceId)
    .single();

  if (error || !voice) return null;

  return voice;
};

/**
 * Create TTS voice
 * @param {number} userId - User ID
 * @param {Object} data - Voice data
 * @returns {Promise<Object>} Created voice
 */
const createTtsVoice = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: voice, error } = await supabaseAdmin
    .from('ai_tts_voice')
    .insert({
      tts_model_id: data.ttsModelId,
      tts_voice: data.ttsVoice || data.voiceCode,
      name: data.name || data.voiceName,
      languages: data.languages || data.language,
      remark: data.remark,
      reference_audio: data.referenceAudio,
      reference_text: data.referenceText,
      voice_demo: data.voiceDemo || data.previewUrl,
      sort: data.sort || 0,
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create TTS voice');

  return voice;
};

/**
 * Update TTS voice
 * @param {string} voiceId - Voice ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated voice
 */
const updateTtsVoice = async (voiceId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

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
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: voice, error } = await supabaseAdmin
    .from('ai_tts_voice')
    .update(updateData)
    .eq('id', voiceId)
    .select()
    .single();

  if (error) throw new Error('Failed to update TTS voice');

  return voice;
};

/**
 * Delete TTS voice
 * @param {string} voiceId - Voice ID
 */
const deleteTtsVoice = async (voiceId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_tts_voice')
    .delete()
    .eq('id', voiceId);

  if (error) throw new Error('Failed to delete TTS voice');
};

/**
 * Get model options for dropdown (grouped by type)
 * @returns {Promise<Object>} Grouped model options
 */
const getModelOptions = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model_config')
    .select('id, model_type, model_name, model_code')
    .eq('is_enabled', 1)
    .order('model_type', { ascending: true })
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch model options');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_model_config')
    .select('id, model_name')
    .eq('is_enabled', 1)
    .order('sort', { ascending: true });

  if (modelType) {
    query = query.eq('model_type', modelType);
  }

  if (modelName) {
    query = query.ilike('model_name', `%${modelName}%`);
  }

  const { data: models, error } = await query;

  if (error) throw new Error('Failed to fetch model names');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_model_config')
    .select('id, model_name, config_json')
    .eq('model_type', 'llm')
    .eq('is_enabled', 1)
    .order('sort', { ascending: true });

  if (modelName) {
    query = query.ilike('model_name', `%${modelName}%`);
  }

  const { data: models, error } = await query;

  if (error) throw new Error('Failed to fetch LLM names');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: providers, error } = await supabaseAdmin
    .from('ai_model_provider')
    .select('*')
    .eq('model_type', modelType)
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch provider types');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First verify if provider exists (matching Spring Boot behavior)
  const { data: providers } = await supabaseAdmin
    .from('ai_model_provider')
    .select('id')
    .eq('model_type', modelType)
    .eq('provider_code', provideCode);

  if (!providers || providers.length === 0) {
    throw new Error('Provider does not exist');
  }

  const { data: model, error } = await supabaseAdmin
    .from('ai_model_config')
    .insert({
      model_type: modelType,
      model_name: data.modelName,
      model_code: data.modelCode || data.modelName,
      is_default: 0, // New models are never default
      is_enabled: data.isEnabled !== undefined ? data.isEnabled : 1,
      config_json: data.configJson || {},
      doc_link: data.docLink,
      remark: data.remark,
      sort: data.sort || 0,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create model:', error);
    throw new Error('Failed to create model');
  }

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First verify if provider exists (matching Spring Boot behavior)
  const { data: providers } = await supabaseAdmin
    .from('ai_model_provider')
    .select('id')
    .eq('model_type', modelType)
    .eq('provider_code', provideCode);

  if (!providers || providers.length === 0) {
    throw new Error('Provider does not exist');
  }

  // Then verify the model exists
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('ai_model_config')
    .select('id')
    .eq('id', modelId)
    .single();

  if (fetchError || !existing) {
    throw new Error('Model not found');
  }

  // Spring Boot: validate intent LLM configuration
  // If configJson contains "llm" key, verify the referenced LLM is valid
  if (data.configJson && data.configJson.llm) {
    const llmId = data.configJson.llm;
    const { data: llmModel, error: llmError } = await supabaseAdmin
      .from('ai_model_config')
      .select('id, model_type, config_json')
      .eq('id', llmId)
      .single();

    if (llmError || !llmModel) {
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

  const updateData = { update_date: new Date().toISOString() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;
  if (data.configJson !== undefined) updateData.config_json = data.configJson;
  if (data.docLink !== undefined) updateData.doc_link = data.docLink;
  if (data.remark !== undefined) updateData.remark = data.remark;
  if (data.sort !== undefined) updateData.sort = data.sort;

  const { data: model, error } = await supabaseAdmin
    .from('ai_model_config')
    .update(updateData)
    .eq('id', modelId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update model:', error);
    throw new Error('Failed to update model');
  }

  return transformToCamelCase(model);
};

/**
 * Enable/disable model configuration
 * @param {string} modelId - Model ID
 * @param {number} status - Enable status (0 or 1)
 * @returns {Promise<void>}
 */
const enableModel = async (modelId, status) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error: fetchError } = await supabaseAdmin
    .from('ai_model_config')
    .select('id')
    .eq('id', modelId)
    .single();

  if (fetchError || !model) {
    throw new Error('Model configuration does not exist');
  }

  const { error } = await supabaseAdmin
    .from('ai_model_config')
    .update({
      is_enabled: status,
      update_date: new Date().toISOString()
    })
    .eq('id', modelId);

  if (error) throw new Error('Failed to update model status');
};

/**
 * Set default model
 * @param {string} modelId - Model ID
 * @returns {Promise<void>}
 */
const setDefaultModel = async (modelId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error: fetchError } = await supabaseAdmin
    .from('ai_model_config')
    .select('id, model_type')
    .eq('id', modelId)
    .single();

  if (fetchError || !model) {
    throw new Error('Model configuration does not exist');
  }

  // Set other models of the same type as non-default
  await supabaseAdmin
    .from('ai_model_config')
    .update({ is_default: 0, update_date: new Date().toISOString() })
    .eq('model_type', model.model_type);

  // Set this model as default and enabled
  const { error } = await supabaseAdmin
    .from('ai_model_config')
    .update({
      is_default: 1,
      is_enabled: 1,
      update_date: new Date().toISOString()
    })
    .eq('id', modelId);

  if (error) throw new Error('Failed to set default model');
};

// =============================================
// Model Provider CRUD Methods
// =============================================

/**
 * Get model providers with pagination
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated providers
 */
const getProviders = async ({ page = 1, limit = 20, modelType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_model_provider')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_model_provider')
    .select('*')
    .order('model_type', { ascending: true })
    .order('sort', { ascending: true });

  if (modelType) {
    countQuery = countQuery.eq('model_type', modelType);
    dataQuery = dataQuery.eq('model_type', modelType);
  }

  const { count } = await countQuery;
  const { data: providers, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch providers');

  return {
    list: providers || [],
    total: count || 0,
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
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: provider, error } = await supabaseAdmin
    .from('ai_model_provider')
    .select('*')
    .eq('id', providerId)
    .single();

  if (error || !provider) return null;

  return provider;
};

/**
 * Create model provider
 * @param {number} userId - User ID (creator)
 * @param {Object} data - Provider data
 * @returns {Promise<Object>} Created provider
 */
const createProvider = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: provider, error } = await supabaseAdmin
    .from('ai_model_provider')
    .insert({
      model_type: data.modelType,
      provider_code: data.providerCode,
      name: data.name,
      fields: data.fields || [],
      sort: data.sort || 0,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create provider:', error);
    throw new Error('Failed to create provider');
  }

  return provider;
};

/**
 * Update model provider
 * @param {string} providerId - Provider ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated provider
 */
const updateProvider = async (providerId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { update_date: new Date().toISOString() };

  if (data.modelType !== undefined) updateData.model_type = data.modelType;
  if (data.providerCode !== undefined) updateData.provider_code = data.providerCode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.fields !== undefined) updateData.fields = data.fields;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.updater !== undefined) updateData.updater = data.updater;

  const { data: provider, error } = await supabaseAdmin
    .from('ai_model_provider')
    .update(updateData)
    .eq('id', providerId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update provider:', error);
    throw new Error('Failed to update provider');
  }

  return provider;
};

/**
 * Delete model provider
 * @param {string} providerId - Provider ID
 */
const deleteProvider = async (providerId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_model_provider')
    .delete()
    .eq('id', providerId);

  if (error) {
    logger.error('Failed to delete provider:', error);
    throw new Error('Failed to delete provider');
  }
};

/**
 * Get provider plugin names
 * Returns unique provider codes grouped by model type
 * @returns {Promise<Array>} Plugin names
 */
const getProviderPluginNames = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: providers, error } = await supabaseAdmin
    .from('ai_model_provider')
    .select('id, model_type, provider_code, name')
    .order('model_type', { ascending: true })
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch provider plugin names');

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
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('ai_tts_voice')
    .select('id, tts_voice, name, languages, remark, voice_demo, sort')
    .eq('tts_model_id', modelId)
    .order('sort', { ascending: true });

  if (voiceName) {
    query = query.ilike('name', `%${voiceName}%`);
  }

  const { data: voices, error } = await query;

  if (error) throw new Error('Failed to fetch voices');

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
  getProviderPluginNames,
  // Voice by model
  getVoicesByModelId
};
