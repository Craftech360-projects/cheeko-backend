/**
 * Model Routes
 *
 * Handles AI model configuration (ASR, TTS, LLM, VAD, etc.)
 * Base path: /models
 *
 * PRD-compliant endpoints:
 * - GET /models/names - Get model names (OAuth)
 * - GET /models/llm/names - Get LLM names (OAuth)
 * - GET /models/:type/provideTypes - Get provider types (OAuth)
 * - GET /models/list - List all models (OAuth)
 * - POST /models/:type/:provider - Create model (Admin)
 * - PUT /models/:type/:provider/:id - Update model (Admin)
 * - DELETE /models/:id - Delete model (Admin)
 */

const express = require('express');
const router = express.Router();
const modelService = require('../services/model.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

// Valid model types
const VALID_MODEL_TYPES = ['asr', 'tts', 'llm', 'vad', 'mem', 'intent', 'vllm'];

/**
 * @swagger
 * components:
 *   schemas:
 *     Model:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         model_type:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         model_name:
 *           type: string
 *         model_code:
 *           type: string
 *         provider:
 *           type: string
 *         api_url:
 *           type: string
 *         config:
 *           type: object
 *         description:
 *           type: string
 *         sort:
 *           type: integer
 *         status:
 *           type: integer
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     ModelInput:
 *       type: object
 *       required:
 *         - modelName
 *       properties:
 *         modelName:
 *           type: string
 *           description: Display name for the model
 *         modelCode:
 *           type: string
 *           description: Model code/identifier
 *         apiKey:
 *           type: string
 *           description: API key for the provider
 *         apiUrl:
 *           type: string
 *           description: API endpoint URL
 *         config:
 *           type: object
 *           description: Additional configuration
 *         description:
 *           type: string
 *         sort:
 *           type: integer
 *           default: 0
 *         status:
 *           type: integer
 *           default: 1
 *     ModelName:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         modelType:
 *           type: string
 *         modelName:
 *           type: string
 *         modelCode:
 *           type: string
 *         provider:
 *           type: string
 *     ProviderType:
 *       type: object
 *       properties:
 *         provider:
 *           type: string
 *         name:
 *           type: string
 *     TtsVoice:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         tts_model_id:
 *           type: string
 *         voice_name:
 *           type: string
 *         voice_code:
 *           type: string
 *         gender:
 *           type: string
 *           enum: [male, female, neutral]
 *         language:
 *           type: string
 *         accent:
 *           type: string
 *         age_group:
 *           type: string
 *         style:
 *           type: string
 *         preview_url:
 *           type: string
 *         config:
 *           type: object
 *         sort:
 *           type: integer
 *         status:
 *           type: integer
 *     TtsVoiceInput:
 *       type: object
 *       required:
 *         - ttsModelId
 *         - voiceName
 *         - voiceCode
 *       properties:
 *         ttsModelId:
 *           type: string
 *         voiceName:
 *           type: string
 *         voiceCode:
 *           type: string
 *         gender:
 *           type: string
 *           enum: [male, female, neutral]
 *         language:
 *           type: string
 *         accent:
 *           type: string
 *         ageGroup:
 *           type: string
 *         style:
 *           type: string
 *         previewUrl:
 *           type: string
 *         config:
 *           type: object
 *         sort:
 *           type: integer
 *         status:
 *           type: integer
 */

// ==================== PRD-COMPLIANT MODEL ROUTES ====================
// Static routes MUST be defined before dynamic :type/:id routes

/**
 * @swagger
 * /models/names:
 *   get:
 *     tags: [Models]
 *     summary: Get model names
 *     description: Returns a list of all model names with their types and providers
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of model names
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
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ModelName'
 *       401:
 *         description: Unauthorized
 */
router.get('/names',
  requireAuth,
  asyncHandler(async (req, res) => {
    const names = await modelService.getModelNames();
    success(res, names);
  })
);

/**
 * @swagger
 * /models/llm/names:
 *   get:
 *     tags: [Models]
 *     summary: Get LLM model names
 *     description: Returns a list of LLM model names only
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of LLM model names
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
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ModelName'
 *       401:
 *         description: Unauthorized
 */
router.get('/llm/names',
  requireAuth,
  asyncHandler(async (req, res) => {
    const names = await modelService.getLlmNames();
    success(res, names);
  })
);

/**
 * @swagger
 * /models/options:
 *   get:
 *     tags: [Models]
 *     summary: Get all model options grouped by type
 *     description: Returns models for dropdowns in agent configuration
 *     responses:
 *       200:
 *         description: Model options grouped by type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         code:
 *                           type: string
 */
router.get('/options',
  asyncHandler(async (req, res) => {
    const options = await modelService.getModelOptions();
    success(res, options);
  })
);

/**
 * @swagger
 * /models/list:
 *   get:
 *     tags: [Models]
 *     summary: List all models
 *     description: Returns a paginated list of all models
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
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: modelType
 *         schema:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         description: Filter by model type
 *     responses:
 *       200:
 *         description: Paginated model list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Model'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, modelType } = req.query;
    const result = await modelService.listModels({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      modelType
    });
    success(res, result);
  })
);

// ==================== TTS VOICE ROUTES ====================
// These must be defined before :type routes to prevent conflicts

/**
 * @swagger
 * /models/tts-voices:
 *   get:
 *     tags: [Models - TTS Voices]
 *     summary: Get TTS voices
 *     description: Returns a list of TTS voices, optionally filtered by TTS model
 *     parameters:
 *       - in: query
 *         name: ttsModelId
 *         schema:
 *           type: string
 *         description: Filter by TTS model ID
 *     responses:
 *       200:
 *         description: List of TTS voices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TtsVoice'
 */
router.get('/tts-voices',
  asyncHandler(async (req, res) => {
    const voices = await modelService.getTtsVoices(req.query.ttsModelId);
    success(res, voices);
  })
);

/**
 * @swagger
 * /models/tts-voices/create:
 *   post:
 *     tags: [Models - TTS Voices]
 *     summary: Create TTS voice
 *     description: Create a new TTS voice configuration
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TtsVoiceInput'
 *     responses:
 *       200:
 *         description: TTS voice created successfully
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
 *                   $ref: '#/components/schemas/TtsVoice'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/tts-voices/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.body.ttsModelId || !req.body.voiceName || !req.body.voiceCode) {
      return badRequest(res, 'TTS model ID, voice name, and voice code are required');
    }

    try {
      const voice = await modelService.createTtsVoice(req.user.id, req.body);
      success(res, voice, 'TTS voice created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/tts-voices/update/{id}:
 *   put:
 *     tags: [Models - TTS Voices]
 *     summary: Update TTS voice
 *     description: Update an existing TTS voice configuration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: TTS voice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TtsVoiceInput'
 *     responses:
 *       200:
 *         description: TTS voice updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put('/tts-voices/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const voice = await modelService.updateTtsVoice(req.params.id, req.body);
      success(res, voice, 'TTS voice updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/tts-voices/delete/{id}:
 *   delete:
 *     tags: [Models - TTS Voices]
 *     summary: Delete TTS voice
 *     description: Delete a TTS voice configuration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: TTS voice ID
 *     responses:
 *       200:
 *         description: TTS voice deleted successfully
 *       400:
 *         description: Error deleting voice
 *       401:
 *         description: Unauthorized
 */
router.delete('/tts-voices/delete/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await modelService.deleteTtsVoice(req.params.id);
      success(res, null, 'TTS voice deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/tts-voices/{id}:
 *   get:
 *     tags: [Models - TTS Voices]
 *     summary: Get TTS voice by ID
 *     description: Retrieve a single TTS voice configuration
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: TTS voice ID
 *     responses:
 *       200:
 *         description: TTS voice details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/TtsVoice'
 *       404:
 *         description: TTS voice not found
 */
router.get('/tts-voices/:id',
  asyncHandler(async (req, res) => {
    const voice = await modelService.getTtsVoiceById(req.params.id);
    if (!voice) {
      return notFound(res, 'TTS voice not found');
    }
    success(res, voice);
  })
);

// ==================== LEGACY MODEL ROUTES (backward compatibility) ====================

/**
 * @swagger
 * /models/create:
 *   post:
 *     tags: [Models]
 *     summary: Create model (legacy)
 *     description: Legacy endpoint for creating a model. Prefer POST /models/:type/:provider
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - modelType
 *               - modelName
 *             properties:
 *               modelType:
 *                 type: string
 *                 enum: [asr, tts, llm, vad, mem, intent, vllm]
 *               modelName:
 *                 type: string
 *               modelCode:
 *                 type: string
 *               provider:
 *                 type: string
 *               apiKey:
 *                 type: string
 *               apiUrl:
 *                 type: string
 *               config:
 *                 type: object
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Model created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.body.modelType || !req.body.modelName) {
      return badRequest(res, 'Model type and name are required');
    }

    try {
      const model = await modelService.createModel(req.user.id, req.body);
      success(res, model, 'Model created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/update/{id}:
 *   put:
 *     tags: [Models]
 *     summary: Update model (legacy)
 *     description: Legacy endpoint for updating a model. Prefer PUT /models/:type/:provider/:id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Model ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ModelInput'
 *     responses:
 *       200:
 *         description: Model updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.put('/update/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const model = await modelService.updateModel(req.params.id, req.body);
      success(res, model, 'Model updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/delete/{id}:
 *   delete:
 *     tags: [Models]
 *     summary: Delete model (legacy)
 *     description: Legacy endpoint for deleting a model. Prefer DELETE /models/:id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model deleted
 *       400:
 *         description: Error deleting model
 *       401:
 *         description: Unauthorized
 */
router.delete('/delete/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await modelService.deleteModel(req.params.id);
      success(res, null, 'Model deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/type/{type}:
 *   get:
 *     tags: [Models]
 *     summary: Get models by type
 *     description: Get all active models of a specific type
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         description: Model type
 *     responses:
 *       200:
 *         description: Models of specified type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Model'
 *       400:
 *         description: Invalid model type
 */
router.get('/type/:type',
  asyncHandler(async (req, res) => {
    if (!VALID_MODEL_TYPES.includes(req.params.type)) {
      return badRequest(res, 'Invalid model type');
    }

    const models = await modelService.getModelsByType(req.params.type);
    success(res, models);
  })
);

// ==================== PRD-COMPLIANT DYNAMIC ROUTES ====================
// These must be defined AFTER all static routes

/**
 * @swagger
 * /models/{type}/provideTypes:
 *   get:
 *     tags: [Models]
 *     summary: Get provider types for a model type
 *     description: Returns the list of available providers for the specified model type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         description: Model type
 *     responses:
 *       200:
 *         description: List of provider types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ProviderType'
 *       400:
 *         description: Invalid model type
 *       401:
 *         description: Unauthorized
 */
router.get('/:type/provideTypes',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!VALID_MODEL_TYPES.includes(req.params.type)) {
      return badRequest(res, 'Invalid model type');
    }

    const providers = await modelService.getProviderTypes(req.params.type);
    success(res, providers);
  })
);

/**
 * @swagger
 * /models/{type}/{provider}:
 *   post:
 *     tags: [Models]
 *     summary: Create model by type and provider
 *     description: Create a new model configuration for the specified type and provider
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         description: Model type
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider name (e.g., groq, google, elevenlabs)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ModelInput'
 *     responses:
 *       200:
 *         description: Model created successfully
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
 *                   $ref: '#/components/schemas/Model'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/:type/:provider',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { type, provider } = req.params;

    if (!VALID_MODEL_TYPES.includes(type)) {
      return badRequest(res, 'Invalid model type');
    }

    if (!provider || provider.trim() === '') {
      return badRequest(res, 'Provider is required');
    }

    if (!req.body.modelName) {
      return badRequest(res, 'Model name is required');
    }

    try {
      const model = await modelService.createModelByTypeProvider(
        req.user.id,
        type,
        provider,
        req.body
      );
      success(res, model, 'Model created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/{type}/{provider}/{id}:
 *   put:
 *     tags: [Models]
 *     summary: Update model by type and provider
 *     description: Update an existing model configuration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [asr, tts, llm, vad, mem, intent, vllm]
 *         description: Model type
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider name
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Model ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ModelInput'
 *     responses:
 *       200:
 *         description: Model updated successfully
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
 *                   $ref: '#/components/schemas/Model'
 *       400:
 *         description: Validation error or model not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.put('/:type/:provider/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { type, provider, id } = req.params;

    if (!VALID_MODEL_TYPES.includes(type)) {
      return badRequest(res, 'Invalid model type');
    }

    try {
      const model = await modelService.updateModelByTypeProvider(
        id,
        type,
        provider,
        req.body
      );
      success(res, model, 'Model updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /models/{id}:
 *   get:
 *     tags: [Models]
 *     summary: Get model by ID
 *     description: Retrieve a single model by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   $ref: '#/components/schemas/Model'
 *       404:
 *         description: Model not found
 *   delete:
 *     tags: [Models]
 *     summary: Delete model by ID
 *     description: Delete a model configuration
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model deleted successfully
 *       400:
 *         description: Error deleting model
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/:id',
  asyncHandler(async (req, res) => {
    const model = await modelService.getModelById(req.params.id);
    if (!model) {
      return notFound(res, 'Model not found');
    }
    success(res, model);
  })
);

router.delete('/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      await modelService.deleteModel(req.params.id);
      success(res, null, 'Model deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
