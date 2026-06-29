/**
 * Profile Service
 *
 * Handles kid profiles and preferences.
 */

const { prisma } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Get all kid profiles for user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Kid profiles
 */
const getKidProfiles = async (userId) => {
  try {
    const profiles = await prisma.kid_profile.findMany({
      where: { user_id: BigInt(userId) },
      orderBy: { created_at: 'asc' }
    });

    return profiles;
  } catch (err) {
    logger.error('Failed to fetch kid profiles:', err);
    throw new Error('Failed to fetch kid profiles');
  }
};

/**
 * Get kid profile by ID
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Kid profile
 */
const getKidById = async (userId, kidId) => {
  try {
    const profile = await prisma.kid_profile.findFirst({
      where: {
        id: BigInt(kidId),
        user_id: BigInt(userId)
      }
    });

    if (!profile) return null;

    return profile;
  } catch (err) {
    return null;
  }
};

/**
 * Create kid profile
 * @param {number} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Promise<Object>} Created profile
 */
const PARENT_RULE_MAX_LEN = 500;

/**
 * Bound free-text parent custom instructions: trim + length cap. Bounds input
 * only — does NOT judge meaning (ADR-0004). The worker re-sanitizes (strips
 * fences/control chars, collapses whitespace) on every render. Null if empty.
 */
const sanitizeParentRule = (value) => {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s.slice(0, PARENT_RULE_MAX_LEN);
};

const createKid = async (userId, data) => {
  try {
    const profile = await prisma.kid_profile.create({
      data: {
        user_id: BigInt(userId),
        name: data.name,
        nickname: data.nickname || null,
        avatar_url: data.avatarUrl || null,
        birth_date: data.birthDate ? new Date(data.birthDate) : null,
        gender: data.gender || null,
        grade: data.grade || null,
        school: data.school || null,
        interests: data.interests || [],
        language: data.language || 'en',
        timezone: data.timezone || null,
        parent_rule: sanitizeParentRule(data.parent_rule),
        preferences: data.preferences || {}
      }
    });

    return profile;
  } catch (err) {
    logger.error('Failed to create kid profile:', err);
    throw new Error('Failed to create kid profile');
  }
};

/**
 * Update kid profile
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated profile
 */
const updateKid = async (userId, kidId, data) => {
  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const updateData = { updated_at: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
  if (data.birthDate !== undefined) updateData.birth_date = data.birthDate ? new Date(data.birthDate) : null;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.grade !== undefined) updateData.grade = data.grade;
  if (data.school !== undefined) updateData.school = data.school;
  if (data.interests !== undefined) updateData.interests = data.interests;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.parent_rule !== undefined) updateData.parent_rule = sanitizeParentRule(data.parent_rule);
  if (data.preferences !== undefined) updateData.preferences = data.preferences;

  try {
    const profile = await prisma.kid_profile.update({
      where: { id: BigInt(kidId) },
      data: updateData
    });

    return profile;
  } catch (err) {
    logger.error('Failed to update kid profile:', err);
    throw new Error('Failed to update kid profile');
  }
};

/**
 * Delete kid profile
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 */
const deleteKid = async (userId, kidId) => {
  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  try {
    await prisma.kid_profile.delete({
      where: { id: BigInt(kidId) }
    });
  } catch (err) {
    logger.error('Failed to delete kid profile:', err);
    throw new Error('Failed to delete kid profile');
  }
};

/**
 * Get kid's learning progress
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Learning progress
 */
const getProgress = async (userId, kidId) => {
  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  try {
    const progress = await prisma.kid_learning_progress.findMany({
      where: { kid_id: BigInt(kidId) },
      orderBy: { updated_at: 'desc' }
    });

    return progress;
  } catch (err) {
    logger.error('Failed to fetch learning progress:', err);
    throw new Error('Failed to fetch learning progress');
  }
};

/**
 * Update learning progress
 * @param {number} kidId - Kid ID
 * @param {Object} data - Progress data
 * @returns {Promise<Object>} Updated progress
 */
const updateProgress = async (kidId, data) => {
  try {
    // kid_learning_progress has a unique constraint on [kid_id, subject, topic]
    const progress = await prisma.kid_learning_progress.upsert({
      where: {
        kid_id_subject_topic: {
          kid_id: BigInt(kidId),
          subject: data.subject,
          topic: data.topic
        }
      },
      update: {
        score: data.score,
        time_spent: data.timeSpent,
        completed: data.completed || false,
        metadata: data.metadata || {},
        updated_at: new Date()
      },
      create: {
        kid_id: BigInt(kidId),
        subject: data.subject,
        topic: data.topic,
        score: data.score,
        time_spent: data.timeSpent,
        completed: data.completed || false,
        metadata: data.metadata || {}
      }
    });

    return progress;
  } catch (err) {
    logger.error('Failed to update learning progress:', err);
    throw new Error('Failed to update learning progress');
  }
};

/**
 * Get kid's activity history
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Activity history
 */
const getActivityHistory = async (userId, kidId, { page = 1, limit = 20 } = {}) => {
  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const offset = (page - 1) * limit;

  try {
    const [total, activities] = await Promise.all([
      prisma.kid_activity_log.count({
        where: { kid_id: BigInt(kidId) }
      }),
      prisma.kid_activity_log.findMany({
        where: { kid_id: BigInt(kidId) },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      })
    ]);

    return {
      list: activities,
      total,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to fetch activity history:', err);
    throw new Error('Failed to fetch activity history');
  }
};

/**
 * Log kid activity
 * @param {number} kidId - Kid ID
 * @param {Object} data - Activity data
 * @returns {Promise<Object>} Created activity log
 */
const logActivity = async (kidId, data) => {
  try {
    const activity = await prisma.kid_activity_log.create({
      data: {
        kid_id: BigInt(kidId),
        activity_type: data.activityType,
        content_type: data.contentType || null,
        content_id: data.contentId || null,
        duration: data.duration || null,
        metadata: data.metadata || {}
      }
    });

    return activity;
  } catch (err) {
    logger.error('Failed to log activity:', err);
    throw new Error('Failed to log activity');
  }
};

/**
 * Get kid preferences
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Preferences
 */
const getPreferences = async (kidId) => {
  try {
    const profile = await prisma.kid_profile.findFirst({
      where: { id: BigInt(kidId) },
      select: { preferences: true, language: true, interests: true }
    });

    if (!profile) return null;

    return {
      language: profile.language,
      interests: profile.interests,
      ...(profile.preferences || {})
    };
  } catch (err) {
    return null;
  }
};

/**
 * Update kid preferences
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} preferences - New preferences
 * @returns {Promise<Object>} Updated preferences
 */
const updatePreferences = async (userId, kidId, preferences) => {
  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  try {
    const profile = await prisma.kid_profile.update({
      where: { id: BigInt(kidId) },
      data: {
        preferences: {
          ...(existing.preferences || {}),
          ...preferences
        },
        updated_at: new Date()
      },
      select: { preferences: true }
    });

    return profile.preferences;
  } catch (err) {
    logger.error('Failed to update preferences:', err);
    throw new Error('Failed to update preferences');
  }
};

// =============================================
// Parent Profile Methods
// =============================================

const dateOrNull = (value) => (value ? new Date(value) : null);

const applyParentProfileFields = (target, data) => {
  if (data.fullName !== undefined) target.display_name = data.fullName;
  if (data.displayName !== undefined) target.display_name = data.displayName;
  if (data.parent_name !== undefined) target.display_name = data.parent_name;
  if (data.email !== undefined) target.email = data.email;
  if (data.phoneNumber !== undefined) target.phone_number = data.phoneNumber;
  if (data.phone_number !== undefined) target.phone_number = data.phone_number;
  if (data.preferredLanguage !== undefined) target.language = data.preferredLanguage;
  if (data.preferred_language !== undefined) target.language = data.preferred_language;
  if (data.language !== undefined) target.language = data.language;
  if (data.timezone !== undefined) target.timezone = data.timezone;
  if (data.fcm_token !== undefined) target.fcm_token = data.fcm_token;
  if (data.fcmToken !== undefined) target.fcm_token = data.fcmToken;
  if (data.terms_version !== undefined) target.terms_version = data.terms_version;
  if (data.termsVersion !== undefined) target.terms_version = data.termsVersion;
  if (data.terms_accepted_at !== undefined) target.terms_accepted_at = dateOrNull(data.terms_accepted_at);
  if (data.termsAcceptedAt !== undefined) target.terms_accepted_at = dateOrNull(data.termsAcceptedAt);
  if (data.privacy_policy_accepted_at !== undefined) {
    target.privacy_policy_accepted_at = dateOrNull(data.privacy_policy_accepted_at);
  }
  if (data.privacyPolicyAcceptedAt !== undefined) {
    target.privacy_policy_accepted_at = dateOrNull(data.privacyPolicyAcceptedAt);
  }
  if (data.consent_accepted_at !== undefined) target.consent_accepted_at = dateOrNull(data.consent_accepted_at);
  if (data.consentAcceptedAt !== undefined) target.consent_accepted_at = dateOrNull(data.consentAcceptedAt);
  if (data.onboardingCompleted !== undefined) target.onboarding_completed = data.onboardingCompleted;
  if (data.onboarding_completed !== undefined) target.onboarding_completed = data.onboarding_completed;
  if (data.emailNotifications !== undefined) target.email_notifications = data.emailNotifications;
  if (data.email_notifications !== undefined) target.email_notifications = data.email_notifications;
  if (data.pushNotifications !== undefined) target.push_notifications = data.pushNotifications;
  if (data.push_notifications !== undefined) target.push_notifications = data.push_notifications;
  if (data.weeklyReport !== undefined) target.weekly_report = data.weeklyReport;
  if (data.weekly_report !== undefined) target.weekly_report = data.weekly_report;

  if (data.notificationPreferences !== undefined) {
    const prefs = data.notificationPreferences;
    if (prefs.email !== undefined) target.email_notifications = prefs.email;
    if (prefs.push !== undefined) target.push_notifications = prefs.push;
    if (prefs.weeklyReport !== undefined) target.weekly_report = prefs.weeklyReport;
  }
};

/**
 * Get parent profile for user
 * @param {string|number} userId - User ID
 * @returns {Promise<Object>} Parent profile
 */
const getParentProfile = async (userId) => {
  try {
    const profile = await prisma.parent_profile.findFirst({
      where: { user_id: BigInt(userId) }
    });

    return profile || null;
  } catch (err) {
    logger.error('Failed to fetch parent profile', { err, userId });
    throw new Error('Failed to fetch parent profile');
  }
};

/**
 * Get parent profile by Supabase user ID
 * NOTE: supabase_user_id is no longer in the current schema.
 * This function is kept for API compatibility but will always return null.
 * @param {string} supabaseUserId - Supabase user ID (deprecated field)
 * @returns {Promise<Object>} Parent profile
 */
const getParentBySupabaseId = async (supabaseUserId) => {
  logger.warn('getParentBySupabaseId: supabase_user_id field no longer exists in schema. Returning null.', { supabaseUserId });
  return null;
};

/**
 * Create parent profile
 * @param {string|number} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Promise<Object>} Created profile
 */
const createParentProfile = async (userId, data) => {
  // Check if profile already exists
  const existing = await getParentProfile(userId);
  if (existing) {
    throw new Error('Parent profile already exists for this user');
  }

  try {
    const createData = {
      user_id: BigInt(userId),
      email: data.email || null,
      language: data.preferredLanguage || data.preferred_language || data.language || 'en',
      onboarding_completed: data.onboardingCompleted || data.onboarding_completed || false
    };
    applyParentProfileFields(createData, data);

    const profile = await prisma.parent_profile.create({
      data: createData
    });

    return profile;
  } catch (err) {
    logger.error('Failed to create parent profile', { err, userId });
    throw new Error('Failed to create parent profile');
  }
};

/**
 * Update parent profile
 * @param {string|number} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated profile
 */
const updateParentProfile = async (userId, data) => {
  // Verify profile exists
  const existing = await getParentProfile(userId);
  if (!existing) throw new Error('Parent profile not found');

  const updateData = { updated_at: new Date() };
  applyParentProfileFields(updateData, data);

  try {
    const profile = await prisma.parent_profile.update({
      where: { id: existing.id },
      data: updateData
    });

    return profile;
  } catch (err) {
    logger.error('Failed to update parent profile', { err, userId });
    throw new Error('Failed to update parent profile');
  }
};

/**
 * Delete parent profile
 * @param {string|number} userId - User ID
 */
const deleteParentProfile = async (userId) => {
  // Verify profile exists
  const existing = await getParentProfile(userId);
  if (!existing) throw new Error('Parent profile not found');

  try {
    await prisma.parent_profile.delete({
      where: { id: existing.id }
    });
  } catch (err) {
    logger.error('Failed to delete parent profile', { err, userId });
    throw new Error('Failed to delete parent profile');
  }
};

/**
 * Update notification preferences
 * @param {string|number} userId - User ID
 * @param {Object} preferences - Notification preferences
 * @returns {Promise<Object>} Updated preferences
 */
const updateNotificationPreferences = async (userId, preferences) => {
  // Verify profile exists
  const existing = await getParentProfile(userId);
  if (!existing) throw new Error('Parent profile not found');

  // In the current schema, notification settings are individual boolean columns
  const updateData = { updated_at: new Date() };

  if (preferences.email !== undefined) updateData.email_notifications = preferences.email;
  if (preferences.push !== undefined) updateData.push_notifications = preferences.push;
  if (preferences.weeklyReport !== undefined) updateData.weekly_report = preferences.weeklyReport;

  // Also handle direct boolean field names
  if (preferences.email_notifications !== undefined) updateData.email_notifications = preferences.email_notifications;
  if (preferences.push_notifications !== undefined) updateData.push_notifications = preferences.push_notifications;
  if (preferences.weekly_report !== undefined) updateData.weekly_report = preferences.weekly_report;

  try {
    const profile = await prisma.parent_profile.update({
      where: { id: existing.id },
      data: updateData,
      select: {
        email_notifications: true,
        push_notifications: true,
        weekly_report: true
      }
    });

    // Return in the shape callers expect (mirrors old notification_preferences JSON shape)
    return {
      email: profile.email_notifications,
      push: profile.push_notifications,
      weeklyReport: profile.weekly_report,
      // Also expose raw field names for backward compat
      email_notifications: profile.email_notifications,
      push_notifications: profile.push_notifications,
      weekly_report: profile.weekly_report
    };
  } catch (err) {
    logger.error('Failed to update notification preferences', { err, userId });
    throw new Error('Failed to update notification preferences');
  }
};

/**
 * Mark onboarding as completed
 * @param {string|number} userId - User ID
 * @returns {Promise<Object>} Updated profile
 */
const completeOnboarding = async (userId) => {
  // Verify profile exists first to get id
  const existing = await getParentProfile(userId);
  if (!existing) throw new Error('Parent profile not found');

  try {
    const profile = await prisma.parent_profile.update({
      where: { id: existing.id },
      data: {
        onboarding_completed: true,
        updated_at: new Date()
      }
    });

    return profile;
  } catch (err) {
    logger.error('Failed to complete onboarding', { err, userId });
    throw new Error('Failed to complete onboarding');
  }
};

/**
 * Accept terms and privacy policy
 * @param {string|number} userId - User ID
 * @param {Object} data - Acceptance data
 * @returns {Promise<Object>} Updated profile
 */
const acceptTerms = async (userId, data = {}) => {
  // Verify profile exists first to get id
  const existing = await getParentProfile(userId);
  if (!existing) throw new Error('Parent profile not found');

  const now = new Date();
  const updateData = { updated_at: now };

  if (data.acceptTerms) {
    updateData.terms_accepted_at = now;
  }
  // privacy_policy_accepted_at no longer exists in current schema — skip it silently

  try {
    const profile = await prisma.parent_profile.update({
      where: { id: existing.id },
      data: updateData
    });

    return profile;
  } catch (err) {
    logger.error('Failed to accept terms', { err, userId });
    throw new Error('Failed to accept terms');
  }
};

module.exports = {
  // Kid profile methods
  sanitizeParentRule,
  getKidProfiles,
  getKidById,
  createKid,
  updateKid,
  deleteKid,
  getProgress,
  updateProgress,
  getActivityHistory,
  logActivity,
  getPreferences,
  updatePreferences,
  // Parent profile methods
  getParentProfile,
  getParentBySupabaseId,
  createParentProfile,
  updateParentProfile,
  deleteParentProfile,
  updateNotificationPreferences,
  completeOnboarding,
  acceptTerms
};
