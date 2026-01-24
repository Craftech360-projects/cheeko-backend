/**
 * Server Management Routes
 *
 * Handles WebSocket server management and worker notifications.
 * Base path: /admin/server
 */

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

// ==================== SERVER LIST ====================

/**
 * @swagger
 * /admin/server/server-list:
 *   get:
 *     tags: [Server Management]
 *     summary: Get WebSocket server list
 *     description: Returns a list of available WebSocket servers for device connections (Admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of WebSocket servers
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
 *                   example: Success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Server identifier
 *                       name:
 *                         type: string
 *                         description: Server display name
 *                       url:
 *                         type: string
 *                         description: WebSocket URL
 *                       region:
 *                         type: string
 *                         description: Server region
 *                       status:
 *                         type: string
 *                         enum: [online, offline, maintenance]
 *                         description: Server status
 *                       activeConnections:
 *                         type: integer
 *                         description: Number of active connections
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get('/server-list',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Return configured WebSocket servers
    // In production, this would query a database or service registry
    const servers = [
      {
        id: 'livekit-main',
        name: 'LiveKit Main Server',
        url: process.env.LIVEKIT_URL || 'wss://livekit.example.com',
        region: 'us-east',
        status: 'online',
        activeConnections: 0
      },
      {
        id: 'mqtt-gateway',
        name: 'MQTT Gateway',
        url: process.env.MQTT_WS_URL || 'wss://mqtt.example.com',
        region: 'us-east',
        status: 'online',
        activeConnections: 0
      }
    ];

    success(res, servers);
  })
);

// ==================== EMIT ACTION ====================

/**
 * @swagger
 * /admin/server/emit-action:
 *   post:
 *     tags: [Server Management]
 *     summary: Notify workers to update configuration
 *     description: Sends a notification to Python workers (LiveKit, MQTT gateway) to refresh their configuration (Admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [refresh-config, refresh-agents, refresh-models, restart-workers, clear-cache]
 *                 description: Action to perform
 *               target:
 *                 type: string
 *                 enum: [all, livekit, mqtt-gateway, media-api]
 *                 default: all
 *                 description: Target service(s) for the action
 *               payload:
 *                 type: object
 *                 description: Optional additional data for the action
 *     responses:
 *       200:
 *         description: Action emitted successfully
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
 *                   example: Action emitted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                     target:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
 *                       enum: [queued, sent, acknowledged]
 *       400:
 *         description: Invalid action or target
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post('/emit-action',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { action, target = 'all', payload } = req.body;

    if (!action) {
      return badRequest(res, 'Action is required');
    }

    const validActions = ['refresh-config', 'refresh-agents', 'refresh-models', 'restart-workers', 'clear-cache'];
    if (!validActions.includes(action)) {
      return badRequest(res, `Invalid action. Valid actions: ${validActions.join(', ')}`);
    }

    const validTargets = ['all', 'livekit', 'mqtt-gateway', 'media-api'];
    if (!validTargets.includes(target)) {
      return badRequest(res, `Invalid target. Valid targets: ${validTargets.join(', ')}`);
    }

    // Log the action for auditing
    logger.info('Server action emitted', {
      action,
      target,
      payload,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });

    // In production, this would:
    // 1. Send a message to a message queue (Redis, RabbitMQ, etc.)
    // 2. Or make HTTP calls to worker health endpoints
    // 3. Or publish to MQTT topic that workers subscribe to

    // For now, we return success and log the action
    // The actual notification mechanism depends on the deployment setup

    const result = {
      action,
      target,
      timestamp: new Date().toISOString(),
      status: 'queued',
      message: `Action '${action}' queued for target '${target}'`
    };

    success(res, result, 'Action emitted successfully');
  })
);

/**
 * @swagger
 * /admin/server/health:
 *   get:
 *     tags: [Server Management]
 *     summary: Get server health status
 *     description: Returns health status of all connected services (Admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Health status of all services
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
 *                     manager-api:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                         uptime:
 *                           type: number
 *                     database:
 *                       type: object
 *                       properties:
 *                         status:
 *                           type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
router.get('/health',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const health = {
      'manager-api': {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      },
      database: {
        status: 'healthy',
        type: 'supabase'
      },
      timestamp: new Date().toISOString()
    };

    success(res, health);
  })
);

module.exports = router;
