/**
 * POST /webhooks/revenuecat (SUB-15)
 *
 * RevenueCat retries failed deliveries with backoff, so config errors return
 * 503 (retryable) and only a bad Authorization value gets the terminal 401.
 * JSON body — no raw-body HMAC on these rails, mounts after the JSON parser.
 */

const express = require('express');
const asyncHandler = require('express-async-handler');
const revenuecatService = require('../services/revenuecat.service');
const logger = require('../utils/logger');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!process.env.REVENUECAT_WEBHOOK_AUTH) {
      logger.error('[REVENUECAT] REVENUECAT_WEBHOOK_AUTH not set — webhook rejected');
      return res.status(503).json({ code: 503, msg: 'Webhook auth not configured' });
    }

    if (!revenuecatService.verifyWebhookAuth(req.headers.authorization)) {
      logger.warn('[REVENUECAT] Webhook Authorization mismatch');
      return res.status(401).json({ code: 401, msg: 'Invalid authorization' });
    }

    const event = req.body?.event;
    if (!event?.id) {
      // Authorized but unidentifiable — no idempotency key.
      return res.status(400).json({ code: 400, msg: 'Missing event.id' });
    }

    const { outcome } = await revenuecatService.processWebhookEvent(event);
    return res.status(200).json({ code: 0, msg: outcome });
  })
);

module.exports = router;
