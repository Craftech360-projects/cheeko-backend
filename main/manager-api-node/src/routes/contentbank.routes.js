/**
 * Content bank routes. Base path: /content-bank
 *
 * - GET /content-bank/next - the session's content payload for an unscored
 *   character (worker PULL, speculative like /quiz/next-questions). Characters
 *   without a content bank get an empty 200 so the worker can tell "no bank"
 *   from "API down" — only the latter falls back to STARTER MODE noisily.
 */

const express = require('express');
const router = express.Router();
const { nextContent } = require('../services/contentbank.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');

router.get('/next',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const deviceMac = String(req.query.device_mac || '').trim();
    if (!deviceMac) return badRequest(res, 'device_mac is required');
    const character = String(req.query.character || '').trim();
    const result = await nextContent({ character, deviceMac });
    return success(res, result || { bank: null, items: [] });
  }));

module.exports = router;
