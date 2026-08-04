/**
 * Quiz Routes
 *
 * Quizzy Question Bank. Base path: /quiz
 *
 * - GET  /quiz/next-questions - next scored batch for a device (worker PULL)
 * - POST /quiz/answer         - log one answered question (worker PUSH)
 * - GET  /quiz/progress       - answer-log aggregate for the parent portal
 */

const express = require('express');
const router = express.Router();
const quizService = require('../services/quiz.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { success, created, badRequest } = require('../utils/response');
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

/**
 * @swagger
 * /quiz/answer:
 *   post:
 *     tags: [Quiz]
 *     summary: Log one answered question (worker PUSH)
 *     description: Inserts a single quiz_question_answer row. Results 'correct' and
 *       'revealed' Clear the question, so next-questions stops offering it. Called
 *       per question in real time. Service-key auth.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_mac, question_id, result]
 *             properties:
 *               device_mac:
 *                 type: string
 *               question_id:
 *                 type: string
 *                 description: Question id, sent as a string (BigInt ids are not JSON-serialisable)
 *               result:
 *                 type: string
 *                 enum: [correct, wrong, revealed]
 *     responses:
 *       201:
 *         description: Answer logged
 *       400:
 *         description: Missing field, bad result, or unknown question_id
 */
router.post('/answer',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.body.device_mac || '').trim();
    const questionId = String(req.body.question_id ?? '').trim();
    const result = String(req.body.result || '').trim();

    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }
    if (!questionId) {
      return badRequest(res, 'question_id is required');
    }
    if (!result) {
      return badRequest(res, 'result is required');
    }

    const answer = await quizService.recordAnswer(deviceMac, questionId, result);
    logger.info(
      `[QUIZ] POST /quiz/answer device=${deviceMac} question=${answer.question_id} result=${answer.result}`
    );
    return created(res, answer, 'Answer logged');
  })
);

/**
 * @swagger
 * /quiz/progress:
 *   get:
 *     tags: [Quiz]
 *     summary: Answer-log aggregate for a device (parent portal)
 *     description: Read-only. current_level is the derived Current Level, null once
 *       every level in the band is cleared; levels_completed counts the levels whose
 *       active questions are all Cleared; counts are lifetime totals. Service-key auth.
 *     parameters:
 *       - in: query
 *         name: device_mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progress summary
 *       400:
 *         description: device_mac missing
 */
router.get('/progress',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) {
      return badRequest(res, 'device_mac is required');
    }

    const summary = await quizService.progress(deviceMac);
    logger.info(
      `[QUIZ] GET /quiz/progress device=${deviceMac} -> band=${summary.age_band} level=${summary.current_level} completed=${summary.levels_completed}`
    );
    return success(res, summary);
  })
);

module.exports = router;
