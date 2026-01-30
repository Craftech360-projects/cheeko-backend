/**
 * RFID Service
 *
 * Handles RFID card mapping management and content lookup.
 * Supports card-to-question mappings with RAG integration.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { normalizeMacAddress } = require('../utils/helpers');
const { extractBySequence, countItems } = require('../utils/mdParser');
const qdrantService = require('./integrations/qdrant.service');

// =============================================
// Helper: Format date to yyyy-MM-dd HH:mm:ss
// =============================================
const formatDate = (date) => {
  if (!date) return null;
  const d = new Date(date);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// =============================================
// Helper: Transform RFID Question to camelCase (RfidQuestionDTO)
// =============================================
const transformQuestionToCamelCase = (question) => {
  if (!question) return null;
  return {
    id: question.id ? Number(question.id) : null,
    code: question.code,
    title: question.title,
    promptText: question.prompt_text,
    language: question.language,
    category: question.category,
    difficulty: question.difficulty,
    active: question.active,
    createDate: formatDate(question.create_date),
    updateDate: formatDate(question.update_date)
  };
};

// =============================================
// Helper: Transform RFID Pack to camelCase (RfidPackDTO)
// Maps Supabase schema (pack_name, status, created_at) to Spring Boot schema (name, active, createDate)
// =============================================
const transformPackToCamelCase = (pack) => {
  if (!pack) return null;
  return {
    id: pack.id ? Number(pack.id) : null,
    packCode: pack.pack_code,
    // Supabase uses pack_name, Spring Boot uses name
    name: pack.pack_name || pack.name,
    description: pack.description,
    ageMin: pack.age_min,
    ageMax: pack.age_max,
    // Supabase uses status (1=active, 0=inactive), Spring Boot uses active (boolean)
    active: pack.status !== undefined ? pack.status === 1 : pack.active,
    createDate: formatDate(pack.created_at || pack.create_date),
    updateDate: formatDate(pack.updated_at || pack.update_date)
  };
};

// =============================================
// Helper: Transform RFID Card Mapping to camelCase (RfidCardMappingDTO)
// =============================================
const transformCardMappingToCamelCase = (card) => {
  if (!card) return null;
  return {
    id: card.id ? Number(card.id) : null,
    rfidUid: card.rfid_uid,
    questionId: card.question_id ? Number(card.question_id) : null,
    questionIds: card.question_ids || [],
    packCode: card.pack_code,
    packId: card.pack_id ? Number(card.pack_id) : null,
    contentPackId: card.content_pack_id ? Number(card.content_pack_id) : null,
    notes: card.notes,
    active: card.active,
    createDate: formatDate(card.create_date || card.created_at),
    updateDate: formatDate(card.update_date || card.updated_at)
  };
};

// =============================================
// Helper: Transform RFID Series to camelCase (RfidSeriesDTO)
// =============================================
const transformSeriesToCamelCase = (series) => {
  if (!series) return null;
  // Note: Actual DB uses 'status' (Int) instead of 'active' (Boolean)
  // and 'content_pack_id' instead of 'question_id'/'pack_id'
  return {
    id: series.id ? Number(series.id) : null,
    seriesName: series.series_name,
    startUid: series.start_uid,
    endUid: series.end_uid,
    contentPackId: series.content_pack_id ? Number(series.content_pack_id) : null,
    // Keep packId for backward compatibility with frontend
    packId: series.content_pack_id ? Number(series.content_pack_id) : null,
    priority: series.priority,
    active: series.status === 1,
    createDate: formatDate(series.created_at),
    updateDate: formatDate(series.updated_at)
  };
};

// =============================================
// Card Mapping Methods (PRD-specified)
// =============================================

/**
 * Get card mappings with pagination (matches Spring Boot /page endpoint)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated card mapping list with camelCase fields
 */
const getCardMappingPage = async ({ page = 1, limit = 10, rfidUid, packCode, questionId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_card_mapping')
    .select('id', { count: 'exact', head: true });

  // Build data query
  let dataQuery = supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .order('create_date', { ascending: false });

  // Apply filters (LIKE search matching Spring Boot)
  if (rfidUid) {
    countQuery = countQuery.ilike('rfid_uid', `%${rfidUid}%`);
    dataQuery = dataQuery.ilike('rfid_uid', `%${rfidUid}%`);
  }

  if (packCode) {
    countQuery = countQuery.ilike('pack_code', `%${packCode}%`);
    dataQuery = dataQuery.ilike('pack_code', `%${packCode}%`);
  }

  if (questionId) {
    countQuery = countQuery.eq('question_id', questionId);
    dataQuery = dataQuery.eq('question_id', questionId);
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
    list: (cards || []).map(transformCardMappingToCamelCase),
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all card mappings (no pagination, matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All card mappings with camelCase fields
 */
const getCardMappingList = async ({ packCode, questionId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .order('create_date', { ascending: false });

  if (packCode) {
    query = query.ilike('pack_code', `%${packCode}%`);
  }

  if (questionId) {
    query = query.eq('question_id', questionId);
  }

  if (active !== undefined) {
    query = query.eq('active', active);
  }

  const { data: cards, error } = await query;

  if (error) {
    logger.error('Failed to fetch card mappings:', error);
    throw new Error('Failed to fetch card mappings');
  }

  return (cards || []).map(transformCardMappingToCamelCase);
};

/**
 * Get card mapping by ID (matches Spring Boot GET /{id} endpoint)
 * @param {number} id - Card mapping ID
 * @returns {Promise<Object>} Card mapping with camelCase fields
 */
const getCardMappingById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch card mapping:', error);
    throw new Error('Failed to fetch card mapping');
  }

  return transformCardMappingToCamelCase(card);
};

/**
 * Get card mapping by RFID UID (matches Spring Boot GET /uid/{rfidUid} endpoint)
 * Admin endpoint - returns single card mapping
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object>} Card mapping with camelCase fields
 */
const getCardMappingByRfidUid = async (rfidUid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = rfidUid.toUpperCase().replace(/[:-]/g, '');

  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('rfid_uid', normalizedUid)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch card mapping by UID:', error);
    throw new Error('Failed to fetch card mapping by UID');
  }

  return transformCardMappingToCamelCase(card);
};

/**
 * Get cards by pack code (matches Spring Boot GET /pack/{packCode} endpoint)
 * @param {string} packCode - Pack code
 * @returns {Promise<Array>} Card mappings with camelCase fields
 */
const getCardsByPackCode = async (packCode) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: cards, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('pack_code', packCode)
    .order('rfid_uid', { ascending: true });

  if (error) {
    logger.error('Failed to fetch cards by pack code:', error);
    throw new Error('Failed to fetch cards by pack code');
  }

  return (cards || []).map(transformCardMappingToCamelCase);
};

/**
 * Get cards by question ID (matches Spring Boot GET /question/{questionId} endpoint)
 * @param {number} questionId - Question ID
 * @returns {Promise<Array>} Card mappings with camelCase fields
 */
const getCardsByQuestionId = async (questionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: cards, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('question_id', questionId)
    .order('rfid_uid', { ascending: true });

  if (error) {
    logger.error('Failed to fetch cards by question ID:', error);
    throw new Error('Failed to fetch cards by question ID');
  }

  return (cards || []).map(transformCardMappingToCamelCase);
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

  // First try exact match - query without relationship joins
  const { data: card, error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('rfid_uid', normalizedUid)
    .eq('active', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Card lookup error:', error);
  }

  if (card) {
    // Fetch related data separately
    const questions = [];
    let question = null;
    let pack = null;
    let contentPack = null;

    // Fetch question if question_id exists
    if (card.question_id) {
      const { data: questionData } = await supabaseAdmin
        .from('rfid_question')
        .select('id, code, title, prompt_text, language, category, difficulty')
        .eq('id', card.question_id)
        .single();
      if (questionData) {
        question = questionData;
        questions.push(questionData);
      }
    }

    // Fetch pack if pack_id exists
    if (card.pack_id) {
      const { data: packData } = await supabaseAdmin
        .from('rfid_pack')
        .select('id, pack_code, name, description')
        .eq('id', card.pack_id)
        .single();
      if (packData) {
        pack = packData;
      }
    }

    // Fetch content_pack if content_pack_id exists
    if (card.content_pack_id) {
      const { data: contentPackData } = await supabaseAdmin
        .from('rfid_content_pack')
        .select('id, pack_code, name, content_type, content_md')
        .eq('id', card.content_pack_id)
        .single();
      if (contentPackData) {
        contentPack = contentPackData;
      }
    }

    // Get additional questions if question_ids is populated
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
      question,
      pack,
      content_pack: contentPack,
      questions: questions.length > 0 ? questions : undefined
    };
  }

  // If no exact match, try series lookup (UID range)
  // Note: Actual DB uses 'status' (Int, 1=active) instead of 'active' (Boolean)
  const { data: series } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .lte('start_uid', normalizedUid)
    .gte('end_uid', normalizedUid)
    .eq('status', 1)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (series) {
    // Fetch related content pack for series
    let seriesContentPack = null;

    if (series.content_pack_id) {
      const { data: packData } = await supabaseAdmin
        .from('rfid_pack')
        .select('id, pack_code, name, description')
        .eq('id', series.content_pack_id)
        .single();
      if (packData) {
        seriesContentPack = packData;
      }
    }

    return {
      rfid_uid: normalizedUid,
      source: 'series',
      series_id: series.id,
      series_name: series.series_name,
      content_pack: seriesContentPack
    };
  }

  return null;
};

/**
 * Create card mapping (matches Spring Boot POST /card)
 * @param {Object} data - Card mapping data
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createCardMapping = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Normalize UID
  const normalizedUid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');

  // Check for duplicate
  const existing = await getCardMappingByRfidUid(normalizedUid);
  if (existing) {
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
    active: data.active !== false
  };

  const { error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .insert(insertData);

  if (error) {
    logger.error('Failed to create card mapping:', error);
    if (error.code === '23505') {
      throw new Error('Card mapping already exists for this UID');
    }
    throw new Error('Failed to create card mapping');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Update card mapping (matches Spring Boot PUT /card)
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const updateCardMapping = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Card mapping ID is required');
  }

  const updateData = {
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

  const { error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .update(updateData)
    .eq('id', data.id);

  if (error) {
    logger.error('Failed to update card mapping:', error);
    throw new Error('Failed to update card mapping');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete card mapping (single)
 * @param {Object} data - Delete criteria (id or rfidUid)
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
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

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete multiple card mappings (matches Spring Boot DELETE /card and POST /card/delete)
 * @param {number[]} ids - Array of card mapping IDs
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const deleteCardMappings = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Card mapping IDs are required');
  }

  const { error } = await supabaseAdmin
    .from('rfid_card_mapping')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to delete card mappings:', error);
    throw new Error('Failed to delete card mappings');
  }

  return null;  // Spring Boot returns Result<Void>
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

  // Query series without relationship joins
  // Note: Actual DB uses 'status' (Int, 1=active) instead of 'active' (Boolean)
  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .lte('start_uid', normalizedUid)
    .gte('end_uid', normalizedUid)
    .eq('status', 1)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Series lookup error:', error);
    throw new Error('Failed to lookup series');
  }

  if (!series) return null;

  // Fetch related content pack if content_pack_id exists
  let contentPack = null;

  if (series.content_pack_id) {
    const { data: packData } = await supabaseAdmin
      .from('rfid_pack')
      .select('id, pack_code, name, description')
      .eq('id', series.content_pack_id)
      .single();
    if (packData) {
      contentPack = packData;
    }
  }

  return {
    ...series,
    content_pack: contentPack
  };
};

// =============================================
// Pack Management Methods
// Maps Supabase schema (pack_name, status) to Spring Boot schema (name, active)
// =============================================

/**
 * Get pack list with pagination (matches Spring Boot /page endpoint)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated pack list with camelCase fields
 */
const getPackPage = async ({ page = 1, limit = 10, packCode, name, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_pack')
    .select('id', { count: 'exact', head: true });

  // Build data query - order by pack_name ascending (matches Spring Boot)
  let dataQuery = supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .order('pack_name', { ascending: true });

  // Apply filters (LIKE search matching Spring Boot)
  if (packCode) {
    countQuery = countQuery.ilike('pack_code', `%${packCode}%`);
    dataQuery = dataQuery.ilike('pack_code', `%${packCode}%`);
  }

  if (name) {
    countQuery = countQuery.ilike('pack_name', `%${name}%`);
    dataQuery = dataQuery.ilike('pack_name', `%${name}%`);
  }

  if (active !== undefined) {
    // Convert boolean to status (1=active, 0=inactive)
    const statusValue = active ? 1 : 0;
    countQuery = countQuery.eq('status', statusValue);
    dataQuery = dataQuery.eq('status', statusValue);
  }

  const { count } = await countQuery;
  const { data: packs, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch packs:', error);
    throw new Error('Failed to fetch packs');
  }

  return {
    list: (packs || []).map(transformPackToCamelCase),
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all packs list (matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Pack list with camelCase fields
 */
const getPackList = async ({ packCode, name, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .order('pack_name', { ascending: true });

  // Apply filters
  if (packCode) {
    query = query.ilike('pack_code', `%${packCode}%`);
  }

  if (name) {
    query = query.ilike('pack_name', `%${name}%`);
  }

  if (active !== undefined) {
    const statusValue = active ? 1 : 0;
    query = query.eq('status', statusValue);
  }

  const { data: packs, error } = await query;

  if (error) {
    logger.error('Failed to fetch packs:', error);
    throw new Error('Failed to fetch packs');
  }

  return (packs || []).map(transformPackToCamelCase);
};

/**
 * Get all active packs (matches Spring Boot /active endpoint)
 * @returns {Promise<Array>} Active pack list with camelCase fields
 */
const getAllActivePacks = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: packs, error } = await supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .eq('status', 1)
    .order('pack_name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch active packs:', error);
    throw new Error('Failed to fetch active packs');
  }

  return (packs || []).map(transformPackToCamelCase);
};

/**
 * Get pack by ID
 * @param {number} packId - Pack ID
 * @returns {Promise<Object>} Pack details with camelCase fields
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

  return transformPackToCamelCase(pack);
};

/**
 * Get pack by pack code (matches Spring Boot /code/{packCode} endpoint)
 * @param {string} packCode - Pack code
 * @returns {Promise<Object>} Pack details with camelCase fields
 */
const getPackByCode = async (packCode) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .eq('pack_code', packCode)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch pack by code:', error);
    throw new Error('Failed to fetch pack by code');
  }

  return transformPackToCamelCase(pack);
};

/**
 * Get packs suitable for age (matches Spring Boot /age/{age} endpoint)
 * @param {number} age - Target age
 * @returns {Promise<Array>} Pack list with camelCase fields
 */
const getPackByAge = async (age) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get active packs where age is within range
  const { data: packs, error } = await supabaseAdmin
    .from('rfid_pack')
    .select('*')
    .eq('status', 1)
    .or(`age_min.is.null,age_min.lte.${age}`)
    .or(`age_max.is.null,age_max.gte.${age}`)
    .order('pack_name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch packs by age:', error);
    throw new Error('Failed to fetch packs by age');
  }

  // Filter in memory for AND condition (Supabase or() creates OR)
  const filtered = (packs || []).filter(p => {
    const minOk = p.age_min === null || p.age_min <= age;
    const maxOk = p.age_max === null || p.age_max >= age;
    return minOk && maxOk;
  });

  return filtered.map(transformPackToCamelCase);
};

/**
 * Create pack (matches Spring Boot POST /pack)
 * @param {Object} data - Pack data (packCode, name, description, ageMin, ageMax, active)
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createPack = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { error } = await supabaseAdmin
    .from('rfid_pack')
    .insert({
      pack_code: data.packCode,
      pack_name: data.name,  // Supabase uses pack_name
      description: data.description,
      age_min: data.ageMin,
      age_max: data.ageMax,
      status: data.active !== false ? 1 : 0  // Convert boolean to status
    });

  if (error) {
    logger.error('Failed to create pack:', error);
    if (error.code === '23505') {
      throw new Error('Pack with this code already exists');
    }
    throw new Error('Failed to create pack');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Update pack (matches Spring Boot PUT /pack)
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const updatePack = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Pack ID is required');
  }

  const updateData = {
    updated_at: new Date().toISOString()
  };

  // Only update provided fields - map to Supabase column names
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.name !== undefined) updateData.pack_name = data.name;  // Supabase uses pack_name
  if (data.description !== undefined) updateData.description = data.description;
  if (data.ageMin !== undefined) updateData.age_min = data.ageMin;
  if (data.ageMax !== undefined) updateData.age_max = data.ageMax;
  if (data.active !== undefined) updateData.status = data.active ? 1 : 0;  // Convert boolean to status

  const { error } = await supabaseAdmin
    .from('rfid_pack')
    .update(updateData)
    .eq('id', data.id);

  if (error) {
    logger.error('Failed to update pack:', error);
    if (error.code === '23505') {
      throw new Error('Pack with this code already exists');
    }
    throw new Error('Failed to update pack');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete pack (single ID)
 * @param {number} packId - Pack ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
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

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete multiple packs (matches Spring Boot DELETE /pack and POST /pack/delete)
 * @param {number[]} ids - Array of pack IDs
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const deletePacks = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Pack IDs are required');
  }

  const { error } = await supabaseAdmin
    .from('rfid_pack')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to delete packs:', error);
    throw new Error('Failed to delete packs');
  }

  return null;  // Spring Boot returns Result<Void>
};

// =============================================
// Series Management Methods
// =============================================

/**
 * Get series list with pagination (matches Spring Boot /page endpoint)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated series list with camelCase fields
 */
const getSeriesList = async ({ page = 1, limit = 10, packId, questionId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_series')
    .select('id', { count: 'exact', head: true });

  // Build data query
  let dataQuery = supabaseAdmin
    .from('rfid_series')
    .select('*')
    .order('priority', { ascending: false });

  // Apply filters
  // Note: Actual DB uses 'content_pack_id' instead of 'pack_id'/'question_id'
  // and 'status' (Int) instead of 'active' (Boolean)
  if (packId) {
    countQuery = countQuery.eq('content_pack_id', packId);
    dataQuery = dataQuery.eq('content_pack_id', packId);
  }

  // questionId filter not applicable - rfid_series doesn't have question_id column

  if (active !== undefined) {
    const statusValue = active === true || active === 'true' ? 1 : 0;
    countQuery = countQuery.eq('status', statusValue);
    dataQuery = dataQuery.eq('status', statusValue);
  }

  const { count } = await countQuery;
  const { data: series, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return {
    list: (series || []).map(transformSeriesToCamelCase),
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all series (no pagination, matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All series with camelCase fields
 */
const getSeriesAll = async ({ packId, questionId, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_series')
    .select('*')
    .order('priority', { ascending: false });

  // Note: Actual DB uses 'content_pack_id' instead of 'pack_id'/'question_id'
  // and 'status' (Int) instead of 'active' (Boolean)
  if (packId) {
    query = query.eq('content_pack_id', packId);
  }

  // questionId filter not applicable - rfid_series doesn't have question_id column

  if (active !== undefined) {
    const statusValue = active === true || active === 'true' ? 1 : 0;
    query = query.eq('status', statusValue);
  }

  const { data: series, error } = await query;

  if (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return (series || []).map(transformSeriesToCamelCase);
};

/**
 * Get series by ID (matches Spring Boot GET /{id} endpoint)
 * @param {number} seriesId - Series ID
 * @returns {Promise<Object>} Series details with camelCase fields
 */
const getSeriesById = async (seriesId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .eq('id', seriesId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }

  return transformSeriesToCamelCase(series);
};

/**
 * Create series (matches Spring Boot POST /series)
 * @param {Object} data - Series data
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createSeries = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Normalize UIDs
  const startUid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  const endUid = data.endUid.toUpperCase().replace(/[:-]/g, '');

  // Validate UID order
  if (startUid > endUid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  // Note: Actual DB uses 'status' (Int) instead of 'active' (Boolean)
  // and 'content_pack_id' instead of 'question_id'/'pack_id'
  const insertData = {
    series_name: data.seriesName || data.notes || `Series ${startUid}-${endUid}`,
    start_uid: startUid,
    end_uid: endUid,
    content_pack_id: data.contentPackId || data.packId || null,
    priority: data.priority || 0,
    status: data.active !== false ? 1 : 0
  };

  const { error } = await supabaseAdmin
    .from('rfid_series')
    .insert(insertData);

  if (error) {
    logger.error('Failed to create series:', error);
    throw new Error('Failed to create series');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Update series (matches Spring Boot PUT /series)
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const updateSeries = async (data, _userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Series ID is required');
  }

  const updateData = {
    updated_at: new Date().toISOString()
  };

  // Only update provided fields
  // Note: Actual DB uses 'status' (Int) instead of 'active' (Boolean)
  // and 'content_pack_id' instead of 'question_id'/'pack_id'
  if (data.startUid !== undefined) {
    updateData.start_uid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.endUid !== undefined) {
    updateData.end_uid = data.endUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.seriesName !== undefined) updateData.series_name = data.seriesName;
  if (data.contentPackId !== undefined) updateData.content_pack_id = data.contentPackId;
  if (data.packId !== undefined) updateData.content_pack_id = data.packId;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.active !== undefined) updateData.status = data.active ? 1 : 0;

  // Validate UID order if both are being updated
  if (updateData.start_uid && updateData.end_uid && updateData.start_uid > updateData.end_uid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  const { error } = await supabaseAdmin
    .from('rfid_series')
    .update(updateData)
    .eq('id', data.id);

  if (error) {
    logger.error('Failed to update series:', error);
    throw new Error('Failed to update series');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete multiple series (matches Spring Boot DELETE /series and POST /series/delete)
 * @param {number[]} ids - Array of series IDs
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const deleteSeriesBatch = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Series IDs are required');
  }

  const { error } = await supabaseAdmin
    .from('rfid_series')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to delete series:', error);
    throw new Error('Failed to delete series');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Delete single series (legacy - kept for backward compatibility)
 * @param {number} seriesId - Series ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
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

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Get all active series (matches Spring Boot /active endpoint)
 * Note: Actual DB uses 'status' (Int, 1=active) instead of 'active' (Boolean)
 * @returns {Promise<Array>} All active series with camelCase fields
 */
const getActiveSeries = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .eq('status', 1)
    .order('priority', { ascending: false });

  if (error) {
    logger.error('Failed to fetch active series:', error);
    throw new Error('Failed to fetch active series');
  }

  return (series || []).map(transformSeriesToCamelCase);
};

/**
 * Find all series containing a UID (matches Spring Boot /find/{uid} endpoint)
 * @param {string} uid - RFID UID to check
 * @returns {Promise<Array>} Series that contain the UID with camelCase fields
 */
const findSeriesByUid = async (uid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = uid.toUpperCase().replace(/[:-]/g, '');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .lte('start_uid', normalizedUid)
    .gte('end_uid', normalizedUid)
    .order('priority', { ascending: false });

  if (error) {
    logger.error('Failed to find series by UID:', error);
    throw new Error('Failed to find series');
  }

  return (series || []).map(transformSeriesToCamelCase);
};

/**
 * Get series by pack ID (matches Spring Boot /pack/{packId} endpoint)
 * Note: Actual DB uses 'content_pack_id' instead of 'pack_id'
 * @param {number} packId - Pack ID (mapped to content_pack_id)
 * @returns {Promise<Array>} Series in the pack with camelCase fields
 */
const getSeriesByPackId = async (packId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: series, error } = await supabaseAdmin
    .from('rfid_series')
    .select('*')
    .eq('content_pack_id', packId)
    .order('priority', { ascending: false });

  if (error) {
    logger.error('Failed to fetch series by pack:', error);
    throw new Error('Failed to fetch series');
  }

  return (series || []).map(transformSeriesToCamelCase);
};

/**
 * Get series by question ID (matches Spring Boot /question/{questionId} endpoint)
 * Note: rfid_series doesn't have question_id column - returns empty array for compatibility
 * @param {number} questionId - Question ID (not used - column doesn't exist)
 * @returns {Promise<Array>} Empty array (column doesn't exist in actual DB)
 */
const getSeriesByQuestionId = async (questionId) => {
  // Note: rfid_series table doesn't have question_id column
  // Return empty array for backward compatibility
  logger.warn(`getSeriesByQuestionId called but rfid_series has no question_id column. questionId: ${questionId}`);
  return [];
};

// =============================================
// Question Management Methods
// =============================================

/**
 * Get questions with pagination
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated question list
 */
const getQuestionPage = async ({ page = 1, limit = 10, category, language, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  // Build count query
  let countQuery = supabaseAdmin
    .from('rfid_question')
    .select('id', { count: 'exact', head: true });

  // Build data query
  let dataQuery = supabaseAdmin
    .from('rfid_question')
    .select('*')
    .order('create_date', { ascending: false });

  // Apply filters
  if (category) {
    countQuery = countQuery.eq('category', category);
    dataQuery = dataQuery.eq('category', category);
  }

  if (language) {
    countQuery = countQuery.eq('language', language);
    dataQuery = dataQuery.eq('language', language);
  }

  if (active !== undefined) {
    countQuery = countQuery.eq('active', active);
    dataQuery = dataQuery.eq('active', active);
  }

  const { count } = await countQuery;
  const { data: questions, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch questions:', error);
    throw new Error('Failed to fetch questions');
  }

  return {
    list: (questions || []).map(transformQuestionToCamelCase),
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit)
  };
};

/**
 * Get all questions (no pagination)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All questions
 */
const getQuestionList = async ({ category, language, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_question')
    .select('*')
    .order('create_date', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  if (language) {
    query = query.eq('language', language);
  }

  if (active !== undefined) {
    query = query.eq('active', active);
  }

  const { data: questions, error } = await query;

  if (error) {
    logger.error('Failed to fetch questions:', error);
    throw new Error('Failed to fetch questions');
  }

  return (questions || []).map(transformQuestionToCamelCase);
};

/**
 * Get question by ID
 * @param {number} questionId - Question ID
 * @returns {Promise<Object>} Question details
 */
const getQuestionById = async (questionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: question, error } = await supabaseAdmin
    .from('rfid_question')
    .select('*')
    .eq('id', questionId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch question:', error);
    throw new Error('Failed to fetch question');
  }

  return transformQuestionToCamelCase(question);
};

/**
 * Get question by code
 * @param {string} code - Question code
 * @returns {Promise<Object>} Question details
 */
const getQuestionByCode = async (code) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: question, error } = await supabaseAdmin
    .from('rfid_question')
    .select('*')
    .eq('code', code)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch question by code:', error);
    throw new Error('Failed to fetch question');
  }

  return transformQuestionToCamelCase(question);
};

/**
 * Get questions by category
 * @param {string} category - Category name
 * @returns {Promise<Array>} Questions in category
 */
const getQuestionsByCategory = async (category) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: questions, error } = await supabaseAdmin
    .from('rfid_question')
    .select('*')
    .eq('category', category)
    .eq('active', true)
    .order('create_date', { ascending: false });

  if (error) {
    logger.error('Failed to fetch questions by category:', error);
    throw new Error('Failed to fetch questions');
  }

  return (questions || []).map(transformQuestionToCamelCase);
};

/**
 * Get questions by language
 * @param {string} language - Language code
 * @returns {Promise<Array>} Questions in language
 */
const getQuestionsByLanguage = async (language) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: questions, error } = await supabaseAdmin
    .from('rfid_question')
    .select('*')
    .eq('language', language)
    .eq('active', true)
    .order('create_date', { ascending: false });

  if (error) {
    logger.error('Failed to fetch questions by language:', error);
    throw new Error('Failed to fetch questions');
  }

  return (questions || []).map(transformQuestionToCamelCase);
};

/**
 * Create question
 * @param {Object} data - Question data
 * @param {number} userId - Creator user ID
 * @returns {Promise<Object>} Created question (returns null for Spring Boot compatibility)
 */
const createQuestion = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check for duplicate code
  const existing = await getQuestionByCode(data.code);
  if (existing) {
    throw new Error('Question with this code already exists');
  }

  const insertData = {
    code: data.code,
    title: data.title,
    prompt_text: data.promptText,
    language: data.language || 'en',
    category: data.category || null,
    difficulty: data.difficulty || 1,
    active: data.active !== false,
    creator: userId
  };

  const { data: question, error } = await supabaseAdmin
    .from('rfid_question')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    logger.error('Failed to create question:', error);
    if (error.code === '23505') {
      throw new Error('Question with this code already exists');
    }
    throw new Error('Failed to create question');
  }

  // Return null for Spring Boot Result<Void> compatibility
  return null;
};

/**
 * Update question
 * @param {Object} data - Update data (must include id)
 * @param {number} userId - Updater user ID
 * @returns {Promise<Object>} Updated question (returns null for Spring Boot compatibility)
 */
const updateQuestion = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Question ID is required');
  }

  const updateData = {
    updater: userId,
    update_date: new Date().toISOString()
  };

  // Only update provided fields
  if (data.code !== undefined) updateData.code = data.code;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.promptText !== undefined) updateData.prompt_text = data.promptText;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
  if (data.active !== undefined) updateData.active = data.active;

  const { data: question, error } = await supabaseAdmin
    .from('rfid_question')
    .update(updateData)
    .eq('id', data.id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update question:', error);
    if (error.code === '23505') {
      throw new Error('Question with this code already exists');
    }
    throw new Error('Failed to update question');
  }

  // Return null for Spring Boot Result<Void> compatibility
  return null;
};

/**
 * Delete questions
 * @param {Array|number} ids - Question ID(s) to delete
 * @returns {Promise<null>} Returns null for Spring Boot Result<Void> compatibility
 */
const deleteQuestions = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const idArray = Array.isArray(ids) ? ids : [ids];

  if (idArray.length === 0) {
    throw new Error('At least one question ID is required');
  }

  const { error } = await supabaseAdmin
    .from('rfid_question')
    .delete()
    .in('id', idArray);

  if (error) {
    logger.error('Failed to delete questions:', error);
    throw new Error('Failed to delete questions');
  }

  // Return null for Spring Boot Result<Void> compatibility
  return null;
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

// =============================================
// Content Item Query Methods (Task 3)
// =============================================

/**
 * Get all content items for a content pack, ordered by item_number
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<Array>} Content items
 */
const getContentItemsByPackId = async (contentPackId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: items, error } = await supabaseAdmin
    .from('content_item')
    .select('*')
    .eq('content_pack_id', contentPackId)
    .eq('active', true)
    .order('item_number', { ascending: true });

  if (error) {
    logger.error('Failed to fetch content items:', { error, contentPackId });
    throw new Error('Failed to fetch content items');
  }

  return items || [];
};

/**
 * Get a single content item by pack ID and item number
 * @param {number} contentPackId - Content pack ID
 * @param {number} itemNumber - Item sequence number (1-based)
 * @returns {Promise<Object|null>} Content item or null
 */
const getContentItem = async (contentPackId, itemNumber) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: item, error } = await supabaseAdmin
    .from('content_item')
    .select('*')
    .eq('content_pack_id', contentPackId)
    .eq('item_number', itemNumber)
    .eq('active', true)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch content item:', { error, contentPackId, itemNumber });
    throw new Error('Failed to fetch content item');
  }

  return item || null;
};

/**
 * Get total audio size for all items in a content pack
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<number>} Total audio size in bytes
 */
const getTotalAudioSize = async (contentPackId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: items, error } = await supabaseAdmin
    .from('content_item')
    .select('audio_size_bytes')
    .eq('content_pack_id', contentPackId)
    .eq('active', true);

  if (error) {
    logger.error('Failed to get total audio size:', { error, contentPackId });
    throw new Error('Failed to get total audio size');
  }

  return (items || []).reduce((sum, item) => sum + (item.audio_size_bytes || 0), 0);
};

/**
 * Count items that have images in a content pack
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<number>} Count of items with images
 */
const countItemsWithImages = async (contentPackId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: items, error } = await supabaseAdmin
    .from('content_item')
    .select('id, images_json')
    .eq('content_pack_id', contentPackId)
    .eq('active', true)
    .not('images_json', 'is', null);

  if (error) {
    logger.error('Failed to count items with images:', { error, contentPackId });
    throw new Error('Failed to count items with images');
  }

  // Filter for non-empty arrays
  return (items || []).filter(item => {
    if (!item.images_json) return false;
    const images = typeof item.images_json === 'string' ? JSON.parse(item.images_json) : item.images_json;
    return Array.isArray(images) && images.length > 0;
  }).length;
};

/**
 * Transform a content_item row to ContentItemDTO shape
 * @param {Object} item - Raw DB row
 * @returns {Object} ContentItemDTO
 */
const transformContentItemToDTO = (item) => {
  if (!item) return null;

  const dto = {
    itemNumber: item.item_number,
    title: item.title,
    description: item.description,
    lyricsText: item.lyrics_text,
  };

  // Audio info (nested object)
  if (item.audio_url) {
    dto.audio = {
      url: item.audio_url,
      sizeBytes: item.audio_size_bytes ? Number(item.audio_size_bytes) : null,
      durationMs: item.audio_duration_ms ? Number(item.audio_duration_ms) : null,
    };
  } else {
    dto.audio = null;
  }

  // Images info (parse JSONB)
  if (item.images_json) {
    try {
      const images = typeof item.images_json === 'string'
        ? JSON.parse(item.images_json)
        : item.images_json;
      dto.images = Array.isArray(images) ? images : [];
    } catch (e) {
      logger.error('Failed to parse images_json for item:', { itemId: item.id, error: e.message });
      dto.images = [];
    }
  } else {
    dto.images = [];
  }

  return dto;
};

// =============================================
// Content Pack Lookup with Sequence Support (Task 4)
// =============================================

/**
 * Lookup content by RFID UID with sequence support (matches Java lookupContentByRfidUid)
 * @param {string} rfidUid - RFID UID
 * @param {number|null} sequence - Sequence number (1-based)
 * @returns {Promise<Object>} RfidContentLookupDTO
 */
const lookupContentByRfidUid = async (rfidUid, sequence) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = rfidUid.toUpperCase().replace(/[^0-9A-F]/g, '');
  logger.info('Looking up content for RFID UID:', { rfidUid: normalizedUid, sequence });

  const result = {
    rfidUid: normalizedUid,
    sequence: sequence || null,
    contentType: null,
    title: null,
    contentText: null,
    promptText: null,
    packCode: null,
    language: null,
    cachedAudioUrl: null,
    cached: false,
  };

  // Step 1: Try to find content pack via card mapping
  const { data: mapping } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*, rfid_content_pack:content_pack_id(*)')
    .eq('rfid_uid', normalizedUid)
    .eq('active', true)
    .single();

  const contentPack = mapping?.rfid_content_pack;

  if (contentPack && contentPack.content_md) {
    logger.info('Found content pack for RFID UID:', { packCode: contentPack.pack_code, rfidUid: normalizedUid });

    result.contentType = contentPack.content_type;
    result.packCode = contentPack.pack_code;
    result.language = contentPack.language;

    // Parse markdown to extract content by sequence
    if (sequence && sequence > 0) {
      const item = extractBySequence(contentPack.content_md, sequence);

      if (item) {
        result.title = item.title;
        result.contentText = item.content;
        logger.info('Extracted content for sequence:', { sequence, title: item.title });
      } else {
        logger.warn('Sequence not found in content pack:', { sequence, packCode: contentPack.pack_code });
      }

      // Check for cached audio URL
      const cachedAudioUrl = getCachedAudioUrl(contentPack.cached_audio_urls, sequence);
      if (cachedAudioUrl) {
        result.cachedAudioUrl = cachedAudioUrl;
        result.cached = true;
        logger.info('Found cached audio:', { sequence, url: cachedAudioUrl });
      }
    }

    return result;
  }

  // Step 2: Fallback to legacy rfid_question lookup
  logger.info('No content pack found, falling back to legacy question lookup:', { rfidUid: normalizedUid });

  let questionEntity = null;

  // Try to get question by sequence if provided and question_ids exists
  if (sequence && sequence > 0 && mapping?.question_ids && Array.isArray(mapping.question_ids) && mapping.question_ids.length > 0) {
    const questionIdForSequence = mapping.question_ids[sequence - 1]; // 0-indexed array
    if (questionIdForSequence) {
      const { data: qData } = await supabaseAdmin
        .from('rfid_question')
        .select('*')
        .eq('id', questionIdForSequence)
        .eq('active', true)
        .single();
      if (qData) {
        questionEntity = qData;
        logger.info('Found question by sequence:', { sequence, title: qData.title });
      }
    }
  }

  // Fallback to single question
  if (!questionEntity && mapping?.question_id) {
    const { data: qData } = await supabaseAdmin
      .from('rfid_question')
      .select('*')
      .eq('id', mapping.question_id)
      .eq('active', true)
      .single();
    if (qData) {
      questionEntity = qData;
    }
  }

  // Try series range match if no exact match
  if (!questionEntity) {
    const { data: series } = await supabaseAdmin
      .from('rfid_series')
      .select('*, rfid_content_pack:content_pack_id(*)')
      .lte('start_uid', normalizedUid)
      .gte('end_uid', normalizedUid)
      .eq('status', 1)
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (series?.rfid_content_pack?.content_md && sequence && sequence > 0) {
      const pack = series.rfid_content_pack;
      result.contentType = pack.content_type;
      result.packCode = pack.pack_code;
      result.language = pack.language;

      const item = extractBySequence(pack.content_md, sequence);
      if (item) {
        result.title = item.title;
        result.contentText = item.content;
      }

      const cachedAudioUrl = getCachedAudioUrl(pack.cached_audio_urls, sequence);
      if (cachedAudioUrl) {
        result.cachedAudioUrl = cachedAudioUrl;
        result.cached = true;
      }

      return result;
    }
  }

  if (questionEntity) {
    result.contentType = 'prompt';
    result.title = questionEntity.title;
    result.promptText = questionEntity.prompt_text;
    result.language = questionEntity.language;
    logger.info('Found legacy question:', { rfidUid: normalizedUid, title: questionEntity.title });
  } else {
    logger.warn('No content or question found for RFID UID:', { rfidUid: normalizedUid });
  }

  return result;
};

/**
 * Extract cached audio URL for a specific sequence from JSON string
 * @param {string} cachedAudioUrlsJson - JSON string mapping sequence to URL
 * @param {number} sequence - Sequence number
 * @returns {string|null} Audio URL or null
 */
const getCachedAudioUrl = (cachedAudioUrlsJson, sequence) => {
  if (!cachedAudioUrlsJson || sequence == null) return null;

  try {
    const cachedUrls = typeof cachedAudioUrlsJson === 'string'
      ? JSON.parse(cachedAudioUrlsJson)
      : cachedAudioUrlsJson;
    return cachedUrls[String(sequence)] || null;
  } catch (e) {
    logger.warn('Failed to parse cached audio URLs:', { error: e.message });
    return null;
  }
};

// =============================================
// Content Download Manifest Methods (Task 5)
// =============================================

/**
 * Get unified content download manifest (matches Java getContentDownloadManifest)
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object|null>} ContentDownloadDTO or null
 */
const getContentDownloadManifest = async (rfidUid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!rfidUid || !rfidUid.trim()) {
    logger.warn('getContentDownloadManifest called with empty rfidUid');
    return null;
  }

  const normalizedUid = rfidUid.toUpperCase().replace(/[^0-9A-F]/g, '');

  // Lookup card mapping
  const { data: mapping } = await supabaseAdmin
    .from('rfid_card_mapping')
    .select('*')
    .eq('rfid_uid', normalizedUid)
    .eq('active', true)
    .single();

  if (!mapping) {
    logger.info('No RFID mapping found for UID:', { rfidUid: normalizedUid });
    return null;
  }

  if (!mapping.content_pack_id) {
    logger.info('RFID card is not linked to a content pack:', { rfidUid: normalizedUid });
    return null;
  }

  return getContentDownloadManifestByPackId(mapping.content_pack_id, normalizedUid);
};

/**
 * Get content download manifest by pack ID (matches Java getContentDownloadManifestByPackId)
 * @param {number} contentPackId - Content pack ID
 * @param {string} rfidUid - RFID UID for response
 * @returns {Promise<Object|null>} ContentDownloadDTO or null
 */
const getContentDownloadManifestByPackId = async (contentPackId, rfidUid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get content pack
  const { data: contentPack } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('id', contentPackId)
    .eq('active', true)
    .single();

  if (!contentPack) {
    logger.info('Content pack not found or inactive:', { contentPackId });
    return null;
  }

  // Get all content items
  const items = await getContentItemsByPackId(contentPackId);

  // Convert items to DTOs
  const itemDtos = items.map(transformContentItemToDTO);

  // Build response (ContentDownloadDTO)
  const dto = {
    rfidUid: rfidUid,
    contentType: contentPack.content_type,
    packCode: contentPack.pack_code,
    packName: contentPack.name,
    description: contentPack.description,
    version: contentPack.version || '1.0.0',
    contentHash: contentPack.content_hash,
    totalItems: contentPack.total_items || items.length,
    language: contentPack.language,
    thumbnailUrl: null,
    items: itemDtos,
  };

  logger.info('Returning download manifest:', {
    contentType: contentPack.content_type,
    rfidUid,
    itemCount: itemDtos.length,
  });

  return dto;
};

/**
 * Get habit download manifest (matches Java HabitDownloadDTO)
 * @param {string} rfidUid - RFID UID
 * @param {string} [clientVersion] - Client's cached version for 304 check
 * @param {string} [clientHash] - Client's cached hash for 304 check
 * @returns {Promise<Object|null>} HabitDownloadDTO or null
 */
const getHabitDownloadManifest = async (rfidUid, clientVersion, clientHash) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = rfidUid.toUpperCase().replace(/[^0-9A-F]/g, '');

  // Get unified manifest first
  const manifest = await getContentDownloadManifest(normalizedUid);
  if (!manifest) return null;

  // Check if client already has the latest version
  if (clientVersion && clientHash && manifest.version === clientVersion && manifest.contentHash === clientHash) {
    return { notModified: true };
  }

  // Convert to HabitDownloadDTO
  return {
    rfidUid: normalizedUid,
    contentType: 'habit',
    habitCode: manifest.packCode,
    habitName: manifest.packName,
    version: manifest.version,
    contentHash: manifest.contentHash,
    totalSteps: manifest.totalItems,
    thumbnailUrl: manifest.thumbnailUrl,
    steps: (manifest.items || []).map(item => ({
      stepNumber: item.itemNumber,
      title: item.title,
      instructionText: item.description,
      audio: item.audio,
      images: item.images || [],
    })),
  };
};

/**
 * Get rhyme download manifest (deprecated - matches Java RhymeDownloadDTO)
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object|null>} RhymeDownloadDTO or null
 */
const getRhymeDownloadManifest = async (rfidUid) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedUid = rfidUid.toUpperCase().replace(/[^0-9A-F]/g, '');

  // Get unified manifest first
  const manifest = await getContentDownloadManifest(normalizedUid);
  if (!manifest) return null;

  // Convert to RhymeDownloadDTO
  return {
    rfidUid: normalizedUid,
    contentType: manifest.contentType || 'rhyme',
    packCode: manifest.packCode,
    packName: manifest.packName,
    version: manifest.version,
    contentHash: manifest.contentHash,
    totalItems: manifest.totalItems,
    language: manifest.language,
    items: (manifest.items || []).map(item => ({
      itemNumber: item.itemNumber,
      title: item.title,
      lyricsText: item.lyricsText,
      audio: item.audio,
    })),
  };
};

// =============================================
// Cached Audio URL Update (Task 6)
// =============================================

/**
 * Update cached audio URL for a content pack sequence (matches Java updateCachedAudioUrl)
 * @param {string} packCode - Content pack code
 * @param {number} sequence - Sequence number
 * @param {string} audioUrl - New audio URL
 * @returns {Promise<boolean>} true if successful
 */
const updateCachedAudioUrl = async (packCode, sequence, audioUrl) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  logger.info('Updating cached audio URL:', { packCode, sequence, audioUrl });

  try {
    // Get pack by packCode
    const { data: contentPack, error: fetchError } = await supabaseAdmin
      .from('rfid_content_pack')
      .select('id, cached_audio_urls')
      .eq('pack_code', packCode)
      .single();

    if (fetchError || !contentPack) {
      logger.error('Content pack not found:', { packCode });
      return false;
    }

    // Parse existing cachedAudioUrls JSON (or create empty)
    let cachedUrls = {};
    if (contentPack.cached_audio_urls) {
      try {
        cachedUrls = typeof contentPack.cached_audio_urls === 'string'
          ? JSON.parse(contentPack.cached_audio_urls)
          : contentPack.cached_audio_urls;
      } catch (e) {
        logger.warn('Failed to parse existing cached URLs, starting fresh:', { error: e.message });
      }
    }

    // Add/update entry for sequence
    cachedUrls[String(sequence)] = audioUrl;

    // Save back to DB
    const updatedJson = JSON.stringify(cachedUrls);
    const { error: updateError } = await supabaseAdmin
      .from('rfid_content_pack')
      .update({ cached_audio_urls: updatedJson, update_date: new Date().toISOString() })
      .eq('id', contentPack.id);

    if (updateError) {
      logger.error('Failed to update cached audio URL:', { error: updateError });
      return false;
    }

    logger.info('Successfully updated cached audio URL:', { packCode, sequence });
    return true;
  } catch (e) {
    logger.error('Failed to update cached audio URL:', { error: e.message, packCode, sequence });
    return false;
  }
};

// =============================================
// Content Pack CRUD Methods (Task 7)
// =============================================

/**
 * Transform rfid_content_pack row to camelCase DTO
 */
const transformContentPackToCamelCase = (pack) => {
  if (!pack) return null;
  return {
    id: pack.id ? Number(pack.id) : null,
    packCode: pack.pack_code,
    name: pack.name,
    description: pack.description,
    contentType: pack.content_type,
    contentMd: pack.content_md,
    totalItems: pack.total_items,
    language: pack.language,
    active: pack.active,
    cachedAudioUrls: pack.cached_audio_urls,
    version: pack.version,
    contentHash: pack.content_hash,
    createDate: formatDate(pack.create_date),
    updateDate: formatDate(pack.update_date),
  };
};

/**
 * Get content packs with pagination (matches Java page endpoint)
 * @param {Object} params - Pagination and filter options
 * @returns {Promise<Object>} Paginated content pack list
 */
const getContentPackPage = async ({ page = 1, limit = 10, packCode, name, contentType, language, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('rfid_content_pack')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .order('name', { ascending: true });

  // Apply filters (LIKE search matching Java)
  if (packCode) {
    countQuery = countQuery.ilike('pack_code', `%${packCode}%`);
    dataQuery = dataQuery.ilike('pack_code', `%${packCode}%`);
  }
  if (name) {
    countQuery = countQuery.ilike('name', `%${name}%`);
    dataQuery = dataQuery.ilike('name', `%${name}%`);
  }
  if (contentType) {
    countQuery = countQuery.eq('content_type', contentType);
    dataQuery = dataQuery.eq('content_type', contentType);
  }
  if (language) {
    countQuery = countQuery.eq('language', language);
    dataQuery = dataQuery.eq('language', language);
  }
  if (active !== undefined) {
    const activeVal = active === true || active === 'true' || active === '1';
    countQuery = countQuery.eq('active', activeVal);
    dataQuery = dataQuery.eq('active', activeVal);
  }

  const { count } = await countQuery;
  const { data: packs, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch content packs:', error);
    throw new Error('Failed to fetch content packs');
  }

  return {
    list: (packs || []).map(transformContentPackToCamelCase),
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit),
  };
};

/**
 * Get all content packs (no pagination)
 */
const getContentPackList = async ({ packCode, name, contentType, language, active } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .order('name', { ascending: true });

  if (packCode) query = query.ilike('pack_code', `%${packCode}%`);
  if (name) query = query.ilike('name', `%${name}%`);
  if (contentType) query = query.eq('content_type', contentType);
  if (language) query = query.eq('language', language);
  if (active !== undefined) {
    const activeVal = active === true || active === 'true' || active === '1';
    query = query.eq('active', activeVal);
  }

  const { data: packs, error } = await query;

  if (error) {
    logger.error('Failed to fetch content packs:', error);
    throw new Error('Failed to fetch content packs');
  }

  return (packs || []).map(transformContentPackToCamelCase);
};

/**
 * Get content pack by pack code
 */
const getContentPackByCode = async (packCode) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: pack, error } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('pack_code', packCode)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to fetch content pack by code:', error);
    throw new Error('Failed to fetch content pack');
  }

  return transformContentPackToCamelCase(pack);
};

/**
 * Get all active content packs
 */
const getAllActiveContentPacks = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: packs, error } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch active content packs:', error);
    throw new Error('Failed to fetch active content packs');
  }

  return (packs || []).map(transformContentPackToCamelCase);
};

/**
 * Get content packs by content type
 */
const getContentPacksByType = async (contentType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: packs, error } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('content_type', contentType)
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch content packs by type:', error);
    throw new Error('Failed to fetch content packs');
  }

  return (packs || []).map(transformContentPackToCamelCase);
};

/**
 * Get content packs by language
 */
const getContentPacksByLanguage = async (language) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: packs, error } = await supabaseAdmin
    .from('rfid_content_pack')
    .select('*')
    .eq('language', language)
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch content packs by language:', error);
    throw new Error('Failed to fetch content packs');
  }

  return (packs || []).map(transformContentPackToCamelCase);
};

/**
 * Create content pack with packCode uniqueness check
 */
const createContentPack = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Check for duplicate packCode
  const existing = await getContentPackByCode(data.packCode);
  if (existing) {
    throw new Error('Content pack with this code already exists');
  }

  const insertData = {
    pack_code: data.packCode,
    name: data.name,
    description: data.description || null,
    content_type: data.contentType || 'prompt',
    content_md: data.contentMd || null,
    total_items: data.totalItems || 0,
    language: data.language || 'en',
    active: data.active !== false,
    cached_audio_urls: data.cachedAudioUrls || null,
    version: data.version || null,
    content_hash: data.contentHash || null,
    creator: userId,
  };

  const { error } = await supabaseAdmin
    .from('rfid_content_pack')
    .insert(insertData);

  if (error) {
    logger.error('Failed to create content pack:', error);
    if (error.code === '23505') {
      throw new Error('Content pack with this code already exists');
    }
    throw new Error('Failed to create content pack');
  }

  return null;
};

/**
 * Update content pack by id
 */
const updateContentPack = async (data, userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!data.id) {
    throw new Error('Content pack ID is required');
  }

  const updateData = {
    updater: userId,
    update_date: new Date().toISOString(),
  };

  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.contentType !== undefined) updateData.content_type = data.contentType;
  if (data.contentMd !== undefined) updateData.content_md = data.contentMd;
  if (data.totalItems !== undefined) updateData.total_items = data.totalItems;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.active !== undefined) updateData.active = data.active;
  if (data.cachedAudioUrls !== undefined) updateData.cached_audio_urls = data.cachedAudioUrls;
  if (data.version !== undefined) updateData.version = data.version;
  if (data.contentHash !== undefined) updateData.content_hash = data.contentHash;

  const { error } = await supabaseAdmin
    .from('rfid_content_pack')
    .update(updateData)
    .eq('id', data.id);

  if (error) {
    logger.error('Failed to update content pack:', error);
    if (error.code === '23505') {
      throw new Error('Content pack with this code already exists');
    }
    throw new Error('Failed to update content pack');
  }

  return null;
};

/**
 * Delete content packs by IDs
 */
const deleteContentPacks = async (ids) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Content pack IDs are required');
  }

  const { error } = await supabaseAdmin
    .from('rfid_content_pack')
    .delete()
    .in('id', ids);

  if (error) {
    logger.error('Failed to delete content packs:', error);
    throw new Error('Failed to delete content packs');
  }

  return null;
};

module.exports = {
  // PRD-specified card mapping methods
  getCardMappingPage,
  getCardMappingList,
  getCardMappingById,
  getCardMappingByRfidUid,
  getCardsByPackCode,
  getCardsByQuestionId,
  lookupCardByUid,
  createCardMapping,
  updateCardMapping,
  deleteCardMapping,
  deleteCardMappings,

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
  deleteSeriesBatch,
  getActiveSeries,
  findSeriesByUid,
  getSeriesByPackId,
  getSeriesByQuestionId,

  // Pack management
  getPackPage,
  getPackList,
  getAllActivePacks,
  getPackById,
  getPackByCode,
  getPackByAge,
  createPack,
  updatePack,
  deletePack,
  deletePacks,

  // Question management
  getQuestionPage,
  getQuestionList,
  getQuestionById,
  getQuestionByCode,
  getQuestionsByCategory,
  getQuestionsByLanguage,
  createQuestion,
  updateQuestion,
  deleteQuestions,

  // Legacy RFID tag methods
  getRfidList,
  getRfidById,
  getRfidByUid,
  createRfid,
  updateRfid,
  deleteRfid,
  processScan,
  getScanLogs,
  registerDeviceTags,

  // Content Item methods (Task 3)
  getContentItemsByPackId,
  getContentItem,
  getTotalAudioSize,
  countItemsWithImages,
  transformContentItemToDTO,

  // Content Pack Lookup with sequence (Task 4)
  lookupContentByRfidUid,

  // Content Download Manifest methods (Task 5)
  getContentDownloadManifest,
  getContentDownloadManifestByPackId,
  getHabitDownloadManifest,
  getRhymeDownloadManifest,

  // Cached Audio URL update (Task 6)
  updateCachedAudioUrl,

  // Content Pack CRUD (Task 7)
  getContentPackPage,
  getContentPackList,
  getContentPackByCode,
  getAllActiveContentPacks,
  getContentPacksByType,
  getContentPacksByLanguage,
  createContentPack,
  updateContentPack,
  deleteContentPacks,
  transformContentPackToCamelCase,
};
