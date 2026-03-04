/**
 * Quota Routes
 *
 * Endpoints for question quota management.
 * Service key endpoints are called by LiveKit agent workers.
 * Admin endpoints are for the dashboard.
 */

const express = require('express');
const router = express.Router();
const quotaService = require('../services/quota.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey, requireAdmin } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');
const logger = require('../utils/logger');

// ==================== AGENT WORKER ENDPOINTS (Service Key) ====================

/**
 * @swagger
 * /quota/check/{mac}:
 *   get:
 *     tags: [Quota]
 *     summary: Check quota for a device
 *     description: Returns remaining questions for the user who owns this device. Used by agent workers at session start.
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Quota status
 */
router.get('/check/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const quota = await quotaService.getQuotaByMac(mac);
      success(res, quota, 'Quota retrieved successfully');
    } catch (error) {
      logger.error('Error checking quota:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /quota/increment/{mac}:
 *   post:
 *     tags: [Quota]
 *     summary: Increment question count for a device
 *     description: Called by agent workers on each user speech turn. Increments the question counter.
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Updated quota status
 */
router.post('/increment/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { month_key: monthKey } = req.body || {};

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }

    try {
      const quota = await quotaService.incrementByMac(mac, monthKey);
      success(res, quota, 'Quota incremented');
    } catch (error) {
      logger.error('Error incrementing quota:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== GAME SESSION PROTECTION ENDPOINTS (Service Key) ====================

/**
 * @swagger
 * /quota/game-session/start/{mac}:
 *   post:
 *     tags: [Quota]
 *     summary: Start a protected game session
 *     description: Atomically checks quota and registers a game session. Active games can finish even if quota expires mid-game.
 *     security:
 *       - serviceKey: []
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
 *               - agent_type
 *               - session_id
 *             properties:
 *               agent_type:
 *                 type: string
 *                 enum: [math_tutor, riddle_solver, word_ladder]
 *               session_id:
 *                 type: string
 *                 description: Room name for correlation
 *     responses:
 *       200:
 *         description: Game session start result
 */
router.post('/game-session/start/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { agent_type, session_id } = req.body || {};

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }
    if (!agent_type || !session_id) {
      return badRequest(res, 'agent_type and session_id are required');
    }

    try {
      const result = await quotaService.startGameSession(mac, agent_type, session_id);
      success(res, result, result.allowed ? 'Game session started' : 'Game session denied');
    } catch (error) {
      logger.error('Error starting game session:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /quota/game-session/end/{mac}:
 *   post:
 *     tags: [Quota]
 *     summary: End a protected game session
 *     description: Marks an active game session as completed or abandoned.
 *     security:
 *       - serviceKey: []
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
 *               - agent_type
 *               - session_id
 *             properties:
 *               agent_type:
 *                 type: string
 *               session_id:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [completed, abandoned]
 *                 default: completed
 *     responses:
 *       200:
 *         description: Game session end result
 */
router.post('/game-session/end/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { agent_type, session_id, status = 'completed' } = req.body || {};

    if (!mac) {
      return badRequest(res, 'MAC address is required');
    }
    if (!agent_type || !session_id) {
      return badRequest(res, 'agent_type and session_id are required');
    }

    try {
      const result = await quotaService.endGameSession(mac, agent_type, session_id, status);
      success(res, result, result.ended ? 'Game session ended' : 'No active session found');
    } catch (error) {
      logger.error('Error ending game session:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== ADMIN ENDPOINTS ====================

/**
 * @swagger
 * /quota/user/{userId}:
 *   get:
 *     tags: [Quota]
 *     summary: Get quota for a specific user
 *     description: Admin endpoint to view a user's quota status
 *     security:
 *       - bearerAuth: []
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: monthKey
 *         schema:
 *           type: string
 *         description: Month in YYYY-MM format (defaults to current month)
 *     responses:
 *       200:
 *         description: User quota status
 */
router.get('/user/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { monthKey } = req.query;

    try {
      const quota = await quotaService.getQuotaForUser(Number(userId), monthKey);
      success(res, quota, 'User quota retrieved');
    } catch (error) {
      logger.error('Error getting user quota:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /quota/user/{userId}/grant:
 *   post:
 *     tags: [Quota]
 *     summary: Grant extra questions to a user
 *     description: Admin grants additional questions for the current month
 *     security:
 *       - bearerAuth: []
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of extra questions to grant
 *     responses:
 *       200:
 *         description: Updated quota after granting extras
 */
router.post('/user/:userId/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return badRequest(res, 'Amount must be a positive number');
    }

    try {
      const quota = await quotaService.grantExtra(Number(userId), Number(amount));
      logger.info(`Admin granted ${amount} extra questions to user ${userId}`);
      success(res, quota, `Granted ${amount} extra questions`);
    } catch (error) {
      logger.error('Error granting extra quota:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /quota/summary:
 *   get:
 *     tags: [Quota]
 *     summary: List all users' quotas
 *     description: Paginated admin view of all users' quota usage
 *     security:
 *       - bearerAuth: []
 *       - serviceKey: []
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
 *           default: 20
 *       - in: query
 *         name: monthKey
 *         schema:
 *           type: string
 *         description: Month in YYYY-MM format (defaults to current month)
 *     responses:
 *       200:
 *         description: Paginated quota list
 */
router.get('/summary',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, monthKey } = req.query;

    try {
      const result = await quotaService.listQuotas({
        page: Number(page),
        limit: Number(limit),
        monthKey
      });
      success(res, result, 'Quota summary retrieved');
    } catch (error) {
      logger.error('Error listing quotas:', error);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
