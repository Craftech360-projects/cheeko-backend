/**
 * RevenueCat webhook integration (SUB-15).
 *
 * IAP pivot rails (design doc 2026-07-21): the app buys natively via
 * purchases_flutter with appUserID = device MAC; RevenueCat validates store
 * receipts and delivers ONE normalized webhook here. Same delivery contract
 * defenses as the Razorpay handler (SUB-6): at-least-once → ledger dedupe,
 * unordered → period anchors only ever advance (EXPIRATION guards on
 * current_period_end the same way). Ledger + transition commit in ONE
 * transaction, so a failed transition rolls the ledger row back and RC's
 * retry re-processes instead of hitting the dedupe.
 *
 * BILLING_ISSUE / refunds are ledgered only (SUB-7 owns grace).
 * PRODUCT_CHANGE is ledgered only: RC fires it when the user COMMITS a
 * change, not when it takes effect — the store's transaction event
 * (RENEWAL/INITIAL_PURCHASE) carries the new product_id at effective time
 * and swaps the plan then (SUB-9 owns richer plan-change UX).
 * ponytail: no live re-derive on a rejected stale write — a newer anchor is
 * already in place, which IS the derived state; SUB-7's nightly RC
 * reconciliation covers real drift.
 */

const crypto = require('crypto');
const { prisma } = require('../config/database');
const { normalizeMacAddress, isValidMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

/** app_user_id → MAC, or null (RC anonymous ids fail the hex check). */
const macFromAppUserId = (appUserId) =>
  appUserId && isValidMacAddress(appUserId) ? normalizeMacAddress(appUserId) : null;

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

/** Our plan row id for an RC product id; null when unknown. */
const planIdForProduct = async (tx, productId) => {
  if (!productId) return null;
  const plan = await tx.subscription_plans.findFirst({
    where: { store_product_id: productId },
    select: { id: true },
  });
  return plan?.id ?? null;
};

/**
 * INITIAL_PURCHASE / RENEWAL: the row becomes active with the store's billing
 * period as the bucket anchor. Anchor guard = out-of-order defense.
 * Returns false when nothing was applied (stale event, degraded payload, or
 * an unknown product that would leave an active row with no plan — that
 * would fail open to unlimited usage downstream, so refuse instead).
 */
const applyActiveState = async (tx, normalizedMac, event) => {
  const periodStart = event.purchased_at_ms ? new Date(event.purchased_at_ms) : null;
  if (!periodStart) {
    // No anchor ⇒ the out-of-order guard can't run; never write blind.
    logger.warn(`[REVENUECAT] ${event.type} for ${normalizedMac} has no purchased_at_ms — not applied`);
    return false;
  }
  const periodEnd = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
  const planId = await planIdForProduct(tx, event.product_id);

  const existing = await tx.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: { plan_id: true },
  });
  if (planId == null && existing?.plan_id == null) {
    // Active + plan-less fails open to unlimited usage (subscription.service).
    logger.error(
      `[REVENUECAT] Unknown product_id "${event.product_id}" for ${normalizedMac} — not activating (check SUB-17 store/plan seeding)`
    );
    return false;
  }

  const data = {
    status: 'active',
    current_period_start: periodStart,
    current_period_end: periodEnd,
    // RC store values map 1:1 by lowercasing (APP_STORE → app_store); never
    // overwrite with null — null means razorpay-era/trial in the schema.
    store: event.store ? String(event.store).toLowerCase() : undefined,
    rc_original_transaction_id: event.original_transaction_id || undefined,
    grace_until: null,
    cancel_at_period_end: false,
    ...(planId != null ? { plan_id: planId } : {}),
    updated_at: new Date(),
  };

  if (!existing) {
    // Webhook beat the device bind — still land a row.
    await tx.device_subscriptions.create({ data: { mac_address: normalizedMac, ...data } });
    return true;
  }

  const { count } = await tx.device_subscriptions.updateMany({
    where: {
      mac_address: normalizedMac,
      OR: [{ current_period_start: null }, { current_period_start: { lte: periodStart } }],
    },
    data,
  });
  return count > 0;
};

/**
 * Process one RC webhook event: ledger it (dupe ⇒ stop), then transition —
 * atomically. Ledger key reuses subscription_events.razorpay_event_id with an
 * 'rc:' prefix — one unique column, two rails, zero collision.
 *
 * @param {Object} event - body.event from the RC webhook payload
 * @returns {Promise<{outcome: 'duplicate'|'processed'|'ledgered'}>}
 */
const processWebhookEvent = async (event) => {
  const normalizedMac = macFromAppUserId(event?.app_user_id);

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.subscription_events.createMany({
      data: [
        {
          razorpay_event_id: `rc:${event.id}`,
          event_type: event?.type || 'unknown',
          mac_address: normalizedMac,
          payload: event,
          // The whole handler commits atomically, so ledgered == processed.
          processed_at: new Date(),
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
          const applied = await applyActiveState(tx, normalizedMac, event);
          handled = applied;
          logger.info(
            `[REVENUECAT] ${event.type} for ${normalizedMac}: ${applied ? 'applied' : 'not applied (stale/degraded/unknown product)'}`
          );
          break;
        }

        case 'CANCELLATION':
          // Auto-renew turned off; entitlement runs to period end (spec state machine).
          await tx.device_subscriptions.updateMany({
            where: { mac_address: normalizedMac },
            data: { cancel_at_period_end: true, updated_at: new Date() },
          });
          handled = true;
          break;

        case 'UNCANCELLATION':
          await tx.device_subscriptions.updateMany({
            where: { mac_address: normalizedMac },
            data: { cancel_at_period_end: false, updated_at: new Date() },
          });
          handled = true;
          break;

        case 'EXPIRATION': {
          // Guard mirrors the anchor guard: only lapse periods that have
          // actually ended — a delayed EXPIRATION for an old period must not
          // lapse a row a newer purchase re-activated.
          const expiresAtMs = event.expiration_at_ms || event.event_timestamp_ms;
          if (expiresAtMs) {
            const { count: lapsed } = await tx.device_subscriptions.updateMany({
              where: {
                mac_address: normalizedMac,
                OR: [
                  { current_period_end: null },
                  { current_period_end: { lte: new Date(expiresAtMs) } },
                ],
              },
              data: { status: 'lapsed', updated_at: new Date() },
            });
            handled = lapsed > 0;
          }
          break;
        }

        default:
          // BILLING_ISSUE / TRANSFER / PRODUCT_CHANGE / future types →
          // ledgered for SUB-7 / the effective-time transaction event.
          break;
      }
    } else if (event?.app_user_id) {
      logger.warn(
        `[REVENUECAT] Webhook rc:${event.id} app_user_id "${event.app_user_id}" is not a MAC — ledgered only`
      );
    }

    return { outcome: handled ? 'processed' : 'ledgered' };
  });
};

module.exports = { verifyWebhookAuth, processWebhookEvent };
