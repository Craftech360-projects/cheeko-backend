/**
 * Character progress routes. Base path: /progress
 *
 * - POST /progress/session - worker PUSH at session end: final MEMO per type
 * - GET  /progress/state   - worker PULL at bootstrap: current state to restore
 *
 * Both service-key auth: these are worker seams. Parent-app read endpoints
 * belong in the mobile routes when the app defines its contract; the rows in
 * kid_session_progress are already queryable for it.
 */

const express = require('express');
const router = express.Router();
const progressService = require('../services/progress.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');

router.post('/session',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.body?.device_mac || '').trim();
    if (!deviceMac) return badRequest(res, 'device_mac is required');
    const result = await progressService.recordSessionProgress({
      deviceMac,
      character: String(req.body?.character || '').trim() || null,
      memos: req.body?.memos,
      // { bank, codes } — what the content bank served this session, for the
      // no-repeat ledger. Absent for characters with no content bank.
      content: req.body?.content,
    });
    return success(res, result);
  }));

router.get('/state',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) return badRequest(res, 'device_mac is required');
    const states = await progressService.getCurrentState(deviceMac);
    return success(res, { states });
  }));

module.exports = router;
