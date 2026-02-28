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
 * Upserts the current month row and increments questions_used by 1
 *
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Updated quota status
 */
const incrementByMac = async (mac) => {
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

  const monthKey = getCurrentMonthKey();
  const freeLimit = await getFreeMonthlyLimit();

  // Upsert: insert if not exists, increment if exists
  const { data: existing } = await supabaseAdmin
    .from('user_question_quota')
    .select('id, questions_used, extra_purchased')
    .eq('user_id', userId)
    .eq('month_key', monthKey)
    .single();

  let questionsUsed;
  let extraPurchased;

  if (existing) {
    // Update existing row
    questionsUsed = existing.questions_used + 1;
    extraPurchased = existing.extra_purchased;

    const { error } = await supabaseAdmin
      .from('user_question_quota')
      .update({
        questions_used: questionsUsed,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (error) {
      logger.error('Failed to increment quota:', error);
      throw new Error('Failed to increment quota');
    }
  } else {
    // Insert new row for this month
    questionsUsed = 1;
    extraPurchased = 0;

    const { error } = await supabaseAdmin
      .from('user_question_quota')
      .insert({
        user_id: userId,
        month_key: monthKey,
        questions_used: 1,
        extra_purchased: 0
      });

    if (error) {
      logger.error('Failed to create quota row:', error);
      throw new Error('Failed to create quota row');
    }
  }

  const totalAllowed = freeLimit + extraPurchased;
  const remaining = totalAllowed - questionsUsed;

  return {
    remaining: Math.max(0, remaining),
    isExhausted: remaining <= 0,
    questionsUsed,
    freeLimit,
    extraPurchased,
    userId,
    monthKey
  };
};

/**
 * Grant extra questions to a user for the current month
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

  const { data: existing } = await supabaseAdmin
    .from('user_question_quota')
    .select('id, questions_used, extra_purchased')
    .eq('user_id', userId)
    .eq('month_key', monthKey)
    .single();

  let questionsUsed;
  let extraPurchased;

  if (existing) {
    extraPurchased = existing.extra_purchased + amount;
    questionsUsed = existing.questions_used;

    const { error } = await supabaseAdmin
      .from('user_question_quota')
      .update({
        extra_purchased: extraPurchased,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);

    if (error) {
      logger.error('Failed to grant extra quota:', error);
      throw new Error('Failed to grant extra quota');
    }
  } else {
    extraPurchased = amount;
    questionsUsed = 0;

    const { error } = await supabaseAdmin
      .from('user_question_quota')
      .insert({
        user_id: userId,
        month_key: monthKey,
        questions_used: 0,
        extra_purchased: amount
      });

    if (error) {
      logger.error('Failed to create quota with extras:', error);
      throw new Error('Failed to create quota with extras');
    }
  }

  const totalAllowed = freeLimit + extraPurchased;
  const remaining = totalAllowed - questionsUsed;

  return {
    remaining: Math.max(0, remaining),
    isExhausted: remaining <= 0,
    questionsUsed,
    freeLimit,
    extraPurchased,
    userId,
    monthKey
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

module.exports = {
  getQuotaByMac,
  incrementByMac,
  grantExtra,
  getQuotaForUser,
  listQuotas,
  getCurrentMonthKey,
  getFreeMonthlyLimit
};
