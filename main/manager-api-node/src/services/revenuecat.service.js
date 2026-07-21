/**
 * RevenueCat webhook integration (SUB-15).
 *
 * IAP pivot rails (design doc 2026-07-21): the app buys natively via
 * purchases_flutter with appUserID = device MAC; RevenueCat validates store
 * receipts and delivers ONE normalized webhook here. Same delivery contract
 * defenses as the Razorpay handler (SUB-6): at-least-once → ledger dedupe,
 * unordered → period anchors only ever advance. There is no checkout race at
 * all — no server-side checkout exists on these rails.
 *
 * BILLING_ISSUE / refunds are ledgered only (SUB-7 owns grace).
 * ponytail: no live re-derive on a rejected stale write — a newer anchor is
 * already in place, which IS the derived state; SUB-7's nightly RC
 * reconciliation covers real drift.
 */

const crypto = require('crypto');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

/** RC store field → our device_subscriptions.store value. */
const STORE_MAP = { APP_STORE: 'app_store', PLAY_STORE: 'play_store' };

/**
 * app_user_id → MAC, or null. normalizeMacAddress only length-checks, so an
 * RC anonymous id could slip through it — require real hex pairs too.
 */
const macFromAppUserId = (appUserId) => {
  const mac = normalizeMacAddress(appUserId);
  return mac && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : null;
};

/**
 * RC sends the configured value verbatim in the Authorization header.
 * Constant-time compare; false when unset (route maps that to 503 first).
 *
 * @param {string|undefined} headerValue
 * @returns {boolean}
 */
const verifyWebhookAuth = (headerValue) => {
  const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret || !headerValue) return false;
  const provided = Buffer.from(String(headerValue));
  const wanted = Buffer.from(secret);
  return provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted);
};

/** Our plan row id for an RC product id; null when unknown (keep existing). */
const planIdForProduct = async (productId) => {
  if (!productId) return null;
  const plan = await prisma.subscription_plans.findFirst({
    where: { store_product_id: productId },
    select: { id: true },
  });
  return plan?.id ?? null;
};

/**
 * INITIAL_PURCHASE / RENEWAL: the row becomes active with the store's billing
 * period as the bucket anchor. Anchor guard = out-of-order defense.
 * Returns false when the guard rejected the write (stale event).
 */
const applyActiveState = async (normalizedMac, event) => {
  const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : null;
  const periodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
  const planId = await planIdForProduct(event.product_id);

  const data = {
    status: 'active',
    current_period_start: periodStart,
    current_period_end: periodEnd,
    store: STORE_MAP[event.store] || null,
    rc_original_transaction_id: event.original_transaction_id || undefined,
    grace_until: null,
    cancel_at_period_end: false,
    ...(planId != null ? { plan_id: planId } : {}),
    updated_at: new Date(),
  };

  // Upsert first so a webhook that beats the bind still lands a row.
  await prisma.device_subscriptions.upsert({
    where: { mac_address: normalizedMac },
    create: { mac_address: normalizedMac, ...data },
    update: {},
  });

  const { count } = await prisma.device_subscriptions.updateMany({
    where: {
      mac_address: normalizedMac,
      ...(periodStart
        ? { OR: [{ current_period_start: null }, { current_period_start: { lte: periodStart } }] }
        : {}),
    },
    data,
  });
  return count > 0;
};

/**
 * Process one RC webhook event: ledger it (dupe ⇒ stop), then transition.
 * Ledger key reuses subscription_events.razorpay_event_id with an 'rc:'
 * prefix — one unique column, two rails, zero collision.
 *
 * @param {Object} event - body.event from the RC webhook payload
 * @returns {Promise<{outcome: 'duplicate'|'processed'|'ledgered'}>}
 */
const processWebhookEvent = async (event) => {
  const normalizedMac = macFromAppUserId(event?.app_user_id);

  const { count } = await prisma.subscription_events.createMany({
    data: [
      {
        razorpay_event_id: `rc:${event.id}`,
        event_type: event?.type || 'unknown',
        mac_address: normalizedMac,
        payload: event,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) {
    logger.info(`[REVENUECAT] Duplicate webhook rc:${event.id} — no-op`);
    return { outcome: 'duplicate' };
  }

  let handled = false;
  if (normalizedMac) {
    switch (event?.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL': {
        const applied = await applyActiveState(normalizedMac, event);
        handled = applied;
        logger.info(
          `[REVENUECAT] ${event.type} for ${normalizedMac}: ${applied ? 'applied' : 'stale — anchor guard rejected'}`
        );
        break;
      }

      case 'CANCELLATION':
        // Auto-renew turned off; entitlement runs to period end (spec state machine).
        await prisma.device_subscriptions.updateMany({
          where: { mac_address: normalizedMac },
          data: { cancel_at_period_end: true, updated_at: new Date() },
        });
        handled = true;
        break;

      case 'UNCANCELLATION':
        await prisma.device_subscriptions.updateMany({
          where: { mac_address: normalizedMac },
          data: { cancel_at_period_end: false, updated_at: new Date() },
        });
        handled = true;
        break;

      case 'PRODUCT_CHANGE': {
        // Store-native upgrade/downgrade (SUB-9): swap the plan; anchors move
        // with the next RENEWAL, which encodes the store's effective timing.
        const planId = await planIdForProduct(event.new_product_id || event.product_id);
        if (planId != null) {
          await prisma.device_subscriptions.updateMany({
            where: { mac_address: normalizedMac },
            data: { plan_id: planId, updated_at: new Date() },
          });
          handled = true;
        }
        break;
      }

      case 'EXPIRATION':
        await prisma.device_subscriptions.updateMany({
          where: { mac_address: normalizedMac },
          data: { status: 'lapsed', updated_at: new Date() },
        });
        handled = true;
        break;

      default:
        // BILLING_ISSUE / TRANSFER / future types → ledgered for SUB-7.
        break;
    }
  } else if (event?.app_user_id) {
    logger.warn(
      `[REVENUECAT] Webhook rc:${event.id} app_user_id "${event.app_user_id}" is not a MAC — ledgered only`
    );
  }

  await prisma.subscription_events.updateMany({
    where: { razorpay_event_id: `rc:${event.id}` },
    data: { processed_at: new Date() },
  });

  return { outcome: handled ? 'processed' : 'ledgered' };
};

module.exports = { verifyWebhookAuth, processWebhookEvent };
