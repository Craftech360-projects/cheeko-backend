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
 * Unhappy paths (SUB-7): BILLING_ISSUE → grace (+3d or the store's grace
 * window, whichever is later) + fix-payment push; EXPIRATION → cancelled
 * when the user had cancelled, else lapsed + plan-gate push; CANCELLATION
 * with cancel_reason=CUSTOMER_SUPPORT (full refund) → lapsed immediately.
 * Pushes fire AFTER the transaction commits — at-most-once, same posture as
 * the trial reminder cron.
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
const { sendPushNotification, findParentFcmToken } = require('./pushNotification.service');
const logger = require('../utils/logger');

const GRACE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
// A BILLING_ISSUE can land slightly before the period actually ends (store
// retry windows open early) — allow that day, reject anything staler.
const BILLING_GUARD_SLACK_MS = 24 * 60 * 60 * 1000;

const PUSH_FIX_PAYMENT = {
  title: 'Cheeko subscription payment failed',
  body: 'Update your payment method in your store settings — Cheeko keeps playing for now.',
};
const PUSH_PLAN_GATED = {
  title: 'Cheeko’s plan has ended',
  body: 'Choose a plan in the Cheeko app to keep the conversations going.',
};

/**
 * Fire-and-forget parent push; a lost push never fails the webhook.
 * ponytail: mirrors subscription.service sendPlanGatePush — consolidate into
 * pushNotification.service if a third copy appears.
 */
const sendLifecyclePush = async (normalizedMac, copy) => {
  try {
    const fcmToken = await findParentFcmToken(normalizedMac);
    if (!fcmToken) return;
    const delivered = await sendPushNotification(fcmToken, copy.title, copy.body);
    if (!delivered) logger.error(`[REVENUECAT] Push "${copy.title}" FAILED for ${normalizedMac}`);
  } catch (err) {
    logger.error(`[REVENUECAT] Push "${copy.title}" errored for ${normalizedMac}: ${err.message}`);
  }
};

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

/** Out-of-order guard: match only rows whose anchor is unset or ≤ the event's cutoff. */
const notStale = (field, cutoffMs) => ({
  OR: [{ [field]: null }, { [field]: { lte: new Date(cutoffMs) } }],
});

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
    where: { mac_address: normalizedMac, ...notStale('current_period_start', periodStart.getTime()) },
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

  const result = await prisma.$transaction(async (tx) => {
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
    let push = null;
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

        case 'BILLING_ISSUE': {
          // Renewal attempt failed → grace (spec §4): +3d, or the store's own
          // grace window when it runs later. Guard: a BILLING_ISSUE older than
          // the row's period end (minus slack) is stale — a later RENEWAL
          // already succeeded.
          const issuedAtMs = event.event_timestamp_ms;
          if (!issuedAtMs) break; // degraded payload — never write blind
          const { count: graced } = await tx.device_subscriptions.updateMany({
            where: {
              mac_address: normalizedMac,
              status: 'active',
              ...notStale('current_period_end', issuedAtMs + BILLING_GUARD_SLACK_MS),
            },
            data: {
              status: 'grace',
              grace_until: new Date(Math.max(issuedAtMs + GRACE_DAYS_MS, event.grace_period_expiration_at_ms || 0)),
              updated_at: new Date(),
            },
          });
          handled = graced > 0;
          if (handled) push = PUSH_FIX_PAYMENT;
          break;
        }

        case 'CANCELLATION': {
          const isRefund = event.cancel_reason === 'CUSTOMER_SUPPORT';
          if (isRefund && event.event_timestamp_ms) {
            // Full refund via store support → entitlement ends now. Only a
            // paid row whose period started before the refund can lapse —
            // never a trial row (its purchase webhook may not have landed
            // yet), never a newer subscription.
            const { count: refunded } = await tx.device_subscriptions.updateMany({
              where: {
                mac_address: normalizedMac,
                status: { in: ['active', 'grace'] },
                ...notStale('current_period_start', event.event_timestamp_ms),
              },
              data: { status: 'lapsed', grace_until: null, updated_at: new Date() },
            });
            if (refunded > 0) {
              handled = true;
              push = PUSH_PLAN_GATED;
              break;
            }
            // No paid row matched — fall through to the plain-cancel floor so
            // auto-renew still stops. The floor keeps the staleness guard: a
            // refund for an OLD period must not flag a newer subscription
            // (trial rows have a null anchor and still match).
          }
          // Auto-renew turned off; entitlement runs to period end (spec state machine).
          const { count: flagged } = await tx.device_subscriptions.updateMany({
            where: {
              mac_address: normalizedMac,
              ...(isRefund && event.event_timestamp_ms
                ? notStale('current_period_start', event.event_timestamp_ms)
                : {}),
            },
            data: { cancel_at_period_end: true, updated_at: new Date() },
          });
          handled = flagged > 0;
          break;
        }

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
          // lapse a row a newer purchase re-activated. Lapse first (the event
          // can never be dropped), then relabel to 'cancelled' when the
          // parent had cancelled — the relabel keys on the row we just wrote,
          // so a concurrent CANCELLATION can't make both writes miss.
          const expiresAtMs = event.expiration_at_ms || event.event_timestamp_ms;
          if (!expiresAtMs) break;
          const { count: lapsed } = await tx.device_subscriptions.updateMany({
            where: { mac_address: normalizedMac, ...notStale('current_period_end', expiresAtMs) },
            data: { status: 'lapsed', grace_until: null, updated_at: new Date() },
          });
          if (lapsed === 0) break; // stale — ledgered
          handled = true;
          const { count: relabelled } = await tx.device_subscriptions.updateMany({
            where: { mac_address: normalizedMac, status: 'lapsed', cancel_at_period_end: true },
            data: { status: 'cancelled', updated_at: new Date() },
          });
          // The cancelling parent chose this — only the involuntary lapse
          // gets the plan-gate push.
          if (relabelled === 0) push = PUSH_PLAN_GATED;
          break;
        }

        default:
          // TRANSFER / PRODUCT_CHANGE / future types → ledgered only
          // (PRODUCT_CHANGE swaps plans via the effective-time transaction event).
          break;
      }
    } else if (event?.app_user_id) {
      logger.warn(
        `[REVENUECAT] Webhook rc:${event.id} app_user_id "${event.app_user_id}" is not a MAC — ledgered only`
      );
    }

    return { outcome: handled ? 'processed' : 'ledgered', push };
  });

  // After commit only — a rolled-back transition must not push.
  if (result.push) await sendLifecyclePush(normalizedMac, result.push);
  return { outcome: result.outcome };
};

module.exports = { verifyWebhookAuth, processWebhookEvent };
