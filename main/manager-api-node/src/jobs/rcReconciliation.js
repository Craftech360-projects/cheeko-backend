/**
 * RevenueCat Reconciliation Cron (SUB-7)
 *
 * Nightly safety net for the webhook rails: every active|grace IAP row is
 * checked against the RevenueCat REST API (`GET /v1/subscribers/:mac` — the
 * appUserID IS the MAC) and repaired when the DB disagrees. Every repair is
 * an alert (logger.error with [DRIFT]) — drift means webhooks were lost or
 * mis-ordered and somebody should look.
 *
 * This job is NOT the enforcer: webhooks own the realtime transitions; a
 * cron that never runs costs repair latency, never correctness of the happy
 * path. Razorpay-era rows (store = null) are out of scope — RC knows nothing
 * about them.
 *
 * ponytail: plan drift repairs only when the RC product maps to a seeded
 * store_product_id; period anchors repair with 60s tolerance to ignore
 * clock jitter.
 *
 * Usage: startRcReconciliationCron() at server start.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');

const RC_BASE_URL = 'https://api.revenuecat.com/v1';
const TIMEZONE = 'Asia/Kolkata';
const ANCHOR_TOLERANCE_MS = 60 * 1000;

let reconcileCronJob = null;
let running = false;

/**
 * What the DB row SHOULD look like according to an RC subscriber object.
 * Pure — unit-testable without HTTP. Picks the subscription with the latest
 * expiry (one device = one sub; multiple entries only across product changes).
 *
 * @param {Object|undefined} subscriber - RC response `subscriber`
 * @param {Date} now
 * @returns {{status: string, current_period_start: Date|null,
 *            current_period_end: Date|null, grace_until: Date|null,
 *            product_id: string|null}}
 */
const deriveExpected = (subscriber, now) => {
  const entries = Object.entries(subscriber?.subscriptions || {});
  let productId = null;
  let sub = null;
  for (const [pid, s] of entries) {
    if (!s?.expires_date) continue;
    if (!sub || new Date(s.expires_date) > new Date(sub.expires_date)) {
      sub = s;
      productId = pid;
    }
  }
  if (!sub) {
    // RC has no subscription at all for a row we hold live — hard drift.
    // Anchors stay untouched (null here means "don't repair"): nulling them
    // would disarm every webhook out-of-order guard downstream.
    return { status: 'lapsed', current_period_start: null, current_period_end: null, grace_until: null, cancel_at_period_end: false, product_id: null };
  }

  const expires = new Date(sub.expires_date);
  const grace = sub.grace_period_expires_date ? new Date(sub.grace_period_expires_date) : null;
  const base = {
    current_period_start: sub.purchase_date ? new Date(sub.purchase_date) : null,
    current_period_end: expires,
    // Auto-renew off shows up here even when the CANCELLATION webhook was lost.
    cancel_at_period_end: Boolean(sub.unsubscribe_detected_at),
    product_id: productId,
  };

  if (grace && grace > now) {
    // Store is retrying payment — our grace state.
    return { ...base, status: 'grace', grace_until: grace };
  }
  if (expires > now) {
    return { ...base, status: 'active', grace_until: null };
  }
  return { ...base, status: sub.unsubscribe_detected_at ? 'cancelled' : 'lapsed', grace_until: null };
};

const anchorsDiffer = (a, b) => {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return Math.abs(a.getTime() - b.getTime()) > ANCHOR_TOLERANCE_MS;
};

async function reconcileRow(row, planByProduct, apiKey, now) {
  const { data } = await axios.get(`${RC_BASE_URL}/subscribers/${encodeURIComponent(row.mac_address)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 15000,
  });
  const expected = deriveExpected(data?.subscriber, now);

  // App-layer +3d grace (BILLING_ISSUE without a store grace window): RC shows
  // a plain expiry while our grace still runs — that's policy, not drift.
  if (
    expected.status === 'lapsed' &&
    row.status === 'grace' &&
    row.grace_until &&
    row.grace_until > now
  ) {
    return false;
  }

  const planId = expected.product_id ? planByProduct.get(expected.product_id) : undefined;
  const drifted =
    expected.status !== row.status ||
    anchorsDiffer(expected.current_period_end, row.current_period_end) ||
    anchorsDiffer(expected.grace_until, row.grace_until) ||
    expected.cancel_at_period_end !== row.cancel_at_period_end ||
    (planId != null && planId !== row.plan_id);
  if (!drifted) return false;

  const repair = {
    status: expected.status,
    grace_until: expected.grace_until,
    cancel_at_period_end: expected.cancel_at_period_end,
    updated_at: new Date(),
  };
  // Never null an anchor — that would disarm the webhook out-of-order guards.
  if (expected.current_period_end) repair.current_period_end = expected.current_period_end;
  if (expected.current_period_start) repair.current_period_start = expected.current_period_start;
  if (planId != null && planId !== row.plan_id) repair.plan_id = planId;

  await prisma.device_subscriptions.updateMany({
    where: { mac_address: row.mac_address },
    data: repair,
  });
  // The repair IS the alert — [DRIFT] is the string to page on.
  logger.error(
    `[RC-RECONCILE][DRIFT] ${row.mac_address}: db=${row.status}/${row.current_period_end?.toISOString() ?? 'null'} ` +
      `rc=${expected.status}/${expected.current_period_end?.toISOString() ?? 'null'} — repaired`
  );
  return true;
}

async function runRcReconciliation(options = {}) {
  const now = options.now || new Date();
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    logger.warn('[RC-RECONCILE] REVENUECAT_API_KEY not set — skipping run');
    return { checked: 0, repaired: 0, failed: 0 };
  }
  if (running) {
    logger.warn('[RC-RECONCILE] Previous run still in progress, skipping');
    return { checked: 0, repaired: 0, failed: 0 };
  }
  running = true;
  let repaired = 0;
  let failed = 0;
  let rows = [];

  try {
    // ponytail: ticket-scoped to live rows — a lapsed row RC says is active
    // heals on its next RENEWAL webhook, not here. Widen if support tickets
    // show stuck-gated payers.
    rows = await prisma.device_subscriptions.findMany({
      where: {
        status: { in: ['active', 'grace'] },
        // RC rows only; either marker works (a degraded INITIAL_PURCHASE can
        // land one without the other). Razorpay-era rows have neither.
        OR: [{ store: { not: null } }, { rc_original_transaction_id: { not: null } }],
      },
      select: {
        mac_address: true,
        status: true,
        plan_id: true,
        current_period_end: true,
        grace_until: true,
        cancel_at_period_end: true,
      },
    });

    // The plan catalog is tiny and static per sweep — one query, not one per row.
    const planByProduct = new Map(
      (
        await prisma.subscription_plans.findMany({
          where: { store_product_id: { not: null } },
          select: { id: true, store_product_id: true },
        })
      ).map((p) => [p.store_product_id, p.id])
    );

    // ponytail: sequential sweep, one RC call at a time — add bounded
    // concurrency (5-10) when the live fleet outgrows a nightly window.
    for (const row of rows) {
      try {
        if (await reconcileRow(row, planByProduct, apiKey, now)) repaired++;
      } catch (err) {
        // One unreachable subscriber must not kill the sweep.
        failed++;
        logger.error(`[RC-RECONCILE] ${row.mac_address} failed: ${err.message}`);
      }
    }

    logger.info(`[RC-RECONCILE] Run complete: ${rows.length} checked, ${repaired} repaired, ${failed} failed`);
  } catch (error) {
    logger.error(`[RC-RECONCILE] Run failed: ${error.message}`);
  } finally {
    running = false;
  }

  return { checked: rows.length, repaired, failed };
}

const startRcReconciliationCron = async (options = {}) => {
  let cron;
  try {
    cron = require('node-cron');
  } catch (error) {
    logger.warn('node-cron not installed. RC reconciliation will not be scheduled.');
    return;
  }

  const { timezone = TIMEZONE } = options;
  if (reconcileCronJob) reconcileCronJob.stop();

  // 03:30 IST — dead of night, after the stores' own billing windows.
  reconcileCronJob = cron.schedule('30 3 * * *', () => runRcReconciliation(), {
    scheduled: true,
    timezone,
  });

  logger.info(`RC reconciliation cron started (daily 03:30 ${timezone})`);
};

const stopRcReconciliationCron = () => {
  if (reconcileCronJob) {
    reconcileCronJob.stop();
    reconcileCronJob = null;
  }
  logger.info('RC reconciliation cron stopped');
};

module.exports = {
  startRcReconciliationCron,
  stopRcReconciliationCron,
  runRcReconciliation,
  // exported for tests
  deriveExpected,
};
