/**
 * API Routes Index
 *
 * Aggregates all route modules under the /toy context path.
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { testConnection } = require('../config/database');

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
const configRoutes = require('./config.routes');
const usageRoutes = require('./usage.routes');
const otaRoutes = require('./ota.routes');
const otaMagRoutes = require('./otaMag.routes');
const serverRoutes = require('./server.routes');
const paramsRoutes = require('./params.routes');
const dictRoutes = require('./dict.routes');
const ttsVoiceRoutes = require('./ttsVoice.routes');
const emailReportRoutes = require('./emailReport.routes');
const deviceSyncRoutes = require('./deviceSync.routes');
const livekitProvidersRoutes = require('./livekitProviders.routes');

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
 *     description: Tests connectivity to DigitalOcean PostgreSQL database (via Prisma)
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
    const isConnected = await testConnection();
    res.json({
      code: 0,
      msg: 'success',
      data: {
        database: isConnected ? 'connected' : 'disconnected',
        provider: 'DigitalOcean PostgreSQL (Prisma)',
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
 * /health/deps/gemini:
 *   get:
 *     tags: [Health]
 *     summary: Gemini API dependency health check
 *     description: Validates connectivity/auth to Gemini API using models.list endpoint
 *     responses:
 *       200:
 *         description: Gemini dependency is healthy
 *       503:
 *         description: Gemini dependency is unhealthy or not configured
 */
router.get('/health/deps/gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      code: 1,
      msg: 'Gemini API key is not configured',
      data: {
        status: 'not_configured',
        provider: 'gemini',
        timestamp: new Date().toISOString()
      }
    });
  }

  const start = Date.now();

  try {
    const response = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
      params: { key: apiKey, pageSize: 1 },
      timeout: 6000,
      validateStatus: () => true
    });

    const latencyMs = Date.now() - start;

    if (response.status >= 200 && response.status < 300) {
      return res.status(200).json({
        code: 0,
        msg: 'success',
        data: {
          status: 'healthy',
          provider: 'gemini',
          latencyMs,
          timestamp: new Date().toISOString()
        }
      });
    }

    return res.status(503).json({
      code: 1,
      msg: `Gemini API returned status ${response.status}`,
      data: {
        status: 'unhealthy',
        provider: 'gemini',
        statusCode: response.status,
        latencyMs,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(503).json({
      code: 1,
      msg: 'Gemini API check failed',
      data: {
        status: 'unhealthy',
        provider: 'gemini',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * @swagger
 * /health/deps/elevenlabs:
 *   get:
 *     tags: [Health]
 *     summary: ElevenLabs API dependency health check
 *     description: Validates connectivity/auth to ElevenLabs API using models endpoint
 *     responses:
 *       200:
 *         description: ElevenLabs dependency is healthy
 *       503:
 *         description: ElevenLabs dependency is unhealthy or not configured
 */
router.get('/health/deps/elevenlabs', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY;
  const voiceId = (process.env.ELEVENLABS_VOICE_ID || '').trim();

  if (!apiKey) {
    return res.status(503).json({
      code: 1,
      msg: 'ElevenLabs API key is not configured',
      data: {
        status: 'not_configured',
        provider: 'elevenlabs',
        timestamp: new Date().toISOString()
      }
    });
  }
  if (!voiceId) {
    return res.status(503).json({
      code: 1,
      msg: 'ElevenLabs voice id is not configured',
      data: {
        status: 'not_configured',
        provider: 'elevenlabs',
        timestamp: new Date().toISOString()
      }
    });
  }

  const start = Date.now();

  try {
    // Some ElevenLabs keys only have TTS convert permission (no voices_read/models_read),
    // so probe the actual synth endpoint used by the product.
    const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      text: 'ping',
      model_id: process.env.ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5'
    }, {
      headers: {
        'xi-api-key': apiKey,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      timeout: 6000,
      validateStatus: () => true
    });

    const latencyMs = Date.now() - start;

    if (response.status >= 200 && response.status < 300) {
      return res.status(200).json({
        code: 0,
        msg: 'success',
        data: {
          status: 'healthy',
          provider: 'elevenlabs',
          voiceId,
          latencyMs,
          timestamp: new Date().toISOString()
        }
      });
    }

    return res.status(503).json({
      code: 1,
      msg: `ElevenLabs API returned status ${response.status}`,
      data: {
        status: 'unhealthy',
        provider: 'elevenlabs',
        statusCode: response.status,
        latencyMs,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(503).json({
      code: 1,
      msg: 'ElevenLabs API check failed',
      data: {
        status: 'unhealthy',
        provider: 'elevenlabs',
        error: error.message,
        timestamp: new Date().toISOString()
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
router.use('/api/mobile', require('./mobile.routes')); // Firebase-backed mobile endpoints (must come first)
router.use('/api/mobile', profileRoutes); // Legacy profile routes (fallback)
router.use('/models', modelRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/system', systemRoutes);
router.use('/admin', adminRoutes);
router.use('/config', configRoutes);
router.use('/usage', usageRoutes);
router.use('/ota', otaRoutes);
router.use('/otaMag', otaMagRoutes);
router.use('/admin/server', serverRoutes);
router.use('/admin/params', paramsRoutes);
router.use('/admin/dict', dictRoutes);
router.use('/ttsVoice', ttsVoiceRoutes);
router.use('/admin/email-reports', emailReportRoutes);
router.use('/device-sync', deviceSyncRoutes);
router.use('/livekit', livekitProvidersRoutes);

module.exports = router;
