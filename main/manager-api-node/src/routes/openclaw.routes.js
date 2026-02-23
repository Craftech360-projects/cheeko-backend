/**
 * OpenClaw Routes
 *
 * Handles OpenClaw configuration, pairing flow, and connection testing.
 * Base paths: /user/openclaw-* (authenticated) and /api/openclaw/* (plugin calls)
 */

const express = require('express');
const router = express.Router();
const openclawService = require('../services/openclaw.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

// =============================================
// Authenticated endpoints (user-facing)
// =============================================

/**
 * @swagger
 * /user/openclaw-config:
 *   get:
 *     tags: [OpenClaw]
 *     summary: Get user's OpenClaw configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OpenClaw config
 */
router.get('/user/openclaw-config',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await openclawService.getOpenClawConfig(req.user.id);
    success(res, data);
  })
);

/**
 * @swagger
 * /user/openclaw-config:
 *   put:
 *     tags: [OpenClaw]
 *     summary: Set user's OpenClaw URL and token
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openclaw_url:
 *                 type: string
 *                 description: WebSocket URL (ws:// or wss://)
 *               openclaw_token:
 *                 type: string
 *                 description: Optional auth token
 *     responses:
 *       200:
 *         description: Config saved
 */
router.put('/user/openclaw-config',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { openclaw_url, openclaw_token } = req.body;
    try {
      const data = await openclawService.setOpenClawConfig(req.user.id, {
        openclaw_url,
        openclaw_token
      });
      success(res, data);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/openclaw-config/test:
 *   post:
 *     tags: [OpenClaw]
 *     summary: Test connection to an OpenClaw URL
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Connection test result
 */
router.post('/user/openclaw-config/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return badRequest(res, 'URL is required');
    }
    try {
      const result = await openclawService.testConnection(url);
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/openclaw-pair/generate:
 *   post:
 *     tags: [OpenClaw]
 *     summary: Generate a one-time pairing token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pairing token generated
 */
router.post('/user/openclaw-pair/generate',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const data = await openclawService.generatePairingToken(req.user.id);
      success(res, data);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /user/openclaw-pair/status:
 *   get:
 *     tags: [OpenClaw]
 *     summary: Check pairing status (polled by frontend)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pairing status
 */
router.get('/user/openclaw-pair/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return badRequest(res, 'Token is required');
    }
    const data = await openclawService.getPairingStatus(token);
    success(res, data);
  })
);

// =============================================
// Public endpoint (called by OpenClaw plugin)
// =============================================

/**
 * @swagger
 * /api/openclaw/pair:
 *   post:
 *     tags: [OpenClaw]
 *     summary: Complete pairing (called by OpenClaw plugin)
 *     description: |
 *       Public endpoint called by the OpenClaw plugin when CHEEKO_PAIR env var is set.
 *       No user authentication required - uses the pairing token for auth.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - url
 *             properties:
 *               token:
 *                 type: string
 *                 description: Pairing token from dashboard
 *               url:
 *                 type: string
 *                 description: WebSocket URL of the plugin
 *               localIp:
 *                 type: string
 *                 description: Local IP address of the plugin
 *     responses:
 *       200:
 *         description: Pairing complete
 */
router.post('/api/openclaw/pair',
  asyncHandler(async (req, res) => {
    const { token, url, localIp } = req.body;
    if (!token || !url) {
      return badRequest(res, 'token and url are required');
    }
    try {
      const result = await openclawService.completePairing({ token, url, localIp });
      success(res, result);
    } catch (error) {
      logger.warn(`Pairing failed: ${error.message}`);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
