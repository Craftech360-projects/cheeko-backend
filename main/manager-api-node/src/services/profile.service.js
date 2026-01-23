/**
 * Profile Service
 *
 * Handles kid profiles and preferences.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Get all kid profiles for user
 * @param {number} userId - User ID
 * @returns {Promise<Array>} Kid profiles
 */
const getKidProfiles = async (userId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: profiles, error } = await supabaseAdmin
    .from('kid_profile')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error('Failed to fetch kid profiles');

  return profiles || [];
};

/**
 * Get kid profile by ID
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Kid profile
 */
const getKidById = async (userId, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .select('*')
    .eq('id', kidId)
    .eq('user_id', userId)
    .single();

  if (error || !profile) return null;

  return profile;
};

/**
 * Create kid profile
 * @param {number} userId - User ID
 * @param {Object} data - Profile data
 * @returns {Promise<Object>} Created profile
 */
const createKid = async (userId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .insert({
      user_id: userId,
      name: data.name,
      nickname: data.nickname,
      avatar_url: data.avatarUrl,
      birth_date: data.birthDate,
      gender: data.gender,
      grade: data.grade,
      school: data.school,
      interests: data.interests,
      language: data.language || 'en',
      timezone: data.timezone,
      preferences: data.preferences || {}
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create kid profile');

  return profile;
};

/**
 * Update kid profile
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated profile
 */
const updateKid = async (userId, kidId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const updateData = { updated_at: new Date().toISOString() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.nickname !== undefined) updateData.nickname = data.nickname;
  if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
  if (data.birthDate !== undefined) updateData.birth_date = data.birthDate;
  if (data.gender !== undefined) updateData.gender = data.gender;
  if (data.grade !== undefined) updateData.grade = data.grade;
  if (data.school !== undefined) updateData.school = data.school;
  if (data.interests !== undefined) updateData.interests = data.interests;
  if (data.language !== undefined) updateData.language = data.language;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.preferences !== undefined) updateData.preferences = data.preferences;

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .update(updateData)
    .eq('id', kidId)
    .select()
    .single();

  if (error) throw new Error('Failed to update kid profile');

  return profile;
};

/**
 * Delete kid profile
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 */
const deleteKid = async (userId, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const { error } = await supabaseAdmin
    .from('kid_profile')
    .delete()
    .eq('id', kidId);

  if (error) throw new Error('Failed to delete kid profile');
};

/**
 * Get kid's learning progress
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Learning progress
 */
const getProgress = async (userId, kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const { data: progress, error } = await supabaseAdmin
    .from('kid_learning_progress')
    .select('*')
    .eq('kid_id', kidId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error('Failed to fetch learning progress');

  return progress || [];
};

/**
 * Update learning progress
 * @param {number} kidId - Kid ID
 * @param {Object} data - Progress data
 * @returns {Promise<Object>} Updated progress
 */
const updateProgress = async (kidId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: progress, error } = await supabaseAdmin
    .from('kid_learning_progress')
    .upsert({
      kid_id: kidId,
      subject: data.subject,
      topic: data.topic,
      score: data.score,
      time_spent: data.timeSpent,
      completed: data.completed || false,
      metadata: data.metadata || {},
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'kid_id,subject,topic'
    })
    .select()
    .single();

  if (error) throw new Error('Failed to update learning progress');

  return progress;
};

/**
 * Get kid's activity history
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Activity history
 */
const getActivityHistory = async (userId, kidId, { page = 1, limit = 20 } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const offset = (page - 1) * limit;

  const { count } = await supabaseAdmin
    .from('kid_activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('kid_id', kidId);

  const { data: activities, error } = await supabaseAdmin
    .from('kid_activity_log')
    .select('*')
    .eq('kid_id', kidId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error('Failed to fetch activity history');

  return {
    list: activities || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Log kid activity
 * @param {number} kidId - Kid ID
 * @param {Object} data - Activity data
 * @returns {Promise<Object>} Created activity log
 */
const logActivity = async (kidId, data) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: activity, error } = await supabaseAdmin
    .from('kid_activity_log')
    .insert({
      kid_id: kidId,
      activity_type: data.activityType,
      content_type: data.contentType,
      content_id: data.contentId,
      duration: data.duration,
      metadata: data.metadata || {}
    })
    .select()
    .single();

  if (error) throw new Error('Failed to log activity');

  return activity;
};

/**
 * Get kid preferences
 * @param {number} kidId - Kid ID
 * @returns {Promise<Object>} Preferences
 */
const getPreferences = async (kidId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .select('preferences, language, interests')
    .eq('id', kidId)
    .single();

  if (error || !profile) return null;

  return {
    language: profile.language,
    interests: profile.interests,
    ...profile.preferences
  };
};

/**
 * Update kid preferences
 * @param {number} userId - User ID
 * @param {number} kidId - Kid ID
 * @param {Object} preferences - New preferences
 * @returns {Promise<Object>} Updated preferences
 */
const updatePreferences = async (userId, kidId, preferences) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Verify ownership
  const existing = await getKidById(userId, kidId);
  if (!existing) throw new Error('Kid profile not found');

  const { data: profile, error } = await supabaseAdmin
    .from('kid_profile')
    .update({
      preferences: {
        ...existing.preferences,
        ...preferences
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', kidId)
    .select('preferences')
    .single();

  if (error) throw new Error('Failed to update preferences');

  return profile.preferences;
};

module.exports = {
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
  updatePreferences
};
