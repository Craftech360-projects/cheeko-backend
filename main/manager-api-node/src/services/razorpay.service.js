/**
 * Razorpay Subscriptions integration (SUB-6).
 *
 * Two jobs: create the customer+subscription pair at checkout, and turn
 * webhook events into device_subscriptions state. The webhook side is built
 * for Razorpay's real delivery contract (research doc, wayfinder 006):
 * at-least-once (ledger dedupe on razorpay_event_id), unordered (period
 * anchors only ever advance; a rejected write re-fetches live state from the
 * API and derives), and racing the checkout response (upserts keyed on the
 * MAC carried in subscription notes — never assumes checkout wrote first).
 *
 * REST via axios basic auth — no Razorpay SDK dependency for three calls.
 */

const crypto = require('crypto');
const axios = require('axios');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

// ~10 years of monthly cycles: `completed` must never fire on a live customer
// (ticket SUB-6 "seed subscriptions with a high total_count").
const SUBSCRIPTION_TOTAL_COUNT = 120;

const razorpayAuth = () => ({
  username: process.env.RAZORPAY_KEY_ID,
  password: process.env.RAZORPAY_KEY_SECRET,
});

const isRazorpayConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

const razorpayPost = async (path, body) => {
  const { data } = await axios.post(`${RAZORPAY_BASE_URL}${path}`, body, {
    auth: razorpayAuth(),
    timeout: 10000,
  });
  return data;
};

const razorpayGet = async (path) => {
  const { data } = await axios.get(`${RAZORPAY_BASE_URL}${path}`, {
    auth: razorpayAuth(),
    timeout: 10000,
  });
  return data;
};

/**
 * HMAC-SHA256 over the RAW request body (never the parsed JSON — Razorpay's
 * own rule) against X-Razorpay-Signature. Constant-time compare.
 *
 * @param {Buffer|string} rawBody
 * @param {string} signature - hex digest from the X-Razorpay-Signature header
 * @returns {boolean}
 */
const verifyWebhookSignature = (rawBody, signature) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = Buffer.from(String(signature));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted);
};

/**
 * Create the Razorpay customer + subscription for a plan purchase and return
 * what the portal's Checkout needs. The device row keeps its current status —
 * activation is the webhook's job, so a parent who abandons checkout leaves
 * no half-active state behind.
 *
 * @param {string} macAddress - device MAC (any separator format)
 * @param {number|string|BigInt|null} userId - the paying parent
 * @param {string} tier - subscription_plans.tier
 * @param {Object} [contact] - {name, email} for the Razorpay customer
 * @returns {Promise<Object>} checkout params for Razorpay Checkout
 * @throws {Error} with .statusCode for route-level 4xx mapping
 */
const createCheckout = async (macAddress, userId, tier, contact = {}) => {
  if (!isRazorpayConfigured()) {
    const err = new Error('Razorpay is not configured');
    err.statusCode = 503;
    throw err;
  }

  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    const err = new Error('Invalid MAC address');
    err.statusCode = 400;
    throw err;
  }

  const plan = await prisma.subscription_plans.findUnique({ where: { tier } });
  if (!plan || !plan.is_active) {
    const err = new Error(`No active plan for tier "${tier}"`);
    err.statusCode = 400;
    throw err;
  }
  if (!plan.razorpay_plan_id) {
    const err = new Error(`Plan "${tier}" has no razorpay_plan_id — run scripts/razorpay-seed-plans.js`);
    err.statusCode = 503;
    throw err;
  }

  // fail_existing=0: return the existing customer instead of erroring when
  // the same parent buys for a second device.
  const customer = await razorpayPost('/customers', {
    name: contact.name || undefined,
    email: contact.email || undefined,
    fail_existing: 0,
  });

  const subscription = await razorpayPost('/subscriptions', {
    plan_id: plan.razorpay_plan_id,
    total_count: SUBSCRIPTION_TOTAL_COUNT,
    customer_notify: 1,
    // The webhook's only link back to the device — every transition keys off it.
    notes: { mac_address: normalizedMac },
  });

  // Record the pending purchase. Never touches status/period: the activated
  // webhook may already have landed (it owns those fields), and if it hasn't,
  // the device stays trial/lapsed until it does.
  await prisma.device_subscriptions.upsert({
    where: { mac_address: normalizedMac },
    create: {
      mac_address: normalizedMac,
      status: 'lapsed',
      plan_id: plan.id,
      user_id: userId ? BigInt(userId) : null,
      razorpay_customer_id: customer.id,
      razorpay_subscription_id: subscription.id,
    },
    update: {
      plan_id: plan.id,
      user_id: userId ? BigInt(userId) : undefined,
      razorpay_customer_id: customer.id,
      razorpay_subscription_id: subscription.id,
      updated_at: new Date(),
    },
  });

  logger.info(
    `[RAZORPAY] Checkout created for ${normalizedMac}: sub=${subscription.id} plan=${tier}`
  );

  return {
    key_id: process.env.RAZORPAY_KEY_ID,
    razorpay_subscription_id: subscription.id,
    razorpay_customer_id: customer.id,
    plan: { tier: plan.tier, name: plan.name, price_inr: plan.price_inr },
  };
};

/** Epoch-seconds → Date, null-safe (Razorpay timestamps are Unix seconds). */
const tsToDate = (ts) => (ts ? new Date(ts * 1000) : null);

/** The device MAC a webhook's subscription entity points at, if any. */
const macFromEntity = (entity) => normalizeMacAddress(entity?.notes?.mac_address) || null;

/** Our plan row for a Razorpay plan id; null when unknown (keep existing). */
const planIdForRazorpayPlan = async (razorpayPlanId) => {
  if (!razorpayPlanId) return null;
  const plan = await prisma.subscription_plans.findFirst({
    where: { razorpay_plan_id: razorpayPlanId },
    select: { id: true },
  });
  return plan?.id ?? null;
};

/**
 * Apply an active-state snapshot (from an activated/charged event, or a live
 * API fetch) to the device row. The period-anchor guard is the out-of-order
 * defense: anchors only ever move forward, so a stale event can never drag
 * the period back. Returns false when the guard rejected the write.
 */
const applyActiveState = async (normalizedMac, entity, { guarded = true } = {}) => {
  const periodStart = tsToDate(entity.current_start);
  const periodEnd = tsToDate(entity.current_end);
  const planId = await planIdForRazorpayPlan(entity.plan_id);

  const data = {
    status: 'active',
    current_period_start: periodStart,
    current_period_end: periodEnd,
    razorpay_subscription_id: entity.id,
    razorpay_customer_id: entity.customer_id || undefined,
    grace_until: null,
    ...(planId != null ? { plan_id: planId } : {}),
    updated_at: new Date(),
  };

  // Upsert first so the webhook-before-checkout race still lands a row.
  await prisma.device_subscriptions.upsert({
    where: { mac_address: normalizedMac },
    create: { mac_address: normalizedMac, ...data },
    update: {},
  });

  const { count } = await prisma.device_subscriptions.updateMany({
    where: {
      mac_address: normalizedMac,
      ...(guarded && periodStart
        ? { OR: [{ current_period_start: null }, { current_period_start: { lte: periodStart } }] }
        : {}),
    },
    data,
  });
  return count > 0;
};

/**
 * The write was rejected as out-of-order — stop trusting the event and derive
 * from the live subscription instead (ticket SUB-6 rule). Only an `active`
 * live status is applied here; pending/halted/cancelled transitions belong to
 * SUB-7 and are left for their own webhooks.
 */
const deriveFromLiveState = async (normalizedMac, razorpaySubscriptionId) => {
  const live = await razorpayGet(`/subscriptions/${razorpaySubscriptionId}`);
  if (live.status === 'active') {
    await applyActiveState(normalizedMac, live, { guarded: false });
    logger.info(`[RAZORPAY] ${normalizedMac} re-derived from live state: active`);
  } else {
    logger.info(
      `[RAZORPAY] ${normalizedMac} live status "${live.status}" — no transition applied (SUB-7 scope)`
    );
  }
};

/**
 * Process one webhook delivery: ledger it (dupe ⇒ stop), then apply the
 * transition for authenticated/activated/charged. Everything else is ledgered
 * for SUB-7 to pick up.
 *
 * @param {string} eventId - x-razorpay-event-id header (dedupe key)
 * @param {Object} body - parsed webhook payload
 * @returns {Promise<{outcome: 'duplicate'|'processed'|'ledgered'}>}
 */
const processWebhookEvent = async (eventId, body) => {
  const entity = body?.payload?.subscription?.entity || null;
  const normalizedMac = macFromEntity(entity);

  const { count } = await prisma.subscription_events.createMany({
    data: [
      {
        razorpay_event_id: eventId,
        event_type: body?.event || 'unknown',
        mac_address: normalizedMac,
        razorpay_subscription_id: entity?.id || null,
        payload: body,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) {
    logger.info(`[RAZORPAY] Duplicate webhook ${eventId} — no-op`);
    return { outcome: 'duplicate' };
  }

  let handled = false;
  switch (body?.event) {
    case 'subscription.authenticated':
      // Mandate approved; activation (and the period anchor) comes with the
      // next event. Just make sure the row carries the Razorpay ids.
      if (normalizedMac && entity) {
        await prisma.device_subscriptions.updateMany({
          where: { mac_address: normalizedMac },
          data: {
            razorpay_subscription_id: entity.id,
            razorpay_customer_id: entity.customer_id || undefined,
            updated_at: new Date(),
          },
        });
        handled = true;
      }
      break;

    case 'subscription.activated':
    case 'subscription.charged':
      if (normalizedMac && entity) {
        const applied = await applyActiveState(normalizedMac, entity);
        if (!applied) await deriveFromLiveState(normalizedMac, entity.id);
        handled = true;
        logger.info(
          `[RAZORPAY] ${body.event} for ${normalizedMac}: ${applied ? 'applied' : 'derived from live'}`
        );
      }
      break;

    default:
      // pending/halted/paused/resumed/cancelled/completed → SUB-7.
      break;
  }

  if (!handled && entity && !normalizedMac) {
    logger.warn(`[RAZORPAY] Webhook ${eventId} (${body?.event}) has no mac_address note — ledgered only`);
  }

  await prisma.subscription_events.updateMany({
    where: { razorpay_event_id: eventId },
    data: { processed_at: new Date() },
  });

  return { outcome: handled ? 'processed' : 'ledgered' };
};

module.exports = {
  isRazorpayConfigured,
  verifyWebhookSignature,
  createCheckout,
  processWebhookEvent,
  SUBSCRIPTION_TOTAL_COUNT,
};
