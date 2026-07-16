/**
 * Subscription Service
 *
 * Session-start gating for AI voice + imagine.
 *
 * SUB-1 (walking skeleton) scope: the kill-switch and the "does this MAC have a
 * live plan" question. Trial expiry (SUB-2) and bucket maths (SUB-3) land later;
 * until then `remaining` is reported as unknown rather than faked.
 */

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

// Statuses that may start a session. `grace` is a failed renewal inside the
// 3-day window — the toy keeps working while the parent fixes the mandate.
const SESSION_ALLOWED_STATUSES = new Set(['trial', 'active', 'grace']);

// Trial: 1 month at Family limits, once per MAC ever (wayfinder ticket 003).
const TRIAL_DAYS = 30;
const TRIAL_TIER = 'family';

// ponytail: SUB-3 replaces these nulls with live SUMs over
// device_token_usage_session. Null = "not computed yet", never "zero left".
const REMAINING_UNKNOWN = Object.freeze({
  questions_month: null,
  questions_today: null,
  minutes_today: null,
  images_today: null,
});

/**
 * Is global enforcement on? Defaults to OFF, so a missing env var can never
 * brick the fleet (spec §5 kill-switch).
 * @returns {boolean}
 */
const isEnforcementEnabled = () => process.env.ENFORCEMENT_ENABLED === 'true';

/**
 * Grant the one-and-only trial for a MAC, if it has never had one.
 *
 * Called from the bind path: the trial clock starts when a real family first
 * owns the toy, not at factory OTA (wayfinder ticket 005). The upsert with an
 * empty `update` is deliberate — it is an atomic create-if-absent, so a re-bind
 * (by any account) or two concurrent binds can never re-grant a trial. That is
 * also why this table is MAC-keyed and not FK'd to ai_device: unbind can delete
 * that row, and `trial_used` has to outlive it.
 *
 * @param {string} macAddress - MAC in any separator format
 * @param {number|string|BigInt} userId - the binding parent (payer)
 * @returns {Promise<Object|null>} the subscription row, or null for a bad MAC
 */
const ensureTrialForMac = async (macAddress, userId) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return null;

  const plan = await prisma.subscription_plans.findUnique({
    where: { tier: TRIAL_TIER },
    select: { id: true },
  });

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const subscription = await prisma.device_subscriptions.upsert({
    where: { mac_address: normalizedMac },
    create: {
      mac_address: normalizedMac,
      status: 'trial',
      plan_id: plan?.id ?? null,
      user_id: userId ? BigInt(userId) : null,
      trial_started_at: now,
      trial_ends_at: trialEndsAt,
      trial_used: true,
    },
    update: {},
  });

  if (subscription.trial_started_at?.getTime() === now.getTime()) {
    logger.info(`[SUBSCRIPTION] Trial granted to ${normalizedMac} until ${trialEndsAt.toISOString()}`);
  } else {
    logger.info(`[SUBSCRIPTION] ${normalizedMac} already has a subscription row; no trial re-granted`);
  }

  return subscription;
};

/**
 * Expire a trial the moment it is asked about, not when a cron gets round to it.
 *
 * The verdict is the enforcer; the reminder job only ever sends pushes (spec
 * §4). Without this, a device whose trial ended while the cron was down would
 * keep playing.
 *
 * @param {Object} subscription - row with status + trial_ends_at
 * @param {string} normalizedMac
 * @returns {Promise<string>} the effective status
 */
const applyLazyTrialExpiry = async (subscription, normalizedMac) => {
  const expired =
    subscription.status === 'trial' &&
    subscription.trial_ends_at &&
    Date.now() > subscription.trial_ends_at.getTime();

  if (!expired) return subscription.status;

  // Repair the row so the rest of the system (admin views, metrics) agrees.
  // Idempotent: concurrent verdicts both land on 'lapsed'.
  await prisma.device_subscriptions.update({
    where: { mac_address: normalizedMac },
    data: { status: 'lapsed', updated_at: new Date() },
  });
  logger.info(`[SUBSCRIPTION] Trial expired for ${normalizedMac}; row repaired to lapsed`);

  return 'lapsed';
};

/**
 * Decide whether a device may start a session.
 *
 * @param {string} macAddress - MAC in any separator format
 * @returns {Promise<{allowed: boolean, reason: string, remaining: Object}>}
 */
const getSessionVerdict = async (macAddress) => {
  if (!isEnforcementEnabled()) {
    return { allowed: true, reason: 'ok', remaining: REMAINING_UNKNOWN };
  }

  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  const subscription = await prisma.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: { status: true, trial_ends_at: true },
  });

  if (!subscription) {
    logger.info(`[SUBSCRIPTION] Verdict refused for ${normalizedMac}: no subscription row`);
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  const status = await applyLazyTrialExpiry(subscription, normalizedMac);

  if (!SESSION_ALLOWED_STATUSES.has(status)) {
    logger.info(`[SUBSCRIPTION] Verdict refused for ${normalizedMac}: status=${status}`);
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  return { allowed: true, reason: 'ok', remaining: REMAINING_UNKNOWN };
};

module.exports = {
  isEnforcementEnabled,
  getSessionVerdict,
  ensureTrialForMac,
  SESSION_ALLOWED_STATUSES,
  TRIAL_DAYS,
};
