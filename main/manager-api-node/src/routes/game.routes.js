/**
 * Game progression routes.
 * All endpoints use service key auth (backend-to-backend from livekit-server).
 */
const express = require('express');
const router = express.Router();
const gameProgressService = require('../services/game-progress.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest } = require('../utils/response');

// GET /game/progress/:childId/:gameType
router.get('/progress/:childId/:gameType', requireServiceKey, asyncHandler(async (req, res) => {
  const { childId, gameType } = req.params;
  const progress = await gameProgressService.getProgress(childId, gameType);
  success(res, progress);
}));

// GET /game/progress/:childId
router.get('/progress/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const { childId } = req.params;
  const progress = await gameProgressService.getAllProgress(childId);
  success(res, progress);
}));

// POST /game/session/end
router.post('/session/end', requireServiceKey, validate({ body: schemas.sessionEnd }),
  asyncHandler(async (req, res) => {
    const result = await gameProgressService.endSession(req.body);
    success(res, result);
  })
);

// GET /game/streak/:childId
router.get('/streak/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const streak = await gameProgressService.getStreak(req.params.childId);
  success(res, streak);
}));

// POST /game/streak/:childId/freeze
router.post('/streak/:childId/freeze', requireServiceKey, asyncHandler(async (req, res) => {
  const result = await gameProgressService.useStreakFreeze(req.params.childId);
  success(res, result);
}));

// GET /game/achievements/:childId
router.get('/achievements/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const achievements = await gameProgressService.getAchievements(req.params.childId);
  success(res, achievements);
}));

// GET /game/achievements/:childId/unannounced
router.get('/achievements/:childId/unannounced', requireServiceKey, asyncHandler(async (req, res) => {
  const achievements = await gameProgressService.getUnannouncedAchievements(req.params.childId);
  success(res, achievements);
}));

// POST /game/achievements/:childId/announce
router.post('/achievements/:childId/announce', requireServiceKey, asyncHandler(async (req, res) => {
  const { codes } = req.body;
  if (!codes || !Array.isArray(codes)) return badRequest(res, 'codes array required');
  await gameProgressService.markAchievementsAnnounced(req.params.childId, codes);
  success(res, { announced: codes.length });
}));

// GET /game/missions/:childId
router.get('/missions/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const ageBand = req.query.ageBand || 'explorer';
  const missions = await gameProgressService.getDailyMissions(req.params.childId, ageBand);
  success(res, missions);
}));

module.exports = router;
