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
const { requireAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest, notFound } = require('../utils/response');

// ==============================================
// Static routes must come before dynamic :id routes
// ==============================================

/**
 * @swagger
 * /agent/list:
 *   get:
 *     tags: [Agent]
 *     summary: List user's agents (paginated)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated list of agents
 */
router.get('/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const result = await agentService.listAgents(req.user.id, { page, limit });
    success(res, result);
  })
);

/**
 * @swagger
 * /agent/all:
 *   get:
 *     tags: [Agent]
 *     summary: Get all agents for user (no pagination)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all agents
 */
router.get('/all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const agents = await agentService.getAllAgents(req.user.id);
    success(res, agents);
  })
);

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
      success(res, result);
    } catch (error) {
      notFound(res, error.message);
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
      success(res, agent, 'Agent created successfully');
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
 *     summary: Get agent chat sessions
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
 *         description: List of sessions
 */
router.get('/:id/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const sessions = await agentService.getAgentSessions(req.params.id);
      success(res, sessions);
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
 *     responses:
 *       200:
 *         description: Chat messages
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
    const agent = await agentService.getAgentById(req.params.id, req.user.id);
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
      const agent = await agentService.updateAgent(req.params.id, req.user.id, req.body);
      success(res, agent, 'Agent updated successfully');
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
