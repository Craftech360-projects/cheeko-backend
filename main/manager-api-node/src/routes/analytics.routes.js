/**
 * Analytics Routes
 *
 * Handles game session tracking, game attempts, media playback,
 * streaks, and user progress analytics.
 * Base path: /analytics
 */

const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireServiceKey } = require('../middleware/auth');
const { success, badRequest, notFound } = require('../utils/response');
const { isValidMacAddress } = require('../utils/helpers');

/**
 * @swagger
 * components:
 *   schemas:
 *     GameSession:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Session record ID
 *         session_id:
 *           type: string
 *           description: Unique session identifier
 *         mac_address:
 *           type: string
 *           description: Device MAC address
 *         agent_id:
 *           type: string
 *           description: Associated agent ID
 *         mode_type:
 *           type: string
 *           enum: [Conversation, Math, Riddle, WordLadder, Music, Story]
 *           description: Session mode type
 *         started_at:
 *           type: string
 *           format: date-time
 *           description: Session start time
 *         ended_at:
 *           type: string
 *           format: date-time
 *           description: Session end time
 *         duration_seconds:
 *           type: integer
 *           description: Session duration in seconds
 *         interaction_count:
 *           type: integer
 *           description: Number of interactions in session
 *         completion_status:
 *           type: string
 *           enum: [completed, interrupted, switched, victory, failure]
 *           description: How session ended
 *         metadata:
 *           type: object
 *           description: Additional session data
 *     GameAttempt:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Attempt record ID
 *         session_id:
 *           type: string
 *           description: Associated session ID
 *         mac_address:
 *           type: string
 *           description: Device MAC address
 *         game_type:
 *           type: string
 *           enum: [math_tutor, riddle_solver, word_ladder]
 *           description: Type of game
 *         question_text:
 *           type: string
 *           description: The question asked
 *         question_type:
 *           type: string
 *           description: Type of question (e.g., addition, animal-riddle)
 *         difficulty_level:
 *           type: string
 *           enum: [easy, medium, hard]
 *           description: Question difficulty
 *         correct_answer:
 *           type: string
 *           description: The correct answer
 *         user_answer:
 *           type: string
 *           description: User's answer
 *         is_correct:
 *           type: boolean
 *           description: Whether answer was correct
 *         attempt_number:
 *           type: integer
 *           description: Attempt number (1 or 2 for retry)
 *         response_time_ms:
 *           type: integer
 *           description: Time taken to answer in milliseconds
 *         answered_at:
 *           type: string
 *           format: date-time
 *           description: When answer was submitted
 *         metadata:
 *           type: object
 *           description: Additional attempt data
 *     MediaPlayback:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Playback record ID
 *         session_id:
 *           type: string
 *           description: Associated session ID
 *         mac_address:
 *           type: string
 *           description: Device MAC address
 *         media_type:
 *           type: string
 *           enum: [music, story]
 *           description: Type of media
 *         media_id:
 *           type: string
 *           description: Content item ID
 *         media_title:
 *           type: string
 *           description: Content item title
 *         started_at:
 *           type: string
 *           format: date-time
 *           description: Playback start time
 *         ended_at:
 *           type: string
 *           format: date-time
 *           description: Playback end time
 *         duration_played_seconds:
 *           type: integer
 *           description: Time played in seconds
 *         total_duration_seconds:
 *           type: integer
 *           description: Total content duration
 *         completion_percentage:
 *           type: number
 *           description: Percentage completed (0-100)
 *         skip_action:
 *           type: string
 *           enum: [next, previous, stop, null]
 *           description: Skip action if any
 *     Streak:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Streak record ID
 *         session_id:
 *           type: string
 *           description: Associated session ID
 *         mac_address:
 *           type: string
 *           description: Device MAC address
 *         game_type:
 *           type: string
 *           description: Game type for streak
 *         streak_number:
 *           type: integer
 *           description: Streak sequence number
 *         questions_in_streak:
 *           type: integer
 *           description: Consecutive correct answers
 *         started_at:
 *           type: string
 *           format: date-time
 *           description: Streak start time
 *         ended_at:
 *           type: string
 *           format: date-time
 *           description: Streak end time
 *         duration_seconds:
 *           type: integer
 *           description: Streak duration in seconds
 *     UserProgress:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Progress record ID
 *         mac_address:
 *           type: string
 *           description: Device MAC address
 *         mode_type:
 *           type: string
 *           description: Mode type for progress
 *         total_sessions:
 *           type: integer
 *           description: Total sessions played
 *         total_time_seconds:
 *           type: integer
 *           description: Total time played in seconds
 *         total_interactions:
 *           type: integer
 *           description: Total interactions
 *         success_rate_percentage:
 *           type: number
 *           description: Overall success rate
 *         longest_streak:
 *           type: integer
 *           description: Longest streak achieved
 *         skill_level:
 *           type: string
 *           enum: [beginner, intermediate, advanced]
 *           description: Current skill level
 *     OverallStats:
 *       type: object
 *       properties:
 *         totalSessions:
 *           type: integer
 *           description: Total sessions played
 *         totalTimeSeconds:
 *           type: integer
 *           description: Total time played
 *         totalAttempts:
 *           type: integer
 *           description: Total game attempts
 *         correctAttempts:
 *           type: integer
 *           description: Correct game attempts
 *         overallAccuracy:
 *           type: number
 *           description: Overall accuracy percentage
 *         longestStreak:
 *           type: integer
 *           description: Longest streak achieved
 *         progressByMode:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserProgress'
 *     GameStats:
 *       type: object
 *       properties:
 *         gameType:
 *           type: string
 *           description: Game type
 *         totalAttempts:
 *           type: integer
 *           description: Total attempts for this game
 *         correctAttempts:
 *           type: integer
 *           description: Correct attempts
 *         accuracy:
 *           type: number
 *           description: Accuracy percentage
 *         averageResponseTimeMs:
 *           type: integer
 *           description: Average response time in ms
 *         longestStreak:
 *           type: integer
 *           description: Longest streak for this game
 *         byDifficulty:
 *           type: object
 *           description: Stats grouped by difficulty
 *         byQuestionType:
 *           type: object
 *           description: Stats grouped by question type
 */

// =============================================
// Session Management (Service Auth)
// =============================================

/**
 * @swagger
 * /analytics/session/start:
 *   post:
 *     tags: [Analytics]
 *     summary: Start a new game session
 *     description: Creates a new game session. Called by LiveKit agents via service auth.
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *               - modeType
 *             properties:
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *                 example: "AA:BB:CC:DD:EE:FF"
 *               agentId:
 *                 type: string
 *                 description: Agent ID
 *               modeType:
 *                 type: string
 *                 enum: [Conversation, Math, Riddle, WordLadder, Music, Story]
 *                 description: Session mode type
 *               metadata:
 *                 type: object
 *                 description: Additional session metadata
 *     responses:
 *       200:
 *         description: Session started successfully
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
 *                   $ref: '#/components/schemas/GameSession'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/session/start', requireServiceKey, asyncHandler(async (req, res) => {
  const { mac, agentId, modeType, metadata } = req.body;

  if (!mac) {
    return badRequest(res, 'MAC address is required');
  }

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  if (!modeType) {
    return badRequest(res, 'Mode type is required');
  }

  const session = await analyticsService.startSession({
    mac,
    agentId,
    modeType,
    metadata
  });

  return success(res, session);
}));

/**
 * @swagger
 * /analytics/session/end:
 *   post:
 *     tags: [Analytics]
 *     summary: End a game session
 *     description: Ends an existing game session. Called by LiveKit agents via service auth.
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Session ID to end
 *               completionStatus:
 *                 type: string
 *                 enum: [completed, interrupted, switched, victory, failure]
 *                 description: How session ended
 *               interactionCount:
 *                 type: integer
 *                 description: Final interaction count
 *               metadata:
 *                 type: object
 *                 description: Additional end metadata
 *     responses:
 *       200:
 *         description: Session ended successfully
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
 *                   $ref: '#/components/schemas/GameSession'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Session not found
 */
router.post('/session/end', requireServiceKey, asyncHandler(async (req, res) => {
  const { sessionId, completionStatus, interactionCount, metadata } = req.body;

  if (!sessionId) {
    return badRequest(res, 'Session ID is required');
  }

  try {
    const session = await analyticsService.endSession(sessionId, {
      completionStatus,
      interactionCount,
      metadata
    });
    return success(res, session);
  } catch (error) {
    if (error.message === 'Session not found') {
      return notFound(res, 'Session not found');
    }
    throw error;
  }
}));

// =============================================
// Game Attempts (Service Auth)
// =============================================

/**
 * @swagger
 * /analytics/game-attempt:
 *   post:
 *     tags: [Analytics]
 *     summary: Log a game attempt
 *     description: Records a game answer attempt. Called by LiveKit agents via service auth.
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - mac
 *               - gameType
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Session ID
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               gameType:
 *                 type: string
 *                 enum: [math_tutor, riddle_solver, word_ladder]
 *                 description: Type of game
 *               questionText:
 *                 type: string
 *                 description: The question asked
 *               questionType:
 *                 type: string
 *                 description: Type of question
 *               difficultyLevel:
 *                 type: string
 *                 enum: [easy, medium, hard]
 *               correctAnswer:
 *                 type: string
 *                 description: The correct answer
 *               userAnswer:
 *                 type: string
 *                 description: User's answer
 *               isCorrect:
 *                 type: boolean
 *                 description: Whether answer was correct
 *               attemptNumber:
 *                 type: integer
 *                 description: Attempt number (1 or 2)
 *               responseTimeMs:
 *                 type: integer
 *                 description: Response time in ms
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Attempt logged successfully
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
 *                   $ref: '#/components/schemas/GameAttempt'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/game-attempt', requireServiceKey, asyncHandler(async (req, res) => {
  const {
    sessionId,
    mac,
    gameType,
    questionText,
    questionType,
    difficultyLevel,
    correctAnswer,
    userAnswer,
    isCorrect,
    attemptNumber,
    responseTimeMs,
    metadata
  } = req.body;

  if (!sessionId) {
    return badRequest(res, 'Session ID is required');
  }

  if (!mac) {
    return badRequest(res, 'MAC address is required');
  }

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  if (!gameType) {
    return badRequest(res, 'Game type is required');
  }

  const attempt = await analyticsService.logGameAttempt({
    sessionId,
    mac,
    gameType,
    questionText,
    questionType,
    difficultyLevel,
    correctAnswer,
    userAnswer,
    isCorrect,
    attemptNumber,
    responseTimeMs,
    metadata
  });

  return success(res, attempt);
}));

// =============================================
// Media Events (Service Auth)
// =============================================

/**
 * @swagger
 * /analytics/media-event:
 *   post:
 *     tags: [Analytics]
 *     summary: Log a media playback event
 *     description: Records media start/end/skip events. Called by LiveKit agents via service auth.
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *               - mediaType
 *               - event
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Session ID
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               mediaType:
 *                 type: string
 *                 enum: [music, story]
 *               mediaId:
 *                 type: string
 *                 description: Content item ID
 *               mediaTitle:
 *                 type: string
 *                 description: Content item title
 *               event:
 *                 type: string
 *                 enum: [start, end, skip]
 *                 description: Event type
 *               durationPlayedSeconds:
 *                 type: integer
 *                 description: Time played in seconds
 *               totalDurationSeconds:
 *                 type: integer
 *                 description: Total content duration
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Event logged successfully
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
 *                   $ref: '#/components/schemas/MediaPlayback'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/media-event', requireServiceKey, asyncHandler(async (req, res) => {
  const {
    sessionId,
    mac,
    mediaType,
    mediaId,
    mediaTitle,
    event,
    durationPlayedSeconds,
    totalDurationSeconds,
    metadata
  } = req.body;

  if (!mac) {
    return badRequest(res, 'MAC address is required');
  }

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  if (!mediaType) {
    return badRequest(res, 'Media type is required');
  }

  if (!event) {
    return badRequest(res, 'Event type is required');
  }

  if (!['start', 'end', 'skip'].includes(event)) {
    return badRequest(res, 'Invalid event type. Must be: start, end, or skip');
  }

  const playback = await analyticsService.logMediaEvent({
    sessionId,
    mac,
    mediaType,
    mediaId,
    mediaTitle,
    event,
    durationPlayedSeconds,
    totalDurationSeconds,
    metadata
  });

  return success(res, playback);
}));

// =============================================
// Streaks (Service Auth)
// =============================================

/**
 * @swagger
 * /analytics/streak:
 *   post:
 *     tags: [Analytics]
 *     summary: Log a streak
 *     description: Records a game streak. Called by LiveKit agents via service auth.
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - mac
 *               - gameType
 *               - streakNumber
 *               - questionsInStreak
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Session ID
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               gameType:
 *                 type: string
 *                 description: Game type for streak
 *               streakNumber:
 *                 type: integer
 *                 description: Streak sequence number
 *               questionsInStreak:
 *                 type: integer
 *                 description: Consecutive correct answers
 *               startedAt:
 *                 type: string
 *                 format: date-time
 *               endedAt:
 *                 type: string
 *                 format: date-time
 *               durationSeconds:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Streak logged successfully
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
 *                   $ref: '#/components/schemas/Streak'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/streak', requireServiceKey, asyncHandler(async (req, res) => {
  const {
    sessionId,
    mac,
    gameType,
    streakNumber,
    questionsInStreak,
    startedAt,
    endedAt,
    durationSeconds
  } = req.body;

  if (!sessionId) {
    return badRequest(res, 'Session ID is required');
  }

  if (!mac) {
    return badRequest(res, 'MAC address is required');
  }

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  if (!gameType) {
    return badRequest(res, 'Game type is required');
  }

  if (streakNumber === undefined) {
    return badRequest(res, 'Streak number is required');
  }

  if (questionsInStreak === undefined) {
    return badRequest(res, 'Questions in streak is required');
  }

  const streak = await analyticsService.logStreak({
    sessionId,
    mac,
    gameType,
    streakNumber,
    questionsInStreak,
    startedAt,
    endedAt,
    durationSeconds
  });

  return success(res, streak);
}));

// =============================================
// Statistics (OAuth Auth)
// =============================================

/**
 * @swagger
 * /analytics/user/{mac}/overall:
 *   get:
 *     tags: [Analytics]
 *     summary: Get overall user statistics
 *     description: Returns aggregated statistics for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Overall statistics
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
 *                   $ref: '#/components/schemas/OverallStats'
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user/:mac/overall', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getOverallStats(mac);
  return success(res, stats);
}));

/**
 * @swagger
 * /analytics/user/{mac}/math:
 *   get:
 *     tags: [Analytics]
 *     summary: Get math tutor statistics
 *     description: Returns statistics for math tutor game
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Math statistics
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
 *                   $ref: '#/components/schemas/GameStats'
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user/:mac/math', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getGameStats(mac, 'math_tutor');
  return success(res, stats);
}));

/**
 * @swagger
 * /analytics/user/{mac}/riddle:
 *   get:
 *     tags: [Analytics]
 *     summary: Get riddle solver statistics
 *     description: Returns statistics for riddle solver game
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Riddle statistics
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
 *                   $ref: '#/components/schemas/GameStats'
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user/:mac/riddle', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getGameStats(mac, 'riddle_solver');
  return success(res, stats);
}));

/**
 * @swagger
 * /analytics/user/{mac}/wordladder:
 *   get:
 *     tags: [Analytics]
 *     summary: Get word ladder statistics
 *     description: Returns statistics for word ladder game
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Word ladder statistics
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
 *                   $ref: '#/components/schemas/GameStats'
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user/:mac/wordladder', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getGameStats(mac, 'word_ladder');
  return success(res, stats);
}));

/**
 * @swagger
 * /analytics/sessions/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get sessions for device
 *     description: Returns paginated list of sessions for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
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
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: modeType
 *         schema:
 *           type: string
 *         description: Filter by mode type
 *     responses:
 *       200:
 *         description: List of sessions
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
 *                     list:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GameSession'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/sessions/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;
  const { page = 1, limit = 10, modeType } = req.query;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const sessions = await analyticsService.getSessionsByMac(mac, {
    page: parseInt(page),
    limit: parseInt(limit),
    modeType
  });

  return success(res, sessions);
}));

/**
 * @swagger
 * /analytics/usage/daily/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get daily usage statistics
 *     description: Returns daily usage data for the specified number of days
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *         description: Number of days to retrieve
 *     responses:
 *       200:
 *         description: Daily usage data
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
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       sessionCount:
 *                         type: integer
 *                       totalSeconds:
 *                         type: integer
 *                       byMode:
 *                         type: object
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/usage/daily/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;
  const { days = 7 } = req.query;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const usage = await analyticsService.getDailyUsage(mac, parseInt(days));
  return success(res, usage);
}));

/**
 * @swagger
 * /analytics/usage/weekly/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get weekly usage statistics
 *     description: Returns weekly usage data for the specified number of weeks
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: weeks
 *         schema:
 *           type: integer
 *           default: 4
 *         description: Number of weeks to retrieve
 *     responses:
 *       200:
 *         description: Weekly usage data
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
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       week:
 *                         type: string
 *                         example: "2026-W04"
 *                         description: ISO week identifier (YYYY-Www)
 *                       weekStart:
 *                         type: string
 *                         format: date
 *                         description: Week start date (Monday)
 *                       weekEnd:
 *                         type: string
 *                         format: date
 *                         description: Week end date (Sunday)
 *                       sessionCount:
 *                         type: integer
 *                         description: Number of sessions in the week
 *                       totalSeconds:
 *                         type: integer
 *                         description: Total time played in seconds
 *                       byMode:
 *                         type: object
 *                         description: Usage breakdown by mode type
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/usage/weekly/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;
  const { weeks = 4 } = req.query;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const usage = await analyticsService.getWeeklyUsage(mac, parseInt(weeks));
  return success(res, usage);
}));

/**
 * @swagger
 * /analytics/usage/monthly/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get monthly usage statistics
 *     description: Returns monthly usage data for the specified number of months
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *           default: 6
 *         description: Number of months to retrieve
 *     responses:
 *       200:
 *         description: Monthly usage data
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
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       month:
 *                         type: string
 *                         example: "2026-01"
 *                         description: Month identifier (YYYY-MM)
 *                       monthStart:
 *                         type: string
 *                         format: date
 *                         description: Month start date
 *                       monthEnd:
 *                         type: string
 *                         format: date
 *                         description: Month end date
 *                       sessionCount:
 *                         type: integer
 *                         description: Number of sessions in the month
 *                       totalSeconds:
 *                         type: integer
 *                         description: Total time played in seconds
 *                       byMode:
 *                         type: object
 *                         description: Usage breakdown by mode type
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/usage/monthly/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;
  const { months = 6 } = req.query;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const usage = await analyticsService.getMonthlyUsage(mac, parseInt(months));
  return success(res, usage);
}));

// =============================================
// Extended Analytics - Individual Getters
// =============================================

/**
 * @swagger
 * /analytics/session-by-id/{id}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get session by ID
 *     description: Returns a single session by its database ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Session database ID
 *     responses:
 *       200:
 *         description: Session details
 *       404:
 *         description: Session not found
 *       401:
 *         description: Unauthorized
 */
router.get('/session-by-id/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const session = await analyticsService.getSessionById(parseInt(id));
  if (!session) {
    return notFound(res, 'Session not found');
  }

  return success(res, session);
}));

/**
 * @swagger
 * /analytics/sessions:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all sessions with pagination
 *     description: Returns paginated list of all sessions with optional filters
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
 *           default: 20
 *       - in: query
 *         name: mac
 *         schema:
 *           type: string
 *         description: Filter by MAC address
 *       - in: query
 *         name: modeType
 *         schema:
 *           type: string
 *         description: Filter by mode type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Paginated session list
 *       401:
 *         description: Unauthorized
 */
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, mac, modeType, startDate, endDate } = req.query;

  const sessions = await analyticsService.getAllSessions({
    page: parseInt(page),
    limit: parseInt(limit),
    mac,
    modeType,
    startDate,
    endDate
  });

  return success(res, sessions);
}));

/**
 * @swagger
 * /analytics/attempts/stats/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get attempt statistics by question type
 *     description: Returns attempt statistics grouped by question type for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Attempt statistics by question type
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/attempts/stats/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getAttemptStatsByQuestionType(mac);
  return success(res, stats);
}));

/**
 * @swagger
 * /analytics/attempts/{id}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get attempt by ID
 *     description: Returns a single game attempt by its database ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Attempt database ID
 *     responses:
 *       200:
 *         description: Attempt details
 *       404:
 *         description: Attempt not found
 *       401:
 *         description: Unauthorized
 */
router.get('/attempts/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const attempt = await analyticsService.getAttemptById(parseInt(id));
  if (!attempt) {
    return notFound(res, 'Attempt not found');
  }

  return success(res, attempt);
}));

/**
 * @swagger
 * /analytics/attempts:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all attempts with pagination
 *     description: Returns paginated list of all game attempts with optional filters
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
 *           default: 20
 *       - in: query
 *         name: mac
 *         schema:
 *           type: string
 *         description: Filter by MAC address
 *       - in: query
 *         name: gameType
 *         schema:
 *           type: string
 *         description: Filter by game type
 *       - in: query
 *         name: questionType
 *         schema:
 *           type: string
 *         description: Filter by question type
 *     responses:
 *       200:
 *         description: Paginated attempt list
 *       401:
 *         description: Unauthorized
 */
router.get('/attempts', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, mac, gameType, questionType } = req.query;

  const attempts = await analyticsService.getAllAttempts({
    page: parseInt(page),
    limit: parseInt(limit),
    mac,
    gameType,
    questionType
  });

  return success(res, attempts);
}));

/**
 * @swagger
 * /analytics/media-playback/{id}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get media playback by ID
 *     description: Returns a single media playback record by its database ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Media playback database ID
 *     responses:
 *       200:
 *         description: Media playback details
 *       404:
 *         description: Media playback not found
 *       401:
 *         description: Unauthorized
 */
router.get('/media-playback/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const playback = await analyticsService.getMediaPlaybackById(parseInt(id));
  if (!playback) {
    return notFound(res, 'Media playback not found');
  }

  return success(res, playback);
}));

/**
 * @swagger
 * /analytics/media-playback:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all media playback with pagination
 *     description: Returns paginated list of all media playback records with optional filters
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
 *           default: 20
 *       - in: query
 *         name: mac
 *         schema:
 *           type: string
 *         description: Filter by MAC address
 *       - in: query
 *         name: mediaType
 *         schema:
 *           type: string
 *           enum: [music, story]
 *         description: Filter by media type
 *     responses:
 *       200:
 *         description: Paginated media playback list
 *       401:
 *         description: Unauthorized
 */
router.get('/media-playback', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, mac, mediaType } = req.query;

  const playback = await analyticsService.getAllMediaPlayback({
    page: parseInt(page),
    limit: parseInt(limit),
    mac,
    mediaType
  });

  return success(res, playback);
}));

/**
 * @swagger
 * /analytics/streaks/{id}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get streak by ID
 *     description: Returns a single streak record by its database ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Streak database ID
 *     responses:
 *       200:
 *         description: Streak details
 *       404:
 *         description: Streak not found
 *       401:
 *         description: Unauthorized
 */
router.get('/streaks/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const streak = await analyticsService.getStreakById(parseInt(id));
  if (!streak) {
    return notFound(res, 'Streak not found');
  }

  return success(res, streak);
}));

/**
 * @swagger
 * /analytics/streaks:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all streaks with pagination
 *     description: Returns paginated list of all streaks with optional filters
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
 *           default: 20
 *       - in: query
 *         name: mac
 *         schema:
 *           type: string
 *         description: Filter by MAC address
 *       - in: query
 *         name: gameType
 *         schema:
 *           type: string
 *         description: Filter by game type
 *     responses:
 *       200:
 *         description: Paginated streak list
 *       401:
 *         description: Unauthorized
 */
router.get('/streaks', requireAuth, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, mac, gameType } = req.query;

  const streaks = await analyticsService.getAllStreaks({
    page: parseInt(page),
    limit: parseInt(limit),
    mac,
    gameType
  });

  return success(res, streaks);
}));

// =============================================
// Extended Analytics - User Progress
// =============================================

/**
 * @swagger
 * /analytics/user-progress/{mac}/{modeType}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get user progress by mode
 *     description: Returns user progress for a specific mode type
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *       - in: path
 *         name: modeType
 *         required: true
 *         schema:
 *           type: string
 *         description: Mode type (e.g., Math, Riddle, WordLadder)
 *     responses:
 *       200:
 *         description: User progress for mode
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user-progress/:mac/:modeType', requireAuth, asyncHandler(async (req, res) => {
  const { mac, modeType } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const progress = await analyticsService.getUserProgress(mac, modeType);
  return success(res, progress);
}));

/**
 * @swagger
 * /analytics/user-progress/{mac}:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all user progress for device
 *     description: Returns all user progress records for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: All user progress for device
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user-progress/:mac', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const progress = await analyticsService.getUserProgress(mac);
  return success(res, progress);
}));

/**
 * @swagger
 * /analytics/user-progress/update:
 *   post:
 *     tags: [Analytics]
 *     summary: Update user progress
 *     description: Updates aggregated user progress for a device/mode
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mac
 *               - modeType
 *             properties:
 *               mac:
 *                 type: string
 *                 description: Device MAC address
 *               modeType:
 *                 type: string
 *                 description: Mode type
 *               totalSessions:
 *                 type: integer
 *               totalTimeSeconds:
 *                 type: integer
 *               totalInteractions:
 *                 type: integer
 *               successRatePercentage:
 *                 type: number
 *               longestStreak:
 *                 type: integer
 *               skillLevel:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced]
 *     responses:
 *       200:
 *         description: Progress updated successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/user-progress/update', requireServiceKey, asyncHandler(async (req, res) => {
  const { mac, modeType, ...progressData } = req.body;

  if (!mac) {
    return badRequest(res, 'MAC address is required');
  }

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  if (!modeType) {
    return badRequest(res, 'Mode type is required');
  }

  const progress = await analyticsService.updateUserProgress(mac, modeType, progressData);
  return success(res, progress, 'Progress updated successfully');
}));

// =============================================
// Extended Analytics - Media Stats
// =============================================

/**
 * @swagger
 * /analytics/user/{mac}/media:
 *   get:
 *     tags: [Analytics]
 *     summary: Get media playback stats
 *     description: Returns music and story playback statistics for a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     responses:
 *       200:
 *         description: Media playback statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     music:
 *                       type: object
 *                       properties:
 *                         totalPlays:
 *                           type: integer
 *                         totalDuration:
 *                           type: integer
 *                         uniqueTracks:
 *                           type: integer
 *                         favorites:
 *                           type: array
 *                     story:
 *                       type: object
 *                       properties:
 *                         totalPlays:
 *                           type: integer
 *                         totalDuration:
 *                           type: integer
 *                         uniqueStories:
 *                           type: integer
 *                         favorites:
 *                           type: array
 *       400:
 *         description: Invalid MAC address
 *       401:
 *         description: Unauthorized
 */
router.get('/user/:mac/media', requireAuth, asyncHandler(async (req, res) => {
  const { mac } = req.params;

  if (!isValidMacAddress(mac)) {
    return badRequest(res, 'Invalid MAC address format');
  }

  const stats = await analyticsService.getMediaStats(mac);
  return success(res, stats);
}));

// =============================================
// Extended Analytics - Device Activity
// =============================================

/**
 * @swagger
 * /analytics/today/device-count:
 *   get:
 *     tags: [Analytics]
 *     summary: Count devices interacted today
 *     description: Returns the count of unique devices that have had sessions today
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Device count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/today/device-count', requireAuth, asyncHandler(async (req, res) => {
  const count = await analyticsService.getTodayDeviceCount();
  return success(res, { count });
}));

/**
 * @swagger
 * /analytics/month/device-count:
 *   get:
 *     tags: [Analytics]
 *     summary: Count devices interacted this month
 *     description: Returns the count of unique devices that have had sessions this month
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Device count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/month/device-count', requireAuth, asyncHandler(async (req, res) => {
  const count = await analyticsService.getMonthDeviceCount();
  return success(res, { count });
}));

/**
 * @swagger
 * /analytics/today/active-devices:
 *   get:
 *     tags: [Analytics]
 *     summary: List active devices today
 *     description: Returns list of devices that have had sessions today with summary stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       macAddress:
 *                         type: string
 *                       sessionCount:
 *                         type: integer
 *                       totalDuration:
 *                         type: integer
 *                       lastSession:
 *                         type: string
 *                         format: date-time
 *                       modes:
 *                         type: array
 *                         items:
 *                           type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/today/active-devices', requireAuth, asyncHandler(async (req, res) => {
  const devices = await analyticsService.getTodayActiveDevices();
  return success(res, devices);
}));

/**
 * @swagger
 * /analytics/month/active-devices:
 *   get:
 *     tags: [Analytics]
 *     summary: List active devices this month
 *     description: Returns list of devices that have had sessions this month with summary stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       macAddress:
 *                         type: string
 *                       sessionCount:
 *                         type: integer
 *                       totalDuration:
 *                         type: integer
 *                       lastSession:
 *                         type: string
 *                         format: date-time
 *                       modes:
 *                         type: array
 *                         items:
 *                           type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/month/active-devices', requireAuth, asyncHandler(async (req, res) => {
  const devices = await analyticsService.getMonthActiveDevices();
  return success(res, devices);
}));

module.exports = router;
