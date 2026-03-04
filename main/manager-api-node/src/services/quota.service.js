/**
 * Quota Service
 *
 * Manages per-user monthly question quotas.
 * Each user gets a configurable number of free questions per month.
 * Admins can grant extra question packs. No cron needed - month_key provides natural reset.
 */

const { supabaseAdmin } = require('../config/database');
const { getParamValue } = require('./system.service');
const { normalizeMacAddress } = require('../utils/helpers');
const logger = require('../utils/logger');

const DEFAULT_FREE_QUOTA = 20;

/**
 * Get current month key in YYYY-MM format
 * @returns {string} e.g. '2026-03'
 */
const getCurrentMonthKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

/**
 * Validate a month key string is in YYYY-MM format
 * @param {string} key
 * @returns {boolean}
 */
const isValidMonthKey = (key) => {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
};

/**
 * Resolve MAC address to user_id via ai_device table
 * @param {string} mac - Device MAC address
 * @returns {Promise<number|null>} user_id or null
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
 * Get the free monthly quota limit from sys_params
 * @returns {Promise<number>}
 */
const getFreeMonthlyLimit = async () => {
  return await getParamValue('free_monthly_quota', DEFAULT_FREE_QUOTA);
};

/**
 * Get quota status for a device by MAC address
 * Used by agent workers to check/enforce limits
 *
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Quota status
 */
const getQuotaByMac = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const userId = await resolveUserIdFromMac(mac);

  // Unbound devices (no user_id) get unlimited - they're test devices
  if (!userId) {
    return {
      remaining: -1,
      isExhausted: false,
      questionsUsed: 0,
      freeLimit: -1,
      extraPurchased: 0,
      isUnbound: true
    };
  }

  const freeLimit = await getFreeMonthlyLimit();
  const monthKey = getCurrentMonthKey();

  const { data: quota, error } = await supabaseAdmin
    .from('user_question_quota')
    .select('*')
    .eq('user_id', userId)
    .eq('month_key', monthKey)
    .single();

  if (error || !quota) {
    // No row yet = no questions used this month
    return {
      remaining: freeLimit,
      isExhausted: false,
      questionsUsed: 0,
      freeLimit,
      extraPurchased: 0,
      userId,
      monthKey
    };
  }

  const totalAllowed = freeLimit + quota.extra_purchased;
  const remaining = totalAllowed - quota.questions_used;

  return {
    remaining: Math.max(0, remaining),
    isExhausted: remaining <= 0,
    questionsUsed: quota.questions_used,
    freeLimit,
    extraPurchased: quota.extra_purchased,
    userId,
    monthKey
  };
};

/**
 * Increment question count for a device by MAC address
 * Uses atomic RPC function to avoid race conditions and UNIQUE constraint violations
 *
 * @param {string} mac - Device MAC address
 * @param {string} [clientMonthKey] - Optional month key from client (for month-rollover handling)
 * @returns {Promise<Object>} Updated quota status
 */
const incrementByMac = async (mac, clientMonthKey) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const userId = await resolveUserIdFromMac(mac);

  // Unbound devices - no tracking needed
  if (!userId) {
    return {
      remaining: -1,
      isExhausted: false,
      questionsUsed: 0,
      isUnbound: true
    };
  }

  // Use client month key if valid, otherwise server's current month
  const monthKey = (clientMonthKey && isValidMonthKey(clientMonthKey))
    ? clientMonthKey
    : getCurrentMonthKey();
  const freeLimit = await getFreeMonthlyLimit();

  // Atomic upsert via RPC - no race window, no UNIQUE violation
  const { data, error } = await supabaseAdmin
    .rpc('increment_question_quota', {
      p_user_id: userId,
      p_month_key: monthKey,
      p_free_limit: freeLimit
    })
    .single();

  if (error) {
    logger.error('Failed to increment quota via RPC:', error);
    throw new Error('Failed to increment quota');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    questionsUsed: data.out_questions_used,
    freeLimit,
    extraPurchased: data.out_extra_purchased,
    userId,
    monthKey: data.out_month_key
  };
};

/**
 * Grant extra questions to a user for the current month
 * Uses atomic RPC function to avoid race conditions
 *
 * @param {number} userId - User ID
 * @param {number} amount - Number of extra questions to grant
 * @returns {Promise<Object>} Updated quota status
 */
const grantExtra = async (userId, amount) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  if (!amount || amount <= 0) {
    throw new Error('Amount must be a positive number');
  }

  const monthKey = getCurrentMonthKey();
  const freeLimit = await getFreeMonthlyLimit();

  // Atomic upsert via RPC - no race window, no UNIQUE violation
  const { data, error } = await supabaseAdmin
    .rpc('grant_extra_quota', {
      p_user_id: userId,
      p_month_key: monthKey,
      p_amount: amount,
      p_free_limit: freeLimit
    })
    .single();

  if (error) {
    logger.error('Failed to grant extra quota via RPC:', error);
    throw new Error('Failed to grant extra quota');
  }

  return {
    remaining: data.out_remaining,
    isExhausted: data.out_is_exhausted,
    questionsUsed: data.out_questions_used,
    freeLimit,
    extraPurchased: data.out_extra_purchased,
    userId,
    monthKey: data.out_month_key
  };
};

/**
 * Get quota for a specific user (admin view)
 *
 * @param {number} userId - User ID
 * @param {string} [monthKey] - Optional month key, defaults to current month
 * @returns {Promise<Object>} Quota status
 */
const getQuotaForUser = async (userId, monthKey) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const targetMonth = monthKey || getCurrentMonthKey();
  const freeLimit = await getFreeMonthlyLimit();

  const { data: quota, error } = await supabaseAdmin
    .from('user_question_quota')
    .select('*')
    .eq('user_id', userId)
    .eq('month_key', targetMonth)
    .single();

  if (error || !quota) {
    return {
      remaining: freeLimit,
      isExhausted: false,
      questionsUsed: 0,
      freeLimit,
      extraPurchased: 0,
      userId,
      monthKey: targetMonth
    };
  }

  const totalAllowed = freeLimit + quota.extra_purchased;
  const remaining = totalAllowed - quota.questions_used;

  return {
    remaining: Math.max(0, remaining),
    isExhausted: remaining <= 0,
    questionsUsed: quota.questions_used,
    freeLimit,
    extraPurchased: quota.extra_purchased,
    userId,
    monthKey: targetMonth
  };
};

/**
 * List all users' quotas (admin dashboard)
 *
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated quota list
 */
const listQuotas = async ({ page = 1, limit = 20, monthKey } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const targetMonth = monthKey || getCurrentMonthKey();
  const offset = (page - 1) * limit;

  const { count } = await supabaseAdmin
    .from('user_question_quota')
    .select('id', { count: 'exact', head: true })
    .eq('month_key', targetMonth);

  const { data: quotas, error } = await supabaseAdmin
    .from('user_question_quota')
    .select('*, user:sys_user(id, username, email)')
    .eq('month_key', targetMonth)
    .order('questions_used', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to list quotas:', error);
    throw new Error('Failed to list quotas');
  }

  const freeLimit = await getFreeMonthlyLimit();

  // Enrich each row with computed fields
  const enriched = (quotas || []).map(q => {
    const totalAllowed = freeLimit + q.extra_purchased;
    const remaining = totalAllowed - q.questions_used;
    return {
      ...q,
      freeLimit,
      remaining: Math.max(0, remaining),
      isExhausted: remaining <= 0
    };
  });

  return {
    list: enriched,
    total: count || 0,
    page,
    limit,
    monthKey: targetMonth,
    freeLimit
  };
};

/**
 * Start a protected game session for a device
 * Atomically checks quota, stale sessions, and inserts new session via RPC.
 *
 * @param {string} mac - Device MAC address
 * @param {string} agentType - Game type ('math_tutor', 'riddle_solver', 'word_ladder')
 * @param {string} sessionId - Room name for correlation
 * @returns {Promise<Object>} { allowed, reason, sessionId, remaining, isExhausted }
 */
const startGameSession = async (mac, agentType, sessionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const userId = await resolveUserIdFromMac(mac);

  // Unbound devices (no user_id) get unlimited - allow immediately
  if (!userId) {
    return {
      allowed: true,
      reason: 'unbound_device',
      sessionId,
      remaining: -1,
      isExhausted: false
    };
  }

  const freeLimit = await getFreeMonthlyLimit();

  const { data, error } = await supabaseAdmin
    .rpc('start_game_session', {
      p_user_id: userId,
      p_mac_address: normalizeMacAddress(mac),
      p_agent_type: agentType,
      p_session_id: sessionId,
      p_free_limit: freeLimit,
      p_stale_minutes: 60
    })
    .single();

  if (error) {
    logger.error('Failed to start game session via RPC:', error);
    throw new Error('Failed to start game session');
  }

  return {
    allowed: data.allowed,
    reason: data.reason,
    sessionId: data.session_id,
    remaining: data.remaining != null ? data.remaining : -1,
    isExhausted: data.allowed === false && data.reason === 'quota_exhausted'
  };
};

/**
 * End a protected game session
 *
 * @param {string} mac - Device MAC address
 * @param {string} agentType - Game type
 * @param {string} sessionId - Room name for correlation
 * @param {string} status - Final status ('completed' or 'abandoned')
 * @returns {Promise<Object>} { ended: true/false }
 */
const endGameSession = async (mac, agentType, sessionId, status = 'completed') => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const validStatuses = ['completed', 'abandoned'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  const { data, error } = await supabaseAdmin
    .from('game_session_protection')
    .update({
      status,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('session_id', sessionId)
    .eq('status', 'active')
    .select('id');

  if (error) {
    logger.error('Failed to end game session:', error);
    throw new Error('Failed to end game session');
  }

  return {
    ended: data && data.length > 0
  };
};

module.exports = {
  getQuotaByMac,
  incrementByMac,
  grantExtra,
  getQuotaForUser,
  listQuotas,
  getCurrentMonthKey,
  getFreeMonthlyLimit,
  isValidMonthKey,
  startGameSession,
  endGameSession
};
