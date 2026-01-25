/**
 * TTS Voice Routes (Timbre Management)
 *
 * Matches Spring Boot TimbreController at /ttsVoice
 * All endpoints require sys:role:superAdmin permission
 */

const express = require('express');
const router = express.Router();
const modelService = require('../services/model.service');
const { success, badRequest, paginated } = require('../utils/response');
const { requireAdmin } = require('../middleware/auth');
const asyncHandler = require('express-async-handler');

/**
 * Transform database record to camelCase VO format
 * Matches Spring Boot TimbreDetailsVO
 */
const transformTimbreToCamelCase = (record) => {
  if (!record) return null;
  return {
    id: record.id,
    languages: record.languages,
    name: record.name,
    remark: record.remark,
    referenceAudio: record.reference_audio,
    referenceText: record.reference_text,
    sort: record.sort || 0,
    ttsModelId: record.tts_model_id,
    ttsVoice: record.tts_voice,
    voiceDemo: record.voice_demo
  };
};

/**
 * @swagger
 * /ttsVoice:
 *   get:
 *     tags: [TTS Voice (Timbre)]
 *     summary: Paginated search
 *     description: Get paginated list of TTS voices filtered by TTS model ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: ttsModelId
 *         required: true
 *         schema:
 *           type: string
 *         description: Corresponding TTS Model Primary Key
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Timbre name (fuzzy match)
 *       - in: query
 *         name: page
 *         required: true
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Current page number (from 1)
 *       - in: query
 *         name: limit
 *         required: true
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Per page display record count
 *     responses:
 *       200:
 *         description: Paginated list of TTS voices
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
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/TimbreDetailsVO'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { ttsModelId, name, page = '1', limit = '10' } = req.query;

    if (!ttsModelId) {
      return badRequest(res, 'ttsModelId is required');
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const result = await modelService.getTtsVoicesPage(ttsModelId, name, pageNum, limitNum);

    // Transform records to camelCase
    const transformedList = (result.list || []).map(transformTimbreToCamelCase);

    return paginated(res, transformedList, result.total, pageNum, limitNum);
  })
);

/**
 * @swagger
 * /ttsVoice:
 *   post:
 *     tags: [TTS Voice (Timbre)]
 *     summary: Save timbre
 *     description: Create a new TTS voice configuration
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TimbreDataDTO'
 *     responses:
 *       200:
 *         description: Timbre created successfully
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
 *                   type: null
 */
router.post('/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { languages, name, ttsModelId, ttsVoice } = req.body;

    // Validate required fields per TimbreDataDTO
    if (!languages) {
      return badRequest(res, 'languages is required');
    }
    if (!name) {
      return badRequest(res, 'name is required');
    }
    if (!ttsModelId) {
      return badRequest(res, 'ttsModelId is required');
    }
    if (!ttsVoice) {
      return badRequest(res, 'ttsVoice is required');
    }

    try {
      await modelService.createTimbre(req.user.id, req.body);
      // Spring Boot returns Result<Void> (null data)
      return success(res, null);
    } catch (error) {
      return badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /ttsVoice/{id}:
 *   put:
 *     tags: [TTS Voice (Timbre)]
 *     summary: Modify timbre
 *     description: Update an existing TTS voice configuration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Timbre ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TimbreDataDTO'
 *     responses:
 *       200:
 *         description: Timbre updated successfully
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
 *                   type: null
 */
router.put('/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { languages, name, ttsModelId, ttsVoice } = req.body;

    // Validate required fields per TimbreDataDTO
    if (!languages) {
      return badRequest(res, 'languages is required');
    }
    if (!name) {
      return badRequest(res, 'name is required');
    }
    if (!ttsModelId) {
      return badRequest(res, 'ttsModelId is required');
    }
    if (!ttsVoice) {
      return badRequest(res, 'ttsVoice is required');
    }

    try {
      await modelService.updateTimbre(id, req.user.id, req.body);
      // Spring Boot returns Result<Void> (null data)
      return success(res, null);
    } catch (error) {
      return badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /ttsVoice/delete:
 *   post:
 *     tags: [TTS Voice (Timbre)]
 *     summary: Delete timbre
 *     description: Delete one or more TTS voice configurations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: string
 *             description: Array of timbre IDs to delete
 *     responses:
 *       200:
 *         description: Timbre(s) deleted successfully
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
 *                   type: null
 */
router.post('/delete',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'Array of IDs is required');
    }

    try {
      await modelService.deleteTimbreBatch(ids);
      // Spring Boot returns Result<Void> (null data)
      return success(res, null);
    } catch (error) {
      return badRequest(res, error.message);
    }
  })
);

module.exports = router;
