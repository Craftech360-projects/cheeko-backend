/**
 * Quiz Routes
 *
 * Quizzy Question Bank. Base path: /quiz
 *
 * - GET /quiz/next-questions - next scored batch for a device (worker PULL)
 */

const express = require('express');
const router = express.Router();
const quizService = require('../services/quiz.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * @swagger
 * /quiz/next-questions:
 *   get:
 *     tags: [Quiz]
 *     summary: Next scored question batch for a device (worker PULL)
 *     description: Returns the current Level's uncleared active questions for the
 *       device's Age Band and language. Nothing is written on fetch. When every
 *       level in the band is cleared, returns the least recently played level's
 *       full set with replay=true. Service-key auth.
 *     parameters:
 *       - in: query
 *         name: device_mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Question batch (questions may be empty when the bank has no content for the band)
 *       400:
 *         description: device_mac missing
 */
router.get('/next-questions',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }

    const batch = await quizService.nextQuestions(deviceMac);
    logger.info(
      `[QUIZ] GET /quiz/next-questions device=${deviceMac} -> band=${batch.age_band} level=${batch.level} replay=${batch.replay} questions=${batch.questions.length}`
    );
    return success(res, batch);
  })
);

module.exports = router;
