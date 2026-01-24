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
 *     description: Returns aggregated daily token usage statistics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
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
 *           default: 30
 *         description: Results per page
 *     responses:
 *       200:
 *         description: Daily usage summary
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
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           inputTokens:
 *                             type: integer
 *                           outputTokens:
 *                             type: integer
 *                           totalTokens:
 *                             type: integer
 *                           deviceCount:
 *                             type: integer
 *                           sessionCount:
 *                             type: integer
 *                           messageCount:
 *                             type: integer
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/analytics/daily-summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.getDailyUsageSummary({
        startDate,
        endDate,
        page,
        limit
      });
      success(res, result);
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
 *     description: Returns daily token usage broken down by device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
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
 *         description: Results per page
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [totalTokens, sessionCount, messageCount, date]
 *           default: totalTokens
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Per-device daily usage
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
 *                         type: object
 *                         properties:
 *                           macAddress:
 *                             type: string
 *                           date:
 *                             type: string
 *                             format: date
 *                           inputTokens:
 *                             type: integer
 *                           outputTokens:
 *                             type: integer
 *                           totalTokens:
 *                             type: integer
 *                           sessionCount:
 *                             type: integer
 *                           messageCount:
 *                             type: integer
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/analytics/per-device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const { startDate, endDate, sortBy, sortOrder } = req.query;

    try {
      const result = await deviceService.getPerDeviceDailyUsage({
        startDate,
        endDate,
        page,
        limit,
        sortBy: sortBy || 'totalTokens',
        sortOrder: sortOrder || 'desc'
      });
      success(res, result);
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
 *     description: Returns aggregated token usage totals across all devices
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Overall usage totals
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
 *                     period:
 *                       type: object
 *                       properties:
 *                         startDate:
 *                           type: string
 *                           format: date
 *                           nullable: true
 *                         endDate:
 *                           type: string
 *                           format: date
 *                           nullable: true
 *                     totals:
 *                       type: object
 *                       properties:
 *                         inputTokens:
 *                           type: integer
 *                         outputTokens:
 *                           type: integer
 *                         totalTokens:
 *                           type: integer
 *                         inputAudioTokens:
 *                           type: integer
 *                         inputTextTokens:
 *                           type: integer
 *                         inputCachedTokens:
 *                           type: integer
 *                         outputAudioTokens:
 *                           type: integer
 *                         outputTextTokens:
 *                           type: integer
 *                         sessionDurationSeconds:
 *                           type: number
 *                         avgTtftSeconds:
 *                           type: number
 *                         messageCount:
 *                           type: integer
 *                         totalResponseDurationSeconds:
 *                           type: number
 *                         sessionCount:
 *                           type: integer
 *                         deviceCount:
 *                           type: integer
 *                         dayCount:
 *                           type: integer
 */
router.get('/analytics/totals',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    try {
      const result = await deviceService.getUsageTotals({
        startDate,
        endDate
      });
      success(res, result);
    } catch (error) {
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
