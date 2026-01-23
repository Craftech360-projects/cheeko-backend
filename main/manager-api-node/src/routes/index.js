/**
 * API Routes Index
 *
 * Aggregates all route modules under the /toy context path.
 */

const express = require('express');
const router = express.Router();
const { testConnection, supabaseAdmin } = require('../config/database');

// Import route modules
const authRoutes = require('./auth.routes');
const deviceRoutes = require('./device.routes');
const agentRoutes = require('./agent.routes');
const contentRoutes = require('./content.routes');
const rfidRoutes = require('./rfid.routes');
const profileRoutes = require('./profile.routes');
const modelRoutes = require('./model.routes');
const analyticsRoutes = require('./analytics.routes');
const systemRoutes = require('./system.routes');
const adminRoutes = require('./admin.routes');

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check endpoint
 *     description: Returns the health status of the API
 *     responses:
 *       200:
 *         description: API is healthy
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
 *                     status:
 *                       type: string
 *                       example: healthy
 *                     version:
 *                       type: string
 *                       example: 1.0.0
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 */
router.get('/health', (req, res) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      status: 'healthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

/**
 * @swagger
 * /health/db:
 *   get:
 *     tags: [Health]
 *     summary: Database health check
 *     description: Tests connectivity to Supabase database
 *     responses:
 *       200:
 *         description: Database connection status
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
 *                     database:
 *                       type: string
 *                       enum: [connected, disconnected, not_configured]
 */
router.get('/health/db', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.json({
        code: 0,
        msg: 'success',
        data: {
          database: 'not_configured',
          message: 'Supabase credentials not configured'
        }
      });
    }

    const isConnected = await testConnection();
    res.json({
      code: 0,
      msg: 'success',
      data: {
        database: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.json({
      code: 0,
      msg: 'success',
      data: {
        database: 'error',
        message: error.message
      }
    });
  }
});

/**
 * @swagger
 * /pub-config:
 *   get:
 *     tags: [Health]
 *     summary: Get public configuration
 *     description: Returns public configuration values (no auth required)
 *     responses:
 *       200:
 *         description: Public configuration
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
 *                     apiVersion:
 *                       type: string
 *                       example: v1
 *                     features:
 *                       type: object
 */
router.get('/pub-config', (req, res) => {
  res.json({
    code: 0,
    msg: 'success',
    data: {
      apiVersion: 'v1',
      platform: 'node',
      features: {
        rfid: true,
        analytics: true,
        rag: true,
        memory: true
      }
    }
  });
});

// Mount route modules
router.use('/user', authRoutes);
router.use('/device', deviceRoutes);
router.use('/agent', agentRoutes);
router.use('/content', contentRoutes);
router.use('/admin/rfid', rfidRoutes);
router.use('/api/mobile', profileRoutes);
router.use('/models', modelRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/system', systemRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
