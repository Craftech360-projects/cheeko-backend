/**
 * POST /webhooks/razorpay (SUB-6)
 *
 * Mounted in app.js BEFORE the global JSON body parser: signature checking
 * needs the raw bytes ("do not parse or cast the webhook request body").
 * Contract with Razorpay's delivery: 2xx within 5s or it retries for 24h,
 * then auto-disables the webhook — so config errors return 503 (retryable)
 * and only a bad signature gets the terminal 401.
 */

const express = require('express');
const asyncHandler = require('express-async-handler');
const razorpayService = require('../services/razorpay.service');
const logger = require('../utils/logger');

const router = express.Router();

router.post(
  '/',
  express.raw({ type: '*/*' }),
  asyncHandler(async (req, res) => {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      logger.error('[RAZORPAY] RAZORPAY_WEBHOOK_SECRET not set — webhook rejected');
      return res.status(503).json({ code: 503, msg: 'Webhook secret not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    if (!razorpayService.verifyWebhookSignature(req.body, signature || '')) {
      logger.warn('[RAZORPAY] Webhook signature verification failed');
      return res.status(401).json({ code: 401, msg: 'Invalid signature' });
    }

    const eventId = req.headers['x-razorpay-event-id'];
    if (!eventId) {
      // Signed but unidentifiable — without the id there is no idempotency key.
      return res.status(400).json({ code: 400, msg: 'Missing x-razorpay-event-id' });
    }

    const body = JSON.parse(req.body.toString('utf8'));
    const { outcome } = await razorpayService.processWebhookEvent(eventId, body);
    return res.status(200).json({ code: 0, msg: outcome });
  })
);

module.exports = router;
