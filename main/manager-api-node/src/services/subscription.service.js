/**
 * Subscription Service
 *
 * Manages subscription plans and user subscriptions.
 * Provides the unified quota check endpoint that returns quota_type + remaining + weights.
 */

const { supabaseAdmin } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const { getParamValue } = require('./system.service');
const { getCurrentMonthKey, isValidMonthKey } = require('./quota.service');
const logger = require('../utils/logger');

const DEFAULT_FREE_QUOTA = 20;

/**
 * Resolve MAC address to user_id via ai_device table
 */
const resolveUserIdFromMac = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) return null;

  const { data: device, error } = await supabaseAdmin
    .from('ai_device')
    .select('user_id')
    .eq('mac_address', normalizedMac)
    .single();

  if (error || !device) return null;
  return device.user_id;
};

/**
 * Get user's active subscription with plan details
 * @param {number} userId
 * @returns {Promise<Object|null>} subscription + plan or null
 */
const getActiveSubscription = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data, error } = await supabaseAdmin
    .from('user_subscription')
    .select('*, plan:subscription_plan(*)')
    .eq('user_id', userId)
    .in('status', ['active', 'grace'])
    .single();

  if (error || !data) return null;

  // Check if expired but not yet updated
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    // Check grace period
    if (data.grace_ends_at && new Date(data.grace_ends_at) > new Date()) {
      // In grace period - still valid
      if (data.status !== 'grace') {
        await supabaseAdmin
          .from('user_subscription')
          .update({ status: 'grace', updated_at: new Date().toISOString() })
          .eq('id', data.id);
        data.status = 'grace';
      }
    } else {
      // Grace period also expired - mark as expired
      await supabaseAdmin
        .from('user_subscription')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('id', data.id);
      return null;
    }
  }

  return data;
};

/**
 * Unified quota check - returns quota_type, remaining, weights, plan info
 * Called by agent workers at session start via GET /subscription/quota/:mac
 *
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Unified quota info
 */
const getUnifiedQuota = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const userId = await resolveUserIdFromMac(mac);

  // Unbound devices get unlimited
  if (!userId) {
    return {
      quotaType: 'none',
      remaining: -1,
      isExhausted: false,
      isUnbound: true,
      limit: -1,
      used: 0,
      audioTokenWeight: 1.0,
      textTokenWeight: 1.0
    };
  }

  const subscription = await getActiveSubscription(userId);
  const monthKey = getCurrentMonthKey();

  const normalizedMac = normalizeMacAddress(mac);

  // No subscription → fall back to default free quota system (configurable via sys_params)
  if (!subscription) {
    const defaultQuotaType = await getParamValue('default_quota_type', 'question');

    if (defaultQuotaType === 'token') {
      const freeTokenLimit = Number(await getParamValue('default_free_token_limit', 10000));
      const { data: quota } = await supabaseAdmin
        .from('user_token_quota')
        .select('*')
        .eq('mac_address', normalizedMac)
        .eq('month_key', monthKey)
        .single();

      const tokensUsed = quota ? quota.tokens_used : 0;
      const extraPurchased = quota ? quota.extra_purchased : 0;
      const totalAllowed = freeTokenLimit + extraPurchased;
      const remaining = Math.max(0, totalAllowed - tokensUsed);

      return {
        quotaType: 'token',
        remaining,
        isExhausted: remaining <= 0,
        limit: totalAllowed,
        used: tokensUsed,
        extraPurchased,
        audioTokenWeight: 1.5,
        textTokenWeight: 1.0,
        macAddress: normalizedMac,
        monthKey,
        planName: 'Free'
      };
    }

    if (defaultQuotaType === 'time') {
      const freeTimeLimit = Number(await getParamValue('default_free_time_limit', 1800));
      const { data: quota } = await supabaseAdmin
        .from('user_time_quota')
        .select('*')
        .eq('mac_address', normalizedMac)
        .eq('month_key', monthKey)
        .single();

      const secondsUsed = quota ? quota.seconds_used : 0;
      const extraPurchased = quota ? quota.extra_purchased : 0;
      const totalAllowed = freeTimeLimit + extraPurchased;
      const remaining = Math.max(0, totalAllowed - secondsUsed);

      return {
        quotaType: 'time',
        remaining,
        isExhausted: remaining <= 0,
        limit: totalAllowed,
        used: secondsUsed,
        extraPurchased,
        audioTokenWeight: 1.0,
        textTokenWeight: 1.0,
        macAddress: normalizedMac,
        monthKey,
        planName: 'Free'
      };
    }

    // Default: question-based
    const freeLimit = await getParamValue('free_monthly_quota', DEFAULT_FREE_QUOTA);
    const { data: quota } = await supabaseAdmin
      .from('user_question_quota')
      .select('*')
      .eq('mac_address', normalizedMac)
      .eq('month_key', monthKey)
      .single();

    const questionsUsed = quota ? quota.questions_used : 0;
    const extraPurchased = quota ? quota.extra_purchased : 0;
    const totalAllowed = freeLimit + extraPurchased;
    const remaining = Math.max(0, totalAllowed - questionsUsed);

    return {
      quotaType: 'question',
      remaining,
      isExhausted: remaining <= 0,
      limit: totalAllowed,
      used: questionsUsed,
      extraPurchased,
      audioTokenWeight: 1.0,
      textTokenWeight: 1.0,
      macAddress: normalizedMac,
      monthKey,
      planName: 'Free'
    };
  }

  const plan = subscription.plan;
  const quotaType = plan.quota_type;

  if (quotaType === 'token') {
    const { data: quota } = await supabaseAdmin
      .from('user_token_quota')
      .select('*')
      .eq('mac_address', normalizedMac)
      .eq('month_key', monthKey)
      .single();

    const tokensUsed = quota ? quota.tokens_used : 0;
    const extraPurchased = quota ? quota.extra_purchased : 0;
    const tokenLimit = plan.token_limit;

    // Unlimited plan
    if (tokenLimit === -1) {
      return {
        quotaType: 'token',
        remaining: -1,
        isExhausted: false,
        limit: -1,
        used: tokensUsed,
        extraPurchased,
        audioTokenWeight: parseFloat(plan.audio_token_weight),
        textTokenWeight: parseFloat(plan.text_token_weight),
        macAddress: normalizedMac,
        monthKey,
        planCode: plan.plan_code,
        planName: plan.plan_name,
        subscriptionStatus: subscription.status
      };
    }

    const totalAllowed = tokenLimit + extraPurchased;
    const remaining = Math.max(0, totalAllowed - tokensUsed);

    return {
      quotaType: 'token',
      remaining,
      isExhausted: remaining <= 0,
      limit: totalAllowed,
      used: tokensUsed,
      extraPurchased,
      audioTokenWeight: parseFloat(plan.audio_token_weight),
      textTokenWeight: parseFloat(plan.text_token_weight),
      macAddress: normalizedMac,
      monthKey,
      planCode: plan.plan_code,
      planName: plan.plan_name,
      subscriptionStatus: subscription.status
    };
  }

  // Time-based plan
  if (quotaType === 'time') {
    const { data: quota } = await supabaseAdmin
      .from('user_time_quota')
      .select('*')
      .eq('mac_address', normalizedMac)
      .eq('month_key', monthKey)
      .single();

    const secondsUsed = quota ? quota.seconds_used : 0;
    const extraPurchased = quota ? quota.extra_purchased : 0;
    const timeLimit = plan.time_limit_secs;

    // Unlimited plan
    if (timeLimit === -1) {
      return {
        quotaType: 'time',
        remaining: -1,
        isExhausted: false,
        limit: -1,
        used: secondsUsed,
        extraPurchased,
        audioTokenWeight: 1.0,
        textTokenWeight: 1.0,
        macAddress: normalizedMac,
        monthKey,
        planCode: plan.plan_code,
        planName: plan.plan_name,
        subscriptionStatus: subscription.status
      };
    }

    const totalAllowed = timeLimit + extraPurchased;
    const remaining = Math.max(0, totalAllowed - secondsUsed);

    return {
      quotaType: 'time',
      remaining,
      isExhausted: remaining <= 0,
      limit: totalAllowed,
      used: secondsUsed,
      extraPurchased,
      audioTokenWeight: 1.0,
      textTokenWeight: 1.0,
      macAddress: normalizedMac,
      monthKey,
      planCode: plan.plan_code,
      planName: plan.plan_name,
      subscriptionStatus: subscription.status
    };
  }

  // Question-based plan with subscription
  if (quotaType === 'question') {
    const questionLimit = plan.question_limit;
    const { data: quota } = await supabaseAdmin
      .from('user_question_quota')
      .select('*')
      .eq('mac_address', normalizedMac)
      .eq('month_key', monthKey)
      .single();

    const questionsUsed = quota ? quota.questions_used : 0;
    const extraPurchased = quota ? quota.extra_purchased : 0;
    const totalAllowed = questionLimit + extraPurchased;
    const remaining = Math.max(0, totalAllowed - questionsUsed);

    return {
      quotaType: 'question',
      remaining,
      isExhausted: remaining <= 0,
      limit: totalAllowed,
      used: questionsUsed,
      extraPurchased,
      audioTokenWeight: 1.0,
      textTokenWeight: 1.0,
      macAddress: normalizedMac,
      monthKey,
      planCode: plan.plan_code,
      planName: plan.plan_name,
      subscriptionStatus: subscription.status
    };
  }

  // Fallback - unknown quota type, fail-open
  return {
    quotaType: quotaType || 'unknown',
    remaining: -1,
    isExhausted: false,
    limit: -1,
    used: 0,
    audioTokenWeight: 1.0,
    textTokenWeight: 1.0,
    userId,
    monthKey
  };
};

/**
 * Consume weighted tokens for a device
 * Called by agent workers on each turn via POST /quota/consume/token/:mac
 *
 * @param {string} mac - Device MAC address
 * @param {Object} params - Token consumption details
 * @param {number} params.weightedTokens - Pre-calculated weighted token count
 * @param {number} params.rawInput - Raw input tokens
 * @param {number} params.rawOutput - Raw output tokens
 * @param {string} [params.monthKey] - Optional month key
 * @returns {Promise<Object>} Updated quota status
 */
const consumeTokenByMac = async (mac, { weightedTokens, rawInput, rawOutput, monthKey: clientMonthKey }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) {
    return { remaining: -1, isExhausted: false, tokensUsed: 0, isUnbound: true };
  }

  // Unbound devices - no tracking
  const userId = await resolveUserIdFromMac(mac);
  if (!userId) {
    return { remaining: -1, isExhausted: false, tokensUsed: 0, isUnbound: true };
  }

  const monthKey = (clientMonthKey && isValidMonthKey(clientMonthKey))
    ? clientMonthKey
    : getCurrentMonthKey();

  // Get token limit from user's subscription plan
  const subscription = await getActiveSubscription(userId);
  let tokenLimit = 10000;

  if (subscription && subscription.plan) {
    tokenLimit = subscription.plan.token_limit;
  }

  const { data, error } = await supabaseAdmin
    .rpc('consume_token_quota', {
      p_mac_address: normalizedMac,
      p_month_key: monthKey,
      p_weighted_tokens: Math.round(weightedTokens),
      p_raw_input: Math.round(rawInput),
      p_raw_output: Math.round(rawOutput),
      p_token_limit: tokenLimit
    })
    .single();

  if (error) {
    logger.error('Failed to consume token quota via RPC:', error);
    throw new Error('Failed to consume token quota');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    tokensUsed: data.out_tokens_used,
    extraPurchased: data.out_extra_purchased,
    macAddress: normalizedMac,
    monthKey: data.out_month_key
  };
};

/**
 * Grant extra tokens to a device for the current month
 *
 * @param {string} mac - Device MAC address
 * @param {number} amount - Number of extra tokens to grant
 * @returns {Promise<Object>} Updated quota status
 */
const grantExtraTokens = async (mac, amount) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address');
  if (!amount || amount <= 0) throw new Error('Amount must be a positive number');

  const monthKey = getCurrentMonthKey();

  // Get token limit from user's subscription plan
  const userId = await resolveUserIdFromMac(mac);
  let tokenLimit = 10000;
  if (userId) {
    const subscription = await getActiveSubscription(userId);
    if (subscription && subscription.plan) {
      tokenLimit = subscription.plan.token_limit;
    }
  }

  const { data, error } = await supabaseAdmin
    .rpc('grant_extra_tokens', {
      p_mac_address: normalizedMac,
      p_month_key: monthKey,
      p_amount: amount,
      p_token_limit: tokenLimit
    })
    .single();

  if (error) {
    logger.error('Failed to grant extra tokens via RPC:', error);
    throw new Error('Failed to grant extra tokens');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    tokensUsed: data.out_tokens_used,
    extraPurchased: data.out_extra_purchased,
    macAddress: normalizedMac,
    monthKey: data.out_month_key
  };
};

/**
 * Consume time (seconds) for a device
 * Called by agent workers periodically during session via POST /quota/consume/time/:mac
 *
 * @param {string} mac - Device MAC address
 * @param {Object} params - Time consumption details
 * @param {number} params.seconds - Seconds to consume
 * @param {string} [params.monthKey] - Optional month key
 * @returns {Promise<Object>} Updated quota status
 */
const consumeTimeByMac = async (mac, { seconds, monthKey: clientMonthKey }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) {
    return { remaining: -1, isExhausted: false, secondsUsed: 0, isUnbound: true };
  }

  // Unbound devices - no tracking
  const userId = await resolveUserIdFromMac(mac);
  if (!userId) {
    return { remaining: -1, isExhausted: false, secondsUsed: 0, isUnbound: true };
  }

  const monthKey = (clientMonthKey && isValidMonthKey(clientMonthKey))
    ? clientMonthKey
    : getCurrentMonthKey();

  // Get time limit from user's subscription plan
  const subscription = await getActiveSubscription(userId);
  let timeLimit = 1800; // 30 min default

  if (subscription && subscription.plan) {
    timeLimit = subscription.plan.time_limit_secs;
  }

  const { data, error } = await supabaseAdmin
    .rpc('consume_time_quota', {
      p_mac_address: normalizedMac,
      p_month_key: monthKey,
      p_seconds: Math.round(seconds),
      p_time_limit: timeLimit
    })
    .single();

  if (error) {
    logger.error('Failed to consume time quota via RPC:', error);
    throw new Error('Failed to consume time quota');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    secondsUsed: data.out_seconds_used,
    extraPurchased: data.out_extra_purchased,
    macAddress: normalizedMac,
    monthKey: data.out_month_key
  };
};

/**
 * Grant extra time (seconds) to a device for the current month
 *
 * @param {string} mac - Device MAC address
 * @param {number} amount - Number of extra seconds to grant
 * @returns {Promise<Object>} Updated quota status
 */
const grantExtraTime = async (mac, amount) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address');
  if (!amount || amount <= 0) throw new Error('Amount must be a positive number');

  const monthKey = getCurrentMonthKey();

  // Get time limit from user's subscription plan
  const userId = await resolveUserIdFromMac(mac);
  let timeLimit = 1800;
  if (userId) {
    const subscription = await getActiveSubscription(userId);
    if (subscription && subscription.plan) {
      timeLimit = subscription.plan.time_limit_secs;
    }
  }

  const { data, error } = await supabaseAdmin
    .rpc('grant_extra_time', {
      p_mac_address: normalizedMac,
      p_month_key: monthKey,
      p_amount: amount,
      p_time_limit: timeLimit
    })
    .single();

  if (error) {
    logger.error('Failed to grant extra time via RPC:', error);
    throw new Error('Failed to grant extra time');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    secondsUsed: data.out_seconds_used,
    extraPurchased: data.out_extra_purchased,
    macAddress: normalizedMac,
    monthKey: data.out_month_key
  };
};

/**
 * List all subscription plans
 * @param {boolean} [activeOnly=true] - Only return active plans
 * @returns {Promise<Array>}
 */
const listPlans = async (activeOnly = true) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  let query = supabaseAdmin
    .from('subscription_plan')
    .select('*')
    .order('price_inr', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('Failed to list plans:', error);
    throw new Error('Failed to list plans');
  }

  return data || [];
};

/**
 * Subscribe a user to a plan (admin action)
 *
 * @param {number} userId - User ID
 * @param {number} planId - Plan ID
 * @returns {Promise<Object>} Created subscription
 */
const subscribeUser = async (userId, planId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get the plan
  const { data: plan, error: planError } = await supabaseAdmin
    .from('subscription_plan')
    .select('*')
    .eq('id', planId)
    .eq('is_active', true)
    .single();

  if (planError || !plan) throw new Error('Plan not found or inactive');

  // Expire any existing active/grace subscription
  await supabaseAdmin
    .from('user_subscription')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('status', ['active', 'grace']);

  // Calculate expiry
  let expiresAt = null;
  let graceEndsAt = null;
  const now = new Date();

  if (plan.billing_period === 'monthly') {
    expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30);
    graceEndsAt = new Date(expiresAt);
    graceEndsAt.setDate(graceEndsAt.getDate() + 3);
  } else if (plan.billing_period === 'yearly') {
    expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    graceEndsAt = new Date(expiresAt);
    graceEndsAt.setDate(graceEndsAt.getDate() + 3);
  }
  // 'free' → expiresAt stays null (never expires)

  const { data: sub, error } = await supabaseAdmin
    .from('user_subscription')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'active',
      started_at: now.toISOString(),
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      grace_ends_at: graceEndsAt ? graceEndsAt.toISOString() : null
    })
    .select('*, plan:subscription_plan(*)')
    .single();

  if (error) {
    logger.error('Failed to subscribe user:', error);
    throw new Error('Failed to subscribe user');
  }

  logger.info(`User ${userId} subscribed to plan ${plan.plan_code} (${plan.plan_name})`);
  return sub;
};

/**
 * Cancel a user's subscription
 *
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Updated subscription
 */
const cancelSubscription = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const now = new Date();
  const graceEndsAt = new Date(now);
  graceEndsAt.setDate(graceEndsAt.getDate() + 3);

  const { data, error } = await supabaseAdmin
    .from('user_subscription')
    .update({
      status: 'cancelled',
      grace_ends_at: graceEndsAt.toISOString(),
      updated_at: now.toISOString()
    })
    .eq('user_id', userId)
    .in('status', ['active'])
    .select('*, plan:subscription_plan(*)')
    .single();

  if (error || !data) {
    throw new Error('No active subscription to cancel');
  }

  logger.info(`User ${userId} subscription cancelled, grace until ${graceEndsAt.toISOString()}`);
  return data;
};

/**
 * Get user subscription + quota status (admin view)
 * Aggregates quota across all user's devices
 */
const getUserSubscriptionStatus = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const subscription = await getActiveSubscription(userId);
  const monthKey = getCurrentMonthKey();

  // Find all devices for this user
  const { data: devices } = await supabaseAdmin
    .from('ai_device')
    .select('mac_address')
    .eq('user_id', userId);
  const macs = (devices || []).map(d => d.mac_address);

  if (!subscription) {
    const freeLimit = await getParamValue('free_monthly_quota', DEFAULT_FREE_QUOTA);

    let deviceQuotas = [];
    if (macs.length > 0) {
      const { data: quotas } = await supabaseAdmin
        .from('user_question_quota')
        .select('*')
        .in('mac_address', macs)
        .eq('month_key', monthKey);

      deviceQuotas = macs.map(m => {
        const q = (quotas || []).find(q => q.mac_address === m);
        const used = q ? q.questions_used : 0;
        const extra = q ? q.extra_purchased : 0;
        const total = freeLimit + extra;
        return { macAddress: m, used, extra, remaining: Math.max(0, total - used) };
      });
    }

    const totalUsed = deviceQuotas.reduce((sum, d) => sum + d.used, 0);

    return {
      hasSubscription: false,
      quotaType: 'question',
      planName: 'Free',
      used: totalUsed,
      limit: freeLimit,
      devices: deviceQuotas,
      monthKey
    };
  }

  const plan = subscription.plan;

  if (plan.quota_type === 'token') {
    let deviceQuotas = [];
    if (macs.length > 0) {
      const { data: quotas } = await supabaseAdmin
        .from('user_token_quota')
        .select('*')
        .in('mac_address', macs)
        .eq('month_key', monthKey);

      deviceQuotas = macs.map(m => {
        const q = (quotas || []).find(q => q.mac_address === m);
        return {
          macAddress: m,
          tokensUsed: q ? q.tokens_used : 0,
          rawInput: q ? q.raw_input_tokens : 0,
          rawOutput: q ? q.raw_output_tokens : 0,
          extraPurchased: q ? q.extra_purchased : 0
        };
      });
    }

    const totalUsed = deviceQuotas.reduce((sum, d) => sum + d.tokensUsed, 0);
    const totalExtra = deviceQuotas.reduce((sum, d) => sum + d.extraPurchased, 0);
    const limit = plan.token_limit === -1 ? -1 : plan.token_limit + totalExtra;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - totalUsed);

    return {
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        startedAt: subscription.started_at,
        expiresAt: subscription.expires_at
      },
      quotaType: 'token',
      planCode: plan.plan_code,
      planName: plan.plan_name,
      used: totalUsed,
      limit,
      remaining,
      devices: deviceQuotas,
      monthKey
    };
  }

  if (plan.quota_type === 'time') {
    let deviceQuotas = [];
    if (macs.length > 0) {
      const { data: quotas } = await supabaseAdmin
        .from('user_time_quota')
        .select('*')
        .in('mac_address', macs)
        .eq('month_key', monthKey);

      deviceQuotas = macs.map(m => {
        const q = (quotas || []).find(q => q.mac_address === m);
        return {
          macAddress: m,
          secondsUsed: q ? q.seconds_used : 0,
          extraPurchased: q ? q.extra_purchased : 0
        };
      });
    }

    const totalUsed = deviceQuotas.reduce((sum, d) => sum + d.secondsUsed, 0);
    const totalExtra = deviceQuotas.reduce((sum, d) => sum + d.extraPurchased, 0);
    const limit = plan.time_limit_secs === -1 ? -1 : plan.time_limit_secs + totalExtra;
    const remaining = limit === -1 ? -1 : Math.max(0, limit - totalUsed);

    return {
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        startedAt: subscription.started_at,
        expiresAt: subscription.expires_at
      },
      quotaType: 'time',
      planCode: plan.plan_code,
      planName: plan.plan_name,
      used: totalUsed,
      limit,
      remaining,
      devices: deviceQuotas,
      monthKey
    };
  }

  // Question-based with subscription
  let deviceQuotas = [];
  if (macs.length > 0) {
    const { data: quotas } = await supabaseAdmin
      .from('user_question_quota')
      .select('*')
      .in('mac_address', macs)
      .eq('month_key', monthKey);

    deviceQuotas = macs.map(m => {
      const q = (quotas || []).find(q => q.mac_address === m);
      return {
        macAddress: m,
        used: q ? q.questions_used : 0,
        extraPurchased: q ? q.extra_purchased : 0
      };
    });
  }

  const totalUsed = deviceQuotas.reduce((sum, d) => sum + d.used, 0);
  const totalExtra = deviceQuotas.reduce((sum, d) => sum + d.extraPurchased, 0);
  const limit = plan.question_limit + totalExtra;

  return {
    hasSubscription: true,
    subscription: {
      id: subscription.id,
      status: subscription.status,
      startedAt: subscription.started_at,
      expiresAt: subscription.expires_at
    },
    quotaType: 'question',
    planCode: plan.plan_code,
    planName: plan.plan_name,
    used: totalUsed,
    limit,
    remaining: Math.max(0, limit - totalUsed),
    devices: deviceQuotas,
    monthKey
  };
};

module.exports = {
  getUnifiedQuota,
  consumeTokenByMac,
  consumeTimeByMac,
  grantExtraTokens,
  grantExtraTime,
  listPlans,
  subscribeUser,
  cancelSubscription,
  getActiveSubscription,
  getUserSubscriptionStatus,
  resolveUserIdFromMac
};
