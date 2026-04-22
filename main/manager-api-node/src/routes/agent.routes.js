/**
 * Agent Routes
 *
 * Handles AI agent configuration, chat history, and device integration.
 * Base path: /agent
 */

const express = require('express');
const router = express.Router();
const agentService = require('../services/agent.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireServiceKey } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest, notFound } = require('../utils/response');
const logger = require('../utils/logger');

// ==============================================
// Static routes must come before dynamic :id routes
// ==============================================

/**
 * @swagger
 * /agent/list:
 *   get:
 *     tags: [Agent]
 *     summary: Get agents list (admin gets all agents, user gets own agents)
 *     description: Returns paginated AgentDTO objects. Admin sees all agents with owner info, regular user sees only their own agents.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number starting from 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Paginated list of agents with device counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           agentName:
 *                             type: string
 *                           memModelId:
 *                             type: string
 *                           systemPrompt:
 *                             type: string
 *                           summaryMemory:
 *                             type: string
 *                           lastConnectedAt:
 *                             type: string
 *                             format: date-time
 *                           deviceCount:
 *                             type: integer
 *                           deviceMacAddresses:
 *                             type: string
 *                           ownerUsername:
 *                             type: string
 *                             description: Only present for admin users
 *                           createDate:
 *                             type: string
 *                             format: date-time
 *                     total:
 *                       type: integer
 */
router.get('/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const isSuperAdmin = req.user.super_admin === 1;
    const { page, limit } = req.query;
    const result = await agentService.getAgentListForUser(req.user.id, isSuperAdmin, { page, limit });
    success(res, result);
  })
);

/**
 * @swagger
 * /agent/all:
 *   get:
 *     tags: [Agent]
 *     summary: Agent list (admin only) - paginated
 *     description: Returns paginated list of all agents. Admin only endpoint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number starting from 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Paginated list of AgentEntity objects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                   example: 0
 *                 data:
 *                   type: object
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: integer
 *       403:
 *         description: Not authorized - admin only
 */
router.get('/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Check if user is super admin
    if (req.user.super_admin !== 1) {
      return res.status(403).json({
        code: 403,
        msg: 'Not authorized - admin only',
        data: null
      });
    }

    const params = {
      page: req.query.page,
      limit: req.query.limit
    };

    const result = await agentService.adminAgentListPaginated(params);
    success(res, result);
  })
);

// ==============================================
// Agent Template Routes
// ==============================================

/**
 * @swagger
 * /agent/template:
 *   get:
 *     tags: [Agent Template]
 *     summary: Get all visible agent templates
 *     description: Requires authentication. Returns list of visible agent templates.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of visible agent templates
 *       401:
 *         description: Unauthorized
 */
router.get('/template',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      // includeHidden=true shows all templates (for admin management)
      const includeHidden = req.query.includeHidden === 'true';
      const templates = await agentService.getTemplates(includeHidden);
      success(res, templates);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/template:
 *   post:
 *     tags: [Agent Template]
 *     summary: Create a new agent template
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentName
 *             properties:
 *               agentCode:
 *                 type: string
 *               agentName:
 *                 type: string
 *               asrModelId:
 *                 type: string
 *               vadModelId:
 *                 type: string
 *               llmModelId:
 *                 type: string
 *               vllmModelId:
 *                 type: string
 *               ttsModelId:
 *                 type: string
 *               ttsVoiceId:
 *                 type: string
 *               memModelId:
 *                 type: string
 *               intentModelId:
 *                 type: string
 *               chatHistoryConf:
 *                 type: integer
 *               systemPrompt:
 *                 type: string
 *               summaryMemory:
 *                 type: string
 *               langCode:
 *                 type: string
 *               language:
 *                 type: string
 *               isVisible:
 *                 type: integer
 *                 enum: [0, 1]
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Template created successfully
 */
router.post('/template',
  requireAuth,
  validate({ body: schemas.agentTemplate }),
  asyncHandler(async (req, res) => {
    try {
      const template = await agentService.createTemplate(req.body);
      success(res, template, 'Template created successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/template/{id}:
 *   get:
 *     tags: [Agent Template]
 *     summary: Get agent template by ID
 *     description: Requires authentication. Gets template details. (Extra endpoint not in Spring Boot)
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
 *         description: Template details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Template not found
 */
router.get('/template/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const template = await agentService.getTemplateById(req.params.id);
    if (!template) {
      return notFound(res, 'Template not found');
    }
    success(res, template);
  })
);

/**
 * @swagger
 * /agent/template/{id}:
 *   put:
 *     tags: [Agent Template]
 *     summary: Update agent template
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agentCode:
 *                 type: string
 *               agentName:
 *                 type: string
 *               asrModelId:
 *                 type: string
 *               vadModelId:
 *                 type: string
 *               llmModelId:
 *                 type: string
 *               vllmModelId:
 *                 type: string
 *               ttsModelId:
 *                 type: string
 *               ttsVoiceId:
 *                 type: string
 *               memModelId:
 *                 type: string
 *               intentModelId:
 *                 type: string
 *               chatHistoryConf:
 *                 type: integer
 *               systemPrompt:
 *                 type: string
 *               summaryMemory:
 *                 type: string
 *               langCode:
 *                 type: string
 *               language:
 *                 type: string
 *               isVisible:
 *                 type: integer
 *                 enum: [0, 1]
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Template updated
 */
router.put('/template/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const template = await agentService.updateTemplate(req.params.id, req.body);
      success(res, template, 'Template updated successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/template/{id}:
 *   delete:
 *     tags: [Agent]
 *     summary: Delete agent template
 *     description: Requires authentication. Deletes a template by ID.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template deleted successfully
 *       404:
 *         description: Template not found
 */
router.delete('/template/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await agentService.deleteTemplate(req.params.id);
      success(res, null, 'Template deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/template/{id}/apply-to-agents:
 *   post:
 *     tags: [Agent Template]
 *     summary: Apply template changes to all agents using this template
 *     description: Finds all agents with matching agent_code and updates them with template settings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template applied to agents
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
 *                     updatedCount:
 *                       type: integer
 *                       description: Number of agents updated
 *                     agentCode:
 *                       type: string
 *                       description: The agent code that was matched
 *                 msg:
 *                   type: string
 */
router.post('/template/:id/apply-to-agents',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.applyTemplateToAgents(req.params.id);
      success(res, result, `Template applied to ${result.updatedCount} agent(s)`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==============================================
// Other Static Routes
// ==============================================

/**
 * @swagger
 * /agent/prompt/{mac}:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent prompt by device MAC
 *     description: Public endpoint for LiveKit agent to get configuration
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent prompt configuration
 */
router.get('/prompt/:mac',
  asyncHandler(async (req, res) => {
    try {
      const config = await agentService.getPromptByMac(req.params.mac);
      success(res, config);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/config/{mac}:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent config by device MAC (alias for prompt)
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent configuration
 */
router.get('/config/:mac',
  asyncHandler(async (req, res) => {
    try {
      const config = await agentService.getPromptByMac(req.params.mac);
      success(res, config);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/bootstrap:
 *   get:
 *     tags: [Agent]
 *     summary: Get manager-backed LiveKit bootstrap context for a device
 *     description: Fallback/debug endpoint. LiveKit room metadata remains the primary startup source.
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: includeMemories
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: recentLimit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Device bootstrap context
 */
router.get('/device/:mac/bootstrap',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    try {
      const includeMemories = req.query.includeMemories !== 'false' && req.query.includeMemories !== '0';
      const recentLimit = req.query.recentLimit || req.query.limit;
      const result = await agentService.getDeviceBootstrap(req.params.mac, {
        includeMemories,
        recentLimit
      });
      success(res, result);
    } catch (error) {
      logger.info(`[AGENT] GET /device/${req.params.mac}/bootstrap error: ${error.message}`);
      if (error.message === 'Invalid MAC address') {
        return badRequest(res, error.message);
      }
      notFound(res, error.message);
    }
  })
);

router.put('/device/:mac/artifacts',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { relativePath, content, contentType, sessionId, metadata } = req.body;

    try {
      const result = await agentService.saveDeviceWorkspaceArtifact({
        macAddress: req.params.mac,
        sessionId,
        relativePath,
        content,
        contentType,
        metadata
      });
      success(res, result, 'Workspace artifact saved');
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

router.get('/device/:mac/artifacts/content',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.getDeviceWorkspaceArtifact(req.params.mac, req.query.path);
      success(res, result);
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

router.get('/device/:mac/artifacts',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.listDeviceWorkspaceArtifacts(req.params.mac, {
        limit: req.query.limit,
        includeContent: req.query.includeContent
      });
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

router.put('/device/:mac/sessions/:sessionId/summary',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { summary, model, sourceMessageCount, agentId } = req.body;

    if (summary === undefined || summary === null) {
      return badRequest(res, 'summary is required');
    }

    try {
      const result = await agentService.saveVoiceSessionSummary({
        macAddress: req.params.mac,
        sessionId: req.params.sessionId,
        summary,
        model,
        sourceMessageCount,
        agentId
      });
      success(res, result, 'Session summary saved');
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

router.post('/device/:mac/sessions/:sessionId/end',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { status = 'ended', endedAt, messageCount } = req.body;

    try {
      const result = await agentService.endVoiceSession({
        macAddress: req.params.mac,
        sessionId: req.params.sessionId,
        status,
        endedAt,
        messageCount
      });
      success(res, result, 'Session ended');
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/agent-id/{mac}:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent ID by device MAC
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent ID
 */
router.get('/agent-id/:mac',
  asyncHandler(async (req, res) => {
    try {
      const agentId = await agentService.getAgentIdByMac(req.params.mac);
      success(res, { agentId });
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/agent-id:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent ID for device (gateway alias)
 *     description: Alias for /agent/agent-id/{mac} - used by LiveKit server
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent ID
 */
router.get('/device/:mac/agent-id',
  asyncHandler(async (req, res) => {
    try {
      const agentId = await agentService.getAgentIdByMac(req.params.mac);
      // LiveKit agent expects: { code: 0, data: "agent-id-string" }
      logger.info(`[AGENT] GET /device/${req.params.mac}/agent-id response: ${agentId}`);
      success(res, agentId);
    } catch (error) {
      logger.info(`[AGENT] GET /device/${req.params.mac}/agent-id error: ${error.message}`);
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/current-character/{mac}:
 *   get:
 *     tags: [Agent]
 *     summary: Get current character for device
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current character info
 */
router.get('/current-character/:mac',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.getCurrentCharacter(req.params.mac);
      // Return same format as /device/:mac/current-character for consistency
      const response = { characterName: result.agentName || 'Cheeko' };
      logger.info(`[AGENT] GET /current-character/${req.params.mac} response: ${JSON.stringify(response)}`);
      success(res, response);
    } catch (error) {
      logger.info(`[AGENT] GET /current-character/${req.params.mac} error: ${error.message}`);
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/current-character:
 *   get:
 *     tags: [Agent]
 *     summary: Get current character for device (gateway alias)
 *     description: Alias for /agent/current-character/{mac} - used by MQTT gateway
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current character info
 */
router.get('/device/:mac/current-character',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.getCurrentCharacter(req.params.mac);
      // Gateway expects either:
      // Format 1: { code: 0, data: "Character Name" }
      // Format 2: { code: 0, data: { characterName: "Character Name" } }
      const response = { characterName: result.agentName || 'Cheeko' };
      logger.info(`[AGENT] GET /device/${req.params.mac}/current-character response: ${JSON.stringify(response)}`);
      success(res, response);
    } catch (error) {
      logger.info(`[AGENT] GET /device/${req.params.mac}/current-character error: ${error.message}`);
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/set-character:
 *   post:
 *     tags: [Agent]
 *     summary: Set character for device (gateway format)
 *     description: Alias for /agent/set-character - used by MQTT gateway
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               characterName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Character set
 */
router.post('/device/:mac/set-character',
  asyncHandler(async (req, res) => {
    try {
      const { characterName } = req.body;
      if (!characterName) {
        return badRequest(res, 'characterName is required');
      }
      // Find agent by name
      const result = await agentService.setCharacterByName(req.params.mac, characterName);
      // Gateway expects: { success: true, newModeName: "Character Name" }
      const response = { success: true, newModeName: result.agentName };
      logger.info(`[AGENT] POST /device/${req.params.mac}/set-character response: ${JSON.stringify(response)}`);
      success(res, response);
    } catch (error) {
      logger.info(`[AGENT] POST /device/${req.params.mac}/set-character error: ${error.message}`);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/cycle-character:
 *   post:
 *     tags: [Agent]
 *     summary: Cycle to next character for device (gateway format)
 *     description: Alias for /agent/cycle-character - used by MQTT gateway
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Character cycled
 */
router.post('/device/:mac/cycle-character',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.cycleCharacter(req.params.mac);
      // Gateway expects: { success: true, newModeName: "Character Name" }
      const response = { success: true, newModeName: result.agentName };
      logger.info(`[AGENT] POST /device/${req.params.mac}/cycle-character response: ${JSON.stringify(response)}`);
      success(res, response);
    } catch (error) {
      logger.info(`[AGENT] POST /device/${req.params.mac}/cycle-character error: ${error.message}`);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/chat-message:
 *   post:
 *     tags: [Agent]
 *     summary: Add chat message to history
 *     description: Internal endpoint for LiveKit agent to save messages
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *               - agentId
 *               - sessionId
 *               - chatType
 *               - content
 *             properties:
 *               macAddress:
 *                 type: string
 *               agentId:
 *                 type: string
 *               sessionId:
 *                 type: string
 *               chatType:
 *                 type: integer
 *                 description: 1=user, 2=agent
 *               content:
 *                 type: string
 *               audioId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message saved
 */
router.post('/chat-message',
  asyncHandler(async (req, res) => {
    const { macAddress, agentId, sessionId, chatType, content, audioId } = req.body;

    if (!macAddress || !agentId || !sessionId || !chatType || !content) {
      return badRequest(res, 'Missing required fields');
    }

    try {
      const message = await agentService.addChatMessage({
        macAddress,
        agentId,
        sessionId,
        chatType,
        content,
        audioId
      });
      success(res, message);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==============================================
// Chat History Batch Routes
// ==============================================

/**
 * @swagger
 * /agent/chat-history/report:
 *   post:
 *     tags: [Agent Chat History]
 *     summary: Report a single chat message
 *     description: Used by cheeko service to report individual messages in real-time
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *               - sessionId
 *               - chatType
 *               - content
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *               agentId:
 *                 type: string
 *                 description: Agent ID (optional, resolved from device if not provided)
 *               sessionId:
 *                 type: string
 *                 description: Session identifier
 *               chatType:
 *                 type: integer
 *                 description: 1=user message, 2=agent message
 *                 enum: [1, 2]
 *               content:
 *                 type: string
 *                 description: Message content
 *               audioId:
 *                 type: string
 *                 description: Audio file ID (optional)
 *     responses:
 *       200:
 *         description: Message reported successfully
 *       400:
 *         description: Missing required fields or report failed
 */
router.post('/chat-history/report',
  asyncHandler(async (req, res) => {
    const { macAddress, agentId, sessionId, chatType, content, audioId, timestamp, sequence, idempotencyKey, providerMessage } = req.body;

    if (!macAddress || !sessionId || chatType === undefined || !content) {
      return badRequest(res, 'macAddress, sessionId, chatType, and content are required');
    }

    try {
      const message = await agentService.reportChatMessage({
        macAddress,
        agentId,
        sessionId,
        chatType,
        content,
        audioId,
        timestamp,
        sequence,
        idempotencyKey,
        providerMessage
      });
      success(res, message, 'Message reported successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/chat-history/session:
 *   post:
 *     tags: [Agent Chat History]
 *     summary: Batch upload all session messages
 *     description: Used by LiveKit workers at end of session to upload all messages at once
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *               - sessionId
 *               - messages
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *               agentId:
 *                 type: string
 *                 description: Agent ID (optional, resolved from device if not provided)
 *               sessionId:
 *                 type: string
 *                 description: Session identifier
 *               messages:
 *                 type: array
 *                 description: Array of chat messages
 *                 items:
 *                   type: object
 *                   required:
 *                     - chatType
 *                     - content
 *                   properties:
 *                     chatType:
 *                       type: integer
 *                       description: 1=user, 2=agent
 *                     content:
 *                       type: string
 *                     audioId:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       200:
 *         description: Session messages uploaded successfully
 *       400:
 *         description: Missing required fields or upload failed
 */
router.post('/chat-history/session',
  asyncHandler(async (req, res) => {
    const { macAddress, agentId, sessionId, messages } = req.body;

    if (!macAddress || !sessionId || !messages) {
      return badRequest(res, 'macAddress, sessionId, and messages are required');
    }

    try {
      const result = await agentService.batchUploadSession({
        macAddress,
        agentId,
        sessionId,
        messages
      });
      success(res, result, 'Session messages uploaded successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==============================================
// MCP Access Point Routes
// ==============================================

/**
 * @swagger
 * /agent/mcp/address/{agentId}:
 *   get:
 *     tags: [Agent MCP]
 *     summary: Get MCP access point URL for an agent
 *     description: Returns the MCP WebSocket URL for the agent (matches Spring Boot format)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: MCP access point URL or message if not configured
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: string
 *                   description: MCP WebSocket URL or helpful message
 *       403:
 *         description: No permission to query this agent's MCP access point
 */
router.get('/mcp/address/:agentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const userId = req.user.id;
    const isSuperAdmin = req.user.super_admin === 1;

    // Check permission (super admin can access any agent)
    if (!isSuperAdmin) {
      const agent = await agentService.getAgentById(agentId);
      if (!agent || agent.user_id !== userId) {
        return res.status(200).json({
          code: 500,
          msg: 'No permission to query this agent\'s MCP access point address',
          data: null
        });
      }
    }

    try {
      const mcpUrl = await agentService.getMcpAddress(agentId);
      if (!mcpUrl) {
        // Match Spring Boot response when MCP not configured
        return success(res, 'Please contact admin to configure MCP access point address in parameter management');
      }
      success(res, mcpUrl);
    } catch (error) {
      // Return error as Result format
      return res.status(200).json({
        code: 500,
        msg: error.message || 'Failed to get MCP address',
        data: null
      });
    }
  })
);

/**
 * @swagger
 * /agent/mcp/tools/{agentId}:
 *   get:
 *     tags: [Agent MCP]
 *     summary: Get MCP tools list for an agent
 *     description: Connects to MCP server via WebSocket and returns list of available tool names
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: List of tool names from MCP server
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
 *                     type: string
 *       403:
 *         description: No permission to query this agent's MCP tools
 */
router.get('/mcp/tools/:agentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const userId = req.user.id;
    const isSuperAdmin = req.user.super_admin === 1;

    // Check permission (super admin can access any agent)
    if (!isSuperAdmin) {
      const agent = await agentService.getAgentById(agentId);
      if (!agent || agent.user_id !== userId) {
        return res.status(200).json({
          code: 500,
          msg: 'No permission to query this agent\'s MCP tools list',
          data: null
        });
      }
    }

    try {
      const tools = await agentService.getMcpTools(agentId);
      success(res, tools);
    } catch (error) {
      return res.status(200).json({
        code: 500,
        msg: error.message || 'Failed to get MCP tools',
        data: null
      });
    }
  })
);

// ==============================================
// Agent Memory and Mode Routes
// ==============================================

/**
 * @swagger
 * /agent/saveMemory/{mac}:
 *   put:
 *     tags: [Agent Memory]
 *     summary: Update agent summary memory by device MAC
 *     description: Used by LiveKit workers to persist conversation summary
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - summaryMemory
 *             properties:
 *               summaryMemory:
 *                 type: string
 *                 description: Summary memory content to save
 *     responses:
 *       200:
 *         description: Memory saved successfully
 *       400:
 *         description: Missing required fields or save failed
 *       404:
 *         description: Device or agent not found
 */
router.put('/saveMemory/:mac',
  asyncHandler(async (req, res) => {
    const { summaryMemory } = req.body;

    if (summaryMemory === undefined) {
      return badRequest(res, 'summaryMemory is required');
    }

    try {
      const result = await agentService.saveMemory(req.params.mac, summaryMemory);
      success(res, result, 'Memory saved successfully');
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/update-mode:
 *   put:
 *     tags: [Agent Memory]
 *     summary: Update agent mode from template
 *     description: Copies template settings to agent. Used for switching agent modes/personalities.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - macAddress
 *               - templateId
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *               templateId:
 *                 type: string
 *                 description: Template ID to apply
 *               preserveMemory:
 *                 type: boolean
 *                 default: true
 *                 description: Keep existing summary_memory if true
 *     responses:
 *       200:
 *         description: Agent updated from template
 *       400:
 *         description: Missing required fields or update failed
 *       404:
 *         description: Device, agent, or template not found
 */
router.put('/update-mode',
  asyncHandler(async (req, res) => {
    const { macAddress, templateId, preserveMemory } = req.body;

    if (!macAddress || !templateId) {
      return badRequest(res, 'macAddress and templateId are required');
    }

    try {
      const agent = await agentService.updateModeFromTemplate({
        macAddress,
        templateId,
        preserveMemory
      });
      success(res, agent, 'Agent mode updated from template');
    } catch (error) {
      if (error.message.includes('not found')) {
        return notFound(res, error.message);
      }
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/device/{mac}/agent-name:
 *   get:
 *     tags: [Agent Memory]
 *     summary: Get agent name for device
 *     description: Used by game mode detection in LiveKit workers
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Agent name and code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId:
 *                   type: string
 *                 agentName:
 *                   type: string
 *                 agentCode:
 *                   type: string
 *                 mode:
 *                   type: string
 *       404:
 *         description: Device not found
 */
router.get('/device/:mac/agent-name',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.getAgentNameByMac(req.params.mac);
      success(res, result);
    } catch (error) {
      notFound(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/cycle-character/{mac}:
 *   post:
 *     tags: [Agent]
 *     summary: Cycle to next character/agent for device
 *     description: Public endpoint for ESP32 button press
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: New character info
 */
router.post('/cycle-character/:mac',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.cycleCharacter(req.params.mac);
      success(res, result, `Switched to ${result.agentName}`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/set-character/{mac}/{agentId}:
 *   post:
 *     tags: [Agent]
 *     summary: Set specific character/agent for device
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Character set
 */
router.post('/set-character/:mac/:agentId',
  asyncHandler(async (req, res) => {
    try {
      const result = await agentService.setCharacter(req.params.mac, req.params.agentId);
      success(res, result, `Set character to ${result.agentName}`);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==============================================
// CRUD routes (POST/PUT/DELETE for core agent management)
// ==============================================

/**
 * @swagger
 * /agent:
 *   post:
 *     tags: [Agent]
 *     summary: Create a new agent
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentName
 *             properties:
 *               agentCode:
 *                 type: string
 *               agentName:
 *                 type: string
 *               asrModelId:
 *                 type: string
 *               vadModelId:
 *                 type: string
 *               llmModelId:
 *                 type: string
 *               vllmModelId:
 *                 type: string
 *               ttsModelId:
 *                 type: string
 *               ttsVoiceId:
 *                 type: string
 *               memModelId:
 *                 type: string
 *               intentModelId:
 *                 type: string
 *               chatHistoryConf:
 *                 type: integer
 *               systemPrompt:
 *                 type: string
 *               summaryMemory:
 *                 type: string
 *               langCode:
 *                 type: string
 *               language:
 *                 type: string
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Agent created successfully
 */
router.post('/',
  requireAuth,
  validate({ body: schemas.agent }),
  asyncHandler(async (req, res) => {
    try {
      const agent = await agentService.createAgent(req.user.id, req.body);
      // Spring Boot returns just the agent ID, not the full object
      success(res, agent.id);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

// ==============================================
// Dynamic :id routes (MUST be defined after all static routes)
// ==============================================

/**
 * @swagger
 * /agent/{id}/sessions:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent chat sessions (paginated)
 *     description: Returns paginated list of unique chat sessions for an agent
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated list of sessions
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
 *                         type: object
 *                         properties:
 *                           sessionId:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           chatCount:
 *                             type: integer
 *                     total:
 *                       type: integer
 */
router.get('/:id/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const { page, limit } = req.query;
      const sessions = await agentService.getAgentSessions(req.params.id, { page, limit });
      success(res, sessions);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/{id}/chat-history/user:
 *   get:
 *     tags: [Agent Chat History]
 *     summary: Get recent user chat messages for mobile app
 *     description: Returns the most recent 50 USER messages with audio for an agent (matches Spring Boot AgentChatHistoryUserVO)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *     responses:
 *       200:
 *         description: Recent user chat messages
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
 *                     type: object
 *                     properties:
 *                       content:
 *                         type: string
 *                         description: Chat content text
 *                       audioId:
 *                         type: string
 *                         description: Audio file ID
 *       400:
 *         description: Failed to get chat history
 */
router.get('/:id/chat-history/user',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const history = await agentService.getRecentUserChatHistory(req.params.id);
      success(res, history);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/{id}/chat-history/audio:
 *   get:
 *     tags: [Agent Chat History]
 *     summary: Get audio content by audio ID
 *     description: Returns the content string for a specific audio ID (Spring Boot compatible - {id} is the audioId)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Audio ID (not Agent ID in this endpoint)
 *     responses:
 *       200:
 *         description: Content string for the audio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: string
 *                   description: Content text associated with this audio ID
 *       404:
 *         description: Audio content not found
 */
router.get('/:id/chat-history/audio',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      // In Spring Boot, the {id} path param is actually the audioId
      const audioId = req.params.id;
      const content = await agentService.getAudioContent(audioId);
      success(res, content);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/{id}/chat-history/{sessionId}:
 *   get:
 *     tags: [Agent]
 *     summary: Get chat history for a session
 *     description: Returns chat messages for a specific session (matches Spring Boot List<AgentChatHistoryDTO>)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Chat messages for the session
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
 *                     type: object
 *                     properties:
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       chatType:
 *                         type: integer
 *                         description: "1=User, 2=Agent"
 *                       content:
 *                         type: string
 *                       audioId:
 *                         type: string
 *                       macAddress:
 *                         type: string
 */
router.get('/:id/chat-history/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const history = await agentService.getChatHistory(req.params.id, req.params.sessionId);
      success(res, history);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/{id}:
 *   get:
 *     tags: [Agent]
 *     summary: Get agent by ID
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
 *         description: Agent details
 *       404:
 *         description: Agent not found
 */
router.get('/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Use getAgentInfoById which returns AgentInfoVO format with functions (plugin mappings)
    // Spring Boot does not filter by user ID - it uses Shiro permissions for authorization
    const agent = await agentService.getAgentInfoById(req.params.id);
    if (!agent) {
      return notFound(res, 'Agent not found');
    }
    success(res, agent);
  })
);

/**
 * @swagger
 * /agent/{id}:
 *   put:
 *     tags: [Agent]
 *     summary: Update agent
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agentCode:
 *                 type: string
 *               agentName:
 *                 type: string
 *               asrModelId:
 *                 type: string
 *               vadModelId:
 *                 type: string
 *               llmModelId:
 *                 type: string
 *               vllmModelId:
 *                 type: string
 *               ttsModelId:
 *                 type: string
 *               ttsVoiceId:
 *                 type: string
 *               memModelId:
 *                 type: string
 *               intentModelId:
 *                 type: string
 *               chatHistoryConf:
 *                 type: integer
 *               systemPrompt:
 *                 type: string
 *               summaryMemory:
 *                 type: string
 *               langCode:
 *                 type: string
 *               language:
 *                 type: string
 *               sort:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Agent updated
 */
router.put('/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await agentService.updateAgent(req.params.id, req.user.id, req.body);
      // Spring Boot returns Result<Void> (null data)
      success(res, null);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /agent/{id}:
 *   delete:
 *     tags: [Agent]
 *     summary: Delete agent
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
 *         description: Agent deleted
 */
router.delete('/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await agentService.deleteAgent(req.params.id, req.user.id);
      success(res, null, 'Agent deleted successfully');
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
