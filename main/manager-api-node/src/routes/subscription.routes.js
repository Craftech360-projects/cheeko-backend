/**
 * Subscription Routes
 *
 * Unified quota check for agent workers (supports question/token/time).
 * Token consumption endpoint for token-based plans.
 * Admin endpoints for plan and subscription management.
 */

const express = require('express');
const router = express.Router();
const subscriptionService = require('../services/subscription.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey, requireAdmin, requireAuth } = require('../middleware/auth');
const { success, badRequest } = require('../utils/response');
const logger = require('../utils/logger');
const { supabaseAdmin } = require('../config/database');
const { getCurrentMonthKey, isValidMonthKey } = require('../services/quota.service');
const { getParamValue, getParamByCode, createParam, updateParam } = require('../services/system.service');

// ==================== AGENT WORKER ENDPOINTS (Service Key) ====================

/**
 * @swagger
 * /subscription/quota/{mac}:
 *   get:
 *     tags: [Subscription]
 *     summary: Unified quota check for a device
 *     description: |
 *       Returns quota_type (question/token/time), remaining, weights, and plan info.
 *       Used by agent workers at session start to determine which quota system to use.
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Unified quota status
 */
router.get('/quota/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    if (!mac) return badRequest(res, 'MAC address is required');

    try {
      const quota = await subscriptionService.getUnifiedQuota(mac);
      success(res, quota, 'Quota retrieved');
    } catch (error) {
      logger.error('Error getting unified quota:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== TOKEN CONSUMPTION (Service Key) ====================

/**
 * @swagger
 * /quota/consume/token/{mac}:
 *   post:
 *     tags: [Subscription]
 *     summary: Consume weighted tokens for a device
 *     description: |
 *       Called by agent workers on each turn for token-based plans.
 *       Accepts pre-calculated weighted tokens + raw counts.
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weightedTokens, rawInput, rawOutput]
 *             properties:
 *               weightedTokens:
 *                 type: number
 *               rawInput:
 *                 type: integer
 *               rawOutput:
 *                 type: integer
 *               monthKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated token quota status
 */
router.post('/consume/token/:mac',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { weightedTokens, rawInput, rawOutput, monthKey } = req.body || {};

    if (!mac) return badRequest(res, 'MAC address is required');
    if (weightedTokens == null || rawInput == null || rawOutput == null) {
      return badRequest(res, 'weightedTokens, rawInput, and rawOutput are required');
    }

    try {
      const result = await subscriptionService.consumeTokenByMac(mac, {
        weightedTokens, rawInput, rawOutput, monthKey
      });
      success(res, result, 'Token quota consumed');
    } catch (error) {
      logger.error('Error consuming token quota:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== QUOTA SETTINGS (Admin) ====================

/**
 * @swagger
 * /subscription/quota-settings:
 *   get:
 *     tags: [Subscription]
 *     summary: Get current quota system settings
 *     description: Returns the default quota type and free-tier limits for users without a subscription
 *     security:
 *       - bearerAuth: []
 */
router.get('/quota-settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const defaultQuotaType = await getParamValue('default_quota_type', 'question');
      const freeQuestionLimit = Number(await getParamValue('free_monthly_quota', 20));
      const freeTokenLimit = Number(await getParamValue('default_free_token_limit', 10000));
      const freeTimeLimit = Number(await getParamValue('default_free_time_limit', 1800));

      success(res, {
        defaultQuotaType,
        freeQuestionLimit,
        freeTokenLimit,
        freeTimeLimit
      }, 'Quota settings retrieved');
    } catch (error) {
      logger.error('Error getting quota settings:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/quota-settings:
 *   put:
 *     tags: [Subscription]
 *     summary: Update quota system settings
 *     description: Change the default quota type and/or free-tier limits
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultQuotaType:
 *                 type: string
 *                 enum: [question, token, time]
 *               freeQuestionLimit:
 *                 type: integer
 *               freeTokenLimit:
 *                 type: integer
 *               freeTimeLimit:
 *                 type: integer
 *                 description: Free time limit in seconds
 */
router.put('/quota-settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { defaultQuotaType, freeQuestionLimit, freeTokenLimit, freeTimeLimit } = req.body || {};

    try {
      const updates = [];

      if (defaultQuotaType !== undefined) {
        const valid = ['question', 'token', 'time'];
        if (!valid.includes(defaultQuotaType)) {
          return badRequest(res, `defaultQuotaType must be one of: ${valid.join(', ')}`);
        }
        updates.push(upsertParam('default_quota_type', defaultQuotaType, 'string', 'Default quota system for free users'));
      }

      if (freeQuestionLimit !== undefined) {
        updates.push(upsertParam('free_monthly_quota', String(freeQuestionLimit), 'number', 'Free monthly question limit per device'));
      }

      if (freeTokenLimit !== undefined) {
        updates.push(upsertParam('default_free_token_limit', String(freeTokenLimit), 'number', 'Free monthly token limit per device'));
      }

      if (freeTimeLimit !== undefined) {
        updates.push(upsertParam('default_free_time_limit', String(freeTimeLimit), 'number', 'Free monthly time limit in seconds per device'));
      }

      await Promise.all(updates);

      // Return updated settings
      const result = {
        defaultQuotaType: defaultQuotaType || await getParamValue('default_quota_type', 'question'),
        freeQuestionLimit: freeQuestionLimit || Number(await getParamValue('free_monthly_quota', 20)),
        freeTokenLimit: freeTokenLimit || Number(await getParamValue('default_free_token_limit', 10000)),
        freeTimeLimit: freeTimeLimit || Number(await getParamValue('default_free_time_limit', 1800))
      };

      logger.info(`Admin updated quota settings: ${JSON.stringify(result)}`);
      success(res, result, 'Quota settings updated');
    } catch (error) {
      logger.error('Error updating quota settings:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * Helper: Create or update a sys_param by code
 */
async function upsertParam(code, value, valueType, remark) {
  const existing = await getParamByCode(code);
  if (existing) {
    await updateParam(existing.id, { paramValue: value });
  } else {
    await createParam(null, { paramCode: code, paramValue: value, valueType, remark });
  }
}

// ==================== ADMIN ENDPOINTS ====================

/**
 * @swagger
 * /subscription/plans:
 *   get:
 *     tags: [Subscription]
 *     summary: List all subscription plans
 *     security:
 *       - bearerAuth: []
 */
router.get('/plans',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const plans = await subscriptionService.listPlans(false);
      success(res, plans, 'Plans retrieved');
    } catch (error) {
      logger.error('Error listing plans:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/available-plans:
 *   get:
 *     tags: [Subscription]
 *     summary: List available plans for purchase
 *     description: Public-facing list of active plans (for parent app)
 *     security:
 *       - bearerAuth: []
 */
router.get('/available-plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const plans = await subscriptionService.listPlans(true);
      success(res, plans, 'Available plans retrieved');
    } catch (error) {
      logger.error('Error listing available plans:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/user/{userId}:
 *   get:
 *     tags: [Subscription]
 *     summary: Get user's subscription and quota status
 *     security:
 *       - bearerAuth: []
 */
router.get('/user/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    try {
      const status = await subscriptionService.getUserSubscriptionStatus(Number(userId));
      success(res, status, 'User subscription status retrieved');
    } catch (error) {
      logger.error('Error getting user subscription:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/user/{userId}/subscribe:
 *   post:
 *     tags: [Subscription]
 *     summary: Subscribe user to a plan
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [planId]
 *             properties:
 *               planId:
 *                 type: integer
 */
router.post('/user/:userId/subscribe',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { planId } = req.body || {};

    if (!planId) return badRequest(res, 'planId is required');

    try {
      const sub = await subscriptionService.subscribeUser(Number(userId), Number(planId));
      logger.info(`Admin subscribed user ${userId} to plan ${planId}`);
      success(res, sub, 'User subscribed');
    } catch (error) {
      logger.error('Error subscribing user:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/user/{userId}/cancel:
 *   post:
 *     tags: [Subscription]
 *     summary: Cancel user's subscription
 *     security:
 *       - bearerAuth: []
 */
router.post('/user/:userId/cancel',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    try {
      const sub = await subscriptionService.cancelSubscription(Number(userId));
      logger.info(`Admin cancelled subscription for user ${userId}`);
      success(res, sub, 'Subscription cancelled');
    } catch (error) {
      logger.error('Error cancelling subscription:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/device/{mac}/grant:
 *   post:
 *     tags: [Subscription]
 *     summary: Grant extra tokens to a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: integer
 *                 minimum: 1
 */
router.post('/device/:mac/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { amount } = req.body || {};

    if (!mac) return badRequest(res, 'MAC address is required');
    if (!amount || amount <= 0) {
      return badRequest(res, 'Amount must be a positive number');
    }

    try {
      const result = await subscriptionService.grantExtraTokens(mac, Number(amount));
      logger.info(`Admin granted ${amount} extra tokens to device ${mac}`);
      success(res, result, `Granted ${amount} extra tokens`);
    } catch (error) {
      logger.error('Error granting extra tokens:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/device/{mac}/grant-time:
 *   post:
 *     tags: [Subscription]
 *     summary: Grant extra time (seconds) to a device
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mac
 *         required: true
 *         schema:
 *           type: string
 *         description: Device MAC address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of extra seconds to grant
 */
router.post('/device/:mac/grant-time',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { mac } = req.params;
    const { amount } = req.body || {};

    if (!mac) return badRequest(res, 'MAC address is required');
    if (!amount || amount <= 0) {
      return badRequest(res, 'Amount must be a positive number');
    }

    try {
      const result = await subscriptionService.grantExtraTime(mac, Number(amount));
      logger.info(`Admin granted ${amount} extra seconds to device ${mac}`);
      success(res, result, `Granted ${amount} extra seconds`);
    } catch (error) {
      logger.error('Error granting extra time:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== AI CARD TIME QUOTA ENDPOINTS ====================

/**
 * @swagger
 * /subscription/quota/ai-card/{rfidUid}:
 *   get:
 *     tags: [Subscription]
 *     summary: Get AI card time quota at session start
 *     description: Called by agent workers at session start for AI card sessions
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *         description: Normalized RFID UID
 *     responses:
 *       200:
 *         description: AI card quota status
 */
router.get('/quota/ai-card/:rfidUid',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;
    if (!rfidUid) return badRequest(res, 'rfidUid is required');

    try {
      const quota = await subscriptionService.getAiCardTimeQuota(rfidUid);
      success(res, quota, 'AI card quota retrieved');
    } catch (error) {
      logger.error('Error getting AI card quota:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/consume/ai-card-time/{rfidUid}:
 *   post:
 *     tags: [Subscription]
 *     summary: Consume elapsed seconds for an AI card session
 *     description: Called by agent workers every 30 seconds during AI card sessions
 *     security:
 *       - serviceKey: []
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [seconds]
 *             properties:
 *               seconds:
 *                 type: integer
 *                 description: Seconds to consume
 *               monthKey:
 *                 type: string
 *                 description: Month key in YYYY-MM format
 *     responses:
 *       200:
 *         description: Updated quota status
 */
router.post('/consume/ai-card-time/:rfidUid',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;
    const { seconds, monthKey } = req.body || {};

    if (!rfidUid) return badRequest(res, 'rfidUid is required');
    if (seconds == null || seconds < 0) {
      return badRequest(res, 'seconds is required and must be non-negative');
    }

    try {
      const result = await subscriptionService.consumeAiCardTime(rfidUid, { seconds, monthKey });
      success(res, result, 'AI card time consumed');
    } catch (error) {
      logger.error('Error consuming AI card time:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/recharge/{rfidUid}:
 *   post:
 *     tags: [Subscription]
 *     summary: Recharge an AI card (parent app)
 *     description: Parents can recharge their child's AI card with extra time
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 86400
 *                 description: Extra seconds to add (max 24 hours)
 *     responses:
 *       200:
 *         description: Updated quota status
 */
router.post('/recharge/:rfidUid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;
    const { amount } = req.body || {};

    if (!rfidUid) return badRequest(res, 'rfidUid is required');
    if (!amount || amount <= 0) {
      return badRequest(res, 'Amount must be a positive number');
    }
    if (amount > 86400) {
      return badRequest(res, 'Amount must not exceed 86400 seconds (24 hours)');
    }

    try {
      const result = await subscriptionService.rechargeAiCard(rfidUid, Number(amount));
      logger.info(`Parent recharged AI card ${rfidUid} with ${amount} seconds`);
      success(res, result, `Granted ${amount} extra seconds`);
    } catch (error) {
      logger.error('Error recharging AI card:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/ai-card-status/{rfidUid}:
 *   get:
 *     tags: [Subscription]
 *     summary: Get AI card status (parent app)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rfidUid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Card details + quota
 */
router.get('/ai-card-status/:rfidUid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rfidUid } = req.params;
    try {
      const status = await subscriptionService.getAiCardStatus(rfidUid);
      success(res, status, 'AI card status retrieved');
    } catch (error) {
      logger.error('Error getting AI card status:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/my-cards:
 *   get:
 *     tags: [Subscription]
 *     summary: List AI cards discovered by the user (parent app)
 *     description: Returns all AI cards the user's child has tapped
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's discovered AI cards with quota
 */
router.get('/my-cards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return badRequest(res, 'Authentication required');

    try {
      const cards = await subscriptionService.listAiCardsForUser(Number(userId));
      success(res, { cards }, 'My cards retrieved');
    } catch (error) {
      logger.error('Error listing AI cards:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/ai-cards/summary:
 *   get:
 *     tags: [Subscription]
 *     summary: List all AI cards with usage (admin)
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
 *         name: monthKey
 *         schema:
 *           type: string
 *         description: Month key in YYYY-MM format
 *     responses:
 *       200:
 *         description: Paginated AI card list
 */
router.get('/ai-cards/summary',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, monthKey } = req.query;
    try {
      const result = await subscriptionService.listAiCardsSummary({
        page: Number(page),
        limit: Number(limit),
        monthKey
      });
      success(res, result, 'AI cards summary retrieved');
    } catch (error) {
      logger.error('Error getting AI cards summary:', error);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;

// ==================== AI CARD QUOTA SETTINGS (Admin) ====================

/**
 * @swagger
 * /subscription/ai-card-quota-settings:
 *   get:
 *     tags: [Subscription]
 *     summary: Get AI card quota settings (fail mode, default limits)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: AI card quota settings
 */
router.get('/ai-card-quota-settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const failMode = await getParamValue('ai_card_quota_fail_mode', 'open');
      success(res, { failMode: failMode || 'open' }, 'AI card quota settings retrieved');
    } catch (error) {
      logger.error('Error getting AI card quota settings:', error);
      badRequest(res, error.message);
    }
  })
);

/**
 * @swagger
 * /subscription/ai-card-quota-settings:
 *   put:
 *     tags: [Subscription]
 *     summary: Update AI card quota settings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               failMode:
 *                 type: string
 *                 enum: [open, capped]
 *                 description: Fail mode when API is unreachable
 */
router.put('/ai-card-quota-settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { failMode } = req.body || {};

    if (failMode) {
      const valid = ['open', 'capped'];
      if (!valid.includes(failMode)) {
        return badRequest(res, `failMode must be one of: ${valid.join(', ')}`);
      }
      await upsertParam('ai_card_quota_fail_mode', failMode, 'string', 'Fail mode for AI card quota when API unreachable');
    }

    success(res, { failMode: failMode || await getParamValue('ai_card_quota_fail_mode', 'open') }, 'AI card quota settings updated');
  })
);

// ==================== MQTT PUBLISH FOR WORKER (Service Key Auth) ====================

/**
 * @swagger
 * /subscription/publish-mqtt-exhaust:
 *   post:
 *     tags: [Subscription]
 *     summary: Trigger MQTT exhaust message to device
 *     description: Called by LiveKit workers when AI card quota is exhausted mid-session
 *     security:
 *       - serviceKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [macAddress, rfidUid, cardName]
 *             properties:
 *               macAddress:
 *                 type: string
 *                 description: Device MAC address
 *               rfidUid:
 *                 type: string
 *                 description: RFID UID of the exhausted card
 *               cardName:
 *                 type: string
 *                 description: Human-readable card name
 *     responses:
 *       200:
 *         description: MQTT message published
 */
router.post('/publish-mqtt-exhaust',
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { macAddress, rfidUid, cardName } = req.body || {};

    if (!macAddress) return badRequest(res, 'macAddress is required');
    if (!rfidUid) return badRequest(res, 'rfidUid is required');

    const gatewayUrl = process.env.MQTT_GATEWAY_URL || 'http://localhost:3001';
    const gatewaySecret = process.env.MQTT_GATEWAY_SECRET || '';

    // Normalize MAC address for topic (EMQX P2P format)
    const normalizedMac = macAddress.replace(/:/g, '_').toLowerCase();
    const topic = `devices/p2p/${normalizedMac}`;

    const payload = {
      type: "time_quota_exhausted",
      rfid_uid: rfidUid,
      card_name: cardName || "AI Card",
      message: "Time quota exhausted for this month. Please recharge.",
      audio_prompt: "recharge_required"
    };

    try {
      const response = await fetch(`${gatewayUrl}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(gatewaySecret && { 'X-Service-Key': gatewaySecret })
        },
        body: JSON.stringify({ topic, payload, macAddress })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`MQTT gateway returned ${response.status}: ${errorText}`);
        throw new Error(`MQTT gateway error: ${response.status}`);
      }

      const result = await response.json();
      logger.info(`📤 [MQTT-PUBLISH] Exhaust message sent to device ${macAddress} for card ${rfidUid}`);
      success(res, result, 'MQTT exhaust message published');
    } catch (error) {
      logger.error('Error publishing MQTT exhaust message:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== AI CARD LINKED TO USER/DEVICE (Admin) ====================

/**
 * @swagger
 * /subscription/ai-cards/linked:
 *   get:
 *     tags: [Subscription]
 *     summary: AI cards linked to users/devices with remaining time
 *     description: Shows card UID, user ID, MAC address, remaining time for admin dashboard
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
 *         name: monthKey
 *         schema:
 *           type: string
 *         description: Month key in YYYY-MM format
 *     responses:
 *       200:
 *         description: AI cards linked to users/devices
 */
router.get('/ai-cards/linked',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, monthKey } = req.query;
    try {
      const result = await subscriptionService.listAiCardsLinked({
        page: Number(page),
        limit: Number(limit),
        monthKey
      });
      success(res, result, 'Linked AI cards retrieved');
    } catch (error) {
      logger.error('Error getting linked AI cards:', error);
      badRequest(res, error.message);
    }
  })
);

// ==================== AI CARD ANALYTICS (Admin) ====================

/**
 * @swagger
 * /subscription/ai-card-analytics:
 *   get:
 *     tags: [Subscription]
 *     summary: AI card usage analytics (admin)
 *     description: Top cards, near-exhaustion alerts, recharge frequency
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: monthKey
 *         schema:
 *           type: string
 *         description: Month key in YYYY-MM format (defaults to current)
 *     responses:
 *       200:
 *         description: AI card analytics data
 */
router.get('/ai-card-analytics',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { monthKey: clientMonthKey } = req.query;
    const monthKey = (clientMonthKey && isValidMonthKey(clientMonthKey))
      ? clientMonthKey
      : getCurrentMonthKey();

    if (!supabaseAdmin) return badRequest(res, 'Database not configured');

    try {
      // 1. Top AI cards by usage
      const { data: quotas } = await supabaseAdmin
        .from('ai_card_time_quota')
        .select('rfid_uid, seconds_used, extra_purchased')
        .eq('month_key', monthKey)
        .order('seconds_used', { ascending: false });

      // 2. Card metadata
      const rfidUids = (quotas || []).map(q => q.rfid_uid).slice(0, 10);
      let cards = [];
      if (rfidUids.length > 0) {
        const { data: cardData } = await supabaseAdmin
          .from('rfid_card_mapping')
          .select('rfid_uid, notes, monthly_time_limit_secs')
          .in('rfid_uid', rfidUids);
        cards = cardData || [];
      }

      const cardsByUid = {};
      for (const c of cards) {
        cardsByUid[c.rfid_uid] = c;
      }

      // Build top cards list
      const topCards = (quotas || []).slice(0, 10).map(q => {
        const card = cardsByUid[q.rfid_uid] || {};
        const limit = card.monthly_time_limit_secs || 0;
        const extra = q.extra_purchased || 0;
        const totalAllowed = limit + extra;
        const used = q.seconds_used || 0;
        const pctUsed = totalAllowed > 0 ? Math.round((used / totalAllowed) * 100) : 0;

        return {
          rfidUid: q.rfid_uid,
          cardName: card.notes || 'AI Card',
          monthlyTimeLimit: limit,
          secondsUsed: used,
          extraPurchased: extra,
          pctUsed,
          remaining: Math.max(0, totalAllowed - used),
          isExhausted: used >= totalAllowed && totalAllowed > 0
        };
      });

      // 3. Near-exhaustion alerts (cards with > 80% used)
      const nearExhaustion = topCards.filter(c => c.pctUsed >= 80 && !c.isExhausted);

      // 4. Exhausted cards count
      const exhaustedCount = (quotas || []).filter(q => {
        const card = cardsByUid[q.rfid_uid] || {};
        const limit = card.monthly_time_limit_secs || 0;
        const extra = q.extra_purchased || 0;
        const total = limit + extra;
        return total > 0 && q.seconds_used >= total;
      }).length;

      // 5. Total active AI cards this month
      const totalActiveCards = (quotas || []).length;

      success(res, {
        monthKey,
        totalActiveCards,
        exhaustedCount,
        topCards: topCards.slice(0, 5),
        nearExhaustion: nearExhaustion.slice(0, 5),
        generatedAt: new Date().toISOString()
      }, 'AI card analytics retrieved');
    } catch (error) {
      logger.error('Error getting AI card analytics:', error);
      badRequest(res, error.message);
    }
  })
);

module.exports = router;
