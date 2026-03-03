/**
 * Analytics Service
 *
 * Handles game session tracking, game attempts, media playback,
 * streaks, and user progress analytics.
 */

const { prisma } = require('../config/database');
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const sessionId = generateUUID();
  const now = new Date();

  try {
    const session = await prisma.analytics_game_sessions.create({
      data: {
        session_id: sessionId,
        mac_address: normalizedMac,
        agent_id: agentId || null,
        mode_type: modeType,
        started_at: now,
        interaction_count: 0,
        metadata: metadata,
        created_at: now,
        updated_at: now
      }
    });
    return session;
  } catch (err) {
    logger.error('Failed to start session:', err);
    throw new Error('Failed to start session');
  }
};

/**
 * End a game session
 * @param {string} sessionId - Session ID
 * @param {Object} data - End session data
 * @returns {Promise<Object>} Updated session
 */
const endSession = async (sessionId, { completionStatus, interactionCount, metadata = {} }) => {
  // Get existing session
  const existing = await prisma.analytics_game_sessions.findFirst({
    where: { session_id: sessionId }
  });

  if (!existing) {
    throw new Error('Session not found');
  }

  const now = new Date();
  const startedAt = new Date(existing.started_at);
  const durationSeconds = Math.floor((now - startedAt) / 1000);

  // Merge metadata
  const existingMeta = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
  const mergedMetadata = { ...existingMeta, ...metadata };

  try {
    const session = await prisma.analytics_game_sessions.update({
      where: { session_id: sessionId },
      data: {
        ended_at: now,
        duration_seconds: durationSeconds,
        completion_status: completionStatus || 'completed',
        interaction_count: interactionCount !== undefined ? interactionCount : existing.interaction_count,
        metadata: mergedMetadata,
        updated_at: now
      }
    });
    return session;
  } catch (err) {
    logger.error('Failed to end session:', err);
    throw new Error('Failed to end session');
  }
};

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session
 */
const getSession = async (sessionId) => {
  try {
    const session = await prisma.analytics_game_sessions.findFirst({
      where: { session_id: sessionId }
    });
    return session || null;
  } catch (err) {
    return null;
  }
};

/**
 * Get sessions by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated sessions
 */
const getSessionsByMac = async (mac, { page = 1, limit = 10, modeType } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  const where = { mac_address: normalizedMac };
  if (modeType) {
    where.mode_type = modeType;
  }

  try {
    const [sessions, total] = await Promise.all([
      prisma.analytics_game_sessions.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_game_sessions.count({ where })
    ]);

    return {
      list: sessions || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get sessions:', err);
    throw new Error('Failed to get sessions');
  }
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date();

  try {
    const attempt = await prisma.analytics_game_attempts.create({
      data: {
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
      }
    });

    // Note: interaction_count is set when ending the session via endSession()
    // No need to increment here since we track attempt count separately

    return attempt;
  } catch (err) {
    logger.error('Failed to log game attempt:', err);
    throw new Error('Failed to log game attempt');
  }
};

/**
 * Get game attempts for a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} List of attempts
 */
const getAttemptsBySession = async (sessionId) => {
  try {
    const attempts = await prisma.analytics_game_attempts.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'asc' }
    });
    return attempts || [];
  } catch (err) {
    logger.error('Failed to get attempts:', err);
    throw new Error('Failed to get attempts');
  }
};

/**
 * Get game attempts by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated attempts
 */
const getAttemptsByMac = async (mac, { page = 1, limit = 20, gameType } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  const where = { mac_address: normalizedMac };
  if (gameType) {
    where.game_type = gameType;
  }

  try {
    const [attempts, total] = await Promise.all([
      prisma.analytics_game_attempts.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_game_attempts.count({ where })
    ]);

    return {
      list: attempts || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get attempts:', err);
    throw new Error('Failed to get attempts');
  }
};

// =============================================
// Media Playback
// =============================================

/**
 * Log a media playback event
 *
 * Schema note: analytics_media_playback uses content_id (BigInt), content_type,
 * event_type, position_seconds, duration_seconds. The legacy fields
 * (session_id, media_type, media_id, media_title, started_at, ended_at,
 * duration_played_seconds, completion_percentage, skip_action, skipped_at)
 * do not exist in the current schema. We map to available columns:
 *   mediaType  → content_type
 *   mediaId    → content_id  (BigInt)
 *   event      → event_type
 *   durationPlayedSeconds → position_seconds (best available approximation)
 *   totalDurationSeconds  → duration_seconds
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  if (!['start', 'end', 'skip'].includes(event)) {
    throw new Error('Invalid event type');
  }

  // Enrich metadata with fields that don't have dedicated columns
  const enrichedMetadata = {
    ...metadata,
    session_id: sessionId,
    media_title: mediaTitle,
    event_type_detail: event
  };

  try {
    const playback = await prisma.analytics_media_playback.create({
      data: {
        mac_address: normalizedMac,
        content_id: mediaId ? BigInt(mediaId) : null,
        content_type: mediaType,
        event_type: event,
        position_seconds: durationPlayedSeconds || 0,
        duration_seconds: totalDurationSeconds || null,
        metadata: enrichedMetadata
      }
    });
    return playback;
  } catch (err) {
    logger.error('Failed to log media event:', err);
    throw new Error('Failed to log media event');
  }
};

/**
 * Get media playback by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated playback records
 */
const getMediaPlaybackByMac = async (mac, { page = 1, limit = 20, mediaType } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  const where = { mac_address: normalizedMac };
  if (mediaType) {
    where.content_type = mediaType;
  }

  try {
    const [playback, total] = await Promise.all([
      prisma.analytics_media_playback.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_media_playback.count({ where })
    ]);

    return {
      list: playback || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get media playback:', err);
    throw new Error('Failed to get media playback');
  }
};

// =============================================
// Streaks
// =============================================

/**
 * Log a streak
 *
 * Schema note: analytics_streaks uses (mac_address, streak_type, streak_date,
 * streak_count). Legacy fields (session_id, game_type, streak_number,
 * questions_in_streak, started_at, ended_at, duration_seconds) do not exist.
 * We map:
 *   gameType       → streak_type
 *   streakNumber   → streak_count
 *   startedAt date → streak_date
 * @param {Object} data - Streak data
 * @returns {Promise<Object>} Created or updated streak record
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const streakDate = startedAt ? new Date(startedAt) : new Date();
  // Normalise to date-only (midnight UTC) for the unique constraint
  const streakDateOnly = new Date(
    Date.UTC(streakDate.getUTCFullYear(), streakDate.getUTCMonth(), streakDate.getUTCDate())
  );

  try {
    // upsert because of the unique(mac_address, streak_type, streak_date) constraint
    const streak = await prisma.analytics_streaks.upsert({
      where: {
        mac_address_streak_type_streak_date: {
          mac_address: normalizedMac,
          streak_type: gameType,
          streak_date: streakDateOnly
        }
      },
      create: {
        mac_address: normalizedMac,
        streak_type: gameType,
        streak_date: streakDateOnly,
        streak_count: streakNumber || 1
      },
      update: {
        streak_count: streakNumber || 1,
        updated_at: new Date()
      }
    });
    return streak;
  } catch (err) {
    logger.error('Failed to log streak:', err);
    throw new Error('Failed to log streak');
  }
};

/**
 * Get streaks by MAC address
 * @param {string} mac - Device MAC address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated streaks
 */
const getStreaksByMac = async (mac, { page = 1, limit = 20, gameType } = {}) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const offset = (page - 1) * limit;

  const where = { mac_address: normalizedMac };
  if (gameType) {
    where.streak_type = gameType;
  }

  try {
    const [streaks, total] = await Promise.all([
      prisma.analytics_streaks.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_streaks.count({ where })
    ]);

    return {
      list: streaks || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get streaks:', err);
    throw new Error('Failed to get streaks');
  }
};

// =============================================
// User Progress
// =============================================

/**
 * Update or create user progress
 *
 * Schema note: analytics_user_progress is keyed on mac_address (unique).
 * Available columns: total_sessions, total_duration_seconds, total_games_played,
 * total_correct_answers, total_wrong_answers, current_streak, longest_streak,
 * last_activity_at. Legacy columns (mode_type, total_time_seconds,
 * total_interactions, success_rate_percentage, total_streaks_completed,
 * average_streak_time_seconds, skill_level, last_played_at, weekly_summary_json)
 * are not in the schema and are silently ignored.
 * @param {string} mac - Device MAC address
 * @param {string} modeType - Mode type (informational only; not stored)
 * @param {Object} progressData - Progress data to update
 * @returns {Promise<Object>} Updated progress record
 */
const updateUserProgress = async (mac, modeType, progressData) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const now = new Date();

  // Build update/create payload from available schema columns
  const updatePayload = { updated_at: now };
  const createPayload = { mac_address: normalizedMac, created_at: now, updated_at: now };

  if (progressData.totalSessions !== undefined) {
    updatePayload.total_sessions = progressData.totalSessions;
    createPayload.total_sessions = progressData.totalSessions;
  } else {
    createPayload.total_sessions = 0;
  }

  if (progressData.totalTimeSeconds !== undefined) {
    updatePayload.total_duration_seconds = progressData.totalTimeSeconds;
    createPayload.total_duration_seconds = progressData.totalTimeSeconds;
  } else {
    createPayload.total_duration_seconds = 0;
  }

  if (progressData.longestStreak !== undefined) {
    updatePayload.longest_streak = progressData.longestStreak;
    createPayload.longest_streak = progressData.longestStreak;
  } else {
    createPayload.longest_streak = 0;
  }

  if (progressData.lastPlayedAt !== undefined) {
    updatePayload.last_activity_at = progressData.lastPlayedAt ? new Date(progressData.lastPlayedAt) : null;
    createPayload.last_activity_at = progressData.lastPlayedAt ? new Date(progressData.lastPlayedAt) : null;
  }

  try {
    const progress = await prisma.analytics_user_progress.upsert({
      where: { mac_address: normalizedMac },
      create: createPayload,
      update: updatePayload
    });
    return progress;
  } catch (err) {
    logger.error('Failed to update user progress:', err);
    throw new Error('Failed to update user progress');
  }
};

/**
 * Get user progress by MAC address
 * @param {string} mac - Device MAC address
 * @param {string} modeType - Optional mode type filter (informational only in current schema)
 * @returns {Promise<Object|null>} Progress record
 */
const getUserProgress = async (mac, modeType = null) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  try {
    // analytics_user_progress has a unique constraint on mac_address
    const progress = await prisma.analytics_user_progress.findFirst({
      where: { mac_address: normalizedMac }
    });

    if (modeType) {
      // Schema has no mode_type; return single record or null
      return progress || null;
    }

    // When no modeType, callers expect an array
    return progress ? [progress] : [];
  } catch (err) {
    logger.error('Failed to get user progress:', err);
    throw new Error('Failed to get user progress');
  }
};

/**
 * Get overall statistics for a device
 * @param {string} mac - Device MAC address
 * @returns {Promise<Object>} Overall statistics
 */
const getOverallStats = async (mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get progress record
  const progress = await prisma.analytics_user_progress.findFirst({
    where: { mac_address: normalizedMac }
  });

  // Get session count
  const [totalSessions, totalAttempts, correctAttempts] = await Promise.all([
    prisma.analytics_game_sessions.count({ where: { mac_address: normalizedMac } }),
    prisma.analytics_game_attempts.count({ where: { mac_address: normalizedMac } }),
    prisma.analytics_game_attempts.count({ where: { mac_address: normalizedMac, is_correct: true } })
  ]);

  const totalTimeSeconds = progress ? (Number(progress.total_duration_seconds) || 0) : 0;
  const longestStreak = progress ? (progress.longest_streak || 0) : 0;

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
    progressByMode: progress ? [progress] : []
  };
};

/**
 * Get statistics for a specific game type
 * @param {string} mac - Device MAC address
 * @param {string} gameType - Game type (math_tutor, riddle_solver, word_ladder)
 * @returns {Promise<Object>} Game-specific statistics
 */
const getGameStats = async (mac, gameType) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get attempts for this game type
  const attempts = await prisma.analytics_game_attempts.findMany({
    where: {
      mac_address: normalizedMac,
      game_type: gameType
    }
  });

  // Get streaks for this game type (streak_type maps to gameType)
  const streaks = await prisma.analytics_streaks.findMany({
    where: {
      mac_address: normalizedMac,
      streak_type: gameType
    },
    orderBy: { streak_count: 'desc' }
  });

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
    longestStreak: streaks?.[0]?.streak_count || 0,
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const sessions = await prisma.analytics_game_sessions.findMany({
    where: {
      mac_address: normalizedMac,
      started_at: { gte: startDate }
    },
    select: {
      started_at: true,
      duration_seconds: true,
      mode_type: true
    },
    orderBy: { started_at: 'asc' }
  });

  // Group by date
  const dailyData = {};
  if (sessions) {
    for (const session of sessions) {
      const date = session.started_at.toISOString().split('T')[0];
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (weeks * 7));

  const sessions = await prisma.analytics_game_sessions.findMany({
    where: {
      mac_address: normalizedMac,
      started_at: { gte: startDate }
    },
    select: {
      started_at: true,
      duration_seconds: true,
      mode_type: true
    },
    orderBy: { started_at: 'asc' }
  });

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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  startDate.setDate(1); // Start from first of the month

  const sessions = await prisma.analytics_game_sessions.findMany({
    where: {
      mac_address: normalizedMac,
      started_at: { gte: startDate }
    },
    select: {
      started_at: true,
      duration_seconds: true,
      mode_type: true
    },
    orderBy: { started_at: 'asc' }
  });

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
  try {
    const session = await prisma.analytics_game_sessions.findFirst({
      where: { id: BigInt(id) }
    });
    return session || null;
  } catch (err) {
    return null;
  }
};

/**
 * Get attempt by ID
 * @param {number} id - Attempt database ID
 * @returns {Promise<Object|null>} Attempt
 */
const getAttemptById = async (id) => {
  try {
    const attempt = await prisma.analytics_game_attempts.findFirst({
      where: { id: BigInt(id) }
    });
    return attempt || null;
  } catch (err) {
    return null;
  }
};

/**
 * Get media playback by ID
 * @param {number} id - Media playback database ID
 * @returns {Promise<Object|null>} Media playback
 */
const getMediaPlaybackById = async (id) => {
  try {
    const playback = await prisma.analytics_media_playback.findFirst({
      where: { id: BigInt(id) }
    });
    return playback || null;
  } catch (err) {
    return null;
  }
};

/**
 * Get streak by ID
 * @param {number} id - Streak database ID
 * @returns {Promise<Object|null>} Streak
 */
const getStreakById = async (id) => {
  try {
    const streak = await prisma.analytics_streaks.findFirst({
      where: { id: BigInt(id) }
    });
    return streak || null;
  } catch (err) {
    return null;
  }
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
  const offset = (page - 1) * limit;

  const where = {};

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      where.mac_address = normalizedMac;
    }
  }

  if (modeType) {
    where.mode_type = modeType;
  }

  if (startDate || endDate) {
    where.started_at = {};
    if (startDate) where.started_at.gte = new Date(startDate);
    if (endDate) where.started_at.lte = new Date(endDate);
  }

  try {
    const [sessions, total] = await Promise.all([
      prisma.analytics_game_sessions.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_game_sessions.count({ where })
    ]);

    return {
      list: sessions || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get sessions:', err);
    throw new Error('Failed to get sessions');
  }
};

/**
 * Get all attempts with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated attempts
 */
const getAllAttempts = async ({ page = 1, limit = 20, mac, gameType, questionType } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      where.mac_address = normalizedMac;
    }
  }

  if (gameType) {
    where.game_type = gameType;
  }

  if (questionType) {
    where.question_type = questionType;
  }

  try {
    const [attempts, total] = await Promise.all([
      prisma.analytics_game_attempts.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_game_attempts.count({ where })
    ]);

    return {
      list: attempts || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get attempts:', err);
    throw new Error('Failed to get attempts');
  }
};

/**
 * Get all media playback with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated media playback
 */
const getAllMediaPlayback = async ({ page = 1, limit = 20, mac, mediaType } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      where.mac_address = normalizedMac;
    }
  }

  if (mediaType) {
    where.content_type = mediaType;
  }

  try {
    const [playback, total] = await Promise.all([
      prisma.analytics_media_playback.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_media_playback.count({ where })
    ]);

    return {
      list: playback || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get media playback:', err);
    throw new Error('Failed to get media playback');
  }
};

/**
 * Get all streaks with pagination and filtering
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated streaks
 */
const getAllStreaks = async ({ page = 1, limit = 20, mac, gameType } = {}) => {
  const offset = (page - 1) * limit;

  const where = {};

  if (mac) {
    const normalizedMac = normalizeMacAddress(mac);
    if (normalizedMac) {
      where.mac_address = normalizedMac;
    }
  }

  if (gameType) {
    where.streak_type = gameType;
  }

  try {
    const [streaks, total] = await Promise.all([
      prisma.analytics_streaks.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.analytics_streaks.count({ where })
    ]);

    return {
      list: streaks || [],
      total: total || 0,
      page,
      limit
    };
  } catch (err) {
    logger.error('Failed to get streaks:', err);
    throw new Error('Failed to get streaks');
  }
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  // Get all media playback for this device
  const playback = await prisma.analytics_media_playback.findMany({
    where: { mac_address: normalizedMac }
  });

  if (!playback || playback.length === 0) {
    return {
      music: { totalPlays: 0, totalDuration: 0, uniqueTracks: 0, favorites: [] },
      story: { totalPlays: 0, totalDuration: 0, uniqueStories: 0, favorites: [] }
    };
  }

  // Separate by content_type (maps to mediaType)
  const musicPlays = playback.filter(p => p.content_type === 'music');
  const storyPlays = playback.filter(p => p.content_type === 'story');

  // Calculate music stats
  // position_seconds is the closest available column to duration_played_seconds
  const musicDuration = musicPlays.reduce((sum, p) => sum + (p.position_seconds || 0), 0);
  const uniqueMusicIds = [...new Set(musicPlays.map(p => p.content_id ? p.content_id.toString() : null).filter(Boolean))];
  const musicPlayCounts = {};
  musicPlays.forEach(p => {
    const cid = p.content_id ? p.content_id.toString() : null;
    if (cid) {
      musicPlayCounts[cid] = (musicPlayCounts[cid] || 0) + 1;
    }
  });
  const topMusic = Object.entries(musicPlayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mediaId, count]) => {
      const play = musicPlays.find(p => p.content_id && p.content_id.toString() === mediaId);
      const meta = play?.metadata && typeof play.metadata === 'object' ? play.metadata : {};
      return { mediaId, title: meta.media_title || 'Unknown', playCount: count };
    });

  // Calculate story stats
  const storyDuration = storyPlays.reduce((sum, p) => sum + (p.position_seconds || 0), 0);
  const uniqueStoryIds = [...new Set(storyPlays.map(p => p.content_id ? p.content_id.toString() : null).filter(Boolean))];
  const storyPlayCounts = {};
  storyPlays.forEach(p => {
    const cid = p.content_id ? p.content_id.toString() : null;
    if (cid) {
      storyPlayCounts[cid] = (storyPlayCounts[cid] || 0) + 1;
    }
  });
  const topStories = Object.entries(storyPlayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mediaId, count]) => {
      const play = storyPlays.find(p => p.content_id && p.content_id.toString() === mediaId);
      const meta = play?.metadata && typeof play.metadata === 'object' ? play.metadata : {};
      return { mediaId, title: meta.media_title || 'Unknown', playCount: count };
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
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');

  const attempts = await prisma.analytics_game_attempts.findMany({
    where: { mac_address: normalizedMac },
    select: {
      question_type: true,
      is_correct: true,
      response_time_ms: true
    }
  });

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get devices that connected today (via OTA check or any API call)
  let connectedDevices = [];
  try {
    connectedDevices = await prisma.ai_device.findMany({
      where: { last_connected_at: { gte: today } },
      select: { mac_address: true }
    });
  } catch (err) {
    logger.error('Failed to get today connected devices:', err);
  }

  // Get game sessions for today
  let sessions = [];
  try {
    sessions = await prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: today } },
      select: { mac_address: true }
    });
  } catch (err) {
    logger.error('Failed to get today game sessions:', err);
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
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get devices that connected this month (via OTA check or any API call)
  let connectedDevices = [];
  try {
    connectedDevices = await prisma.ai_device.findMany({
      where: { last_connected_at: { gte: monthStart } },
      select: { mac_address: true }
    });
  } catch (err) {
    logger.error('Failed to get month connected devices:', err);
  }

  // Get game sessions for this month
  let sessions = [];
  try {
    sessions = await prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: monthStart } },
      select: { mac_address: true }
    });
  } catch (err) {
    logger.error('Failed to get month game sessions:', err);
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get devices that connected today
  let connectedDevices = [];
  try {
    connectedDevices = await prisma.ai_device.findMany({
      where: { last_connected_at: { gte: today } },
      select: {
        id: true,
        mac_address: true,
        alias: true,
        board: true,
        app_version: true,
        last_connected_at: true,
        user_id: true
      },
      orderBy: { last_connected_at: 'desc' }
    });
  } catch (err) {
    logger.error('Failed to get today connected devices:', err);
  }

  // Get game sessions for today
  let sessions = [];
  try {
    sessions = await prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: today } },
      select: {
        mac_address: true,
        mode_type: true,
        started_at: true,
        duration_seconds: true
      },
      orderBy: { started_at: 'desc' }
    });
  } catch (err) {
    logger.error('Failed to get today game sessions:', err);
  }

  // Get unique user IDs to fetch usernames
  const userIds = [...new Set((connectedDevices || []).map(d => d.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const users = await prisma.sys_user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true }
    });
    (users || []).forEach(u => {
      userMap[u.id.toString()] = u.username;
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
        userId: device.user_id ? device.user_id.toString() : null,
        ownerName: device.user_id ? (userMap[device.user_id.toString()] || null) : null,
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
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Get devices that connected this month
  let connectedDevices = [];
  try {
    connectedDevices = await prisma.ai_device.findMany({
      where: { last_connected_at: { gte: monthStart } },
      select: {
        id: true,
        mac_address: true,
        alias: true,
        board: true,
        app_version: true,
        last_connected_at: true,
        user_id: true
      },
      orderBy: { last_connected_at: 'desc' }
    });
  } catch (err) {
    logger.error('Failed to get month connected devices:', err);
  }

  // Get game sessions for this month
  let sessions = [];
  try {
    sessions = await prisma.analytics_game_sessions.findMany({
      where: { started_at: { gte: monthStart } },
      select: {
        mac_address: true,
        mode_type: true,
        started_at: true,
        duration_seconds: true
      },
      orderBy: { started_at: 'desc' }
    });
  } catch (err) {
    logger.error('Failed to get month game sessions:', err);
  }

  // Get unique user IDs to fetch usernames
  const userIds = [...new Set((connectedDevices || []).map(d => d.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const users = await prisma.sys_user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true }
    });
    (users || []).forEach(u => {
      userMap[u.id.toString()] = u.username;
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
        userId: device.user_id ? device.user_id.toString() : null,
        ownerName: device.user_id ? (userMap[device.user_id.toString()] || null) : null,
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

// =============================================
// Dashboard Aggregate Analytics (All Devices)
// =============================================

/**
 * Get dashboard summary stats (aggregate across all devices)
 * @param {Object} options - { startDate, endDate }
 * @returns {Promise<Object>} Summary stats
 */
const getDashboardSummary = async ({ startDate, endDate } = {}) => {
  const sessionWhere = {};
  const attemptWhere = {};

  if (startDate) {
    sessionWhere.started_at = { ...(sessionWhere.started_at || {}), gte: new Date(startDate) };
    attemptWhere.created_at = { ...(attemptWhere.created_at || {}), gte: new Date(startDate) };
  }
  if (endDate) {
    sessionWhere.started_at = { ...(sessionWhere.started_at || {}), lte: new Date(endDate) };
    attemptWhere.created_at = { ...(attemptWhere.created_at || {}), lte: new Date(endDate) };
  }

  // Execute queries in parallel
  const [sessions, totalAttempts, correctAttempts] = await Promise.all([
    prisma.analytics_game_sessions.findMany({
      where: sessionWhere,
      select: { duration_seconds: true, mac_address: true }
    }),
    prisma.analytics_game_attempts.count({ where: attemptWhere }),
    prisma.analytics_game_attempts.count({ where: { ...attemptWhere, is_correct: true } })
  ]);

  const totalSessions = sessions.length;

  // Calculate total time
  const totalTimeSeconds = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);

  // Calculate unique devices
  const uniqueDevices = new Set(sessions.map(s => s.mac_address)).size;

  // Calculate accuracy
  const avgAccuracy = totalAttempts > 0
    ? Math.round((correctAttempts / totalAttempts) * 100)
    : 0;

  return {
    total_sessions: totalSessions,
    total_time_seconds: totalTimeSeconds,
    avg_accuracy: avgAccuracy,
    active_device_count: uniqueDevices,
    total_attempts: totalAttempts,
    correct_attempts: correctAttempts
  };
};

/**
 * Get sessions per day for trend chart (all devices)
 * @param {Object} options - { startDate, endDate }
 * @returns {Promise<Array>} Daily session counts
 */
const getSessionsPerDay = async ({ startDate, endDate } = {}) => {
  // Default to last 30 days if no date range
  if (!startDate) {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    startDate = defaultStart.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  try {
    const sessions = await prisma.analytics_game_sessions.findMany({
      where: {
        started_at: {
          gte: new Date(startDate),
          lte: new Date(endDate + 'T23:59:59.999Z')
        }
      },
      select: {
        started_at: true,
        duration_seconds: true,
        mode_type: true,
        mac_address: true
      },
      orderBy: { started_at: 'asc' }
    });

    // Group by date
    const dailyData = {};
    (sessions || []).forEach(session => {
      const date = session.started_at.toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = {
          date,
          session_count: 0,
          total_duration_seconds: 0,
          unique_devices: new Set(),
          by_mode: {}
        };
      }
      dailyData[date].session_count++;
      dailyData[date].total_duration_seconds += session.duration_seconds || 0;
      dailyData[date].unique_devices.add(session.mac_address);

      const mode = session.mode_type || 'Unknown';
      if (!dailyData[date].by_mode[mode]) {
        dailyData[date].by_mode[mode] = 0;
      }
      dailyData[date].by_mode[mode]++;
    });

    // Convert Sets to counts and return array
    return Object.values(dailyData).map(day => ({
      date: day.date,
      session_count: day.session_count,
      total_duration_seconds: day.total_duration_seconds,
      unique_devices: day.unique_devices.size,
      by_mode: day.by_mode
    }));
  } catch (err) {
    logger.error('Failed to get sessions per day:', err);
    throw new Error('Failed to get sessions per day');
  }
};

/**
 * Get game accuracy by type (aggregate across all devices)
 * @param {Object} options - { startDate, endDate }
 * @returns {Promise<Object>} Accuracy per game type
 */
const getGameAccuracyByType = async ({ startDate, endDate } = {}) => {
  const where = {};
  if (startDate) {
    where.created_at = { ...(where.created_at || {}), gte: new Date(startDate) };
  }
  if (endDate) {
    where.created_at = { ...(where.created_at || {}), lte: new Date(endDate + 'T23:59:59.999Z') };
  }

  try {
    const attempts = await prisma.analytics_game_attempts.findMany({
      where,
      select: {
        game_type: true,
        is_correct: true,
        response_time_ms: true
      }
    });

    // Group by game type
    const gameStats = {};
    (attempts || []).forEach(attempt => {
      const gameType = attempt.game_type || 'unknown';
      if (!gameStats[gameType]) {
        gameStats[gameType] = {
          game_type: gameType,
          total_attempts: 0,
          correct_attempts: 0,
          response_times: []
        };
      }
      gameStats[gameType].total_attempts++;
      if (attempt.is_correct) gameStats[gameType].correct_attempts++;
      if (attempt.response_time_ms) {
        gameStats[gameType].response_times.push(attempt.response_time_ms);
      }
    });

    // Calculate accuracy and avg response time
    const result = {};
    Object.keys(gameStats).forEach(gameType => {
      const stats = gameStats[gameType];
      result[gameType] = {
        game_type: gameType,
        total_attempts: stats.total_attempts,
        correct_attempts: stats.correct_attempts,
        accuracy: stats.total_attempts > 0
          ? Math.round((stats.correct_attempts / stats.total_attempts) * 100)
          : 0,
        avg_response_time_ms: stats.response_times.length > 0
          ? Math.round(stats.response_times.reduce((a, b) => a + b, 0) / stats.response_times.length)
          : null
      };
    });

    return result;
  } catch (err) {
    logger.error('Failed to get game accuracy by type:', err);
    throw new Error('Failed to get game accuracy by type');
  }
};

/**
 * Get difficulty distribution (aggregate across all devices)
 * @param {Object} options - { startDate, endDate }
 * @returns {Promise<Object>} Counts per difficulty level
 */
const getDifficultyDistribution = async ({ startDate, endDate } = {}) => {
  // Default empty distribution
  const distribution = {
    easy: { count: 0, correct: 0, accuracy: 0 },
    medium: { count: 0, correct: 0, accuracy: 0 },
    hard: { count: 0, correct: 0, accuracy: 0 },
    unknown: { count: 0, correct: 0, accuracy: 0 }
  };

  try {
    const where = {};
    if (startDate) {
      where.created_at = { ...(where.created_at || {}), gte: new Date(startDate) };
    }
    if (endDate) {
      where.created_at = { ...(where.created_at || {}), lte: new Date(endDate + 'T23:59:59.999Z') };
    }

    const attempts = await prisma.analytics_game_attempts.findMany({
      where,
      select: {
        difficulty_level: true,
        is_correct: true
      }
    });

    // Group by difficulty level
    (attempts || []).forEach(attempt => {
      const level = (attempt.difficulty_level || 'unknown').toLowerCase();
      const key = distribution[level] ? level : 'unknown';
      distribution[key].count++;
      if (attempt.is_correct) distribution[key].correct++;
    });

    // Calculate accuracy for each level
    Object.keys(distribution).forEach(level => {
      const d = distribution[level];
      d.accuracy = d.count > 0 ? Math.round((d.correct / d.count) * 100) : 0;
    });

    return distribution;
  } catch (err) {
    // Return empty distribution on any error
    logger.error('Error in getDifficultyDistribution:', err);
    return distribution;
  }
};

/**
 * Get response time (TTFT) trend per day
 * @param {Object} options - { startDate, endDate }
 * @returns {Promise<Array>} Daily average response time
 */
const getTtftTrend = async ({ startDate, endDate } = {}) => {
  // Default to last 30 days if no date range
  if (!startDate) {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    startDate = defaultStart.toISOString().split('T')[0];
  }
  if (!endDate) {
    endDate = new Date().toISOString().split('T')[0];
  }

  try {
    const attempts = await prisma.analytics_game_attempts.findMany({
      where: {
        response_time_ms: { not: null },
        created_at: {
          gte: new Date(startDate),
          lte: new Date(endDate + 'T23:59:59.999Z')
        }
      },
      select: {
        created_at: true,
        response_time_ms: true
      },
      orderBy: { created_at: 'asc' }
    });

    // Group by date
    const dailyData = {};
    (attempts || []).forEach(attempt => {
      const date = attempt.created_at.toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = {
          date,
          response_times: []
        };
      }
      dailyData[date].response_times.push(attempt.response_time_ms);
    });

    // Calculate average for each day
    return Object.values(dailyData).map(day => ({
      date: day.date,
      avg_response_time_ms: day.response_times.length > 0
        ? Math.round(day.response_times.reduce((a, b) => a + b, 0) / day.response_times.length)
        : 0,
      total_attempts: day.response_times.length
    }));
  } catch (err) {
    logger.error('Failed to get TTFT trend:', err);
    throw new Error('Failed to get TTFT trend');
  }
};

/**
 * Get top active devices by session count
 * @param {Object} options - { startDate, endDate, limit }
 * @returns {Promise<Array>} Top devices with stats
 */
const getTopActiveDevices = async ({ startDate, endDate, limit = 10 } = {}) => {
  const sessionWhere = {};
  const attemptWhere = {};

  if (startDate) {
    sessionWhere.started_at = { ...(sessionWhere.started_at || {}), gte: new Date(startDate) };
    attemptWhere.created_at = { ...(attemptWhere.created_at || {}), gte: new Date(startDate) };
  }
  if (endDate) {
    sessionWhere.started_at = { ...(sessionWhere.started_at || {}), lte: new Date(endDate + 'T23:59:59.999Z') };
    attemptWhere.created_at = { ...(attemptWhere.created_at || {}), lte: new Date(endDate + 'T23:59:59.999Z') };
  }

  // Get sessions and attempts in parallel
  let sessions = [];
  let attempts = [];

  try {
    sessions = await prisma.analytics_game_sessions.findMany({
      where: sessionWhere,
      select: { mac_address: true, duration_seconds: true, mode_type: true }
    });
  } catch (err) {
    logger.error('Failed to get sessions for top devices:', err);
    throw new Error('Failed to get top active devices');
  }

  try {
    attempts = await prisma.analytics_game_attempts.findMany({
      where: attemptWhere,
      select: { mac_address: true, is_correct: true }
    });
  } catch (err) {
    logger.error('Failed to get attempts for top devices:', err);
    // Non-fatal — continue without attempt stats
  }

  // Aggregate by device
  const deviceStats = {};
  (sessions || []).forEach(session => {
    const mac = session.mac_address;
    if (!deviceStats[mac]) {
      deviceStats[mac] = {
        mac_address: mac,
        session_count: 0,
        total_duration_seconds: 0,
        modes: new Set(),
        total_attempts: 0,
        correct_attempts: 0
      };
    }
    deviceStats[mac].session_count++;
    deviceStats[mac].total_duration_seconds += session.duration_seconds || 0;
    if (session.mode_type) deviceStats[mac].modes.add(session.mode_type);
  });

  // Add attempt stats
  (attempts || []).forEach(attempt => {
    const mac = attempt.mac_address;
    if (deviceStats[mac]) {
      deviceStats[mac].total_attempts++;
      if (attempt.is_correct) deviceStats[mac].correct_attempts++;
    }
  });

  // Get device info (alias, owner)
  const macs = Object.keys(deviceStats);
  let deviceInfoMap = {};
  if (macs.length > 0) {
    const devices = await prisma.ai_device.findMany({
      where: { mac_address: { in: macs } },
      select: { mac_address: true, alias: true, user_id: true }
    });

    const userIds = [...new Set((devices || []).map(d => d.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
      const users = await prisma.sys_user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true }
      });
      (users || []).forEach(u => {
        userMap[u.id.toString()] = u.username;
      });
    }

    (devices || []).forEach(d => {
      deviceInfoMap[d.mac_address] = {
        alias: d.alias,
        owner_name: d.user_id ? (userMap[d.user_id.toString()] || null) : null
      };
    });
  }

  // Build result array
  const result = Object.values(deviceStats).map(stats => ({
    mac_address: stats.mac_address,
    alias: deviceInfoMap[stats.mac_address]?.alias || null,
    owner_name: deviceInfoMap[stats.mac_address]?.owner_name || null,
    session_count: stats.session_count,
    total_duration_seconds: stats.total_duration_seconds,
    modes: Array.from(stats.modes),
    total_attempts: stats.total_attempts,
    accuracy: stats.total_attempts > 0
      ? Math.round((stats.correct_attempts / stats.total_attempts) * 100)
      : 0
  }));

  // Sort by session count and limit
  return result
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, limit);
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
  getMonthActiveDevices,
  // Dashboard aggregate analytics
  getDashboardSummary,
  getSessionsPerDay,
  getGameAccuracyByType,
  getDifficultyDistribution,
  getTtftTrend,
  getTopActiveDevices
};
