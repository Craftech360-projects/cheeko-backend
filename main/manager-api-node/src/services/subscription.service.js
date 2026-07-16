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
    select: { status: true },
  });

  if (!subscription || !SESSION_ALLOWED_STATUSES.has(subscription.status)) {
    logger.info(
      `[SUBSCRIPTION] Verdict refused for ${normalizedMac}: status=${subscription?.status || 'none'}`
    );
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  return { allowed: true, reason: 'ok', remaining: REMAINING_UNKNOWN };
};

module.exports = {
  isEnforcementEnabled,
  getSessionVerdict,
  SESSION_ALLOWED_STATUSES,
};
