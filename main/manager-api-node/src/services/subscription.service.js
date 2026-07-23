/**
 * Subscription Service
 *
 * Session-start gating for AI voice + imagine.
 *
 * SUB-1 laid the kill-switch and "does this MAC have a live plan"; SUB-2 added
 * lazy trial expiry + the plan-gate push; SUB-3 makes the verdict actually
 * meter: live SUMs over device_token_usage_session (no counter columns),
 * image counts over device_image_generations, IST day boundaries, and the
 * once-per-period 80%-of-monthly-bucket push.
 */

const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const { sendPushNotification, findParentFcmToken } = require('./pushNotification.service');
const { sendOpsAlert } = require('./opsAlert.service');
const logger = require('../utils/logger');

// Statuses that may start a session. `grace` is a failed renewal inside the
// 3-day window — the toy keeps working while the parent fixes the mandate.
const SESSION_ALLOWED_STATUSES = new Set(['trial', 'active', 'grace']);

// Trial: 1 month at Family limits, once per MAC ever (wayfinder ticket 003).
const TRIAL_DAYS = 30;
const TRIAL_TIER = 'family';

// Null = "not computed" (kill-switch off, refusals, plan-less rows), never
// "zero left". Allowed verdicts carry real numbers since SUB-3.
const REMAINING_UNKNOWN = Object.freeze({
  questions_month: null,
  questions_today: null,
  minutes_today: null,
  images_today: null,
});

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // UTC+5:30, no DST
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BUCKET_ALERT_THRESHOLD = 0.8;

/**
 * The current IST calendar day as UTC instants: [start, end). Day boundaries
 * are IST midnight; everything is stored and compared in UTC (spec §5).
 * @param {Date} [now] - injectable for tests
 */
const istDayWindow = (now = new Date()) => {
  const startMs =
    Math.floor((now.getTime() + IST_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + MS_PER_DAY) };
};

/**
 * The instant this subscription's monthly buckets count from: trials meter
 * from trial_started_at, paid plans from current_period_start.
 * @returns {Date|null} null = unknown anchor, monthly buckets can't be metered
 */
const monthlyAnchor = (subscription) =>
  (subscription.status === 'trial'
    ? subscription.trial_started_at
    : subscription.current_period_start) || null;

/** SUM(message_count) since the period anchor — the one monthly-bucket number,
 * shared by the verdict and the 80% alert so the two can never drift. */
const monthlyQuestionsUsed = async (normalizedMac, anchor) => {
  const agg = await prisma.device_token_usage_session.aggregate({
    where: { mac_address: normalizedMac, created_at: { gte: anchor } },
    _sum: { message_count: true },
  });
  return Number(agg._sum.message_count || 0);
};

/**
 * Live usage SUMs for one device — only the queries the plan's limits can
 * actually use (a null image limit means its COUNT is never read; skip it).
 * The no-counter-columns rule (spec §5) at current fleet size.
 *
 * ponytail: windows filter on created_at (timestamptz, row created when the
 * session's usage is first flushed) because usage_date is written as the UTC
 * day. A session straddling IST midnight counts toward the day it flushed,
 * and one straddling a period renewal keeps counting toward the old period;
 * switch writers to window-aware attribution if either edge ever matters.
 */
const computeUsage = async (normalizedMac, anchor, plan, now) => {
  const day = istDayWindow(now);
  const dayWhere = { mac_address: normalizedMac, created_at: { gte: day.start, lt: day.end } };
  const anyImageLimit = plan.daily_image_limit != null || plan.monthly_image_limit != null;

  const [questionsMonth, dayAgg, imagesToday, imagesMonth] = await Promise.all([
    anchor ? monthlyQuestionsUsed(normalizedMac, anchor) : null,
    prisma.device_token_usage_session.aggregate({
      where: dayWhere,
      _sum: { message_count: true, session_duration_seconds: true },
    }),
    anyImageLimit ? prisma.device_image_generations.count({ where: dayWhere }) : null,
    anchor && plan.monthly_image_limit != null
      ? prisma.device_image_generations.count({
          where: { mac_address: normalizedMac, created_at: { gte: anchor } },
        })
      : null,
  ]);

  return {
    questionsMonth,
    questionsToday: Number(dayAgg._sum.message_count || 0),
    minutesToday: Number(dayAgg._sum.session_duration_seconds || 0) / 60,
    imagesToday,
    imagesMonth,
  };
};

/** Refusal check + remaining maths for one plan. Buckets are start-gated only:
 * this runs at session/imagine start, never against a running session. */
const applyBuckets = (plan, usage, flow) => {
  const remaining = {
    questions_month:
      usage.questionsMonth === null
        ? null
        : Math.max(0, plan.monthly_question_limit - usage.questionsMonth),
    questions_today: Math.max(0, plan.daily_question_limit - usage.questionsToday),
    // ceil, not floor: 14.5 of 15 minutes used is still an allowed session,
    // so it must not display as "0 left" (0 remaining ⇔ refused, both ways).
    minutes_today: Math.max(0, Math.ceil(plan.daily_minutes_limit - usage.minutesToday)),
    images_today: imageRemaining(plan, usage),
  };

  let reason = null;
  if (usage.questionsMonth !== null && usage.questionsMonth >= plan.monthly_question_limit) {
    reason = 'monthly_bucket_empty';
  } else if (usage.questionsToday >= plan.daily_question_limit) {
    reason = 'daily_questions';
  } else if (usage.minutesToday >= plan.daily_minutes_limit) {
    reason = 'daily_minutes';
  } else if (flow === 'imagine' && remaining.images_today === 0) {
    reason = 'daily_images';
  }

  return { reason, remaining };
};

/** Images left today under the tightest applicable limit; null = unlimited. */
const imageRemaining = (plan, usage) => {
  const caps = [];
  if (plan.daily_image_limit != null) {
    caps.push(plan.daily_image_limit - usage.imagesToday);
  }
  if (plan.monthly_image_limit != null && usage.imagesMonth !== null) {
    caps.push(plan.monthly_image_limit - usage.imagesMonth);
  }
  if (!caps.length) return null;
  return Math.max(0, Math.min(...caps));
};

const PLAN_LIMIT_SELECT = {
  tier: true,
  name: true,
  price_inr: true,
  monthly_question_limit: true,
  daily_question_limit: true,
  daily_minutes_limit: true,
  monthly_image_limit: true,
  daily_image_limit: true,
};

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
 * Expire a trial — or an overrun grace window (SUB-7) — the moment it is
 * asked about, not when a cron gets round to it.
 *
 * The verdict is the enforcer; crons and webhooks only ever get there first
 * (spec §4). Without this, a device whose trial/grace ended while the
 * EXPIRATION webhook was lost and the reconciliation cron was down would
 * keep playing.
 *
 * @param {Object} subscription - row with status + trial_ends_at + grace_until
 * @param {string} normalizedMac
 * @returns {Promise<string>} the effective status
 */
const applyLazyTrialExpiry = async (subscription, normalizedMac) => {
  const now = Date.now();
  const trialExpired =
    subscription.status === 'trial' &&
    subscription.trial_ends_at &&
    now > subscription.trial_ends_at.getTime();
  const graceExpired =
    subscription.status === 'grace' &&
    subscription.grace_until &&
    now > subscription.grace_until.getTime();

  if (!trialExpired && !graceExpired) return subscription.status;

  // Repair the row so the rest of the system (admin views, metrics) agrees.
  // Guarded on the source status so only one caller can win the transition:
  // concurrent verdicts still both land on 'lapsed', but only the winner gets
  // count > 0, which is what makes the plan-gate push fire exactly once
  // instead of on every refused session (SUB-2 criterion 4).
  const fromStatus = trialExpired ? 'trial' : 'grace';
  const { count } = await prisma.device_subscriptions.updateMany({
    where: { mac_address: normalizedMac, status: fromStatus },
    data: { status: 'lapsed', grace_until: null, updated_at: new Date() },
  });
  logger.info(`[SUBSCRIPTION] ${fromStatus} expired for ${normalizedMac}; row repaired to lapsed`);

  if (count > 0) {
    // Deliberately not awaited: the verdict is in the session hot path — the
    // gateway is holding a hello open behind it — and a slow FCM round trip
    // must not delay a child's toy. A lost push is better than a stalled toy.
    const copy = trialExpired
      ? undefined
      : {
          title: 'Cheeko’s plan has ended',
          body: 'Choose a plan in the Cheeko app to keep the conversations going.',
        };
    sendPlanGatePush(normalizedMac, copy, trialExpired ? 'trial_ended' : 'plan_ended').catch((error) =>
      logger.error(`[SUBSCRIPTION] Plan-gate push failed for ${normalizedMac}: ${error.message}`)
    );
  }

  return 'lapsed';
};

/**
 * Tell the parent why the toy just went quiet (SUB-2 criterion 4).
 *
 * Fires on the trial→lapsed transition rather than on every refusal, so a child
 * pressing the button ten times does not push the parent ten times.
 */
const sendPlanGatePush = async (normalizedMac, copy, reason = 'trial_ended') => {
  const fcmToken = await findParentFcmToken(normalizedMac);
  if (!fcmToken) {
    logger.info(`[SUBSCRIPTION] No FCM token for ${normalizedMac}; plan-gate push skipped`);
    return;
  }

  const delivered = await sendPushNotification(
    fcmToken,
    copy?.title ?? 'Cheeko’s free trial has ended',
    copy?.body ?? 'Choose a plan in the Cheeko app to start the conversations again.',
    // Deep-links the app to the gate screen; reason picks the copy there.
    { type: 'plan_gate', reason, mac: normalizedMac }
  );
  logger.info(
    `[SUBSCRIPTION] Plan-gate push for ${normalizedMac}: ${delivered ? 'sent' : 'not delivered'}`
  );
};

/**
 * Ledger a refused verdict so the admin metrics page can count gate hits by
 * reason (SUB-11). Fire-and-forget: the verdict is in the session hot path,
 * and a lost count is better than a slowed toy.
 */
const recordGateHit = (normalizedMac, reason, flow) => {
  prisma.subscription_gate_hits
    .create({ data: { mac_address: normalizedMac, reason, flow } })
    .catch((err) => logger.warn(`[SUBSCRIPTION] gate-hit ledger failed for ${normalizedMac}: ${err.message}`));
};

/**
 * Decide whether a device may start a session (or, flow='imagine', generate
 * an image). Image buckets only ever gate the imagine flow — a device out of
 * images can still talk.
 *
 * @param {string} macAddress - MAC in any separator format
 * @param {Object} [opts]
 * @param {'voice'|'imagine'} [opts.flow] - what is being gated
 * @param {Date} [opts.now] - injectable clock for tests
 * @param {boolean} [opts.dryRun] - admin read: compute the true verdict even
 *   when the kill-switch is off, and don't ledger a gate hit (SUB-18 drawer).
 * @returns {Promise<{allowed: boolean, reason: string, remaining: Object}>}
 */
const getSessionVerdict = async (macAddress, { flow = 'voice', now = new Date(), dryRun = false } = {}) => {
  if (!dryRun && !isEnforcementEnabled()) {
    return { allowed: true, reason: 'ok', remaining: REMAINING_UNKNOWN };
  }

  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  const subscription = await prisma.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: {
      status: true,
      trial_started_at: true,
      trial_ends_at: true,
      grace_until: true,
      current_period_start: true,
      subscription_plans: { select: PLAN_LIMIT_SELECT },
    },
  });

  if (!subscription) {
    logger.info(`[SUBSCRIPTION] Verdict refused for ${normalizedMac}: no subscription row`);
    if (!dryRun) recordGateHit(normalizedMac, 'no_plan', flow);
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  const status = await applyLazyTrialExpiry(subscription, normalizedMac);

  if (!SESSION_ALLOWED_STATUSES.has(status)) {
    logger.info(`[SUBSCRIPTION] Verdict refused for ${normalizedMac}: status=${status}`);
    if (!dryRun) recordGateHit(normalizedMac, 'no_plan', flow);
    return { allowed: false, reason: 'no_plan', remaining: REMAINING_UNKNOWN };
  }

  const plan = subscription.subscription_plans;
  if (!plan) {
    // A live status with no plan row is data damage, not a lapsed customer —
    // fail open rather than invent limits (spec §5 fail-open rule + alert).
    logger.warn(`[SUBSCRIPTION] ${normalizedMac} allowed without limits: status=${status} but no plan row`);
    sendOpsAlert('fail_open', `${normalizedMac} allowed without limits: status=${status} but no plan row`, {
      oncePerDayKey: `fail_open:${normalizedMac}`,
    });
    return { allowed: true, reason: 'ok', remaining: REMAINING_UNKNOWN };
  }

  const anchor = monthlyAnchor({ ...subscription, status });
  const usage = await computeUsage(normalizedMac, anchor, plan, now);
  const { reason, remaining } = applyBuckets(plan, usage, flow);

  if (reason) {
    logger.info(`[SUBSCRIPTION] Verdict refused for ${normalizedMac}: ${reason} (flow=${flow})`);
    if (!dryRun) recordGateHit(normalizedMac, reason, flow);
    return { allowed: false, reason, remaining };
  }

  return { allowed: true, reason: 'ok', remaining };
};

/**
 * Mid-session minute-cap check for the worker's 5-minute usage heartbeat
 * (SUB-5). Cutoff applies ONLY to the daily minute cap — the abuse backstop.
 * Question/image buckets are start-gated and never cut a running session,
 * which is why this reads nothing but session_duration_seconds.
 *
 * Anything short of a confirmed breach answers "keep playing": kill-switch
 * off, bad MAC, missing row/plan — same fail-open posture as the verdict.
 *
 * @param {string} macAddress
 * @param {Object} [opts]
 * @param {Date} [opts.now] - injectable clock for tests
 * @returns {Promise<{cutoff: boolean, reason?: string}>}
 */
const heartbeatCutoff = async (macAddress, { now = new Date() } = {}) => {
  if (!isEnforcementEnabled()) return { cutoff: false };

  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return { cutoff: false };

  const subscription = await prisma.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: { subscription_plans: { select: { daily_minutes_limit: true } } },
  });
  const plan = subscription?.subscription_plans;
  if (!plan) return { cutoff: false };

  const day = istDayWindow(now);
  const agg = await prisma.device_token_usage_session.aggregate({
    where: { mac_address: normalizedMac, created_at: { gte: day.start, lt: day.end } },
    _sum: { session_duration_seconds: true },
  });
  const minutesToday = Number(agg._sum.session_duration_seconds || 0) / 60;
  if (minutesToday < plan.daily_minutes_limit) return { cutoff: false };

  // The gate-hit metric is this log line (same as the verdict's refusals).
  logger.info(
    `[SUBSCRIPTION] Heartbeat cutoff for ${normalizedMac}: daily_minutes ` +
      `(${minutesToday.toFixed(1)}/${plan.daily_minutes_limit} min)`
  );
  return { cutoff: true, reason: 'daily_minutes' };
};

/**
 * Send the once-per-billing-period "80% of your monthly questions used" push.
 * Called fire-and-forget from the usage-write path — that write IS the
 * crossing, so the push lands when the bucket actually crosses, not when the
 * next session starts. Exactly-once is the DB's job: the conditional UPDATE
 * on bucket_alert_sent_at is the claim, and a new period re-arms it because
 * the anchor moves past the old timestamp.
 *
 * @param {string} macAddress
 * @param {Object} [opts]
 * @param {Date} [opts.now]
 */
const maybeSendBucketAlert = async (macAddress, { now = new Date() } = {}) => {
  // Pushing "240 of 300 used" while nothing is enforced would be a lie.
  if (!isEnforcementEnabled()) return;

  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return;

  const subscription = await prisma.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: {
      status: true,
      trial_started_at: true,
      trial_ends_at: true,
      current_period_start: true,
      bucket_alert_sent_at: true,
      subscription_plans: { select: { monthly_question_limit: true } },
    },
  });

  const plan = subscription?.subscription_plans;
  if (!plan || !SESSION_ALLOWED_STATUSES.has(subscription.status)) return;
  // An expired-but-unrepaired trial is about to get the plan-gate push, not a
  // "you're at 80%" nudge about a plan it no longer has. Read-only check —
  // the row repair stays the verdict's job.
  if (
    subscription.status === 'trial' &&
    subscription.trial_ends_at &&
    now.getTime() > subscription.trial_ends_at.getTime()
  ) return;

  const anchor = monthlyAnchor(subscription);
  if (!anchor) return;
  // Already sent this period — skip before paying for the usage SUM. This is
  // the common case for the rest of the period once a device crosses 80%.
  if (subscription.bucket_alert_sent_at && subscription.bucket_alert_sent_at >= anchor) return;

  const used = await monthlyQuestionsUsed(normalizedMac, anchor);
  if (used < BUCKET_ALERT_THRESHOLD * plan.monthly_question_limit) return;

  // Token BEFORE claim: a parent who hasn't registered the app yet must not
  // burn the once-per-period claim — they should still get the alert when
  // they register later in the period.
  const fcmToken = await findParentFcmToken(normalizedMac);
  if (!fcmToken) {
    logger.info(`[SUBSCRIPTION] No FCM token for ${normalizedMac}; bucket alert deferred`);
    return;
  }

  const { count } = await prisma.device_subscriptions.updateMany({
    where: {
      mac_address: normalizedMac,
      OR: [{ bucket_alert_sent_at: null }, { bucket_alert_sent_at: { lt: anchor } }],
    },
    data: { bucket_alert_sent_at: now },
  });
  if (count === 0) return; // a concurrent flush won the claim

  const delivered = await sendPushNotification(
    fcmToken,
    'Cheeko is close to this month’s limit',
    `${used} of ${plan.monthly_question_limit} questions used — Cheeko will take a break when they run out.`
  );
  logger.info(
    `[SUBSCRIPTION] 80% bucket alert for ${normalizedMac}: ${delivered ? 'sent' : 'not delivered'}`
  );
};

/**
 * Count one generated image against the device's buckets. Called from the
 * imagine-upload path — the image exists by now, so failures here are logged,
 * never thrown back into the delivery path.
 * @param {string} macAddress
 * @param {string} [url] - where the image landed (S3/CDN), kept as the record
 */
const recordImageGeneration = async (macAddress, url) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    // Loudly: an uncountable image is a metering hole, not a shrug (SUB-4 rule).
    logger.warn(`[SUBSCRIPTION] Image NOT counted — unusable MAC "${macAddress}"`);
    return;
  }
  await prisma.device_image_generations.create({
    data: { mac_address: normalizedMac, url: url ?? null },
  });
};

/**
 * The active plan catalog the portal's plans page renders (SUB-6). Public
 * fields only — no ids (BigInt) and no razorpay_plan_id; tier is the key
 * checkout takes.
 */
const getActivePlans = () =>
  prisma.subscription_plans.findMany({
    where: { is_active: true },
    select: { ...PLAN_LIMIT_SELECT, features: true, store_product_id: true },
    orderBy: { price_inr: 'asc' },
  });

/**
 * Everything the parent app's plan screen needs for one device (SUB-10
 * consumes this via GET /api/mobile/devices/:mac/subscription).
 *
 * @param {string} macAddress
 * @param {Object} [opts]
 * @param {Date} [opts.now]
 * @returns {Promise<Object|null>} null when the MAC has no subscription row
 */
const getSubscriptionSummary = async (macAddress, { now = new Date() } = {}) => {
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return null;

  const subscription = await prisma.device_subscriptions.findUnique({
    where: { mac_address: normalizedMac },
    select: {
      status: true,
      trial_started_at: true,
      trial_ends_at: true,
      grace_until: true,
      current_period_start: true,
      current_period_end: true,
      cancel_at_period_end: true,
      subscription_plans: { select: PLAN_LIMIT_SELECT },
    },
  });
  if (!subscription) return null;

  const status = await applyLazyTrialExpiry(subscription, normalizedMac);
  const plan = subscription.subscription_plans;

  let usage = null;
  if (plan) {
    const anchor = monthlyAnchor({ ...subscription, status });
    const u = await computeUsage(normalizedMac, anchor, plan, now);
    // flow only affects the refusal reason, which the summary discards;
    // remaining is flow-independent.
    const { remaining } = applyBuckets(plan, u, 'imagine');
    usage = {
      used: {
        questions_month: u.questionsMonth,
        questions_today: u.questionsToday,
        minutes_today: Math.floor(u.minutesToday),
        images_today: u.imagesToday,
      },
      remaining,
    };
  }

  return {
    mac_address: normalizedMac,
    status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    plan,
    period: {
      start: subscription.current_period_start,
      end: subscription.current_period_end,
    },
    trial:
      status === 'trial' && subscription.trial_ends_at
        ? {
            ends_at: subscription.trial_ends_at,
            days_left: Math.max(0, Math.ceil((subscription.trial_ends_at.getTime() - now.getTime()) / MS_PER_DAY)),
          }
        : null,
    usage,
  };
};

module.exports = {
  isEnforcementEnabled,
  getActivePlans,
  getSessionVerdict,
  heartbeatCutoff,
  getSubscriptionSummary,
  maybeSendBucketAlert,
  recordImageGeneration,
  ensureTrialForMac,
  istDayWindow,
  SESSION_ALLOWED_STATUSES,
  TRIAL_DAYS,
};
