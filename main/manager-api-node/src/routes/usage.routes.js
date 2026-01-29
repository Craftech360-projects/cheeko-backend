/**
 * Token Usage Analytics Routes
 *
 * Provides analytics endpoints for token usage tracking.
 * Base path: /usage
 */

const express = require('express');
const router = express.Router();
const deviceService = require('../services/device.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');

/**
 * @swagger
 * tags:
 *   - name: Usage Analytics
 *     description: Token usage analytics and reporting
 */

/**
 * @swagger
 * /usage/tokens/{macAddress}/session/{sessionId}:
 *   get:
 *     tags: [Usage Analytics]
 *     summary: Get token usage for a specific session
 *     description: Returns token usage data for a specific device session
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: macAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session identifier
 *     responses:
 *       200:
 *         description: Session token usage
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
 *                     macAddress:
 *                       type: string
 *                     sessionId:
 *                       type: string
 *                     usageDate:
 *                       type: string
 *                       format: date
 *                     inputTokens:
 *                       type: integer
 *                     outputTokens:
 *                       type: integer
 *                     totalTokens:
 *                       type: integer
 *                     messageCount:
 *                       type: integer
 *                     sessionDurationSeconds:
 *                       type: number
 *       404:
 *         description: Session not found
 */
router.get('/tokens/:macAddress/session/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { macAddress, sessionId } = req.params;

    try {
      const usage = await deviceService.getSessionTokenUsage(macAddress, sessionId);
      if (!usage) {
        return notFound(res, 'Session usage not found');
      }
      success(res, usage);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /usage/analytics/daily-summary:
 *   get:
 *     tags: [Usage Analytics]
 *     summary: Get daily usage summary across all devices
 *     description: Returns aggregated daily token usage statistics (matches Spring Boot format)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD). Defaults to 30 days ago.
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD). Defaults to today.
 *     responses:
 *       200:
 *         description: Daily usage summary (array)
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
 *                       usage_date:
 *                         type: string
 *                         format: date
 *                       input_tokens:
 *                         type: integer
 *                       output_tokens:
 *                         type: integer
 *                       total_tokens:
 *                         type: integer
 *                       input_text_tokens:
 *                         type: integer
 *                       input_audio_tokens:
 *                         type: integer
 *                       output_text_tokens:
 *                         type: integer
 *                       output_audio_tokens:
 *                         type: integer
 *                       device_count:
 *                         type: integer
 *                       session_count:
 *                         type: integer
 *                       message_count:
 *                         type: integer
 *                       cost_inr:
 *                         type: number
 */
router.get('/analytics/daily-summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.getDailyUsageSummary({
        startDate,
        endDate
      });
      // Return just the list to match Spring Boot format
      success(res, result.list || []);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /usage/analytics/per-device:
 *   get:
 *     tags: [Usage Analytics]
 *     summary: Get per-device daily usage
 *     description: Returns daily token usage broken down by device (matches Spring Boot format)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD). Defaults to 30 days ago.
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD). Defaults to today.
 *     responses:
 *       200:
 *         description: Per-device daily usage (array)
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
 *                       mac_address:
 *                         type: string
 *                       usage_date:
 *                         type: string
 *                         format: date
 *                       input_tokens:
 *                         type: integer
 *                       output_tokens:
 *                         type: integer
 *                       total_tokens:
 *                         type: integer
 *                       input_text_tokens:
 *                         type: integer
 *                       input_audio_tokens:
 *                         type: integer
 *                       output_text_tokens:
 *                         type: integer
 *                       output_audio_tokens:
 *                         type: integer
 *                       session_count:
 *                         type: integer
 *                       message_count:
 *                         type: integer
 *                       cost_inr:
 *                         type: number
 */
router.get('/analytics/per-device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.getPerDeviceDailyUsage({
        startDate,
        endDate
      });
      // Return just the list to match Spring Boot format
      success(res, result.list || []);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /usage/analytics/totals:
 *   get:
 *     tags: [Usage Analytics]
 *     summary: Get overall usage totals
 *     description: Returns aggregated token usage totals across all devices (matches Spring Boot format)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overall usage totals (flat map)
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
 *                     input_tokens:
 *                       type: integer
 *                     output_tokens:
 *                       type: integer
 *                     total_tokens:
 *                       type: integer
 *                     input_text_tokens:
 *                       type: integer
 *                     input_audio_tokens:
 *                       type: integer
 *                     input_cached_tokens:
 *                       type: integer
 *                     output_text_tokens:
 *                       type: integer
 *                     output_audio_tokens:
 *                       type: integer
 *                     session_duration_seconds:
 *                       type: number
 *                     message_count:
 *                       type: integer
 *                     session_count:
 *                       type: integer
 *                     device_count:
 *                       type: integer
 *                     day_count:
 *                       type: integer
 *                     cost_inr:
 *                       type: number
 */
router.get('/analytics/totals',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await deviceService.getUsageTotals({});
      // Transform to flat snake_case format to match Spring Boot
      const totals = result.totals || {};
      const flatResult = {
        input_tokens: totals.inputTokens || 0,
        output_tokens: totals.outputTokens || 0,
        total_tokens: totals.totalTokens || 0,
        input_text_tokens: totals.inputTextTokens || 0,
        input_audio_tokens: totals.inputAudioTokens || 0,
        input_cached_tokens: totals.inputCachedTokens || 0,
        output_text_tokens: totals.outputTextTokens || 0,
        output_audio_tokens: totals.outputAudioTokens || 0,
        session_duration_seconds: totals.sessionDurationSeconds || 0,
        avg_ttft_seconds: totals.avgTtftSeconds || 0,
        message_count: totals.messageCount || 0,
        session_count: totals.sessionCount || 0,
        device_count: totals.deviceCount || 0,
        day_count: totals.dayCount || 0,
        // Frontend-expected aliases
        unique_devices: totals.deviceCount || 0,
        total_sessions: totals.sessionCount || 0,
        total_messages: totals.messageCount || 0,
        // Calculate cost in INR for Gemini 2.5 Flash Native Audio (USD rates × ₹91.99)
        // USD: Text In=$0.50, Audio In=$3.00, Text Out=$2.00, Audio Out=$12.00
        cost_inr: Math.round((
          (totals.inputTextTokens || 0) * 46.00 / 1000000 +     // ₹46.00/1M text input ($0.50 × 91.99)
          (totals.inputAudioTokens || 0) * 276.00 / 1000000 +   // ₹276.00/1M audio input ($3.00 × 91.99)
          (totals.outputTextTokens || 0) * 184.00 / 1000000 +   // ₹184.00/1M text output ($2.00 × 91.99)
          (totals.outputAudioTokens || 0) * 1104.00 / 1000000   // ₹1104.00/1M audio output ($12.00 × 91.99)
        ) * 100) / 100  // Round to 2 decimals
      };
      success(res, flatResult);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
