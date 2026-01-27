/**
 * Analytics Service
 *
 * Handles game session tracking, game attempts, media playback,
 * streaks, and user progress analytics.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { generateUUID, normalizeMacAddress } = require('../utils/helpers');

// =============================================
// Session Management
// =============================================

/**
 * Start a new game session
 * @param {Object} data - Session data
 * @returns {Promise<Object>} Created session
 */
const startSession = async ({ mac, agentId, modeType, metadata = {} }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const sessionId = generateUUID();
  const now = new Date().toISOString();

  const { data: session, error } = await supabaseAdmin
    .from('analytics_game_sessions')
    .insert({
      session_id: sessionId,
      mac_address: normalizedMac,
      agent_id: agentId || null,
      mode_type: modeType,
      started_at: now,
      interaction_count: 0,
      metadata: metadata,
      created_at: now,
      updated_at: now
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to start session:', error);
    throw new Error('Failed to start session');
  }

  return session;
};

/**
 * End a game session
 * @param {string} sessionId - Session ID
 * @param {Object} data - End session data
 * @returns {Promise<Object>} Updated session
 */
const endSession = async (sessionId, { completionStatus, interactionCount, metadata = {} }) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  // Get existing session
  const { data: existing, error: findError } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  if (findError || !existing) {
    throw new Error('Session not found');
  }

  const now = new Date();
  const startedAt = new Date(existing.started_at);
  const durationSeconds = Math.floor((now - startedAt) / 1000);

  // Merge metadata
  const mergedMetadata = { ...existing.metadata, ...metadata };

  const { data: session, error } = await supabaseAdmin
    .from('analytics_game_sessions')
    .update({
      ended_at: now.toISOString(),
      duration_seconds: durationSeconds,
      completion_status: completionStatus || 'completed',
      interaction_count: interactionCount !== undefined ? interactionCount : existing.interaction_count,
      metadata: mergedMetadata,
      updated_at: now.toISOString()
    })
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to end session:', error);
    throw new Error('Failed to end session');
  }

  return session;
};

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session
 */
const getSession = async (sessionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: session, error } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  if (error || !session) return null;
  return session;
};

/**
 * Get sessions by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated sessions
 */
const getSessionsByMac = async (mac, { page = 1, limit = 10, modeType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('analytics_game_sessions')
    .select('*', { count: 'exact' })
    .eq('mac_address', normalizedMac);

  if (modeType) {
    query = query.eq('mode_type', modeType);
  }

  const { data: sessions, count, error } = await query
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get sessions:', error);
    throw new Error('Failed to get sessions');
  }

  return {
    list: sessions || [],
    total: count || 0,
    page,
    limit
  };
};

// =============================================
// Game Attempts
// =============================================

/**
 * Log a game attempt
 * @param {Object} data - Attempt data
 * @returns {Promise<Object>} Created attempt
 */
const logGameAttempt = async ({
  sessionId,
  mac,
  gameType,
  questionText,
  questionType,
  difficultyLevel,
  correctAnswer,
  userAnswer,
  isCorrect,
  attemptNumber = 1,
  responseTimeMs,
  metadata = {}
}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date().toISOString();

  const { data: attempt, error } = await supabaseAdmin
    .from('analytics_game_attempts')
    .insert({
      session_id: sessionId,
      mac_address: normalizedMac,
      game_type: gameType,
      question_text: questionText,
      question_type: questionType,
      difficulty_level: difficultyLevel,
      correct_answer: correctAnswer,
      user_answer: userAnswer,
      is_correct: isCorrect,
      attempt_number: attemptNumber,
      response_time_ms: responseTimeMs,
      answered_at: now,
      metadata: metadata,
      created_at: now
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to log game attempt:', error);
    throw new Error('Failed to log game attempt');
  }

  // Increment session interaction count
  if (sessionId) {
    await supabaseAdmin
      .from('analytics_game_sessions')
      .update({
        interaction_count: supabaseAdmin.raw('interaction_count + 1'),
        updated_at: now
      })
      .eq('session_id', sessionId);
  }

  return attempt;
};

/**
 * Get game attempts for a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} List of attempts
 */
const getAttemptsBySession = async (sessionId) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: attempts, error } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to get attempts:', error);
    throw new Error('Failed to get attempts');
  }

  return attempts || [];
};

/**
 * Get game attempts by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated attempts
 */
const getAttemptsByMac = async (mac, { page = 1, limit = 20, gameType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('analytics_game_attempts')
    .select('*', { count: 'exact' })
    .eq('mac_address', normalizedMac);

  if (gameType) {
    query = query.eq('game_type', gameType);
  }

  const { data: attempts, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get attempts:', error);
    throw new Error('Failed to get attempts');
  }

  return {
    list: attempts || [],
    total: count || 0,
    page,
    limit
  };
};

// =============================================
// Media Playback
// =============================================

/**
 * Log a media playback event
 * @param {Object} data - Media event data
 * @returns {Promise<Object>} Created playback record
 */
const logMediaEvent = async ({
  sessionId,
  mac,
  mediaType,
  mediaId,
  mediaTitle,
  event,
  durationPlayedSeconds,
  totalDurationSeconds,
  metadata = {}
}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date().toISOString();

  // Calculate completion percentage
  let completionPercentage = null;
  if (durationPlayedSeconds && totalDurationSeconds && totalDurationSeconds > 0) {
    completionPercentage = Math.min(100, (durationPlayedSeconds / totalDurationSeconds) * 100);
  }

  // Handle different event types
  if (event === 'start') {
    const { data: playback, error } = await supabaseAdmin
      .from('analytics_media_playback')
      .insert({
        session_id: sessionId,
        mac_address: normalizedMac,
        media_type: mediaType,
        media_id: mediaId,
        media_title: mediaTitle,
        started_at: now,
        total_duration_seconds: totalDurationSeconds,
        metadata: metadata,
        created_at: now
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to log media start:', error);
      throw new Error('Failed to log media event');
    }

    return playback;
  }

  // Find existing playback record for end/skip events
  const { data: existing } = await supabaseAdmin
    .from('analytics_media_playback')
    .select('id')
    .eq('mac_address', normalizedMac)
    .eq('media_id', mediaId)
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (event === 'end' || event === 'skip') {
    const updateData = {
      ended_at: now,
      duration_played_seconds: durationPlayedSeconds,
      completion_percentage: completionPercentage
    };

    if (event === 'skip') {
      updateData.skip_action = metadata.skipAction || 'next';
      updateData.skipped_at = now;
    }

    if (existing) {
      const { data: playback, error } = await supabaseAdmin
        .from('analytics_media_playback')
        .update(updateData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update media playback:', error);
        throw new Error('Failed to log media event');
      }

      return playback;
    } else {
      // No existing record, create new one with end data
      const { data: playback, error } = await supabaseAdmin
        .from('analytics_media_playback')
        .insert({
          session_id: sessionId,
          mac_address: normalizedMac,
          media_type: mediaType,
          media_id: mediaId,
          media_title: mediaTitle,
          started_at: now,
          ended_at: now,
          duration_played_seconds: durationPlayedSeconds,
          total_duration_seconds: totalDurationSeconds,
          completion_percentage: completionPercentage,
          skip_action: event === 'skip' ? (metadata.skipAction || 'next') : null,
          skipped_at: event === 'skip' ? now : null,
          metadata: metadata,
          created_at: now
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to log media event:', error);
        throw new Error('Failed to log media event');
      }

      return playback;
    }
  }

  throw new Error('Invalid event type');
};

/**
 * Get media playback by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated playback records
 */
const getMediaPlaybackByMac = async (mac, { page = 1, limit = 20, mediaType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('analytics_media_playback')
    .select('*', { count: 'exact' })
    .eq('mac_address', normalizedMac);

  if (mediaType) {
    query = query.eq('media_type', mediaType);
  }

  const { data: playback, count, error } = await query
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get media playback:', error);
    throw new Error('Failed to get media playback');
  }

  return {
    list: playback || [],
    total: count || 0,
    page,
    limit
  };
};

// =============================================
// Streaks
// =============================================

/**
 * Log a streak
 * @param {Object} data - Streak data
 * @returns {Promise<Object>} Created streak record
 */
const logStreak = async ({
  sessionId,
  mac,
  gameType,
  streakNumber,
  questionsInStreak,
  startedAt,
  endedAt,
  durationSeconds
}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date().toISOString();

  const { data: streak, error } = await supabaseAdmin
    .from('analytics_streaks')
    .insert({
      session_id: sessionId,
      mac_address: normalizedMac,
      game_type: gameType,
      streak_number: streakNumber,
      questions_in_streak: questionsInStreak,
      started_at: startedAt || now,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      created_at: now
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to log streak:', error);
    throw new Error('Failed to log streak');
  }

  return streak;
};

/**
 * Get streaks by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated streaks
 */
const getStreaksByMac = async (mac, { page = 1, limit = 20, gameType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('analytics_streaks')
    .select('*', { count: 'exact' })
    .eq('mac_address', normalizedMac);

  if (gameType) {
    query = query.eq('game_type', gameType);
  }

  const { data: streaks, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get streaks:', error);
    throw new Error('Failed to get streaks');
  }

  return {
    list: streaks || [],
    total: count || 0,
    page,
    limit
  };
};

// =============================================
// User Progress
// =============================================

/**
 * Update or create user progress
 * @param {string} mac - Device MAC address
 * @param {string} modeType - Mode type
 * @param {Object} progressData - Progress data to update
 * @returns {Promise<Object>} Updated progress record
 */
const updateUserProgress = async (mac, modeType, progressData) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date().toISOString();

  // Check if progress exists
  const { data: existing } = await supabaseAdmin
    .from('analytics_user_progress')
    .select('*')
    .eq('mac_address', normalizedMac)
    .eq('mode_type', modeType)
    .single();

  if (existing) {
    // Update existing
    const updateData = {
      updated_at: now
    };

    if (progressData.totalSessions !== undefined) {
      updateData.total_sessions = progressData.totalSessions;
    }
    if (progressData.totalTimeSeconds !== undefined) {
      updateData.total_time_seconds = progressData.totalTimeSeconds;
    }
    if (progressData.totalInteractions !== undefined) {
      updateData.total_interactions = progressData.totalInteractions;
    }
    if (progressData.successRatePercentage !== undefined) {
      updateData.success_rate_percentage = progressData.successRatePercentage;
    }
    if (progressData.longestStreak !== undefined) {
      updateData.longest_streak = progressData.longestStreak;
    }
    if (progressData.totalStreaksCompleted !== undefined) {
      updateData.total_streaks_completed = progressData.totalStreaksCompleted;
    }
    if (progressData.averageStreakTimeSeconds !== undefined) {
      updateData.average_streak_time_seconds = progressData.averageStreakTimeSeconds;
    }
    if (progressData.skillLevel !== undefined) {
      updateData.skill_level = progressData.skillLevel;
    }
    if (progressData.lastPlayedAt !== undefined) {
      updateData.last_played_at = progressData.lastPlayedAt;
    }
    if (progressData.weeklySummary !== undefined) {
      updateData.weekly_summary_json = progressData.weeklySummary;
    }

    const { data: progress, error } = await supabaseAdmin
      .from('analytics_user_progress')
      .update(updateData)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update user progress:', error);
      throw new Error('Failed to update user progress');
    }

    return progress;
  } else {
    // Create new
    const { data: progress, error } = await supabaseAdmin
      .from('analytics_user_progress')
      .insert({
        mac_address: normalizedMac,
        mode_type: modeType,
        total_sessions: progressData.totalSessions || 0,
        total_time_seconds: progressData.totalTimeSeconds || 0,
        total_interactions: progressData.totalInteractions || 0,
        success_rate_percentage: progressData.successRatePercentage,
        longest_streak: progressData.longestStreak || 0,
        total_streaks_completed: progressData.totalStreaksCompleted || 0,
        average_streak_time_seconds: progressData.averageStreakTimeSeconds || 0,
        skill_level: progressData.skillLevel || 'beginner',
        last_played_at: progressData.lastPlayedAt,
        weekly_summary_json: progressData.weeklySummary || {},
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create user progress:', error);
      throw new Error('Failed to create user progress');
    }

    return progress;
  }
};

/**
 * Get user progress by MAC address
 * @param {string} mac - Device MAC address
 * @param {string} modeType - Optional mode type filter
 * @returns {Promise<Object|Array>} Progress record(s)
 */
const getUserProgress = async (mac, modeType = null) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const query = supabaseAdmin
    .from('analytics_user_progress')
    .select('*')
    .eq('mac_address', normalizedMac);

  if (modeType) {
    const { data: progress, error } = await query.eq('mode_type', modeType).single();
    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get user progress:', error);
      throw new Error('Failed to get user progress');
    }
    return progress || null;
  }

  const { data: progress, error } = await query;
  if (error) {
    logger.error('Failed to get user progress:', error);
    throw new Error('Failed to get user progress');
  }

  return progress || [];
};

/**
 * Get overall statistics for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Overall statistics
 */
const getOverallStats = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get all progress records
  const { data: progress } = await supabaseAdmin
    .from('analytics_user_progress')
    .select('*')
    .eq('mac_address', normalizedMac);

  // Get session counts
  const { count: totalSessions } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('mac_address', normalizedMac);

  // Get total attempts
  const { count: totalAttempts } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('mac_address', normalizedMac);

  // Get correct attempts
  const { count: correctAttempts } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('mac_address', normalizedMac)
    .eq('is_correct', true);

  // Calculate totals from progress
  let totalTimeSeconds = 0;
  let longestStreak = 0;

  if (progress && progress.length > 0) {
    for (const p of progress) {
      totalTimeSeconds += p.total_time_seconds || 0;
      if ((p.longest_streak || 0) > longestStreak) {
        longestStreak = p.longest_streak;
      }
    }
  }

  const overallAccuracy = totalAttempts > 0
    ? Math.round((correctAttempts / totalAttempts) * 100)
    : 0;

  return {
    totalSessions: totalSessions || 0,
    totalTimeSeconds,
    totalAttempts: totalAttempts || 0,
    correctAttempts: correctAttempts || 0,
    overallAccuracy,
    longestStreak,
    progressByMode: progress || []
  };
};

/**
 * Get statistics for a specific game type
 * @param {string} mac - Device MAC address
 * @param {string} gameType - Game type (math_tutor, riddle_solver, word_ladder)
 * @returns {Promise<Object>} Game-specific statistics
 */
const getGameStats = async (mac, gameType) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get attempts for this game type
  const { data: attempts } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('*')
    .eq('mac_address', normalizedMac)
    .eq('game_type', gameType);

  // Get streaks for this game type
  const { data: streaks } = await supabaseAdmin
    .from('analytics_streaks')
    .select('*')
    .eq('mac_address', normalizedMac)
    .eq('game_type', gameType)
    .order('questions_in_streak', { ascending: false });

  const totalAttempts = attempts?.length || 0;
  const correctAttempts = attempts?.filter(a => a.is_correct).length || 0;
  const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;

  // Group by difficulty
  const byDifficulty = {};
  if (attempts) {
    for (const attempt of attempts) {
      const diff = attempt.difficulty_level || 'unknown';
      if (!byDifficulty[diff]) {
        byDifficulty[diff] = { total: 0, correct: 0 };
      }
      byDifficulty[diff].total++;
      if (attempt.is_correct) byDifficulty[diff].correct++;
    }
  }

  // Group by question type
  const byQuestionType = {};
  if (attempts) {
    for (const attempt of attempts) {
      const qType = attempt.question_type || 'unknown';
      if (!byQuestionType[qType]) {
        byQuestionType[qType] = { total: 0, correct: 0 };
      }
      byQuestionType[qType].total++;
      if (attempt.is_correct) byQuestionType[qType].correct++;
    }
  }

  // Average response time
  const validResponseTimes = attempts?.filter(a => a.response_time_ms).map(a => a.response_time_ms) || [];
  const averageResponseTimeMs = validResponseTimes.length > 0
    ? Math.round(validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length)
    : 0;

  return {
    gameType,
    totalAttempts,
    correctAttempts,
    accuracy,
    averageResponseTimeMs,
    longestStreak: streaks?.[0]?.questions_in_streak || 0,
    totalStreaks: streaks?.length || 0,
    byDifficulty,
    byQuestionType,
    recentStreaks: (streaks || []).slice(0, 5)
  };
};

/**
 * Get daily usage statistics
 * @param {string} mac - Device MAC address
 * @param {number} days - Number of days to retrieve
 * @returns {Promise<Array>} Daily usage data
 */
const getDailyUsage = async (mac, days = 7) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: sessions } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('started_at, duration_seconds, mode_type')
    .eq('mac_address', normalizedMac)
    .gte('started_at', startDate.toISOString())
    .order('started_at', { ascending: true });

  // Group by date
  const dailyData = {};
  if (sessions) {
    for (const session of sessions) {
      const date = session.started_at.split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = {
          date,
          sessionCount: 0,
          totalSeconds: 0,
          byMode: {}
        };
      }
      dailyData[date].sessionCount++;
      dailyData[date].totalSeconds += session.duration_seconds || 0;

      const mode = session.mode_type;
      if (!dailyData[date].byMode[mode]) {
        dailyData[date].byMode[mode] = { count: 0, seconds: 0 };
      }
      dailyData[date].byMode[mode].count++;
      dailyData[date].byMode[mode].seconds += session.duration_seconds || 0;
    }
  }

  return Object.values(dailyData);
};

/**
 * Get weekly usage statistics
 * @param {string} mac - Device MAC address
 * @param {number} weeks - Number of weeks to retrieve
 * @returns {Promise<Array>} Weekly usage data
 */
const getWeeklyUsage = async (mac, weeks = 4) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (weeks * 7));

  const { data: sessions } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('started_at, duration_seconds, mode_type')
    .eq('mac_address', normalizedMac)
    .gte('started_at', startDate.toISOString())
    .order('started_at', { ascending: true });

  // Group by ISO week
  const weeklyData = {};
  if (sessions) {
    for (const session of sessions) {
      const date = new Date(session.started_at);
      // Get ISO week number and year
      const weekYear = getISOWeekYear(date);
      const weekNum = getISOWeek(date);
      const weekKey = `${weekYear}-W${weekNum.toString().padStart(2, '0')}`;

      if (!weeklyData[weekKey]) {
        // Calculate week start and end dates
        const weekStart = getWeekStart(date);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        weeklyData[weekKey] = {
          week: weekKey,
          weekStart: weekStart.toISOString().split('T')[0],
          weekEnd: weekEnd.toISOString().split('T')[0],
          sessionCount: 0,
          totalSeconds: 0,
          byMode: {}
        };
      }
      weeklyData[weekKey].sessionCount++;
      weeklyData[weekKey].totalSeconds += session.duration_seconds || 0;

      const mode = session.mode_type;
      if (!weeklyData[weekKey].byMode[mode]) {
        weeklyData[weekKey].byMode[mode] = { count: 0, seconds: 0 };
      }
      weeklyData[weekKey].byMode[mode].count++;
      weeklyData[weekKey].byMode[mode].seconds += session.duration_seconds || 0;
    }
  }

  return Object.values(weeklyData).sort((a, b) => a.week.localeCompare(b.week));
};

/**
 * Get monthly usage statistics
 * @param {string} mac - Device MAC address
 * @param {number} months - Number of months to retrieve
 * @returns {Promise<Array>} Monthly usage data
 */
const getMonthlyUsage = async (mac, months = 6) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  startDate.setDate(1); // Start from first of the month

  const { data: sessions } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('started_at, duration_seconds, mode_type')
    .eq('mac_address', normalizedMac)
    .gte('started_at', startDate.toISOString())
    .order('started_at', { ascending: true });

  // Group by month
  const monthlyData = {};
  if (sessions) {
    for (const session of sessions) {
      const date = new Date(session.started_at);
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const monthKey = `${year}-${month}`;

      if (!monthlyData[monthKey]) {
        // Calculate month start and end dates
        const monthStart = new Date(year, date.getMonth(), 1);
        const monthEnd = new Date(year, date.getMonth() + 1, 0);

        monthlyData[monthKey] = {
          month: monthKey,
          monthStart: monthStart.toISOString().split('T')[0],
          monthEnd: monthEnd.toISOString().split('T')[0],
          sessionCount: 0,
          totalSeconds: 0,
          byMode: {}
        };
      }
      monthlyData[monthKey].sessionCount++;
      monthlyData[monthKey].totalSeconds += session.duration_seconds || 0;

      const mode = session.mode_type;
      if (!monthlyData[monthKey].byMode[mode]) {
        monthlyData[monthKey].byMode[mode] = { count: 0, seconds: 0 };
      }
      monthlyData[monthKey].byMode[mode].count++;
      monthlyData[monthKey].byMode[mode].seconds += session.duration_seconds || 0;
    }
  }

  return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
};

/**
 * Helper: Get ISO week number
 * @param {Date} date - Date to get week number for
 * @returns {number} ISO week number (1-53)
 */
const getISOWeek = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

/**
 * Helper: Get ISO week year
 * @param {Date} date - Date to get week year for
 * @returns {number} ISO week year
 */
const getISOWeekYear = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
};

/**
 * Helper: Get week start date (Monday)
 * @param {Date} date - Date to get week start for
 * @returns {Date} Monday of the week
 */
const getWeekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  return new Date(d.setDate(diff));
};

// =============================================
// Extended Analytics - Individual Getters
// =============================================

/**
 * Get session by ID (database ID)
 * @param {number} id - Session database ID
 * @returns {Promise<Object|null>} Session
 */
const getSessionById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: session, error } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !session) return null;
  return session;
};

/**
 * Get attempt by ID
 * @param {number} id - Attempt database ID
 * @returns {Promise<Object|null>} Attempt
 */
const getAttemptById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: attempt, error } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !attempt) return null;
  return attempt;
};

/**
 * Get media playback by ID
 * @param {number} id - Media playback database ID
 * @returns {Promise<Object|null>} Media playback
 */
const getMediaPlaybackById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: playback, error } = await supabaseAdmin
    .from('analytics_media_playback')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !playback) return null;
  return playback;
};

/**
 * Get streak by ID
 * @param {number} id - Streak database ID
 * @returns {Promise<Object|null>} Streak
 */
const getStreakById = async (id) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const { data: streak, error } = await supabaseAdmin
    .from('analytics_streaks')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !streak) return null;
  return streak;
};

// =============================================
// Extended Analytics - Paginated Lists
// =============================================

/**
 * Get all sessions with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated sessions
 */
const getAllSessions = async ({ page = 1, limit = 20, mac, modeType, startDate, endDate } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('analytics_game_sessions')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('analytics_game_sessions')
    .select('*');

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      countQuery = countQuery.eq('mac_address', normalizedMac);
      dataQuery = dataQuery.eq('mac_address', normalizedMac);
    }
  }

  if (modeType) {
    countQuery = countQuery.eq('mode_type', modeType);
    dataQuery = dataQuery.eq('mode_type', modeType);
  }

  if (startDate) {
    countQuery = countQuery.gte('started_at', startDate);
    dataQuery = dataQuery.gte('started_at', startDate);
  }

  if (endDate) {
    countQuery = countQuery.lte('started_at', endDate);
    dataQuery = dataQuery.lte('started_at', endDate);
  }

  const { count } = await countQuery;
  const { data: sessions, error } = await dataQuery
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get sessions:', error);
    throw new Error('Failed to get sessions');
  }

  return {
    list: sessions || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get all attempts with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated attempts
 */
const getAllAttempts = async ({ page = 1, limit = 20, mac, gameType, questionType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('analytics_game_attempts')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('analytics_game_attempts')
    .select('*');

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      countQuery = countQuery.eq('mac_address', normalizedMac);
      dataQuery = dataQuery.eq('mac_address', normalizedMac);
    }
  }

  if (gameType) {
    countQuery = countQuery.eq('game_type', gameType);
    dataQuery = dataQuery.eq('game_type', gameType);
  }

  if (questionType) {
    countQuery = countQuery.eq('question_type', questionType);
    dataQuery = dataQuery.eq('question_type', questionType);
  }

  const { count } = await countQuery;
  const { data: attempts, error } = await dataQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get attempts:', error);
    throw new Error('Failed to get attempts');
  }

  return {
    list: attempts || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get all media playback with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated media playback
 */
const getAllMediaPlayback = async ({ page = 1, limit = 20, mac, mediaType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('analytics_media_playback')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('analytics_media_playback')
    .select('*');

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      countQuery = countQuery.eq('mac_address', normalizedMac);
      dataQuery = dataQuery.eq('mac_address', normalizedMac);
    }
  }

  if (mediaType) {
    countQuery = countQuery.eq('media_type', mediaType);
    dataQuery = dataQuery.eq('media_type', mediaType);
  }

  const { count } = await countQuery;
  const { data: playback, error } = await dataQuery
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get media playback:', error);
    throw new Error('Failed to get media playback');
  }

  return {
    list: playback || [],
    total: count || 0,
    page,
    limit
  };
};

/**
 * Get all streaks with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated streaks
 */
const getAllStreaks = async ({ page = 1, limit = 20, mac, gameType } = {}) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const offset = (page - 1) * limit;

  let countQuery = supabaseAdmin
    .from('analytics_streaks')
    .select('id', { count: 'exact', head: true });

  let dataQuery = supabaseAdmin
    .from('analytics_streaks')
    .select('*');

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      countQuery = countQuery.eq('mac_address', normalizedMac);
      dataQuery = dataQuery.eq('mac_address', normalizedMac);
    }
  }

  if (gameType) {
    countQuery = countQuery.eq('game_type', gameType);
    dataQuery = dataQuery.eq('game_type', gameType);
  }

  const { count } = await countQuery;
  const { data: streaks, error } = await dataQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to get streaks:', error);
    throw new Error('Failed to get streaks');
  }

  return {
    list: streaks || [],
    total: count || 0,
    page,
    limit
  };
};

// =============================================
// Extended Analytics - Media Stats
// =============================================

/**
 * Get media playback stats for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Media stats
 */
const getMediaStats = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get all media playback for this device
  const { data: playback } = await supabaseAdmin
    .from('analytics_media_playback')
    .select('*')
    .eq('mac_address', normalizedMac);

  if (!playback || playback.length === 0) {
    return {
      music: { totalPlays: 0, totalDuration: 0, uniqueTracks: 0, favorites: [] },
      story: { totalPlays: 0, totalDuration: 0, uniqueStories: 0, favorites: [] }
    };
  }

  // Separate by media type
  const musicPlays = playback.filter(p => p.media_type === 'music');
  const storyPlays = playback.filter(p => p.media_type === 'story');

  // Calculate music stats
  const musicDuration = musicPlays.reduce((sum, p) => sum + (p.duration_played_seconds || 0), 0);
  const uniqueMusicIds = [...new Set(musicPlays.map(p => p.media_id).filter(Boolean))];
  const musicPlayCounts = {};
  musicPlays.forEach(p => {
    if (p.media_id) {
      musicPlayCounts[p.media_id] = (musicPlayCounts[p.media_id] || 0) + 1;
    }
  });
  const topMusic = Object.entries(musicPlayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mediaId, count]) => {
      const play = musicPlays.find(p => p.media_id === mediaId);
      return { mediaId, title: play?.media_title || 'Unknown', playCount: count };
    });

  // Calculate story stats
  const storyDuration = storyPlays.reduce((sum, p) => sum + (p.duration_played_seconds || 0), 0);
  const uniqueStoryIds = [...new Set(storyPlays.map(p => p.media_id).filter(Boolean))];
  const storyPlayCounts = {};
  storyPlays.forEach(p => {
    if (p.media_id) {
      storyPlayCounts[p.media_id] = (storyPlayCounts[p.media_id] || 0) + 1;
    }
  });
  const topStories = Object.entries(storyPlayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mediaId, count]) => {
      const play = storyPlays.find(p => p.media_id === mediaId);
      return { mediaId, title: play?.media_title || 'Unknown', playCount: count };
    });

  return {
    music: {
      totalPlays: musicPlays.length,
      totalDuration: musicDuration,
      uniqueTracks: uniqueMusicIds.length,
      favorites: topMusic
    },
    story: {
      totalPlays: storyPlays.length,
      totalDuration: storyDuration,
      uniqueStories: uniqueStoryIds.length,
      favorites: topStories
    }
  };
};

/**
 * Get attempt statistics by question type for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Attempt stats by question type
 */
const getAttemptStatsByQuestionType = async (mac) => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const { data: attempts } = await supabaseAdmin
    .from('analytics_game_attempts')
    .select('question_type, is_correct, response_time_ms')
    .eq('mac_address', normalizedMac);

  if (!attempts || attempts.length === 0) {
    return { stats: [], totalAttempts: 0, overallAccuracy: 0 };
  }

  // Group by question type
  const statsByType = {};
  attempts.forEach(attempt => {
    const qType = attempt.question_type || 'unknown';
    if (!statsByType[qType]) {
      statsByType[qType] = {
        questionType: qType,
        total: 0,
        correct: 0,
        responseTimes: []
      };
    }
    statsByType[qType].total++;
    if (attempt.is_correct) statsByType[qType].correct++;
    if (attempt.response_time_ms) {
      statsByType[qType].responseTimes.push(attempt.response_time_ms);
    }
  });

  // Calculate final stats
  const stats = Object.values(statsByType).map(s => ({
    questionType: s.questionType,
    totalAttempts: s.total,
    correctAttempts: s.correct,
    accuracy: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    averageResponseTimeMs: s.responseTimes.length > 0
      ? Math.round(s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length)
      : null
  }));

  const totalAttempts = attempts.length;
  const totalCorrect = attempts.filter(a => a.is_correct).length;
  const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  return {
    stats,
    totalAttempts,
    overallAccuracy
  };
};

// =============================================
// Extended Analytics - Device Activity
// =============================================

/**
 * Count devices that interacted today
 * @returns {Promise<number>} Device count
 */
const getTodayDeviceCount = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get devices that connected today (via OTA check or any API call)
  const { data: connectedDevices, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('mac_address')
    .gte('last_connected_at', today.toISOString());

  if (deviceError) {
    logger.error('Failed to get today connected devices:', deviceError);
  }

  // Get game sessions for today
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('mac_address')
    .gte('started_at', today.toISOString());

  if (sessionError) {
    logger.error('Failed to get today game sessions:', sessionError);
  }

  // Combine unique MAC addresses from both sources
  const allMacs = new Set();
  (connectedDevices || []).forEach(d => allMacs.add(d.mac_address));
  (sessions || []).forEach(s => allMacs.add(s.mac_address));

  return allMacs.size;
};

/**
 * Count devices that interacted this month
 * @returns {Promise<number>} Device count
 */
const getMonthDeviceCount = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get devices that connected this month (via OTA check or any API call)
  const { data: connectedDevices, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('mac_address')
    .gte('last_connected_at', monthStart.toISOString());

  if (deviceError) {
    logger.error('Failed to get month connected devices:', deviceError);
  }

  // Get game sessions for this month
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('mac_address')
    .gte('started_at', monthStart.toISOString());

  if (sessionError) {
    logger.error('Failed to get month game sessions:', sessionError);
  }

  // Combine unique MAC addresses from both sources
  const allMacs = new Set();
  (connectedDevices || []).forEach(d => allMacs.add(d.mac_address));
  (sessions || []).forEach(s => allMacs.add(s.mac_address));

  return allMacs.size;
};

/**
 * List active devices today
 * @returns {Promise<Array>} List of active device info
 */
const getTodayActiveDevices = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get devices that connected today (via OTA check or any API call)
  const { data: connectedDevices, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('id, mac_address, alias, board, app_version, last_connected_at, user_id')
    .gte('last_connected_at', today.toISOString())
    .order('last_connected_at', { ascending: false });

  if (deviceError) {
    logger.error('Failed to get today connected devices:', deviceError);
  }

  // Get game sessions for today
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('mac_address, mode_type, started_at, duration_seconds')
    .gte('started_at', today.toISOString())
    .order('started_at', { ascending: false });

  if (sessionError) {
    logger.error('Failed to get today game sessions:', sessionError);
  }

  // Get unique user IDs to fetch usernames
  const userIds = [...new Set((connectedDevices || []).map(d => d.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('sys_user')
      .select('id, username')
      .in('id', userIds);
    (users || []).forEach(u => {
      userMap[u.id] = u.username;
    });
  }

  // Build device map from connected devices
  const deviceMap = {};
  (connectedDevices || []).forEach(device => {
    const mac = device.mac_address;
    if (!deviceMap[mac]) {
      deviceMap[mac] = {
        macAddress: mac,
        alias: device.alias,
        board: device.board,
        appVersion: device.app_version,
        lastConnected: device.last_connected_at,
        userId: device.user_id,
        ownerName: userMap[device.user_id] || null,
        sessionCount: 0,
        totalDuration: 0,
        modes: []
      };
    }
  });

  // Add session data to devices
  (sessions || []).forEach(session => {
    const mac = session.mac_address;
    if (!deviceMap[mac]) {
      deviceMap[mac] = {
        macAddress: mac,
        lastConnected: session.started_at,
        sessionCount: 0,
        totalDuration: 0,
        modes: []
      };
    }
    deviceMap[mac].sessionCount++;
    deviceMap[mac].totalDuration += session.duration_seconds || 0;
    if (session.mode_type && !deviceMap[mac].modes.includes(session.mode_type)) {
      deviceMap[mac].modes.push(session.mode_type);
    }
  });

  return Object.values(deviceMap);
};

/**
 * List active devices this month
 * @returns {Promise<Array>} List of active device info
 */
const getMonthActiveDevices = async () => {
  if (!supabaseAdmin) throw new Error('Database not configured');

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get devices that connected this month (via OTA check or any API call)
  const { data: connectedDevices, error: deviceError } = await supabaseAdmin
    .from('ai_device')
    .select('id, mac_address, alias, board, app_version, last_connected_at, user_id')
    .gte('last_connected_at', monthStart.toISOString())
    .order('last_connected_at', { ascending: false });

  if (deviceError) {
    logger.error('Failed to get month connected devices:', deviceError);
  }

  // Get game sessions for this month
  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from('analytics_game_sessions')
    .select('mac_address, mode_type, started_at, duration_seconds')
    .gte('started_at', monthStart.toISOString())
    .order('started_at', { ascending: false });

  if (sessionError) {
    logger.error('Failed to get month game sessions:', sessionError);
  }

  // Get unique user IDs to fetch usernames
  const userIds = [...new Set((connectedDevices || []).map(d => d.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('sys_user')
      .select('id, username')
      .in('id', userIds);
    (users || []).forEach(u => {
      userMap[u.id] = u.username;
    });
  }

  // Build device map from connected devices
  const deviceMap = {};
  (connectedDevices || []).forEach(device => {
    const mac = device.mac_address;
    if (!deviceMap[mac]) {
      deviceMap[mac] = {
        macAddress: mac,
        alias: device.alias,
        board: device.board,
        appVersion: device.app_version,
        lastConnected: device.last_connected_at,
        userId: device.user_id,
        ownerName: userMap[device.user_id] || null,
        sessionCount: 0,
        totalDuration: 0,
        modes: []
      };
    }
  });

  // Add session data to devices
  (sessions || []).forEach(session => {
    const mac = session.mac_address;
    if (!deviceMap[mac]) {
      deviceMap[mac] = {
        macAddress: mac,
        lastConnected: session.started_at,
        sessionCount: 0,
        totalDuration: 0,
        modes: []
      };
    }
    deviceMap[mac].sessionCount++;
    deviceMap[mac].totalDuration += session.duration_seconds || 0;
    if (session.mode_type && !deviceMap[mac].modes.includes(session.mode_type)) {
      deviceMap[mac].modes.push(session.mode_type);
    }
  });

  return Object.values(deviceMap);
};

module.exports = {
  // Sessions
  startSession,
  endSession,
  getSession,
  getSessionsByMac,
  getSessionById,
  getAllSessions,
  // Game attempts
  logGameAttempt,
  getAttemptsBySession,
  getAttemptsByMac,
  getAttemptById,
  getAllAttempts,
  // Media playback
  logMediaEvent,
  getMediaPlaybackByMac,
  getMediaPlaybackById,
  getAllMediaPlayback,
  getMediaStats,
  // Streaks
  logStreak,
  getStreaksByMac,
  getStreakById,
  getAllStreaks,
  // User progress
  updateUserProgress,
  getUserProgress,
  // Statistics
  getOverallStats,
  getGameStats,
  getDailyUsage,
  getWeeklyUsage,
  getMonthlyUsage,
  getAttemptStatsByQuestionType,
  // Device activity
  getTodayDeviceCount,
  getMonthDeviceCount,
  getTodayActiveDevices,
  getMonthActiveDevices
};
