/**
 * RFID Service
 *
 * Handles RFID card mapping management and content lookup.
 * Supports card-to-question mappings with RAG integration.
 *
 * Migrated from Supabase to Prisma ORM.
 */

const { prisma } = require('../config/database');
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
    allowCaching: question.allow_caching !== false,
    cachedAudioUrl: question.cached_audio_url,
    systemPromptOverride: question.system_prompt_override,
    active: question.active,
    createDate: formatDate(question.create_date),
    updateDate: formatDate(question.update_date)
  };
};

// =============================================
// Helper: Transform RFID Pack to camelCase (RfidPackDTO)
// Maps schema (pack_name, status) to DTO (name, active)
// =============================================
const transformPackToCamelCase = (pack) => {
  if (!pack) return null;
  return {
    id: pack.id ? Number(pack.id) : null,
    packCode: pack.pack_code,
    // DB uses pack_name
    name: pack.pack_name || pack.name,
    description: pack.description,
    ageMin: pack.age_min,
    ageMax: pack.age_max,
    // DB uses status (1=active, 0=inactive)
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
    questionPackId: card.question_pack_id ? Number(card.question_pack_id) : null,
    questionIds: card.question_ids || [],
    packCode: card.pack_code,
    packId: card.pack_id ? Number(card.pack_id) : null,
    contentPackId: card.content_pack_id ? Number(card.content_pack_id) : null,
    actionType: card.action_type,
    actionData: card.action_data || {},
    cardType: card.card_type || null,
    notes: card.notes,
    active: card.active,
    status: card.status,
    createDate: formatDate(card.create_date || card.created_at),
    updateDate: formatDate(card.update_date || card.updated_at)
  };
};

// =============================================
// Helper: Transform RFID Series to camelCase (RfidSeriesDTO)
// =============================================
const transformSeriesToCamelCase = (series) => {
  if (!series) return null;
  // DB uses 'status' (Int) instead of 'active' (Boolean)
  const result = {
    id: series.id ? Number(series.id) : null,
    seriesName: series.series_name,
    startUid: series.start_uid,
    endUid: series.end_uid,
    packId: series.content_pack_id ? Number(series.content_pack_id) : null,
    contentPackId: series.content_ref_id ? Number(series.content_ref_id) : null,
    questionPackId: series.question_pack_id ? Number(series.question_pack_id) : null,
    questionId: series.question_id ? Number(series.question_id) : null,
    priority: series.priority,
    notes: series.notes,
    active: series.status === 1,
    createDate: formatDate(series.created_at),
    updateDate: formatDate(series.updated_at)
  };

  // Include physical product SKU name if joined (rfid_pack)
  if (series.rfid_pack) {
    result.packName = series.rfid_pack.pack_name;
    result.packCode = series.rfid_pack.pack_code;
  }

  // Include question name if joined
  if (series.rfid_question) {
    result.questionName = series.rfid_question.title;
    result.questionCode = series.rfid_question.code;
  }

  // Include content pack name if joined
  if (series.rfid_content_pack) {
    result.contentPackName = series.rfid_content_pack.name;
    result.contentPackCode = series.rfid_content_pack.pack_code;
  }

  // Include question pack name if joined
  if (series.rfid_question_pack) {
    result.questionPackName = series.rfid_question_pack.name;
    result.questionPackCode = series.rfid_question_pack.pack_code;
  }

  return result;
};

// =============================================
// Card Mapping Methods (PRD-specified)
// =============================================

/**
 * Get card mappings with pagination (matches Spring Boot /page endpoint)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated card mapping list with camelCase fields
 */
const getCardMappingPage = async ({ page = 1, limit = 10, rfidUid, packCode, questionId, questionPackId, contentPackId, cardType, active } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (rfidUid) {
    where.rfid_uid = { contains: rfidUid, mode: 'insensitive' };
  }
  if (packCode) {
    where.pack_code = { contains: packCode, mode: 'insensitive' };
  }
  if (questionId) {
    where.question_id = BigInt(questionId);
  }
  // questionPackId: rfid_question_pack does not exist; skip filter gracefully
  if (contentPackId) {
    where.content_pack_id = BigInt(contentPackId);
  }
  if (cardType) {
    where.card_type = cardType;
  }
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const [total, cards] = await Promise.all([
      prisma.rfid_card_mapping.count({ where }),
      prisma.rfid_card_mapping.findMany({
        where,
        orderBy: { create_date: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: cards.map(transformCardMappingToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to fetch card mappings:', error);
    throw new Error('Failed to fetch card mappings');
  }
};

/**
 * Get all card mappings (no pagination, matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All card mappings with camelCase fields
 */
const getCardMappingList = async ({ packCode, questionId, questionPackId, contentPackId, active } = {}) => {
  const where = {};

  if (packCode) {
    where.pack_code = { contains: packCode, mode: 'insensitive' };
  }
  if (questionId) {
    where.question_id = BigInt(questionId);
  }
  // questionPackId: rfid_question_pack does not exist; skip filter gracefully
  if (contentPackId) {
    where.content_pack_id = BigInt(contentPackId);
  }
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const cards = await prisma.rfid_card_mapping.findMany({
      where,
      orderBy: { create_date: 'desc' }
    });
    return cards.map(transformCardMappingToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch card mappings:', error);
    throw new Error('Failed to fetch card mappings');
  }
};

/**
 * Get card mapping by ID (matches Spring Boot GET /{id} endpoint)
 * @param {number} id - Card mapping ID
 * @returns {Promise<Object>} Card mapping with camelCase fields
 */
const getCardMappingById = async (id) => {
  try {
    const card = await prisma.rfid_card_mapping.findFirst({
      where: { id: BigInt(id) }
    });
    return transformCardMappingToCamelCase(card);
  } catch (error) {
    logger.error('Failed to fetch card mapping:', error);
    throw new Error('Failed to fetch card mapping');
  }
};

/**
 * Get card mapping by RFID UID (matches Spring Boot GET /uid/{rfidUid} endpoint)
 * Admin endpoint - returns single card mapping
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object>} Card mapping with camelCase fields
 */
const getCardMappingByRfidUid = async (rfidUid) => {
  const normalizedUid = rfidUid.toUpperCase().replace(/[:-]/g, '');

  try {
    const card = await prisma.rfid_card_mapping.findFirst({
      where: { rfid_uid: normalizedUid }
    });
    return transformCardMappingToCamelCase(card);
  } catch (error) {
    logger.error('Failed to fetch card mapping by UID:', error);
    throw new Error('Failed to fetch card mapping by UID');
  }
};

/**
 * Get cards by pack code (matches Spring Boot GET /pack/{packCode} endpoint)
 * @param {string} packCode - Pack code
 * @returns {Promise<Array>} Card mappings with camelCase fields
 */
const getCardsByPackCode = async (packCode) => {
  try {
    const cards = await prisma.rfid_card_mapping.findMany({
      where: { pack_code: packCode },
      orderBy: { rfid_uid: 'asc' }
    });
    return cards.map(transformCardMappingToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch cards by pack code:', error);
    throw new Error('Failed to fetch cards by pack code');
  }
};

/**
 * Get cards by question ID (matches Spring Boot GET /question/{questionId} endpoint)
 * @param {number} questionId - Question ID
 * @returns {Promise<Array>} Card mappings with camelCase fields
 */
const getCardsByQuestionId = async (questionId) => {
  try {
    const cards = await prisma.rfid_card_mapping.findMany({
      where: { question_id: BigInt(questionId) },
      orderBy: { rfid_uid: 'asc' }
    });
    return cards.map(transformCardMappingToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch cards by question ID:', error);
    throw new Error('Failed to fetch cards by question ID');
  }
};

/**
 * Lookup card mapping by RFID UID
 * Public endpoint for ESP32 devices
 * @param {string} rfidUid - RFID UID
 * @returns {Promise<Object>} Card mapping with question data
 */
const lookupCardByUid = async (rfidUid) => {
  const normalizedUid = rfidUid.toUpperCase().replace(/[:-]/g, '');
  logger.info(`[RFID-LOOKUP] lookupCardByUid: uid=${normalizedUid}`);

  // 1. Find the Mapping
  let mapping = null;
  try {
    mapping = await prisma.rfid_card_mapping.findFirst({
      where: { rfid_uid: normalizedUid, active: true }
    });
  } catch (err) {
    logger.error('[RFID-LOOKUP] Card lookup DB error:', err);
  }

  if (!mapping) {
    logger.info(`[RFID-LOOKUP] No individual card mapping for uid=${normalizedUid}, checking bulk-range/series...`);

    // Fallback to series/bulk-range lookup (matches Java: series → question + pack)
    let series = null;
    try {
      series = await prisma.rfid_series.findFirst({
        where: {
          start_uid: { lte: normalizedUid },
          end_uid: { gte: normalizedUid },
          status: 1
        },
        orderBy: { priority: 'desc' },
        include: {
          rfid_pack: { select: { id: true, pack_name: true, pack_code: true } },
          rfid_question: true
        }
      });
    } catch (seriesErr) {
      logger.error('[RFID-LOOKUP] Series lookup DB error:', seriesErr);
    }

    if (series) {
      // Series links to rfid_question (prompt) and rfid_pack (physical SKU)
      if (series.rfid_question) {
        const question = series.rfid_question;
        logger.info(`[RFID-LOOKUP] Series Q&A resolved: title="${question.title}"`);
        return {
          rfid_uid: normalizedUid,
          source: 'bulk_range',
          series_id: Number(series.id),
          contentType: 'prompt',
          title: question.title,
          promptText: question.prompt_text,
          packCode: series.rfid_pack?.pack_code || null,
          language: question.language
        };
      }
      logger.warn(`[RFID-LOOKUP] Series found but no question linked: series_id=${series.id}`);
    }

    logger.warn(`[RFID-LOOKUP] No bulk-range match for uid=${normalizedUid}`);
    return null;
  }

  logger.info(`[RFID-LOOKUP] Found mapping: id=${mapping.id}, card_type=${mapping.card_type}, content_pack_id=${mapping.content_pack_id || 'null'}, question_id=${mapping.question_id || 'null'}`);

  // ✅ PRIORITY ORDER: Content data always wins over card_type label.
  // Check content_pack_id FIRST so that cards with a pack linked are never
  // misrouted to AI even if their card_type was accidentally set to 'ai'.

  // Track 1: Content Pack (Story/Rhyme) — highest priority
  if (mapping.content_pack_id) {
    logger.info(`[RFID-LOOKUP] Track 1: Content Pack lookup, pack_id=${mapping.content_pack_id}`);
    let pack = null;
    try {
      pack = await prisma.rfid_content_pack.findFirst({
        where: { id: mapping.content_pack_id }
      });
    } catch (packErr) {
      logger.error('[RFID-LOOKUP] Content pack query error:', packErr);
    }

    if (pack) {
      let items = [];
      try {
        items = await prisma.content_item.findMany({
          where: { content_pack_id: pack.id },
          orderBy: { item_number: 'asc' }
        });
      } catch (itemsErr) {
        logger.error('[RFID-LOOKUP] Content items query error:', itemsErr);
      }

      const mappedItems = items.map(item => ({
        sequence: item.item_number,
        title: item.title,
        audioUrl: item.audio_url,
        imageUrl: item.image_url || null,
        promptText: item.lyrics_text || null // Optional read-along
      }));

      logger.info(`[RFID-LOOKUP] Content Pack resolved: name="${pack.name}", type=${pack.content_type}, items=${mappedItems.length}, audioUrls=${mappedItems.filter(i => i.audioUrl).length}`);

      return {
        rfid_uid: normalizedUid,
        contentType: pack.content_type || 'story_pack',
        title: pack.name,
        packCode: pack.pack_code,
        version: pack.version,
        items: mappedItems
      };
    } else {
      logger.warn(`[RFID-LOOKUP] Content pack id=${mapping.content_pack_id} not found in rfid_content_pack table`);
    }
  }

  // AI Card: Only treat as AI if card_type is 'ai' AND no content_pack_id is linked above.
  // This guard prevents misconfigured content cards from accidentally firing AI flow.
  if (mapping.card_type === 'ai') {
    logger.info(`[RFID-LOOKUP] AI card detected (no content_pack_id): uid=${normalizedUid}`);
    return {
      rfid_uid: normalizedUid,
      contentType: 'prompt',
      title: mapping.notes || 'AI Card',
      promptText: mapping.notes || 'The child tapped an AI card. Engage them in a fun, interactive conversation.'
    };
  }

  // Track 2: Q&A / Single Question
  if (mapping.question_id) {
    logger.info(`[RFID-LOOKUP] Track 2: Single Q&A lookup, question_id=${mapping.question_id}`);
    let question = null;
    try {
      question = await prisma.rfid_question.findFirst({
        where: { id: mapping.question_id }
      });
    } catch (qErr) {
      logger.error('[RFID-LOOKUP] Question query error:', qErr);
    }

    if (question) {
      logger.info(`[RFID-LOOKUP] Q&A resolved: title="${question.title}", hasCache=${!!question.cached_audio_url}`);
      return {
        rfid_uid: normalizedUid,
        contentType: 'prompt',
        title: question.title,
        promptText: question.prompt_text,
        audioUrl: question.allow_caching ? question.cached_audio_url : null,
        allowCaching: question.allow_caching
      };
    } else {
      logger.warn(`[RFID-LOOKUP] Question id=${mapping.question_id} not found in rfid_question table`);
    }
  }

  // Track 3: Q&A Pack via question_pack_id FK
  if (mapping.question_pack_id) {
    logger.info(`[RFID-LOOKUP] Track 3: Q&A Pack lookup via question_pack_id=${mapping.question_pack_id}`);
    try {
      const qaPack = await prisma.rfid_question_pack.findFirst({
        where: { id: mapping.question_pack_id }
      });

      if (qaPack) {
        // question_ids is stored as JSON array on the pack
        const packQuestionIds = Array.isArray(qaPack.question_ids) ? qaPack.question_ids : [];
        if (packQuestionIds.length > 0) {
          const questions = await prisma.rfid_question.findMany({
            where: { id: { in: packQuestionIds.map(id => BigInt(id)) } }
          });

          const sortedItems = packQuestionIds.map((qId, index) => {
            const q = questions.find(x => String(x.id) === String(qId));
            if (!q) return null;
            return {
              sequence: index + 1,
              title: q.title,
              promptText: q.prompt_text,
              audioUrl: q.allow_caching ? q.cached_audio_url : null,
              allowCaching: q.allow_caching,
              systemPromptOverride: q.system_prompt_override
            };
          }).filter(Boolean);

          logger.info(`[RFID-LOOKUP] Q&A Pack resolved: name="${qaPack.name}", questions=${sortedItems.length}`);

          return {
            rfid_uid: normalizedUid,
            contentType: 'prompt_pack',
            packCode: qaPack.pack_code,
            packName: qaPack.name,
            items: sortedItems
          };
        }
        logger.warn(`[RFID-LOOKUP] Q&A Pack id=${mapping.question_pack_id} has no question_ids`);
      } else {
        logger.warn(`[RFID-LOOKUP] Q&A Pack id=${mapping.question_pack_id} not found in rfid_question_pack table`);
      }
    } catch (qpErr) {
      logger.error('[RFID-LOOKUP] Q&A Pack query error:', qpErr);
    }
  }

  // Track 4: Q&A Pack via question_ids Json array on the mapping itself
  // The mapping's question_ids field holds an array of question IDs directly.
  const questionIds = Array.isArray(mapping.question_ids) ? mapping.question_ids : [];
  if (questionIds.length > 0) {
    logger.info(`[RFID-LOOKUP] Track 3: Q&A Pack lookup via question_ids on mapping, count=${questionIds.length}`);
    try {
      const questions = await prisma.rfid_question.findMany({
        where: { id: { in: questionIds.map(id => BigInt(id)) } }
      });

      if (questions && questions.length > 0) {
        // Map to 'items' structure so Gateway can pick by sequence
        const sortedItems = questionIds.map((qId, index) => {
          const q = questions.find(x => String(x.id) === String(qId));
          if (!q) return null;
          return {
            sequence: index + 1,
            title: q.title,
            promptText: q.prompt_text,
            audioUrl: q.allow_caching ? q.cached_audio_url : null,
            allowCaching: q.allow_caching,
            systemPromptOverride: q.system_prompt_override
          };
        }).filter(Boolean);

        logger.info(`[RFID-LOOKUP] Q&A Pack via question_ids resolved: questions=${sortedItems.length}`);

        return {
          rfid_uid: normalizedUid,
          contentType: 'prompt_pack',
          packCode: mapping.pack_code,
          packName: null,
          items: sortedItems
        };
      }
    } catch (qsErr) {
      logger.error('[RFID-LOOKUP] Questions batch query error:', qsErr);
    }
  }

  logger.warn(`[RFID-LOOKUP] Card mapping exists (id=${mapping.id}) but no content resolved for uid=${normalizedUid}`);
  return null;
};

/**
 * Create card mapping (matches Spring Boot POST /card)
 * @param {Object} data - Card mapping data
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createCardMapping = async (data, _userId) => {
  // Normalize UID
  const normalizedUid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');

  // Check for duplicate
  const existing = await getCardMappingByRfidUid(normalizedUid);
  if (existing) {
    throw new Error('Card mapping already exists for this UID');
  }

  try {
    await prisma.rfid_card_mapping.create({
      data: {
        rfid_uid: normalizedUid,
        question_id: data.questionId ? BigInt(data.questionId) : null,
        question_pack_id: data.questionPackId ? BigInt(data.questionPackId) : null,
        question_ids: data.questionIds || [],
        pack_code: data.packCode || null,
        pack_id: data.packId ? BigInt(data.packId) : null,
        content_pack_id: data.contentPackId ? BigInt(data.contentPackId) : null,
        action_type: data.actionType || null,
        action_data: data.actionData || {},
        card_type: data.cardType || 'content',
        notes: data.notes || null,
        active: data.active !== false,
        status: 1
      }
    });
  } catch (error) {
    logger.error('Failed to create card mapping:', error);
    if (error.code === 'P2002') {
      throw new Error('Card mapping already exists for this UID');
    }
    throw new Error('Failed to create card mapping: ' + error.message);
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
  if (!data.id) {
    throw new Error('Card mapping ID is required');
  }

  const updateData = {
    update_date: new Date()
  };

  // Only update provided fields
  if (data.rfidUid !== undefined) {
    updateData.rfid_uid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.questionId !== undefined) updateData.question_id = data.questionId ? BigInt(data.questionId) : null;
  if (data.questionPackId !== undefined) {
    updateData.question_pack_id = data.questionPackId ? BigInt(data.questionPackId) : null;
    // Mutual exclusivity: setting questionPackId clears contentPackId
    if (data.questionPackId && data.contentPackId === undefined) {
      updateData.content_pack_id = null;
    }
  }
  if (data.questionIds !== undefined) updateData.question_ids = data.questionIds;
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.packId !== undefined) updateData.pack_id = data.packId ? BigInt(data.packId) : null;
  if (data.contentPackId !== undefined) {
    updateData.content_pack_id = data.contentPackId ? BigInt(data.contentPackId) : null;
    // Mutual exclusivity: setting contentPackId clears questionPackId
    if (data.contentPackId && data.questionPackId === undefined) {
      updateData.question_pack_id = null;
    }
  }
  if (data.actionType !== undefined) updateData.action_type = data.actionType;
  if (data.actionData !== undefined) updateData.action_data = data.actionData;
  if (data.cardType !== undefined) updateData.card_type = data.cardType;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.active !== undefined) updateData.active = data.active;

  try {
    await prisma.rfid_card_mapping.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
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
  let where = {};

  if (data.id) {
    where = { id: BigInt(data.id) };
  } else if (data.rfidUid) {
    const normalizedUid = data.rfidUid.toUpperCase().replace(/[:-]/g, '');
    where = { rfid_uid: normalizedUid };
  } else {
    throw new Error('ID or RFID UID is required for deletion');
  }

  try {
    await prisma.rfid_card_mapping.deleteMany({ where });
  } catch (error) {
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
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Card mapping IDs are required');
  }

  try {
    await prisma.rfid_card_mapping.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
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
  try {
    const pack = await prisma.rfid_content_pack.findFirst({
      where: { id: BigInt(contentPackId) }
    });
    return pack || null;
  } catch (error) {
    logger.error('Failed to fetch content pack:', error);
    throw new Error('Failed to fetch content pack');
  }
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
  const normalizedUid = uid.toUpperCase().replace(/[:-]/g, '');

  try {
    // Query series — DB uses 'status' (Int, 1=active)
    const series = await prisma.rfid_series.findFirst({
      where: {
        start_uid: { lte: normalizedUid },
        end_uid: { gte: normalizedUid },
        status: 1
      },
      orderBy: { priority: 'desc' }
    });

    if (!series) return null;

    // Fetch related rfid_pack if content_pack_id exists
    // Note: rfid_series.content_pack_id is a FK to rfid_pack (not rfid_content_pack)
    let contentPack = null;
    if (series.content_pack_id) {
      try {
        const packData = await prisma.rfid_pack.findFirst({
          where: { id: series.content_pack_id },
          select: { id: true, pack_code: true, pack_name: true, description: true }
        });
        if (packData) {
          contentPack = {
            id: Number(packData.id),
            pack_code: packData.pack_code,
            name: packData.pack_name,
            description: packData.description
          };
        }
      } catch (packErr) {
        logger.error('Failed to fetch pack for series:', packErr);
      }
    }

    return {
      ...series,
      id: Number(series.id),
      content_pack_id: series.content_pack_id ? Number(series.content_pack_id) : null,
      question_id: series.question_id ? Number(series.question_id) : null,
      content_pack: contentPack
    };
  } catch (error) {
    logger.error('Series lookup error:', error);
    throw new Error('Failed to lookup series');
  }
};

// =============================================
// Pack Management Methods
// Maps schema (pack_name, status) to Spring Boot schema (name, active)
// =============================================

/**
 * Get pack list with pagination (matches Spring Boot /page endpoint)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated pack list with camelCase fields
 */
const getPackPage = async ({ page = 1, limit = 10, packCode, name, active } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (packCode) {
    where.pack_code = { contains: packCode, mode: 'insensitive' };
  }
  if (name) {
    where.pack_name = { contains: name, mode: 'insensitive' };
  }
  if (active !== undefined && active !== null && active !== '') {
    // Convert boolean to status (1=active, 0=inactive)
    where.status = (active === true || active === 'true' || active === '1') ? 1 : 0;
  }

  try {
    const [total, packs] = await Promise.all([
      prisma.rfid_pack.count({ where }),
      prisma.rfid_pack.findMany({
        where,
        orderBy: { pack_name: 'asc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: packs.map(transformPackToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to fetch packs:', error);
    throw new Error('Failed to fetch packs');
  }
};

/**
 * Get all packs list (matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Pack list with camelCase fields
 */
const getPackList = async ({ packCode, name, active } = {}) => {
  const where = {};

  if (packCode) {
    where.pack_code = { contains: packCode, mode: 'insensitive' };
  }
  if (name) {
    where.pack_name = { contains: name, mode: 'insensitive' };
  }
  if (active !== undefined && active !== null && active !== '') {
    where.status = (active === true || active === 'true' || active === '1') ? 1 : 0;
  }

  try {
    const packs = await prisma.rfid_pack.findMany({
      where,
      orderBy: { pack_name: 'asc' }
    });
    return packs.map(transformPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch packs:', error);
    throw new Error('Failed to fetch packs');
  }
};

/**
 * Get all active packs (matches Spring Boot /active endpoint)
 * @returns {Promise<Array>} Active pack list with camelCase fields
 */
const getAllActivePacks = async () => {
  try {
    const packs = await prisma.rfid_pack.findMany({
      where: { status: 1 },
      orderBy: { pack_name: 'asc' }
    });
    return packs.map(transformPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch active packs:', error);
    throw new Error('Failed to fetch active packs');
  }
};

/**
 * Get pack by ID
 * @param {number} packId - Pack ID
 * @returns {Promise<Object>} Pack details with camelCase fields
 */
const getPackById = async (packId) => {
  try {
    const pack = await prisma.rfid_pack.findFirst({
      where: { id: BigInt(packId) }
    });
    return transformPackToCamelCase(pack);
  } catch (error) {
    logger.error('Failed to fetch pack:', error);
    throw new Error('Failed to fetch pack');
  }
};

/**
 * Get pack by pack code (matches Spring Boot /code/{packCode} endpoint)
 * @param {string} packCode - Pack code
 * @returns {Promise<Object>} Pack details with camelCase fields
 */
const getPackByCode = async (packCode) => {
  try {
    const pack = await prisma.rfid_pack.findFirst({
      where: { pack_code: packCode }
    });
    return transformPackToCamelCase(pack);
  } catch (error) {
    logger.error('Failed to fetch pack by code:', error);
    throw new Error('Failed to fetch pack by code');
  }
};

/**
 * Get packs suitable for age (matches Spring Boot /age/{age} endpoint)
 * @param {number} age - Target age
 * @returns {Promise<Array>} Pack list with camelCase fields
 */
const getPackByAge = async (age) => {
  try {
    // Get active packs where age is within range (use raw query for OR-NULL logic)
    const packs = await prisma.rfid_pack.findMany({
      where: {
        status: 1,
        AND: [
          {
            OR: [
              { age_min: null },
              { age_min: { lte: age } }
            ]
          },
          {
            OR: [
              { age_max: null },
              { age_max: { gte: age } }
            ]
          }
        ]
      },
      orderBy: { pack_name: 'asc' }
    });
    return packs.map(transformPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch packs by age:', error);
    throw new Error('Failed to fetch packs by age');
  }
};

/**
 * Create pack (matches Spring Boot POST /pack)
 * @param {Object} data - Pack data (packCode, name, description, ageMin, ageMax, active)
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createPack = async (data, _userId) => {
  try {
    await prisma.rfid_pack.create({
      data: {
        pack_code: data.packCode,
        pack_name: data.name,  // DB uses pack_name
        description: data.description,
        age_min: data.ageMin,
        age_max: data.ageMax,
        status: data.active !== false ? 1 : 0  // Convert boolean to status
      }
    });
  } catch (error) {
    logger.error('Failed to create pack:', error);
    if (error.code === 'P2002') {
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
  if (!data.id) {
    throw new Error('Pack ID is required');
  }

  const updateData = {
    updated_at: new Date()
  };

  // Only update provided fields - map to DB column names
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.name !== undefined) updateData.pack_name = data.name;  // DB uses pack_name
  if (data.description !== undefined) updateData.description = data.description;
  if (data.ageMin !== undefined) updateData.age_min = data.ageMin;
  if (data.ageMax !== undefined) updateData.age_max = data.ageMax;
  if (data.active !== undefined) updateData.status = data.active ? 1 : 0;  // Convert boolean to status

  try {
    await prisma.rfid_pack.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update pack:', error);
    if (error.code === 'P2002') {
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
  try {
    await prisma.rfid_pack.deleteMany({
      where: { id: BigInt(packId) }
    });
  } catch (error) {
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
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Pack IDs are required');
  }

  try {
    await prisma.rfid_pack.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
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
  const offset = (page - 1) * limit;

  const where = {};

  // DB uses 'content_pack_id' for the pack FK
  if (packId) {
    where.content_pack_id = BigInt(packId);
  }

  // rfid_series does have question_id column in Prisma schema
  if (questionId) {
    where.question_id = BigInt(questionId);
  }

  // DB uses 'status' (Int) instead of 'active' (Boolean)
  if (active !== undefined && active !== null && active !== '') {
    where.status = (active === true || active === 'true') ? 1 : 0;
  }

  try {
    const [total, seriesRows] = await Promise.all([
      prisma.rfid_series.count({ where }),
      prisma.rfid_series.findMany({
        where,
        orderBy: { priority: 'desc' },
        skip: offset,
        take: limit,
        include: {
          rfid_pack: { select: { id: true, pack_name: true, pack_code: true } },
          rfid_question: { select: { id: true, title: true, code: true } },
          rfid_content_pack: { select: { id: true, name: true, pack_code: true } },
          rfid_question_pack: { select: { id: true, name: true, pack_code: true } }
        }
      })
    ]);

    const normalized = seriesRows;

    return {
      list: normalized.map(transformSeriesToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }
};

/**
 * Get all series (no pagination, matches Spring Boot /list endpoint)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All series with camelCase fields
 */
const getSeriesAll = async ({ packId, questionId, active } = {}) => {
  const where = {};

  if (packId) {
    where.content_pack_id = BigInt(packId);
  }
  if (questionId) {
    where.question_id = BigInt(questionId);
  }
  if (active !== undefined && active !== null && active !== '') {
    where.status = (active === true || active === 'true') ? 1 : 0;
  }

  try {
    const seriesRows = await prisma.rfid_series.findMany({
      where,
      orderBy: { priority: 'desc' },
      include: {
        rfid_pack: { select: { id: true, pack_name: true, pack_code: true } },
        rfid_question: { select: { id: true, title: true, code: true } },
        rfid_content_pack: { select: { id: true, name: true, pack_code: true } },
        rfid_question_pack: { select: { id: true, name: true, pack_code: true } }
      }
    });
    return seriesRows.map(transformSeriesToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }
};

/**
 * Get series by ID (matches Spring Boot GET /{id} endpoint)
 * @param {number} seriesId - Series ID
 * @returns {Promise<Object>} Series details with camelCase fields
 */
const getSeriesById = async (seriesId) => {
  try {
    const series = await prisma.rfid_series.findFirst({
      where: { id: BigInt(seriesId) },
      include: {
        rfid_pack: { select: { id: true, pack_name: true, pack_code: true } },
        rfid_question: { select: { id: true, title: true, code: true } },
        rfid_content_pack: { select: { id: true, name: true, pack_code: true } },
        rfid_question_pack: { select: { id: true, name: true, pack_code: true } }
      }
    });
    return transformSeriesToCamelCase(series);
  } catch (error) {
    logger.error('Failed to fetch series:', error);
    throw new Error('Failed to fetch series');
  }
};

/**
 * Create series (matches Spring Boot POST /series)
 * @param {Object} data - Series data
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createSeries = async (data, _userId) => {
  // Normalize UIDs
  const startUid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  const endUid = data.endUid.toUpperCase().replace(/[:-]/g, '');

  // Validate UID order
  if (startUid > endUid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  // DB uses 'status' (Int) instead of 'active' (Boolean)
  const createData = {
    series_name: data.seriesName || data.notes || `Series ${startUid}-${endUid}`,
    start_uid: startUid,
    end_uid: endUid,
    content_ref_id: data.contentPackId ? BigInt(data.contentPackId) : null,
    question_pack_id: data.questionPackId ? BigInt(data.questionPackId) : null,
    question_id: data.questionId ? BigInt(data.questionId) : null,
    notes: data.notes || null,
    priority: data.priority || 0,
    status: data.active !== false ? 1 : 0
  };

  try {
    await prisma.rfid_series.create({ data: createData });
  } catch (error) {
    logger.error('Failed to create series:', error);
    throw new Error('Failed to create series: ' + error.message);
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
  if (!data.id) {
    throw new Error('Series ID is required');
  }

  const updateData = {
    updated_at: new Date()
  };

  // Only update provided fields
  // DB uses 'status' (Int) instead of 'active' (Boolean)
  if (data.startUid !== undefined) {
    updateData.start_uid = data.startUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.endUid !== undefined) {
    updateData.end_uid = data.endUid.toUpperCase().replace(/[:-]/g, '');
  }
  if (data.seriesName !== undefined) updateData.series_name = data.seriesName;
  if (data.notes !== undefined) updateData.notes = data.notes;

  // content_pack_id is FK to rfid_pack (physical product SKU) — legacy field
  if (data.packId !== undefined) {
    updateData.content_pack_id = data.packId ? BigInt(data.packId) : null;
  }

  // content_ref_id is FK to rfid_content_pack (story/rhyme content)
  if (data.contentPackId !== undefined) {
    updateData.content_ref_id = data.contentPackId ? BigInt(data.contentPackId) : null;
    // Mutual exclusivity: clear question_pack_id when setting content pack
    if (data.contentPackId && data.questionPackId === undefined) {
      updateData.question_pack_id = null;
    }
  }

  // question_pack_id is FK to rfid_question_pack (Q&A pack)
  if (data.questionPackId !== undefined) {
    updateData.question_pack_id = data.questionPackId ? BigInt(data.questionPackId) : null;
    // Mutual exclusivity: clear content_ref_id when setting Q&A pack
    if (data.questionPackId && data.contentPackId === undefined) {
      updateData.content_ref_id = null;
    }
  }

  if (data.questionId !== undefined) updateData.question_id = data.questionId ? BigInt(data.questionId) : null;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.active !== undefined) updateData.status = data.active ? 1 : 0;

  // Validate UID order if both are being updated
  if (updateData.start_uid && updateData.end_uid && updateData.start_uid > updateData.end_uid) {
    throw new Error('Start UID must be less than or equal to End UID');
  }

  try {
    await prisma.rfid_series.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
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
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Series IDs are required');
  }

  try {
    await prisma.rfid_series.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
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
  try {
    await prisma.rfid_series.deleteMany({
      where: { id: BigInt(seriesId) }
    });
  } catch (error) {
    logger.error('Failed to delete series:', error);
    throw new Error('Failed to delete series');
  }

  return null;  // Spring Boot returns Result<Void>
};

/**
 * Get all active series (matches Spring Boot /active endpoint)
 * Note: DB uses 'status' (Int, 1=active) instead of 'active' (Boolean)
 * @returns {Promise<Array>} All active series with camelCase fields
 */
const getActiveSeries = async () => {
  try {
    const seriesRows = await prisma.rfid_series.findMany({
      where: { status: 1 },
      orderBy: { priority: 'desc' }
    });
    return seriesRows.map(transformSeriesToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch active series:', error);
    throw new Error('Failed to fetch active series');
  }
};

/**
 * Find all series containing a UID (matches Spring Boot /find/{uid} endpoint)
 * @param {string} uid - RFID UID to check
 * @returns {Promise<Array>} Series that contain the UID with camelCase fields
 */
const findSeriesByUid = async (uid) => {
  const normalizedUid = uid.toUpperCase().replace(/[:-]/g, '');

  try {
    const seriesRows = await prisma.rfid_series.findMany({
      where: {
        start_uid: { lte: normalizedUid },
        end_uid: { gte: normalizedUid }
      },
      orderBy: { priority: 'desc' }
    });
    return seriesRows.map(transformSeriesToCamelCase);
  } catch (error) {
    logger.error('Failed to find series by UID:', error);
    throw new Error('Failed to find series');
  }
};

/**
 * Get series by pack ID (matches Spring Boot /pack/{packId} endpoint)
 * Note: DB uses 'content_pack_id' for the pack FK
 * @param {number} packId - Pack ID (mapped to content_pack_id)
 * @returns {Promise<Array>} Series in the pack with camelCase fields
 */
const getSeriesByPackId = async (packId) => {
  try {
    const seriesRows = await prisma.rfid_series.findMany({
      where: { content_pack_id: BigInt(packId) },
      orderBy: { priority: 'desc' }
    });
    return seriesRows.map(transformSeriesToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch series by pack:', error);
    throw new Error('Failed to fetch series');
  }
};

/**
 * Get series by question ID (matches Spring Boot /question/{questionId} endpoint)
 * rfid_series does have question_id column in Prisma schema
 * @param {number} questionId - Question ID
 * @returns {Promise<Array>} Series containing the question
 */
const getSeriesByQuestionId = async (questionId) => {
  try {
    const seriesRows = await prisma.rfid_series.findMany({
      where: { question_id: BigInt(questionId) },
      orderBy: { priority: 'desc' }
    });
    return seriesRows.map(transformSeriesToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch series by question ID:', error);
    return [];
  }
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
  const offset = (page - 1) * limit;

  const where = {};

  if (category) {
    where.category = category;
  }
  if (language) {
    where.language = language;
  }
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const [total, questions] = await Promise.all([
      prisma.rfid_question.count({ where }),
      prisma.rfid_question.findMany({
        where,
        orderBy: { create_date: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: questions.map(transformQuestionToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    };
  } catch (error) {
    logger.error('Failed to fetch questions:', error);
    throw new Error('Failed to fetch questions');
  }
};

/**
 * Get all questions (no pagination)
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} All questions
 */
const getQuestionList = async ({ category, language, active } = {}) => {
  const where = {};

  if (category) {
    where.category = category;
  }
  if (language) {
    where.language = language;
  }
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const questions = await prisma.rfid_question.findMany({
      where,
      orderBy: { create_date: 'desc' }
    });
    return questions.map(transformQuestionToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch questions:', error);
    throw new Error('Failed to fetch questions');
  }
};

/**
 * Get question by ID
 * @param {number} questionId - Question ID
 * @returns {Promise<Object>} Question details
 */
const getQuestionById = async (questionId) => {
  try {
    const question = await prisma.rfid_question.findFirst({
      where: { id: BigInt(questionId) }
    });
    return transformQuestionToCamelCase(question);
  } catch (error) {
    logger.error('Failed to fetch question:', error);
    throw new Error('Failed to fetch question');
  }
};

/**
 * Get question by code
 * @param {string} code - Question code
 * @returns {Promise<Object>} Question details
 */
const getQuestionByCode = async (code) => {
  try {
    const question = await prisma.rfid_question.findFirst({
      where: { code }
    });
    return transformQuestionToCamelCase(question);
  } catch (error) {
    logger.error('Failed to fetch question by code:', error);
    throw new Error('Failed to fetch question');
  }
};

/**
 * Get questions by category
 * @param {string} category - Category name
 * @returns {Promise<Array>} Questions in category
 */
const getQuestionsByCategory = async (category) => {
  try {
    const questions = await prisma.rfid_question.findMany({
      where: { category, active: true },
      orderBy: { create_date: 'desc' }
    });
    return questions.map(transformQuestionToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch questions by category:', error);
    throw new Error('Failed to fetch questions');
  }
};

/**
 * Get questions by language
 * @param {string} language - Language code
 * @returns {Promise<Array>} Questions in language
 */
const getQuestionsByLanguage = async (language) => {
  try {
    const questions = await prisma.rfid_question.findMany({
      where: { language, active: true },
      orderBy: { create_date: 'desc' }
    });
    return questions.map(transformQuestionToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch questions by language:', error);
    throw new Error('Failed to fetch questions');
  }
};

/**
 * Create question
 * @param {Object} data - Question data
 * @param {number} userId - Creator user ID
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const createQuestion = async (data, userId) => {
  // Check for duplicate code
  const existing = await getQuestionByCode(data.code);
  if (existing) {
    throw new Error('Question with this code already exists');
  }

  // Note: rfid_question in Prisma schema does NOT have allow_caching, cached_audio_url, system_prompt_override
  // Only insert fields that exist in the schema: code, title, prompt_text, language, category, difficulty, active, creator, create_date, updater, update_date
  const createData = {
    code: data.code,
    title: data.title,
    prompt_text: data.promptText,
    language: data.language || 'en',
    category: data.category || null,
    difficulty: data.difficulty || 1,
    active: data.active !== false,
    creator: userId ? BigInt(userId) : null
  };

  try {
    await prisma.rfid_question.create({ data: createData });
  } catch (error) {
    logger.error('Failed to create question:', error);
    if (error.code === 'P2002') {
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
 * @returns {Promise<null>} Returns null for Spring Boot compatibility (Result<Void>)
 */
const updateQuestion = async (data, userId) => {
  if (!data.id) {
    throw new Error('Question ID is required');
  }

  const updateData = {
    updater: userId ? BigInt(userId) : null,
    update_date: new Date()
  };

  // Only update provided fields that exist in Prisma schema
  if (data.code !== undefined) updateData.code = data.code;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.promptText !== undefined) updateData.prompt_text = data.promptText;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
  if (data.active !== undefined) updateData.active = data.active;

  try {
    await prisma.rfid_question.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update question:', error);
    if (error.code === 'P2002') {
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
  const idArray = Array.isArray(ids) ? ids : [ids];

  if (idArray.length === 0) {
    throw new Error('At least one question ID is required');
  }

  try {
    await prisma.rfid_question.deleteMany({
      where: { id: { in: idArray.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete questions:', error);
    throw new Error('Failed to delete questions');
  }

  // Return null for Spring Boot Result<Void> compatibility
  return null;
};

// =============================================
// Legacy RFID Tag Methods (for backward compatibility)
// Uses ai_rfid_tag and ai_rfid_scan_log tables
// =============================================

/**
 * Get RFID tags with pagination (legacy)
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated RFID list
 */
const getRfidList = async ({ page = 1, limit = 10 } = {}) => {
  const offset = (page - 1) * limit;

  try {
    const [total, tags] = await Promise.all([
      prisma.ai_rfid_tag.count(),
      prisma.ai_rfid_tag.findMany({
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: tags || [],
      total,
      page,
      limit
    };
  } catch (error) {
    throw new Error('Failed to fetch RFID tags');
  }
};

/**
 * Get RFID tag by ID (legacy)
 * @param {string} tagId - RFID tag ID (UUID string)
 * @returns {Promise<Object>} RFID tag
 */
const getRfidById = async (tagId) => {
  try {
    const tag = await prisma.ai_rfid_tag.findFirst({
      where: { id: tagId }
    });
    return tag || null;
  } catch (error) {
    return null;
  }
};

/**
 * Get RFID tag by UID (legacy)
 * @param {string} uid - RFID UID
 * @returns {Promise<Object>} RFID tag
 */
const getRfidByUid = async (uid) => {
  const normalizedUid = uid.toUpperCase().replace(/:/g, '');

  try {
    const tag = await prisma.ai_rfid_tag.findFirst({
      where: { uid: normalizedUid }
    });
    return tag || null;
  } catch (error) {
    return null;
  }
};

/**
 * Create RFID tag (legacy)
 * @param {number} userId - User ID
 * @param {Object} data - RFID data
 * @returns {Promise<Object>} Created tag
 */
const createRfid = async (userId, data) => {
  const normalizedUid = data.uid.toUpperCase().replace(/:/g, '');

  // Check if UID already exists
  const existing = await getRfidByUid(normalizedUid);
  if (existing) throw new Error('RFID tag with this UID already exists');

  try {
    const tag = await prisma.ai_rfid_tag.create({
      data: {
        uid: normalizedUid,
        name: data.name,
        description: data.description,
        content_type: data.contentType,
        content_id: data.contentId,
        action_type: data.actionType,
        action_params: data.actionParams,
        status: data.status || 1,
        creator: userId ? BigInt(userId) : null
      }
    });
    return tag;
  } catch (error) {
    throw new Error('Failed to create RFID tag');
  }
};

/**
 * Update RFID tag (legacy)
 * @param {string} tagId - RFID tag ID (UUID string)
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated tag
 */
const updateRfid = async (tagId, data) => {
  const updateData = { updated_at: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.contentType !== undefined) updateData.content_type = data.contentType;
  if (data.contentId !== undefined) updateData.content_id = data.contentId;
  if (data.actionType !== undefined) updateData.action_type = data.actionType;
  if (data.actionParams !== undefined) updateData.action_params = data.actionParams;
  if (data.status !== undefined) updateData.status = data.status;

  try {
    const tag = await prisma.ai_rfid_tag.update({
      where: { id: tagId },
      data: updateData
    });
    return tag;
  } catch (error) {
    throw new Error('Failed to update RFID tag');
  }
};

/**
 * Delete RFID tag (legacy)
 * @param {string} tagId - RFID tag ID (UUID string)
 */
const deleteRfid = async (tagId) => {
  try {
    await prisma.ai_rfid_tag.delete({
      where: { id: tagId }
    });
  } catch (error) {
    throw new Error('Failed to delete RFID tag');
  }
};

/**
 * Process RFID scan from device (legacy)
 * @param {string} mac - Device MAC address
 * @param {string} uid - RFID UID
 * @returns {Promise<Object>} Action to perform
 */
const processScan = async (mac, uid) => {
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
  try {
    await prisma.ai_rfid_scan_log.create({
      data: {
        mac_address: normalizedMac,
        rfid_uid: normalizedUid,
        tag_id: tag.id
      }
    });
  } catch (logErr) {
    logger.error('Failed to log RFID scan:', logErr);
  }

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
  const offset = (page - 1) * limit;

  const where = {};

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    where.mac_address = normalizedMac;
  }
  if (uid) {
    const normalizedUid = uid.toUpperCase().replace(/:/g, '');
    where.rfid_uid = normalizedUid;
  }

  try {
    const [total, logs] = await Promise.all([
      prisma.ai_rfid_scan_log.count({ where }),
      prisma.ai_rfid_scan_log.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit,
        include: {
          ai_rfid_tag: { select: { name: true, content_type: true } }
        }
      })
    ]);

    return {
      list: logs || [],
      total,
      page,
      limit
    };
  } catch (error) {
    throw new Error('Failed to fetch scan logs');
  }
};

/**
 * Register device RFID tags (batch) (legacy)
 * @param {string} mac - Device MAC address
 * @param {Array} tags - Array of {uid, name} objects
 * @returns {Promise<Array>} Created tags
 */
const registerDeviceTags = async (mac, tags) => {
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
    try {
      const created = await prisma.ai_rfid_tag.create({
        data: {
          uid: normalizedUid,
          name: tag.name || `Tag ${normalizedUid.slice(-4)}`,
          device_mac: normalizedMac,
          status: 1
        }
      });
      if (created) {
        results.push({ ...created, status: 'created' });
      }
    } catch (createErr) {
      logger.error('Failed to register device tag:', createErr);
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
  try {
    const items = await prisma.content_item.findMany({
      where: { content_pack_id: BigInt(contentPackId), active: true },
      orderBy: { item_number: 'asc' }
    });
    return items;
  } catch (error) {
    logger.error('Failed to fetch content items:', { error, contentPackId });
    throw new Error('Failed to fetch content items');
  }
};

/**
 * Get a single content item by pack ID and item number
 * @param {number} contentPackId - Content pack ID
 * @param {number} itemNumber - Item sequence number (1-based)
 * @returns {Promise<Object|null>} Content item or null
 */
const getContentItem = async (contentPackId, itemNumber) => {
  try {
    const item = await prisma.content_item.findFirst({
      where: {
        content_pack_id: BigInt(contentPackId),
        item_number: itemNumber,
        active: true
      }
    });
    return item || null;
  } catch (error) {
    logger.error('Failed to fetch content item:', { error, contentPackId, itemNumber });
    throw new Error('Failed to fetch content item');
  }
};

/**
 * Get total audio size for all items in a content pack
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<number>} Total audio size in bytes
 */
const getTotalAudioSize = async (contentPackId) => {
  try {
    const items = await prisma.content_item.findMany({
      where: { content_pack_id: BigInt(contentPackId), active: true },
      select: { audio_size_bytes: true }
    });
    return (items || []).reduce((sum, item) => sum + (item.audio_size_bytes ? Number(item.audio_size_bytes) : 0), 0);
  } catch (error) {
    logger.error('Failed to get total audio size:', { error, contentPackId });
    throw new Error('Failed to get total audio size');
  }
};

/**
 * Count items that have images in a content pack
 * @param {number} contentPackId - Content pack ID
 * @returns {Promise<number>} Count of items with images
 */
const countItemsWithImages = async (contentPackId) => {
  try {
    const items = await prisma.content_item.findMany({
      where: {
        content_pack_id: BigInt(contentPackId),
        active: true,
        NOT: { images_json: null }
      },
      select: { id: true, images_json: true }
    });

    // Filter for non-empty arrays
    return (items || []).filter(item => {
      if (!item.images_json) return false;
      const images = typeof item.images_json === 'string' ? JSON.parse(item.images_json) : item.images_json;
      return Array.isArray(images) && images.length > 0;
    }).length;
  } catch (error) {
    logger.error('Failed to count items with images:', { error, contentPackId });
    throw new Error('Failed to count items with images');
  }
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
  let mapping = null;
  let contentPack = null;
  try {
    mapping = await prisma.rfid_card_mapping.findFirst({
      where: { rfid_uid: normalizedUid, active: true }
    });

    if (mapping?.content_pack_id) {
      contentPack = await prisma.rfid_content_pack.findFirst({
        where: { id: mapping.content_pack_id }
      });
    }
  } catch (err) {
    logger.error('Failed to lookup card mapping or content pack:', err);
  }

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

  // Try to get question by sequence if provided and question_ids exists on mapping
  if (sequence && sequence > 0 && mapping?.question_ids && Array.isArray(mapping.question_ids) && mapping.question_ids.length > 0) {
    const questionIdForSequence = mapping.question_ids[sequence - 1]; // 0-indexed array
    if (questionIdForSequence) {
      try {
        const qData = await prisma.rfid_question.findFirst({
          where: { id: BigInt(questionIdForSequence), active: true }
        });
        if (qData) {
          questionEntity = qData;
          logger.info('Found question by sequence:', { sequence, title: qData.title });
        }
      } catch (qErr) {
        logger.error('Failed to fetch question by sequence:', qErr);
      }
    }
  }

  // Fallback to single question
  if (!questionEntity && mapping?.question_id) {
    try {
      const qData = await prisma.rfid_question.findFirst({
        where: { id: mapping.question_id, active: true }
      });
      if (qData) {
        questionEntity = qData;
      }
    } catch (qErr) {
      logger.error('Failed to fetch single question:', qErr);
    }
  }

  // Try series range match if no exact match (series → question, like Java RFID_RAG)
  if (!questionEntity) {
    try {
      const series = await prisma.rfid_series.findFirst({
        where: {
          start_uid: { lte: normalizedUid },
          end_uid: { gte: normalizedUid },
          status: 1
        },
        orderBy: { priority: 'desc' },
        include: {
          rfid_question: true
        }
      });

      if (series?.rfid_question) {
        questionEntity = series.rfid_question;
        logger.info('Found question via series range match:', { rfidUid: normalizedUid, title: questionEntity.title });
      }
    } catch (seriesErr) {
      logger.error('Failed to lookup series for content:', seriesErr);
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
  if (!rfidUid || !rfidUid.trim()) {
    logger.warn('getContentDownloadManifest called with empty rfidUid');
    return null;
  }

  const normalizedUid = rfidUid.toUpperCase().replace(/[^0-9A-F]/g, '');

  // Lookup card mapping
  let mapping = null;
  try {
    mapping = await prisma.rfid_card_mapping.findFirst({
      where: { rfid_uid: normalizedUid, active: true }
    });
  } catch (err) {
    logger.error('Failed to lookup card mapping:', err);
  }

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
 * @param {number|BigInt} contentPackId - Content pack ID
 * @param {string} rfidUid - RFID UID for response
 * @returns {Promise<Object|null>} ContentDownloadDTO or null
 */
const getContentDownloadManifestByPackId = async (contentPackId, rfidUid) => {
  // Get content pack
  let contentPack = null;
  try {
    contentPack = await prisma.rfid_content_pack.findFirst({
      where: { id: BigInt(contentPackId), active: true }
    });
  } catch (err) {
    logger.error('Failed to fetch content pack for manifest:', err);
  }

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
  logger.info('Updating cached audio URL:', { packCode, sequence, audioUrl });

  try {
    // Get pack by packCode
    const contentPack = await prisma.rfid_content_pack.findFirst({
      where: { pack_code: packCode },
      select: { id: true, cached_audio_urls: true }
    });

    if (!contentPack) {
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
    await prisma.rfid_content_pack.updateMany({
      where: { id: contentPack.id },
      data: { cached_audio_urls: updatedJson, update_date: new Date() }
    });

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
  const offset = (page - 1) * limit;

  const where = {};

  if (packCode) where.pack_code = { contains: packCode, mode: 'insensitive' };
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (contentType) where.content_type = contentType;
  if (language) where.language = language;
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const [total, packs] = await Promise.all([
      prisma.rfid_content_pack.count({ where }),
      prisma.rfid_content_pack.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: packs.map(transformContentPackToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  } catch (error) {
    logger.error('Failed to fetch content packs:', error);
    throw new Error('Failed to fetch content packs');
  }
};

/**
 * Get all content packs (no pagination)
 */
const getContentPackList = async ({ packCode, name, contentType, language, active } = {}) => {
  const where = {};

  if (packCode) where.pack_code = { contains: packCode, mode: 'insensitive' };
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (contentType) where.content_type = contentType;
  if (language) where.language = language;
  if (active !== undefined && active !== null && active !== '') {
    where.active = active === true || active === 'true' || active === '1';
  }

  try {
    const packs = await prisma.rfid_content_pack.findMany({
      where,
      orderBy: { name: 'asc' }
    });
    return packs.map(transformContentPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch content packs:', error);
    throw new Error('Failed to fetch content packs');
  }
};

/**
 * Get content pack by pack code
 */
const getContentPackByCode = async (packCode) => {
  try {
    const pack = await prisma.rfid_content_pack.findFirst({
      where: { pack_code: packCode }
    });

    if (!pack) return null;

    // Fetch associated items
    let items = [];
    try {
      items = await prisma.content_item.findMany({
        where: { content_pack_id: pack.id },
        orderBy: { item_number: 'asc' }
      });
    } catch (itemsError) {
      logger.error('Failed to fetch content items:', itemsError);
      // Non-fatal, continue without items
    }

    // Transform pack to camelCase
    const transformedPack = transformContentPackToCamelCase(pack);

    // Add items array (transformed to camelCase)
    // Note: content_item has no image_url or content_text columns
    if (items && items.length > 0) {
      transformedPack.items = items.map(item => ({
        id: Number(item.id),
        sequence: item.item_number,
        title: item.title,
        text: item.lyrics_text || '',  // lyrics_text is the text field in schema
        audioUrl: item.audio_url,
        imageUrl: item.image_url || null,
        active: item.active
      }));
    } else {
      transformedPack.items = [];
    }

    return transformedPack;
  } catch (error) {
    logger.error('Failed to fetch content pack by code:', error);
    throw new Error('Failed to fetch content pack');
  }
};

/**
 * Get all active content packs
 */
const getAllActiveContentPacks = async () => {
  try {
    const packs = await prisma.rfid_content_pack.findMany({
      where: { active: true },
      orderBy: { name: 'asc' }
    });
    return packs.map(transformContentPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch active content packs:', error);
    throw new Error('Failed to fetch active content packs');
  }
};

/**
 * Get content packs by content type
 */
const getContentPacksByType = async (contentType) => {
  try {
    const packs = await prisma.rfid_content_pack.findMany({
      where: { content_type: contentType, active: true },
      orderBy: { name: 'asc' }
    });
    return packs.map(transformContentPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch content packs by type:', error);
    throw new Error('Failed to fetch content packs');
  }
};

/**
 * Get content packs by language
 */
const getContentPacksByLanguage = async (language) => {
  try {
    const packs = await prisma.rfid_content_pack.findMany({
      where: { language, active: true },
      orderBy: { name: 'asc' }
    });
    return packs.map(transformContentPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch content packs by language:', error);
    throw new Error('Failed to fetch content packs');
  }
};

/**
 * Create content pack with packCode uniqueness check
 */
const createContentPack = async (data, userId) => {
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
    creator: userId ? BigInt(userId) : null,
  };

  let newPack = null;
  try {
    newPack = await prisma.rfid_content_pack.create({ data: insertData });
  } catch (error) {
    logger.error('Failed to create content pack:', error);
    if (error.code === 'P2002') {
      throw new Error('Content pack with this code already exists');
    }
    throw new Error('Failed to create content pack');
  }

  // Insert Items (if any)
  if (data.items && Array.isArray(data.items) && data.items.length > 0) {
    logger.info(`[createContentPack] Inserting ${data.items.length} items for pack ID ${newPack.id}`);

    const itemsData = data.items.map((item, index) => ({
      content_pack_id: newPack.id,
      item_number: index + 1, // Ensure sequence is correct
      title: item.title,
      audio_url: item.audioUrl || null,
      image_url: item.imageUrl || null,
      lyrics_text: item.text || item.lyricsText || null,
      creator: userId ? BigInt(userId) : null,
      active: true
    }));

    logger.info('[createContentPack] Items data to insert:', JSON.stringify(itemsData.map(i => ({ ...i, content_pack_id: String(i.content_pack_id), creator: i.creator ? String(i.creator) : null })), null, 2));

    try {
      await prisma.content_item.createMany({ data: itemsData });
      logger.info(`[createContentPack] Successfully inserted ${itemsData.length} items`);

      // Update total_items count in the pack
      await prisma.rfid_content_pack.updateMany({
        where: { id: newPack.id },
        data: { total_items: itemsData.length }
      });

      logger.info(`[createContentPack] Updated total_items to ${itemsData.length}`);
    } catch (itemsError) {
      logger.error('[createContentPack] Failed to create content items:', itemsError);
      // Non-fatal, but good to know
    }
  } else {
    logger.info('[createContentPack] No items to insert');
  }

  return null;
};

/**
 * Update content pack by id
 */
const updateContentPack = async (data, userId) => {
  if (!data.id) {
    throw new Error('Content pack ID is required');
  }

  const updateData = {
    updater: userId ? BigInt(userId) : null,
    update_date: new Date(),
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

  try {
    await prisma.rfid_content_pack.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update content pack:', error);
    if (error.code === 'P2002') {
      throw new Error('Content pack with this code already exists');
    }
    throw new Error('Failed to update content pack');
  }

  // Update Items (Delete All + Re-insert) — only if items array is provided
  if (data.items && Array.isArray(data.items)) {
    // Delete existing
    try {
      await prisma.content_item.deleteMany({
        where: { content_pack_id: BigInt(data.id) }
      });
    } catch (delErr) {
      logger.error('Failed to delete existing content items:', delErr);
    }

    // Insert new
    if (data.items.length > 0) {
      const itemsData = data.items.map((item, index) => ({
        content_pack_id: BigInt(data.id),
        item_number: index + 1,
        title: item.title,
        audio_url: item.audioUrl || null,
        image_url: item.imageUrl || null,
        lyrics_text: item.text || item.lyricsText || null,
        updater: userId ? BigInt(userId) : null,
        active: true
      }));

      try {
        await prisma.content_item.createMany({ data: itemsData });
      } catch (itemsError) {
        logger.error('Failed to update content items:', itemsError);
      }
    }
  }

  return null;
};

/**
 * Delete content packs by IDs
 */
const deleteContentPacks = async (ids) => {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Content pack IDs are required');
  }

  try {
    await prisma.rfid_content_pack.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete content packs:', error);
    throw new Error('Failed to delete content packs');
  }

  return null;
};

// =============================================
// Question Pack CRUD Methods
// =============================================

/**
 * Transform rfid_question_pack row to camelCase DTO
 */
const transformQuestionPackToCamelCase = (pack) => {
  if (!pack) return null;
  return {
    id: pack.id ? Number(pack.id) : null,
    packCode: pack.pack_code,
    name: pack.name,
    description: pack.description,
    questionIds: pack.question_ids || [],
    language: pack.language,
    category: pack.category,
    version: pack.version,
    status: pack.status,
    active: pack.active,
    createDate: formatDate(pack.create_date),
    updateDate: formatDate(pack.update_date),
  };
};

/**
 * Get question packs with pagination
 */
const getQuestionPackPage = async ({ page = 1, limit = 10, packCode, name, category, language, active } = {}) => {
  const offset = (page - 1) * limit;
  const where = {};
  if (packCode) where.pack_code = { contains: packCode, mode: 'insensitive' };
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (category) where.category = { contains: category, mode: 'insensitive' };
  if (language) where.language = language;
  if (active !== undefined && active !== null && active !== '') {
    where.active = (active === true || active === 'true' || active === '1');
  }

  try {
    const [total, packs] = await Promise.all([
      prisma.rfid_question_pack.count({ where }),
      prisma.rfid_question_pack.findMany({
        where,
        orderBy: { create_date: 'desc' },
        skip: offset,
        take: limit
      })
    ]);
    return {
      list: packs.map(transformQuestionPackToCamelCase),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  } catch (error) {
    logger.error('Failed to fetch question packs:', error);
    throw new Error('Failed to fetch question packs');
  }
};

/**
 * Get all question packs (no pagination)
 */
const getQuestionPackList = async ({ packCode, name, category, language, active } = {}) => {
  const where = {};
  if (packCode) where.pack_code = { contains: packCode, mode: 'insensitive' };
  if (name) where.name = { contains: name, mode: 'insensitive' };
  if (category) where.category = { contains: category, mode: 'insensitive' };
  if (language) where.language = language;
  if (active !== undefined && active !== null && active !== '') {
    where.active = (active === true || active === 'true' || active === '1');
  }

  try {
    const packs = await prisma.rfid_question_pack.findMany({ where, orderBy: { create_date: 'desc' } });
    return packs.map(transformQuestionPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch question pack list:', error);
    throw new Error('Failed to fetch question pack list');
  }
};

/**
 * Get question pack by pack code
 */
const getQuestionPackByCode = async (packCode) => {
  try {
    const pack = await prisma.rfid_question_pack.findFirst({ where: { pack_code: packCode } });
    return transformQuestionPackToCamelCase(pack);
  } catch (error) {
    logger.error('Failed to fetch question pack by code:', error);
    throw new Error('Failed to fetch question pack');
  }
};

/**
 * Get all active question packs
 */
const getAllActiveQuestionPacks = async () => {
  try {
    const packs = await prisma.rfid_question_pack.findMany({
      where: { active: true },
      orderBy: { name: 'asc' }
    });
    return packs.map(transformQuestionPackToCamelCase);
  } catch (error) {
    logger.error('Failed to fetch active question packs:', error);
    return [];
  }
};

/**
 * Create question pack with inline question support
 * Creates questions in rfid_question table and stores their IDs in rfid_question_pack.question_ids
 */
const createQuestionPack = async (data, userId) => {
  let finalQuestionIds = data.questionIds || [];

  // Handle inline questions — insert into rfid_question first
  if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
    const newQuestions = data.questions.map((q, index) => {
      const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const qCode = `${data.packCode}_Q${index + 1}_${suffix}`;
      return {
        code: qCode,
        title: q.text ? (q.text.length > 50 ? q.text.substring(0, 47) + '...' : q.text) : `Question ${index + 1}`,
        prompt_text: q.text,
        language: data.language || 'en',
        category: data.category || 'general',
        difficulty: 1,
        active: true,
        creator: userId ? BigInt(userId) : null
      };
    });

    try {
      await prisma.rfid_question.createMany({ data: newQuestions, skipDuplicates: true });
      const codes = newQuestions.map(q => q.code);
      const createdQs = await prisma.rfid_question.findMany({
        where: { code: { in: codes } },
        select: { id: true }
      });
      const newIds = createdQs.map(q => Number(q.id));
      finalQuestionIds = [...finalQuestionIds, ...newIds];
      logger.info(`Created ${newIds.length} inline questions for pack ${data.packCode}`);
    } catch (qError) {
      logger.error('Failed to create inline questions:', qError);
      throw new Error('Failed to create inline questions: ' + qError.message);
    }
  }

  // Check pack_code uniqueness
  const existing = await prisma.rfid_question_pack.findFirst({ where: { pack_code: data.packCode } });
  if (existing) {
    throw new Error(`Question pack with code "${data.packCode}" already exists`);
  }

  try {
    await prisma.rfid_question_pack.create({
      data: {
        pack_code: data.packCode,
        name: data.name || data.packCode,
        description: data.description || null,
        question_ids: finalQuestionIds,
        language: data.language || 'en',
        category: data.category || 'general',
        version: data.version || '1',
        active: true,
        status: 1,
        creator: userId ? BigInt(userId) : null,
      }
    });
    logger.info(`Created question pack: ${data.packCode} with ${finalQuestionIds.length} questions`);
  } catch (error) {
    logger.error('Failed to create question pack:', error);
    throw new Error('Failed to create question pack');
  }

  return null;
};

/**
 * Update question pack by id
 */
const updateQuestionPack = async (data, userId) => {
  if (!data.id) {
    throw new Error('Question pack ID is required');
  }

  const updateData = { update_date: new Date() };
  if (data.packCode !== undefined) updateData.pack_code = data.packCode;
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.questionIds !== undefined) updateData.question_ids = data.questionIds;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.version !== undefined) updateData.version = data.version;
  if (data.active !== undefined) updateData.active = data.active;
  if (userId) updateData.updater = BigInt(userId);

  try {
    await prisma.rfid_question_pack.updateMany({
      where: { id: BigInt(data.id) },
      data: updateData
    });
  } catch (error) {
    logger.error('Failed to update question pack:', error);
    throw new Error('Failed to update question pack');
  }
  return null;
};

/**
 * Delete question packs by IDs
 */
const deleteQuestionPacks = async (ids) => {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Question pack IDs are required');
  }

  try {
    await prisma.rfid_question_pack.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    });
  } catch (error) {
    logger.error('Failed to delete question packs:', error);
    throw new Error('Failed to delete question packs');
  }
  return null;
};

/**
 * Get RFID mapping options for dropdowns
 * Returns combined list of questions, packs, content packs, and question packs
 */
const getRfidMappingOptions = async () => {
  try {
    const [questions, packs, contentPacks, questionPacks] = await Promise.all([
      prisma.rfid_question.findMany({
        where: { active: true },
        select: { id: true, code: true, title: true },
        orderBy: { title: 'asc' }
      }),
      prisma.rfid_pack.findMany({
        where: { status: 1 },
        select: { id: true, pack_code: true, pack_name: true },
        orderBy: { pack_name: 'asc' }
      }),
      prisma.rfid_content_pack.findMany({
        where: { active: true },
        select: { id: true, pack_code: true, name: true },
        orderBy: { name: 'asc' }
      }),
      prisma.rfid_question_pack.findMany({
        where: { active: true },
        select: { id: true, pack_code: true, name: true },
        orderBy: { name: 'asc' }
      })
    ]);

    return {
      questions: questions.map(q => ({ id: Number(q.id), name: q.title, code: q.code })),
      packs: packs.map(p => ({ id: Number(p.id), name: p.pack_name, code: p.pack_code })),
      contentPacks: contentPacks.map(cp => ({ id: Number(cp.id), name: cp.name, code: cp.pack_code })),
      questionPacks: questionPacks.map(qp => ({ id: Number(qp.id), name: qp.name, code: qp.pack_code }))
    };
  } catch (error) {
    logger.error('Failed to fetch RFID mapping options:', error);
    throw new Error('Failed to fetch RFID mapping options');
  }
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

  // Question Pack CRUD (NOTE: rfid_question_pack table does not exist — graceful stubs)
  getQuestionPackPage,
  getQuestionPackList,
  getQuestionPackByCode,
  getAllActiveQuestionPacks,
  createQuestionPack,
  updateQuestionPack,
  deleteQuestionPacks,
  transformQuestionPackToCamelCase,
  getRfidMappingOptions,
};
