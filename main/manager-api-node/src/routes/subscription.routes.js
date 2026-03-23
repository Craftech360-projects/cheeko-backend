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

const { getParamValue, getParamByCode, createParam, updateParam } = require('../services/system.service');

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

module.exports = router;
