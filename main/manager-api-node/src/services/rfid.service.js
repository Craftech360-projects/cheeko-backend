/**
 * RFID Service
 *
 * Handles RFID card mapping management and content lookup.
 * Supports card-to-question mappings with RAG integration.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');
const qdrantService = require('./integrations/qdrant.service');

// =============================================
// Card Mapping Methods (PRD-specified)
// =============================================

/**
 * Get card mappings with pagination
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated card mapping list
 */
const getCardMappingPage = async ({ page = 1, limit = 10, packCode, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_card_mapping')
    .select('id', { count: 'exact', head: true });

  // Build data query with joins to related tables
  let dataQuery = supabaseAdmin
    .from('rfid_card_mapping')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language),
      pack:pack_id(id, pack_code, name),
      content_pack:content_pack_id(id, pack_code, name, content_type)
    `)
    .order('create_date', { ascending: false });

  // Apply filters
  if (packCode) {
    countQuery = countQuery.eq('pack_code', packCode);
    dataQuery = dataQuery.eq('pack_code', packCode);
  }

  if (active !== undefined) {
    countQuery = countQuery.eq('active', active);
    dataQuery = dataQuery.eq('active', active);
  }

  const { count } = await countQuery;
  const { data: cards, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch card mappings:', error);
    throw new Error('Failed to fetch card mappings');
  }

  return {
    list: cards || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all card mappings (no pagination)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All card mappings
 */
const getCardMappingList = async ({ packCode, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_card_mapping')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language),
      pack:pack_id(id, pack_code, name),
      content_pack:content_pack_id(id, pack_code, name, content_type)
    `)
    .order('create_date', { ascending: false });

  if (packCode) {
    query = query.eq('pack_code', packCode);
  }

  if (active !== undefined) {
    query = query.eq('active', active);
  }

  const { data: cards, error } = await query;

  if (error) {
    logger.error('Failed to fetch card mappings:', error);
    throw new Error('Failed to fetch card mappings');
  }

  return cards || [];
};

/**
 * Lookup card mapping by RFID UID
 * Public endpoint for ESP32 devices
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object>} Card mapping with question data
 */
const lookupCardByUid = async (rfidUid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Normalize UID (uppercase, no separators)
  const normalizedUid = rfidUid.toUpperCase().replace(/[:-]/g, '');

  // First try exact match
  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language, category, difficulty),
      pack:pack_id(id, pack_code, name, description),
      content_pack:content_pack_id(id, pack_code, name, content_type, content_md)
    `)
    .eq('rfid_uid', normalizedUid)
    .eq('active', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Card lookup error:', error);
  }

  if (card) {
    // Get multiple questions if question_ids is populated
    const questions = [];
    if (card.question) {
      questions.push(card.question);
    }

    if (card.question_ids && Array.isArray(card.question_ids) && card.question_ids.length > 0) {
      const { data: additionalQuestions } = await supabaseAdmin
        .from('rfid_question')
        .select('*')
        .in('id', card.question_ids)
        .eq('active', true);

      if (additionalQuestions) {
        // Merge, avoiding duplicates
        const existingIds = questions.map(q => q.id);
        additionalQuestions.forEach(q => {
          if (!existingIds.includes(q.id)) {
            questions.push(q);
          }
        });
      }
    }

    return {
      ...card,
      questions: questions.length > 0 ? questions : undefined
    };
  }

  // If no exact match, try series lookup (UID range)
  const { data: series } = await supabaseAdmin
    .from('rfid_series')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language, category, difficulty),
      pack:pack_id(id, pack_code, name, description)
    `)
    .lte('start_uid', normalizedUid)
    .gte('end_uid', normalizedUid)
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (series) {
    return {
      rfid_uid: normalizedUid,
      source: 'series',
      series_id: series.id,
      question: series.question,
      pack: series.pack,
      questions: series.question ? [series.question] : []
    };
  }

  return null;
};

/**
 * Create card mapping
 * @param {Object} data - Card mapping data
 * @param {number} userId - Creator user ID
 * @returns {Promise<Object>} Created card mapping
 */
const createCardMapping = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Normalize UID
  const normalizedUid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');

  // Check for duplicate
  const existing = await lookupCardByUid(normalizedUid);
  if (existing && existing.id) {
    throw new Error('Card mapping already exists for this UID');
  }

  const insertData = {
    rfid_uid: normalizedUid,
    question_id: data.questionId || null,
    question_ids: data.questionIds || [],
    pack_code: data.packCode || null,
    pack_id: data.packId || null,
    content_pack_id: data.contentPackId || null,
    notes: data.notes || null,
    active: data.active !== false,
    creator: userId
  };

  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .insert(insertData)
    .select(`
      *,
      question:question_id(id, code, title),
      pack:pack_id(id, pack_code, name),
      content_pack:content_pack_id(id, pack_code, name)
    `)
    .single();

  if (error) {
    logger.error('Failed to create card mapping:', error);
    throw new Error('Failed to create card mapping');
  }

  return card;
};

/**
 * Update card mapping
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<Object>} Updated card mapping
 */
const updateCardMapping = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Card mapping ID is required');
  }

  const updateData = {
    updater: userId,
    update_date: new Date().toISOString()
  };

  // Only update provided fields
  if (data.rfidUid !== undefined) {
    updateData.rfid_uid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.questionId !== undefined) updateData.question_id = data.questionId;
  if (data.questionIds !== undefined) updateData.question_ids = data.questionIds;
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.packId !== undefined) updateData.pack_id = data.packId;
  if (data.contentPackId !== undefined) updateData.content_pack_id = data.contentPackId;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.active !== undefined) updateData.active = data.active;

  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .update(updateData)
    .eq('id', data.id)
    .select(`
      *,
      question:question_id(id, code, title),
      pack:pack_id(id, pack_code, name),
      content_pack:content_pack_id(id, pack_code, name)
    `)
    .single();

  if (error) {
    logger.error('Failed to update card mapping:', error);
    throw new Error('Failed to update card mapping');
  }

  return card;
};

/**
 * Delete card mapping
 * @param {Object} data - Delete criteria (id or rfidUid)
 * @returns {Promise<boolean>} Success status
 */
const deleteCardMapping = async (data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_card_mapping')
    .delete();

  if (data.id) {
    query = query.eq('id', data.id);
  } else if (data.rfidUid) {
    const normalizedUid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');
    query = query.eq('rfid_uid', normalizedUid);
  } else {
    throw new Error('ID or RFID UID is required for deletion');
  }

  const { error } = await query;

  if (error) {
    logger.error('Failed to delete card mapping:', error);
    throw new Error('Failed to delete card mapping');
  }

  return true;
};

// =============================================
// RAG-powered Search Methods
// =============================================

/**
 * Perform RAG semantic search using Qdrant
 * @param {Object} options - Search options
 * @param {number[]} options.embedding - Query embedding vector
 * @param {number} [options.contentPackId] - Filter by content pack ID
 * @param {string} [options.language] - Filter by language
 * @param {number} [options.limit=5] - Max results
 * @param {number} [options.scoreThreshold=0.7] - Minimum similarity score
 * @returns {Promise<Array>} Search results with payloads
 */
const ragSearch = async ({ embedding, contentPackId, language, limit = 5, scoreThreshold = 0.7 }) => {
  if (!qdrantService.isAvailable()) {
    logger.debug('Qdrant not available, skipping RAG search');
    return [];
  }

  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    logger.warn('No embedding provided for RAG search');
    return [];
  }

  try {
    // Build filter conditions
    const filterConditions = {};

    if (contentPackId) {
      filterConditions.must = filterConditions.must || {};
      filterConditions.must.content_pack_id = contentPackId;
    }

    if (language) {
      filterConditions.must = filterConditions.must || {};
      filterConditions.must.language = language;
    }

    const filter = Object.keys(filterConditions).length > 0
      ? qdrantService.buildFilter(filterConditions)
      : null;

    const results = await qdrantService.search({
      vector: embedding,
      collection: qdrantService.DEFAULT_COLLECTION,
      limit,
      scoreThreshold,
      filter
    });

    logger.debug('RAG search completed:', {
      resultCount: results.length,
      contentPackId,
      language
    });

    return results;
  } catch (error) {
    logger.error('RAG search failed:', { error: error.message });
    return [];
  }
};

/**
 * Lookup card with RAG-enhanced content matching
 * @param {string} rfidUid - RFID UID
 * @param {Object} [options] - Additional options
 * @param {number[]} [options.queryEmbedding] - Pre-computed query embedding for RAG
 * @param {string} [options.queryText] - Text query for context (logged only)
 * @param {boolean} [options.includeRag=true] - Whether to include RAG results
 * @returns {Promise<Object>} Card mapping with RAG-enhanced questions
 */
const lookupCardWithRag = async (rfidUid, options = {}) => {
  const { queryEmbedding, queryText, includeRag = true } = options;

  // First, get the basic card lookup
  const card = await lookupCardByUid(rfidUid);

  if (!card) {
    return null;
  }

  // If card has a content_pack_id and we have an embedding, perform RAG search
  if (includeRag && card.content_pack_id && queryEmbedding) {
    try {
      const ragResults = await ragSearch({
        embedding: queryEmbedding,
        contentPackId: card.content_pack_id,
        limit: 5,
        scoreThreshold: 0.7
      });

      if (ragResults.length > 0) {
        // Add RAG results to the response
        card.rag_results = ragResults.map(result => ({
          id: result.id,
          score: result.score,
          content: result.payload.content,
          title: result.payload.title,
          category: result.payload.category,
          emotion: result.payload.emotion,
          language: result.payload.language
        }));

        // Extract emotions from RAG results
        const emotions = new Set();
        ragResults.forEach(result => {
          if (result.payload.emotion) {
            emotions.add(result.payload.emotion);
          }
        });
        if (emotions.size > 0) {
          card.emotions = Array.from(emotions);
        }

        logger.info('RAG-enhanced lookup completed:', {
          rfidUid,
          contentPackId: card.content_pack_id,
          ragResultCount: ragResults.length,
          queryText: queryText ? queryText.substring(0, 50) : undefined
        });
      }
    } catch (error) {
      logger.error('RAG enhancement failed:', { error: error.message, rfidUid });
      // Continue without RAG results - graceful degradation
    }
  }

  // Add emotion from card content pack if available
  if (card.content_pack && card.content_pack.emotion) {
    card.emotion = card.content_pack.emotion;
  }

  return card;
};

/**
 * Get content pack by ID with metadata
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<Object>} Content pack details
 */
const getContentPack = async (contentPackId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('id', contentPackId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch content pack:', error);
    throw new Error('Failed to fetch content pack');
  }

  return pack || null;
};

/**
 * Upsert content to Qdrant for RAG
 * @param {Object} options - Upsert options
 * @param {string|number} options.id - Unique point ID
 * @param {number[]} options.embedding - Vector embedding
 * @param {Object} options.payload - Content metadata
 * @returns {Promise<Object>} Upsert result
 */
const upsertRagContent = async ({ id, embedding, payload }) => {
  if (!qdrantService.isAvailable()) {
    throw new Error('Qdrant not configured');
  }

  return qdrantService.upsertOne({
    id,
    vector: embedding,
    payload: {
      ...payload,
      indexed_at: new Date().toISOString()
    }
  });
};

/**
 * Delete RAG content by IDs
 * @param {Array} ids - Point IDs to delete
 * @returns {Promise<Object>} Delete result
 */
const deleteRagContent = async (ids) => {
  if (!qdrantService.isAvailable()) {
    throw new Error('Qdrant not configured');
  }

  return qdrantService.deletePoints({ ids });
};

/**
 * Delete RAG content by content pack ID
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<Object>} Delete result
 */
const deleteRagContentByPack = async (contentPackId) => {
  if (!qdrantService.isAvailable()) {
    throw new Error('Qdrant not configured');
  }

  const filter = qdrantService.buildFilter({
    must: { content_pack_id: contentPackId }
  });

  return qdrantService.deleteByFilter({ filter });
};

// =============================================
// Series Lookup Methods
// =============================================

/**
 * Lookup series by UID
 * @param {string} uid - RFID UID
 * @returns {Promise<Object>} Series mapping
 */
const lookupSeriesByUid = async (uid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = uid.toUpperCase().replace(/[:-]/g, '');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language, category, difficulty),
      pack:pack_id(id, pack_code, name, description)
    `)
    .lte('start_uid', normalizedUid)
    .gte('end_uid', normalizedUid)
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Series lookup error:', error);
    throw new Error('Failed to lookup series');
  }

  return series || null;
};

// =============================================
// Pack Management Methods
// =============================================

/**
 * Get pack list
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Pack list
 */
const getPackList = async ({ active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .order('create_date', { ascending: false });

  if (active !== undefined) {
    query = query.eq('active', active);
  }

  const { data: packs, error } = await query;

  if (error) {
    logger.error('Failed to fetch packs:', error);
    throw new Error('Failed to fetch packs');
  }

  return packs || [];
};

/**
 * Create pack
 * @param {Object} data - Pack data
 * @param {number} userId - Creator user ID
 * @returns {Promise<Object>} Created pack
 */
const createPack = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_pack')
    .insert({
      pack_code: data.packCode,
      name: data.name,
      description: data.description,
      age_min: data.ageMin,
      age_max: data.ageMax,
      active: data.active !== false,
      creator: userId
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create pack:', error);
    if (error.code === '23505') {
      throw new Error('Pack with this code already exists');
    }
    throw new Error('Failed to create pack');
  }

  return pack;
};

/**
 * Get pack by ID
 * @param {number} packId - Pack ID
 * @returns {Promise<Object>} Pack details
 */
const getPackById = async (packId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .eq('id', packId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch pack:', error);
    throw new Error('Failed to fetch pack');
  }

  return pack || null;
};

/**
 * Update pack
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<Object>} Updated pack
 */
const updatePack = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Pack ID is required');
  }

  const updateData = {
    updater: userId,
    update_date: new Date().toISOString()
  };

  // Only update provided fields
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.ageMin !== undefined) updateData.age_min = data.ageMin;
  if (data.ageMax !== undefined) updateData.age_max = data.ageMax;
  if (data.active !== undefined) updateData.active = data.active;

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_pack')
    .update(updateData)
    .eq('id', data.id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update pack:', error);
    if (error.code === '23505') {
      throw new Error('Pack with this code already exists');
    }
    throw new Error('Failed to update pack');
  }

  return pack;
};

/**
 * Delete pack
 * @param {number} packId - Pack ID
 * @returns {Promise<boolean>} Success status
 */
const deletePack = async (packId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('rfid_pack')
    .delete()
    .eq('id', packId);

  if (error) {
    logger.error('Failed to delete pack:', error);
    throw new Error('Failed to delete pack');
  }

  return true;
};

// =============================================
// Series Management Methods
// =============================================

/**
 * Get series list with pagination
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated series list
 */
const getSeriesList = async ({ page = 1, limit = 10, packId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_series')
    .select('id', { count: 'exact', head: true });

  // Build data query with joins
  let dataQuery = supabaseAdmin
    .from('rfid_series')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language),
      pack:pack_id(id, pack_code, name)
    `)
    .order('create_date', { ascending: false });

  // Apply filters
  if (packId) {
    countQuery = countQuery.eq('pack_id', packId);
    dataQuery = dataQuery.eq('pack_id', packId);
  }

  if (active !== undefined) {
    countQuery = countQuery.eq('active', active);
    dataQuery = dataQuery.eq('active', active);
  }

  const { count } = await countQuery;
  const { data: series, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return {
    list: series || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all series (no pagination)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All series
 */
const getSeriesAll = async ({ packId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_series')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language),
      pack:pack_id(id, pack_code, name)
    `)
    .order('create_date', { ascending: false });

  if (packId) {
    query = query.eq('pack_id', packId);
  }

  if (active !== undefined) {
    query = query.eq('active', active);
  }

  const { data: series, error } = await query;

  if (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return series || [];
};

/**
 * Get series by ID
 * @param {number} seriesId - Series ID
 * @returns {Promise<Object>} Series details
 */
const getSeriesById = async (seriesId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select(`
      *,
      question:question_id(id, code, title, prompt_text, language, category, difficulty),
      pack:pack_id(id, pack_code, name, description)
    `)
    .eq('id', seriesId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return series || null;
};

/**
 * Create series
 * @param {Object} data - Series data
 * @param {number} userId - Creator user ID
 * @returns {Promise<Object>} Created series
 */
const createSeries = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Normalize UIDs
  const startUid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  const endUid = data.endUid.toUpperCase().replace(/[:-]/g, '');

  // Validate UID order
  if (startUid > endUid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  const insertData = {
    name: data.name,
    description: data.description || null,
    start_uid: startUid,
    end_uid: endUid,
    question_id: data.questionId || null,
    pack_id: data.packId || null,
    priority: data.priority || 0,
    active: data.active !== false,
    creator: userId
  };

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .insert(insertData)
    .select(`
      *,
      question:question_id(id, code, title),
      pack:pack_id(id, pack_code, name)
    `)
    .single();

  if (error) {
    logger.error('Failed to create series:', error);
    throw new Error('Failed to create series');
  }

  return series;
};

/**
 * Update series
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<Object>} Updated series
 */
const updateSeries = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Series ID is required');
  }

  const updateData = {
    updater: userId,
    update_date: new Date().toISOString()
  };

  // Only update provided fields
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.startUid !== undefined) {
    updateData.start_uid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.endUid !== undefined) {
    updateData.end_uid = data.endUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.questionId !== undefined) updateData.question_id = data.questionId;
  if (data.packId !== undefined) updateData.pack_id = data.packId;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.active !== undefined) updateData.active = data.active;

  // Validate UID order if both are being updated
  if (updateData.start_uid && updateData.end_uid && updateData.start_uid > updateData.end_uid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .update(updateData)
    .eq('id', data.id)
    .select(`
      *,
      question:question_id(id, code, title),
      pack:pack_id(id, pack_code, name)
    `)
    .single();

  if (error) {
    logger.error('Failed to update series:', error);
    throw new Error('Failed to update series');
  }

  return series;
};

/**
 * Delete series
 * @param {number} seriesId - Series ID
 * @returns {Promise<boolean>} Success status
 */
const deleteSeries = async (seriesId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('rfid_series')
    .delete()
    .eq('id', seriesId);

  if (error) {
    logger.error('Failed to delete series:', error);
    throw new Error('Failed to delete series');
  }

  return true;
};

// =============================================
// Legacy RFID Tag Methods (for backward compatibility)
// =============================================

/**
 * Get RFID tags with pagination (legacy)
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated RFID list
 */
const getRfidList = async ({ page = 1, limit = 10 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  const { count } = await supabaseAdmin
    .from('ai_rfid_tag')
    .select('id', { count: 'exact', head: true });

  const { data: tags, error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch RFID tags');

  return {
    list: tags || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get RFID tag by ID (legacy)
 * @param {string} tagId - RFID tag ID
 * @returns {Promise<Object>} RFID tag
 */
const getRfidById = async (tagId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: tag, error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .select('*')
    .eq('id', tagId)
    .single();

  if (error || !tag) return null;

  return tag;
};

/**
 * Get RFID tag by UID (legacy)
 * @param {string} uid - RFID UID
 * @returns {Promise<Object>} RFID tag
 */
const getRfidByUid = async (uid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = uid.toUpperCase().replace(/:/g, '');

  const { data: tag, error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .select('*')
    .eq('uid', normalizedUid)
    .single();

  if (error || !tag) return null;

  return tag;
};

/**
 * Create RFID tag (legacy)
 * @param {number} userId - User ID
 * @param {Object} data - RFID data
 * @returns {Promise<Object>} Created tag
 */
const createRfid = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = data.uid.toUpperCase().replace(/:/g, '');

  // Check if UID already exists
  const existing = await getRfidByUid(normalizedUid);
  if (existing) throw new Error('RFID tag with this UID already exists');

  const { data: tag, error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .insert({
      uid: normalizedUid,
      name: data.name,
      description: data.description,
      content_type: data.contentType,
      content_id: data.contentId,
      action_type: data.actionType,
      action_params: data.actionParams,
      status: data.status || 1,
      creator: userId
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create RFID tag');

  return tag;
};

/**
 * Update RFID tag (legacy)
 * @param {string} tagId - RFID tag ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated tag
 */
const updateRfid = async (tagId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.contentType !== undefined) updateData.content_type = data.contentType;
  if (data.contentId !== undefined) updateData.content_id = data.contentId;
  if (data.actionType !== undefined) updateData.action_type = data.actionType;
  if (data.actionParams !== undefined) updateData.action_params = data.actionParams;
  if (data.status !== undefined) updateData.status = data.status;

  const { data: tag, error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .update(updateData)
    .eq('id', tagId)
    .select()
    .single();

  if (error) throw new Error('Failed to update RFID tag');

  return tag;
};

/**
 * Delete RFID tag (legacy)
 * @param {string} tagId - RFID tag ID
 */
const deleteRfid = async (tagId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('ai_rfid_tag')
    .delete()
    .eq('id', tagId);

  if (error) throw new Error('Failed to delete RFID tag');
};

/**
 * Process RFID scan from device (legacy)
 * @param {string} mac - Device MAC address
 * @param {string} uid - RFID UID
 * @returns {Promise<Object>} Action to perform
 */
const processScan = async (mac, uid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  const normalizedUid = uid.toUpperCase().replace(/:/g, '');

  // Get RFID tag
  const tag = await getRfidByUid(normalizedUid);
  if (!tag) {
    throw new Error('Unknown RFID tag');
  }

  if (tag.status !== 1) {
    throw new Error('RFID tag is disabled');
  }

  // Log the scan
  await supabaseAdmin
    .from('ai_rfid_scan_log')
    .insert({
      mac_address: normalizedMac,
      rfid_uid: normalizedUid,
      tag_id: tag.id
    });

  // Determine action
  if (tag.action_type) {
    return {
      type: 'action',
      action: tag.action_type,
      params: tag.action_params
    };
  }

  if (tag.content_type && tag.content_id) {
    return {
      type: 'content',
      contentType: tag.content_type,
      contentId: tag.content_id,
      tagName: tag.name
    };
  }

  return {
    type: 'none',
    message: 'No action configured for this tag'
  };
};

/**
 * Get scan logs (legacy)
 * @param {Object} options - Filter and pagination options
 * @returns {Promise<Object>} Paginated scan logs
 */
const getScanLogs = async ({ page = 1, limit = 50, mac, uid } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('ai_rfid_scan_log')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('ai_rfid_scan_log')
    .select('*, ai_rfid_tag:tag_id(name, content_type)')
    .order('created_at', { ascending: false });

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    countQuery = countQuery.eq('mac_address', normalizedMac);
    dataQuery = dataQuery.eq('mac_address', normalizedMac);
  }

  if (uid) {
    const normalizedUid = uid.toUpperCase().replace(/:/g, '');
    countQuery = countQuery.eq('rfid_uid', normalizedUid);
    dataQuery = dataQuery.eq('rfid_uid', normalizedUid);
  }

  const { count } = await countQuery;
  const { data: logs, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch scan logs');

  return {
    list: logs || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Register device RFID tags (batch) (legacy)
 * @param {string} mac - Device MAC address
 * @param {Array} tags - Array of {uid, name} objects
 * @returns {Promise<Array>} Created tags
 */
const registerDeviceTags = async (mac, tags) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  const results = [];

  for (const tag of tags) {
    const normalizedUid = tag.uid.toUpperCase().replace(/:/g, '');

    // Check if already exists
    const existing = await getRfidByUid(normalizedUid);
    if (existing) {
      results.push({ ...existing, status: 'existing' });
      continue;
    }

    // Create new tag
    const { data: created } = await supabaseAdmin
      .from('ai_rfid_tag')
      .insert({
        uid: normalizedUid,
        name: tag.name || `Tag ${normalizedUid.slice(-4)}`,
        device_mac: normalizedMac,
        status: 1
      })
      .select()
      .single();

    if (created) {
      results.push({ ...created, status: 'created' });
    }
  }

  return results;
};

module.exports = {
  // PRD-specified card mapping methods
  getCardMappingPage,
  getCardMappingList,
  lookupCardByUid,
  createCardMapping,
  updateCardMapping,
  deleteCardMapping,

  // RAG-powered search
  ragSearch,
  lookupCardWithRag,
  getContentPack,
  upsertRagContent,
  deleteRagContent,
  deleteRagContentByPack,

  // Series lookup and management
  lookupSeriesByUid,
  getSeriesList,
  getSeriesAll,
  getSeriesById,
  createSeries,
  updateSeries,
  deleteSeries,

  // Pack management
  getPackList,
  getPackById,
  createPack,
  updatePack,
  deletePack,

  // Legacy RFID tag methods
  getRfidList,
  getRfidById,
  getRfidByUid,
  createRfid,
  updateRfid,
  deleteRfid,
  processScan,
  getScanLogs,
  registerDeviceTags
};
