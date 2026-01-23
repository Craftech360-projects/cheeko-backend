/**
 * Model Service
 *
 * Handles AI model configuration (ASR, TTS, LLM, VAD, etc.)
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Get all models by type
 * @param {string} modelType - Model type (asr, tts, llm, vad, mem, intent, vllm)
 * @returns {Promise<Array>} Models
 */
const getModelsByType = async (modelType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model')
    .select('*')
    .eq('model_type', modelType)
    .eq('status', 1)
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch models');

  return models || [];
};

/**
 * Get model by ID
 * @param {string} modelId - Model ID
 * @returns {Promise<Object>} Model
 */
const getModelById = async (modelId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error } = await supabaseAdmin
    .from('ai_model')
    .select('*')
    .eq('id', modelId)
    .single();

  if (error || !model) return null;

  return model;
};

/**
 * Get all models (paginated)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated models
 */
const listModels = async ({ page = 1, limit = 20, modelType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_model')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_model')
    .select('*')
    .order('model_type', { ascending: true })
    .order('sort', { ascending: true });

  if (modelType) {
    countQuery = countQuery.eq('model_type', modelType);
    dataQuery = dataQuery.eq('model_type', modelType);
  }

  const { count } = await countQuery;
  const { data: models, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch models');

  return {
    list: models || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Create model
 * @param {number} userId - User ID
 * @param {Object} data - Model data
 * @returns {Promise<Object>} Created model
 */
const createModel = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error } = await supabaseAdmin
    .from('ai_model')
    .insert({
      model_type: data.modelType,
      model_name: data.modelName,
      model_code: data.modelCode,
      provider: data.provider,
      api_key: data.apiKey,
      api_url: data.apiUrl,
      config: data.config || {},
      description: data.description,
      sort: data.sort || 0,
      status: data.status || 1,
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create model');

  return model;
};

/**
 * Update model
 * @param {string} modelId - Model ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated model
 */
const updateModel = async (modelId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.provider !== undefined) updateData.provider = data.provider;
  if (data.apiKey !== undefined) updateData.api_key = data.apiKey;
  if (data.apiUrl !== undefined) updateData.api_url = data.apiUrl;
  if (data.config !== undefined) updateData.config = data.config;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.status !== undefined) updateData.status = data.status;

  const { data: model, error } = await supabaseAdmin
    .from('ai_model')
    .update(updateData)
    .eq('id', modelId)
    .select()
    .single();

  if (error) throw new Error('Failed to update model');

  return model;
};

/**
 * Delete model
 * @param {string} modelId - Model ID
 */
const deleteModel = async (modelId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_model')
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
    .eq('status', 1)
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
      voice_name: data.voiceName,
      voice_code: data.voiceCode,
      gender: data.gender,
      language: data.language,
      accent: data.accent,
      age_group: data.ageGroup,
      style: data.style,
      preview_url: data.previewUrl,
      config: data.config || {},
      sort: data.sort || 0,
      status: data.status || 1,
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

  const updateData = { updated_at: new Date().toISOString() };

  if (data.voiceName !== undefined) updateData.voice_name = data.voiceName;
  if (data.voiceCode !== undefined) updateData.voice_code = data.voiceCode;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.accent !== undefined) updateData.accent = data.accent;
  if (data.ageGroup !== undefined) updateData.age_group = data.ageGroup;
  if (data.style !== undefined) updateData.style = data.style;
  if (data.previewUrl !== undefined) updateData.preview_url = data.previewUrl;
  if (data.config !== undefined) updateData.config = data.config;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.status !== undefined) updateData.status = data.status;

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
    .from('ai_model')
    .select('id, model_type, model_name, model_code')
    .eq('status', 1)
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
 * @returns {Promise<Array>} Model names
 */
const getModelNames = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model')
    .select('id, model_type, model_name, model_code, provider')
    .eq('status', 1)
    .order('model_type', { ascending: true })
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch model names');

  return (models || []).map(model => ({
    id: model.id,
    modelType: model.model_type,
    modelName: model.model_name,
    modelCode: model.model_code,
    provider: model.provider
  }));
};

/**
 * Get LLM model names
 * @returns {Promise<Array>} LLM model names
 */
const getLlmNames = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model')
    .select('id, model_name, model_code, provider')
    .eq('model_type', 'llm')
    .eq('status', 1)
    .order('sort', { ascending: true });

  if (error) throw new Error('Failed to fetch LLM names');

  return (models || []).map(model => ({
    id: model.id,
    modelName: model.model_name,
    modelCode: model.model_code,
    provider: model.provider
  }));
};

/**
 * Get provider types for a given model type
 * @param {string} modelType - Model type (asr, tts, llm, vad, mem, intent, vllm)
 * @returns {Promise<Array>} Provider types
 */
const getProviderTypes = async (modelType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: models, error } = await supabaseAdmin
    .from('ai_model')
    .select('provider')
    .eq('model_type', modelType)
    .eq('status', 1);

  if (error) throw new Error('Failed to fetch provider types');

  // Get unique providers
  const providers = [...new Set((models || []).map(m => m.provider).filter(Boolean))];

  return providers.map(provider => ({
    provider,
    name: provider.charAt(0).toUpperCase() + provider.slice(1)
  }));
};

/**
 * Create model with type and provider in path
 * @param {number} userId - User ID
 * @param {string} modelType - Model type
 * @param {string} provider - Provider name
 * @param {Object} data - Model data
 * @returns {Promise<Object>} Created model
 */
const createModelByTypeProvider = async (userId, modelType, provider, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: model, error } = await supabaseAdmin
    .from('ai_model')
    .insert({
      model_type: modelType,
      provider: provider,
      model_name: data.modelName,
      model_code: data.modelCode,
      api_key: data.apiKey,
      api_url: data.apiUrl,
      config: data.config || {},
      description: data.description,
      sort: data.sort || 0,
      status: data.status !== undefined ? data.status : 1,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create model:', error);
    throw new Error('Failed to create model');
  }

  return model;
};

/**
 * Update model with type and provider in path
 * @param {string} modelId - Model ID
 * @param {string} modelType - Model type
 * @param {string} provider - Provider name
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated model
 */
const updateModelByTypeProvider = async (modelId, modelType, provider, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // First verify the model exists and matches type/provider
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('ai_model')
    .select('id')
    .eq('id', modelId)
    .eq('model_type', modelType)
    .eq('provider', provider)
    .single();

  if (fetchError || !existing) {
    throw new Error('Model not found or type/provider mismatch');
  }

  const updateData = { updated_at: new Date().toISOString() };

  if (data.modelName !== undefined) updateData.model_name = data.modelName;
  if (data.modelCode !== undefined) updateData.model_code = data.modelCode;
  if (data.apiKey !== undefined) updateData.api_key = data.apiKey;
  if (data.apiUrl !== undefined) updateData.api_url = data.apiUrl;
  if (data.config !== undefined) updateData.config = data.config;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.sort !== undefined) updateData.sort = data.sort;
  if (data.status !== undefined) updateData.status = data.status;

  const { data: model, error } = await supabaseAdmin
    .from('ai_model')
    .update(updateData)
    .eq('id', modelId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update model:', error);
    throw new Error('Failed to update model');
  }

  return model;
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
  updateModelByTypeProvider
};
