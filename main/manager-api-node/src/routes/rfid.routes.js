/**
 * RFID Routes
 *
 * Handles RFID card mapping management and lookups.
 * Base path: /admin/rfid
 *
 * PRD-specified endpoints:
 * - GET /admin/rfid/card/page - List cards (paginated)
 * - GET /admin/rfid/card/list - List all cards
 * - GET /admin/rfid/card/lookup/:rfidUid - Lookup by UID (public)
 * - POST /admin/rfid/card - Create mapping (admin)
 * - PUT /admin/rfid/card - Update mapping (admin)
 * - DELETE /admin/rfid/card - Delete mapping (admin)
 * - GET /admin/rfid/series/lookup/:uid - Series lookup (public)
 * - GET /admin/rfid/pack/list - List packs
 * - POST /admin/rfid/pack - Create pack (admin)
 */

const express = require('express');
const router = express.Router();
const rfidService = require('../services/rfid.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

// =============================================
// Card Mapping Routes (PRD-specified)
// =============================================

/**
 * @swagger
 * /admin/rfid/card/page:
 *   get:
 *     tags: [RFID]
 *     summary: Get card mappings (paginated)
 *     description: Returns paginated list of RFID card to content mappings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: packCode
 *         schema:
 *           type: string
 *         description: Filter by pack code
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Paginated card mapping list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 msg:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CardMapping'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get('/card/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, packCode, active } = req.query;
    const result = await rfidService.getCardMappingPage({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      packCode,
      active: active === 'true' ? true : active === 'false' ? false : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/card/list:
 *   get:
 *     tags: [RFID]
 *     summary: Get all card mappings
 *     description: Returns all RFID card mappings without pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: packCode
 *         schema:
 *           type: string
 *         description: Filter by pack code
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Card mapping list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CardMapping'
 */
router.get('/card/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { packCode, active } = req.query;
    const result = await rfidService.getCardMappingList({
      packCode,
      active: active === 'true' ? true : active === 'false' ? false : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/card/lookup/{rfidUid}:
 *   get:
 *     tags: [RFID]
 *     summary: Lookup card mapping by RFID UID
 *     description: Public endpoint for ESP32 devices to lookup card content. Also checks series mappings if no exact match.
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *         description: RFID UID (hex string, colons/dashes optional)
 *         example: "04:A3:B2:C1:D0:00:00"
 *     responses:
 *       200:
 *         description: Card mapping with question data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/CardMappingLookup'
 *       404:
 *         description: Card mapping not found
 */
router.get('/card/lookup/:rfidUid',
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;

    if (!rfidUid) {
      return badRequest(res, 'RFID UID is required');
    }

    const card = await rfidService.lookupCardByUid(rfidUid);
    if (!card) {
      return notFound(res, 'Card mapping not found');
    }
    success(res, card);
  })
);

/**
 * @swagger
 * /admin/rfid/card/rag-lookup/{rfidUid}:
 *   post:
 *     tags: [RFID]
 *     summary: RAG-powered card lookup by RFID UID
 *     description: |
 *       Enhanced lookup using Retrieval-Augmented Generation (RAG).
 *       When a card has a content_pack_id and an embedding is provided,
 *       performs semantic search via Qdrant to find related questions.
 *       Also returns emotion tags if available.
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *         description: RFID UID (hex string, colons/dashes optional)
 *         example: "04:A3:B2:C1:D0:00:00"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               embedding:
 *                 type: array
 *                 items:
 *                   type: number
 *                 description: Pre-computed query embedding vector (1536 dimensions for ada-002)
 *               queryText:
 *                 type: string
 *                 description: Original text query (for logging/debugging)
 *               includeRag:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to include RAG results
 *     responses:
 *       200:
 *         description: Card mapping with RAG-enhanced results and emotion tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/CardMappingLookup'
 *                     - type: object
 *                       properties:
 *                         rag_results:
 *                           type: array
 *                           description: Semantically similar content from Qdrant
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               score:
 *                                 type: number
 *                                 description: Similarity score (0-1)
 *                               content:
 *                                 type: string
 *                               title:
 *                                 type: string
 *                               category:
 *                                 type: string
 *                               emotion:
 *                                 type: string
 *                               language:
 *                                 type: string
 *                         emotions:
 *                           type: array
 *                           description: Extracted emotion tags from RAG results
 *                           items:
 *                             type: string
 *                           example: ["happy", "curious", "excited"]
 *                         emotion:
 *                           type: string
 *                           description: Primary emotion from content pack
 *       404:
 *         description: Card mapping not found
 */
router.post('/card/rag-lookup/:rfidUid',
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;
    const { embedding, queryText, includeRag = true } = req.body;

    if (!rfidUid) {
      return badRequest(res, 'RFID UID is required');
    }

    const card = await rfidService.lookupCardWithRag(rfidUid, {
      queryEmbedding: embedding,
      queryText,
      includeRag
    });

    if (!card) {
      return notFound(res, 'Card mapping not found');
    }

    success(res, card);
  })
);

/**
 * @swagger
 * /admin/rfid/rag/search:
 *   post:
 *     tags: [RFID]
 *     summary: RAG semantic search
 *     description: |
 *       Perform semantic search in the RFID content vector database.
 *       Requires a pre-computed embedding vector and returns matching content.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - embedding
 *             properties:
 *               embedding:
 *                 type: array
 *                 items:
 *                   type: number
 *                 description: Query embedding vector (1536 dimensions for ada-002)
 *               contentPackId:
 *                 type: integer
 *                 description: Filter results to a specific content pack
 *               language:
 *                 type: string
 *                 description: Filter by language code (en, es, etc.)
 *               limit:
 *                 type: integer
 *                 default: 5
 *                 description: Maximum results to return
 *               scoreThreshold:
 *                 type: number
 *                 default: 0.7
 *                 description: Minimum similarity score (0-1)
 *     responses:
 *       200:
 *         description: RAG search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       score:
 *                         type: number
 *                       payload:
 *                         type: object
 *       400:
 *         description: Embedding vector required
 */
router.post('/rag/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { embedding, contentPackId, language, limit, scoreThreshold } = req.body;

    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      return badRequest(res, 'Embedding vector is required');
    }

    const results = await rfidService.ragSearch({
      embedding,
      contentPackId,
      language,
      limit: parseInt(limit) || 5,
      scoreThreshold: parseFloat(scoreThreshold) || 0.7
    });

    success(res, results);
  })
);

/**
 * @swagger
 * /admin/rfid/content-pack/{id}:
 *   get:
 *     tags: [RFID]
 *     summary: Get content pack by ID
 *     description: Retrieve content pack details for RAG content management
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Content pack ID
 *     responses:
 *       200:
 *         description: Content pack details
 *       404:
 *         description: Content pack not found
 */
router.get('/content-pack/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pack = await rfidService.getContentPack(parseInt(id));
    if (!pack) {
      return notFound(res, 'Content pack not found');
    }

    success(res, pack);
  })
);

/**
 * @swagger
 * /admin/rfid/card:
 *   post:
 *     tags: [RFID]
 *     summary: Create card mapping
 *     description: Create a new RFID card to content mapping (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rfidUid
 *             properties:
 *               rfidUid:
 *                 type: string
 *                 description: RFID UID (hex string)
 *                 example: "04A3B2C1D00000"
 *               questionId:
 *                 type: integer
 *                 description: Primary question ID
 *               questionIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Multiple question IDs for multi-question support
 *               packCode:
 *                 type: string
 *                 description: Pack code identifier
 *               packId:
 *                 type: integer
 *                 description: Pack ID
 *               contentPackId:
 *                 type: integer
 *                 description: Content pack ID for RAG
 *               notes:
 *                 type: string
 *                 description: Admin notes
 *               active:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Card mapping created
 *       400:
 *         description: Validation error or duplicate UID
 */
router.post('/card',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.body;

    if (!rfidUid) {
      return badRequest(res, 'RFID UID is required');
    }

    try {
      const card = await rfidService.createCardMapping(req.body, req.user.id);
      success(res, card, 'Card mapping created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/card:
 *   put:
 *     tags: [RFID]
 *     summary: Update card mapping
 *     description: Update an existing RFID card mapping (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Card mapping ID
 *               rfidUid:
 *                 type: string
 *                 description: RFID UID (hex string)
 *               questionId:
 *                 type: integer
 *               questionIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               packCode:
 *                 type: string
 *               packId:
 *                 type: integer
 *               contentPackId:
 *                 type: integer
 *               notes:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Card mapping updated
 *       400:
 *         description: Validation error
 */
router.put('/card',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.body;

    if (!id) {
      return badRequest(res, 'Card mapping ID is required');
    }

    try {
      const card = await rfidService.updateCardMapping(req.body, req.user.id);
      success(res, card, 'Card mapping updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/card:
 *   delete:
 *     tags: [RFID]
 *     summary: Delete card mapping
 *     description: Delete an RFID card mapping (admin only). Provide either id or rfidUid.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Card mapping ID
 *               rfidUid:
 *                 type: string
 *                 description: RFID UID (alternative to id)
 *     responses:
 *       200:
 *         description: Card mapping deleted
 *       400:
 *         description: ID or RFID UID required
 */
router.delete('/card',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id, rfidUid } = req.body;

    if (!id && !rfidUid) {
      return badRequest(res, 'Card mapping ID or RFID UID is required');
    }

    try {
      await rfidService.deleteCardMapping({ id, rfidUid });
      success(res, null, 'Card mapping deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// =============================================
// Series Lookup Routes
// =============================================

/**
 * @swagger
 * /admin/rfid/series/lookup/{uid}:
 *   get:
 *     tags: [RFID]
 *     summary: Lookup series mapping by UID
 *     description: Public endpoint to check if UID falls within a series range
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *         description: RFID UID to check against series ranges
 *     responses:
 *       200:
 *         description: Series mapping found
 *       404:
 *         description: No series mapping found
 */
router.get('/series/lookup/:uid',
  asyncHandler(async (req, res) => {
    const { uid } = req.params;

    if (!uid) {
      return badRequest(res, 'UID is required');
    }

    const series = await rfidService.lookupSeriesByUid(uid);
    if (!series) {
      return notFound(res, 'No series mapping found for this UID');
    }
    success(res, series);
  })
);

// =============================================
// Pack Management Routes
// =============================================

/**
 * @swagger
 * /admin/rfid/pack/list:
 *   get:
 *     tags: [RFID]
 *     summary: List RFID packs
 *     description: Returns list of RFID product packs/SKUs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Pack list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RfidPack'
 */
router.get('/pack/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { active } = req.query;
    const result = await rfidService.getPackList({
      active: active === 'true' ? true : active === 'false' ? false : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/pack:
 *   post:
 *     tags: [RFID]
 *     summary: Create RFID pack
 *     description: Create a new RFID product pack (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - packCode
 *               - name
 *             properties:
 *               packCode:
 *                 type: string
 *                 description: Unique pack identifier
 *                 example: "ANIMALS_PACK_1"
 *               name:
 *                 type: string
 *                 description: Pack display name
 *               description:
 *                 type: string
 *               ageMin:
 *                 type: integer
 *                 description: Minimum recommended age
 *               ageMax:
 *                 type: integer
 *                 description: Maximum recommended age
 *               active:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Pack created
 *       400:
 *         description: Validation error or duplicate code
 */
router.post('/pack',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { packCode, name } = req.body;

    if (!packCode) {
      return badRequest(res, 'Pack code is required');
    }
    if (!name) {
      return badRequest(res, 'Pack name is required');
    }

    try {
      const pack = await rfidService.createPack(req.body, req.user.id);
      success(res, pack, 'Pack created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/pack/{id}:
 *   get:
 *     tags: [RFID]
 *     summary: Get pack by ID
 *     description: Retrieve RFID pack details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Pack ID
 *     responses:
 *       200:
 *         description: Pack details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/RfidPack'
 *       404:
 *         description: Pack not found
 */
router.get('/pack/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const pack = await rfidService.getPackById(parseInt(id));
    if (!pack) {
      return notFound(res, 'Pack not found');
    }

    success(res, pack);
  })
);

/**
 * @swagger
 * /admin/rfid/pack:
 *   put:
 *     tags: [RFID]
 *     summary: Update RFID pack
 *     description: Update an existing RFID pack (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Pack ID
 *               packCode:
 *                 type: string
 *                 description: Unique pack identifier
 *               name:
 *                 type: string
 *                 description: Pack display name
 *               description:
 *                 type: string
 *               ageMin:
 *                 type: integer
 *                 description: Minimum recommended age
 *               ageMax:
 *                 type: integer
 *                 description: Maximum recommended age
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Pack updated
 *       400:
 *         description: Validation error
 */
router.put('/pack',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.body;

    if (!id) {
      return badRequest(res, 'Pack ID is required');
    }

    try {
      const pack = await rfidService.updatePack(req.body, req.user.id);
      success(res, pack, 'Pack updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/pack/{id}:
 *   delete:
 *     tags: [RFID]
 *     summary: Delete RFID pack
 *     description: Delete an RFID pack (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Pack ID
 *     responses:
 *       200:
 *         description: Pack deleted
 *       400:
 *         description: Pack ID required
 */
router.delete('/pack/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return badRequest(res, 'Pack ID is required');
    }

    try {
      await rfidService.deletePack(parseInt(id));
      success(res, null, 'Pack deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// =============================================
// Series Management Routes
// =============================================

/**
 * @swagger
 * /admin/rfid/series/page:
 *   get:
 *     tags: [RFID]
 *     summary: Get series list (paginated)
 *     description: Returns paginated list of RFID series (UID range mappings)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: packId
 *         schema:
 *           type: integer
 *         description: Filter by pack ID
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Paginated series list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 msg:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/RfidSeries'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     pages:
 *                       type: integer
 */
router.get('/series/page',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, packId, active } = req.query;
    const result = await rfidService.getSeriesList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      packId: packId ? parseInt(packId) : undefined,
      active: active === 'true' ? true : active === 'false' ? false : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/series/list:
 *   get:
 *     tags: [RFID]
 *     summary: Get all series
 *     description: Returns all RFID series without pagination
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: packId
 *         schema:
 *           type: integer
 *         description: Filter by pack ID
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Series list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RfidSeries'
 */
router.get('/series/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { packId, active } = req.query;
    const result = await rfidService.getSeriesAll({
      packId: packId ? parseInt(packId) : undefined,
      active: active === 'true' ? true : active === 'false' ? false : undefined
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/series/{id}:
 *   get:
 *     tags: [RFID]
 *     summary: Get series by ID
 *     description: Retrieve RFID series details by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Series ID
 *     responses:
 *       200:
 *         description: Series details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 msg:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/RfidSeries'
 *       404:
 *         description: Series not found
 */
router.get('/series/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Skip if id is 'lookup' (handled by earlier route)
    if (id === 'lookup') {
      return notFound(res, 'Series not found');
    }

    const series = await rfidService.getSeriesById(parseInt(id));
    if (!series) {
      return notFound(res, 'Series not found');
    }

    success(res, series);
  })
);

/**
 * @swagger
 * /admin/rfid/series:
 *   post:
 *     tags: [RFID]
 *     summary: Create RFID series
 *     description: Create a new RFID series (UID range mapping) (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - startUid
 *               - endUid
 *             properties:
 *               name:
 *                 type: string
 *                 description: Series name
 *                 example: "Animal Cards Series 1"
 *               description:
 *                 type: string
 *                 description: Series description
 *               startUid:
 *                 type: string
 *                 description: Starting RFID UID (hex string)
 *                 example: "04A3B2C1D00000"
 *               endUid:
 *                 type: string
 *                 description: Ending RFID UID (hex string)
 *                 example: "04A3B2C1DFFFFF"
 *               questionId:
 *                 type: integer
 *                 description: Question ID to associate with this series
 *               packId:
 *                 type: integer
 *                 description: Pack ID this series belongs to
 *               priority:
 *                 type: integer
 *                 default: 0
 *                 description: Priority for overlapping ranges (higher wins)
 *               active:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Series created
 *       400:
 *         description: Validation error
 */
router.post('/series',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, startUid, endUid } = req.body;

    if (!name) {
      return badRequest(res, 'Series name is required');
    }
    if (!startUid) {
      return badRequest(res, 'Start UID is required');
    }
    if (!endUid) {
      return badRequest(res, 'End UID is required');
    }

    try {
      const series = await rfidService.createSeries(req.body, req.user.id);
      success(res, series, 'Series created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/series:
 *   put:
 *     tags: [RFID]
 *     summary: Update RFID series
 *     description: Update an existing RFID series (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Series ID
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               startUid:
 *                 type: string
 *               endUid:
 *                 type: string
 *               questionId:
 *                 type: integer
 *               packId:
 *                 type: integer
 *               priority:
 *                 type: integer
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Series updated
 *       400:
 *         description: Validation error
 */
router.put('/series',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.body;

    if (!id) {
      return badRequest(res, 'Series ID is required');
    }

    try {
      const series = await rfidService.updateSeries(req.body, req.user.id);
      success(res, series, 'Series updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/series/{id}:
 *   delete:
 *     tags: [RFID]
 *     summary: Delete RFID series
 *     description: Delete an RFID series (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Series ID
 *     responses:
 *       200:
 *         description: Series deleted
 *       400:
 *         description: Series ID required
 */
router.delete('/series/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return badRequest(res, 'Series ID is required');
    }

    try {
      await rfidService.deleteSeries(parseInt(id));
      success(res, null, 'Series deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// =============================================
// Legacy Routes (backward compatibility)
// =============================================

/**
 * @swagger
 * /admin/rfid/list:
 *   get:
 *     tags: [RFID Legacy]
 *     summary: Get RFID tags list (legacy)
 *     description: Legacy endpoint for RFID tag management
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: RFID tags list
 */
router.get('/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await rfidService.getRfidList({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/by-uid/{uid}:
 *   get:
 *     tags: [RFID Legacy]
 *     summary: Get RFID tag by UID (legacy)
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RFID tag details
 */
router.get('/by-uid/:uid',
  asyncHandler(async (req, res) => {
    const tag = await rfidService.getRfidByUid(req.params.uid);
    if (!tag) {
      return notFound(res, 'RFID tag not found');
    }
    success(res, tag);
  })
);

/**
 * @swagger
 * /admin/rfid/create:
 *   post:
 *     tags: [RFID Legacy]
 *     summary: Create RFID tag (legacy)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - uid
 *             properties:
 *               uid:
 *                 type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               contentType:
 *                 type: string
 *                 enum: [music, story, textbook, action]
 *               contentId:
 *                 type: string
 *               actionType:
 *                 type: string
 *                 enum: [play, pause, next, prev, volume_up, volume_down]
 *               actionParams:
 *                 type: object
 *     responses:
 *       200:
 *         description: RFID tag created
 */
router.post('/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.body.uid) {
      return badRequest(res, 'UID is required');
    }

    try {
      const tag = await rfidService.createRfid(req.user.id, req.body);
      success(res, tag, 'RFID tag created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/update/{id}:
 *   put:
 *     tags: [RFID Legacy]
 *     summary: Update RFID tag (legacy)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RFID tag updated
 */
router.put('/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const tag = await rfidService.updateRfid(req.params.id, req.body);
      success(res, tag, 'RFID tag updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/delete/{id}:
 *   delete:
 *     tags: [RFID Legacy]
 *     summary: Delete RFID tag (legacy)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RFID tag deleted
 */
router.delete('/delete/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await rfidService.deleteRfid(req.params.id);
      success(res, null, 'RFID tag deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/{id}:
 *   get:
 *     tags: [RFID Legacy]
 *     summary: Get RFID tag by ID (legacy)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: RFID tag details
 */
router.get('/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tag = await rfidService.getRfidById(req.params.id);
    if (!tag) {
      return notFound(res, 'RFID tag not found');
    }
    success(res, tag);
  })
);

/**
 * @swagger
 * /admin/rfid/scan/{mac}/{uid}:
 *   post:
 *     tags: [RFID Legacy]
 *     summary: Process RFID scan from device (legacy)
 *     description: Public endpoint for ESP32 to report RFID scans
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: path
 *         name: uid
 *         required: true
 *         schema:
 *           type: string
 *         description: RFID tag UID
 *     responses:
 *       200:
 *         description: Action to perform
 */
router.post('/scan/:mac/:uid',
  asyncHandler(async (req, res) => {
    const { mac, uid } = req.params;

    try {
      const result = await rfidService.processScan(mac, uid);
      success(res, result);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /admin/rfid/scan-logs:
 *   get:
 *     tags: [RFID Legacy]
 *     summary: Get RFID scan logs (legacy)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: mac
 *         schema:
 *           type: string
 *       - in: query
 *         name: uid
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scan logs
 */
router.get('/scan-logs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, mac, uid } = req.query;
    const result = await rfidService.getScanLogs({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      mac,
      uid
    });
    success(res, result);
  })
);

/**
 * @swagger
 * /admin/rfid/register-batch:
 *   post:
 *     tags: [RFID Legacy]
 *     summary: Register multiple RFID tags for a device (legacy)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *               - tags
 *             properties:
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               tags:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     name:
 *                       type: string
 *     responses:
 *       200:
 *         description: Registration results
 */
router.post('/register-batch',
  asyncHandler(async (req, res) => {
    const { mac, tags } = req.body;

    if (!mac || !tags || !Array.isArray(tags)) {
      return badRequest(res, 'MAC address and tags array are required');
    }

    try {
      const results = await rfidService.registerDeviceTags(mac, tags);
      success(res, results, `Processed ${results.length} tags`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// =============================================
// Swagger Component Schemas
// =============================================

/**
 * @swagger
 * components:
 *   schemas:
 *     CardMapping:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         rfid_uid:
 *           type: string
 *         question_id:
 *           type: integer
 *         question_ids:
 *           type: array
 *           items:
 *             type: integer
 *         pack_code:
 *           type: string
 *         pack_id:
 *           type: integer
 *         content_pack_id:
 *           type: integer
 *         notes:
 *           type: string
 *         active:
 *           type: boolean
 *         create_date:
 *           type: string
 *           format: date-time
 *         question:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             code:
 *               type: string
 *             title:
 *               type: string
 *         pack:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             pack_code:
 *               type: string
 *             name:
 *               type: string
 *     CardMappingLookup:
 *       allOf:
 *         - $ref: '#/components/schemas/CardMapping'
 *         - type: object
 *           properties:
 *             questions:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   code:
 *                     type: string
 *                   title:
 *                     type: string
 *                   prompt_text:
 *                     type: string
 *                   language:
 *                     type: string
 *             rag_results:
 *               type: array
 *               description: Semantically similar content from Qdrant (RAG)
 *               items:
 *                 $ref: '#/components/schemas/RagResult'
 *             emotions:
 *               type: array
 *               description: Extracted emotion tags from RAG results
 *               items:
 *                 type: string
 *               example: ["happy", "curious", "excited"]
 *             emotion:
 *               type: string
 *               description: Primary emotion tag from content pack
 *               example: "curious"
 *     RagResult:
 *       type: object
 *       description: RAG semantic search result
 *       properties:
 *         id:
 *           type: string
 *           description: Qdrant point ID
 *         score:
 *           type: number
 *           description: Cosine similarity score (0-1)
 *           example: 0.87
 *         content:
 *           type: string
 *           description: The matched content text
 *         title:
 *           type: string
 *           description: Content title
 *         category:
 *           type: string
 *           description: Content category
 *         emotion:
 *           type: string
 *           description: Emotion tag for this content
 *           example: "happy"
 *         language:
 *           type: string
 *           description: Content language code
 *           example: "en"
 *     RfidPack:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         pack_code:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         age_min:
 *           type: integer
 *         age_max:
 *           type: integer
 *         active:
 *           type: boolean
 *         create_date:
 *           type: string
 *           format: date-time
 *     ContentPack:
 *       type: object
 *       description: RFID content pack for RAG/TTS
 *       properties:
 *         id:
 *           type: integer
 *         pack_code:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         content_type:
 *           type: string
 *           enum: [read_only, prompt]
 *           description: read_only for TTS, prompt for LLM interaction
 *         content_md:
 *           type: string
 *           description: Full markdown content
 *         total_items:
 *           type: integer
 *         language:
 *           type: string
 *           example: "en"
 *         active:
 *           type: boolean
 *         create_date:
 *           type: string
 *           format: date-time
 *     RfidSeries:
 *       type: object
 *       description: RFID series for UID range mappings
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *           description: Series name
 *         description:
 *           type: string
 *         start_uid:
 *           type: string
 *           description: Starting RFID UID (normalized hex)
 *         end_uid:
 *           type: string
 *           description: Ending RFID UID (normalized hex)
 *         question_id:
 *           type: integer
 *         pack_id:
 *           type: integer
 *         priority:
 *           type: integer
 *           description: Priority for overlapping ranges (higher wins)
 *         active:
 *           type: boolean
 *         create_date:
 *           type: string
 *           format: date-time
 *         question:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             code:
 *               type: string
 *             title:
 *               type: string
 *             prompt_text:
 *               type: string
 *             language:
 *               type: string
 *         pack:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             pack_code:
 *               type: string
 *             name:
 *               type: string
 */

module.exports = router;
