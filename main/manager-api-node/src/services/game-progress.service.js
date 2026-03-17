/**
 * Game progression service.
 * Handles: progress CRUD, advancement heuristic, streaks, achievements, daily missions.
 *
 * Uses raw SQL via pgPool (Prisma migrations blocked by cross-schema issue).
 */
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// ── Constants ──────────────────────────────────────────
const WINDOW_SIZE = 10;
const ADVANCE_THRESHOLD = 0.80;
const DROP_THRESHOLD = 0.45;
const ADVANCE_MIN_QUESTIONS = 10;

const TIER_FROM_LEVEL = (level) => Math.min(5, Math.ceil(level / 5));

const REVIEW_INTERVALS = [1, 3, 7, 14, 30]; // days

const AGE_BAND = (age) => {
  if (age <= 5) return 'seedling';
  if (age <= 8) return 'explorer';
  if (age <= 11) return 'ranger';
  return 'commander';
};

const MILESTONE_NAMES = {
  5: 'Rising Star', 10: 'Shining Star', 15: 'Shooting Star',
  20: 'Super Star', 25: 'Mega Star', 30: 'Ultra Star',
  40: 'Galactic Star', 50: 'Legend', 75: 'Grand Legend',
  100: 'Centurion', 150: 'Mythic', 200: 'Transcendent',
};

// ── Progress CRUD ──────────────────────────────────────

const getProgress = async (childId, gameType) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM game_progress WHERE child_id = $1 AND game_type = $2`,
    childId, gameType
  );

  let progress;
  if (rows.length === 0) {
    const inserted = await prisma.$queryRawUnsafe(
      `INSERT INTO game_progress (child_id, game_type) VALUES ($1, $2) RETURNING *`,
      childId, gameType
    );
    progress = inserted[0];
  } else {
    progress = rows[0];
  }

  return {
    ...progress,
    difficultyTier: TIER_FROM_LEVEL(progress.level),
    nextMilestone: getNextMilestone(progress.level),
  };
};

const getAllProgress = async (childId) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM game_progress WHERE child_id = $1 ORDER BY updated_at DESC`,
    childId
  );
  return rows.map((r) => ({
    ...r,
    difficultyTier: TIER_FROM_LEVEL(r.level),
    nextMilestone: getNextMilestone(r.level),
  }));
};

const getNextMilestone = (level) => {
  const milestoneKeys = Object.keys(MILESTONE_NAMES).map(Number).sort((a, b) => a - b);
  const next = milestoneKeys.find((m) => m > level);
  if (!next) return { name: 'Transcendent+', level: level + 50, distance: 50 };
  return { name: MILESTONE_NAMES[next], level: next, distance: next - level };
};

// ── Advancement Heuristic ──────────────────────────────

const evaluateAdvancement = (recentWindow) => {
  if (recentWindow.length < ADVANCE_MIN_QUESTIONS) return 'STAY';
  const window = recentWindow.slice(-WINDOW_SIZE);
  const accuracy = window.filter(Boolean).length / window.length;
  if (accuracy >= ADVANCE_THRESHOLD) return 'ADVANCE';
  if (accuracy < DROP_THRESHOLD) return 'DROP';
  return 'STAY';
};

// ── Session End (main entry point) ─────────────────────

const endSession = async (sessionData) => {
  const {
    childId, gameType, ageBand, level: sessionLevel,
    starsEarned, questionsAsked, correctAnswers, bestStreak,
    hintsUsed = 0, avgResponseMs = 0, durationSecs, completed = true,
    answers = [],
  } = sessionData;

  // 1. Load current progress
  let progress = await getProgress(childId, gameType);

  // 2. Update sliding window
  const currentWindow = Array.isArray(progress.recent_window) ? progress.recent_window : [];
  const updatedWindow = [...currentWindow, ...answers].slice(-WINDOW_SIZE);

  // 3. Determine level: trust game engine's level if provided, else use heuristic
  const levelBefore = progress.level;
  let newLevel;
  let advancement;

  if (sessionLevel && sessionLevel > 0) {
    // Game engine already advanced — trust it
    newLevel = sessionLevel;
    advancement = newLevel > levelBefore ? 'ADVANCE' : newLevel < levelBefore ? 'DROP' : 'STAY';
  } else {
    // No level from engine — use sliding window heuristic
    advancement = evaluateAdvancement(updatedWindow);
    newLevel = progress.level;
    if (advancement === 'ADVANCE') newLevel = progress.level + 1;
    else if (advancement === 'DROP') newLevel = Math.max(1, progress.level - 1);
  }

  const levelAdvanced = newLevel > levelBefore;
  const levelAfter = newLevel;

  // 4. Check milestone
  let milestone = null;
  if (levelAdvanced && MILESTONE_NAMES[newLevel]) {
    milestone = { name: MILESTONE_NAMES[newLevel], level: newLevel };
  }

  // 5. Check mastery + spaced repetition
  let mastered = progress.mastered;
  let masteredAt = progress.mastered_at;
  let nextReviewAt = progress.next_review_at;
  let reviewStage = progress.review_stage;

  if (newLevel >= 25 && !mastered) {
    const accuracy = updatedWindow.filter(Boolean).length / updatedWindow.length;
    if (accuracy >= 0.90) {
      mastered = true;
      masteredAt = new Date();
      reviewStage = 0;
      nextReviewAt = addDays(new Date(), REVIEW_INTERVALS[0]);
    }
  }

  // 6. Update progress record
  const newBestStreak = Math.max(progress.best_streak, bestStreak);
  const newTotalStars = progress.total_stars + starsEarned;
  const newTotalPlayed = progress.total_played + 1;
  const newTotalQuestions = progress.total_questions + questionsAsked;
  const newTotalCorrect = progress.total_correct + correctAnswers;

  await prisma.$executeRawUnsafe(
    `UPDATE game_progress SET
      level = $1, age_band = $2, difficulty_tier = $3,
      total_stars = $4, total_played = $5, total_questions = $6, total_correct = $7,
      best_streak = $8, recent_window = $9::jsonb, avg_response_ms = $10,
      mastered = $11, mastered_at = $12, next_review_at = $13, review_stage = $14,
      updated_at = now()
    WHERE child_id = $15 AND game_type = $16`,
    newLevel, ageBand || progress.age_band, TIER_FROM_LEVEL(newLevel),
    newTotalStars, newTotalPlayed, newTotalQuestions, newTotalCorrect,
    newBestStreak, JSON.stringify(updatedWindow), avgResponseMs || progress.avg_response_ms,
    mastered, masteredAt, nextReviewAt, reviewStage,
    childId, gameType
  );

  // 7. Save session log
  const startedAt = new Date(Date.now() - durationSecs * 1000);
  await prisma.$executeRawUnsafe(
    `INSERT INTO game_session_logs
      (child_id, game_type, age_band, level, difficulty_tier,
       stars_earned, questions_asked, correct_answers, best_streak,
       hints_used, avg_response_ms, duration_secs, completed,
       level_before, level_after, started_at, ended_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())`,
    childId, gameType, ageBand || progress.age_band, sessionLevel || levelBefore,
    TIER_FROM_LEVEL(sessionLevel || levelBefore),
    starsEarned, questionsAsked, correctAnswers, bestStreak,
    hintsUsed, avgResponseMs, durationSecs, completed,
    levelBefore, levelAfter, startedAt
  );

  // 8. Update streak
  const streak = await updateStreak(childId);

  // 9. Check achievements
  const newAchievements = await checkAchievements(childId, gameType, {
    correctAnswers, questionsAsked, bestStreak, hintsUsed,
    levelAfter: newLevel, streak: streak.current_streak,
    totalPlayed: newTotalPlayed, totalQuestions: newTotalQuestions,
  });

  // 10. Update daily missions
  const missionUpdate = await updateDailyMissions(childId, gameType, {
    correctAnswers, questionsAsked, completed,
  });

  return {
    progress: {
      level: newLevel,
      levelAdvanced,
      levelBefore,
      levelAfter,
      difficultyTier: TIER_FROM_LEVEL(newLevel),
      totalStars: newTotalStars,
      milestone,
      nextMilestone: getNextMilestone(newLevel),
      advancement,
    },
    streak: {
      current: streak.current_streak,
      longest: streak.longest_streak,
      freezes: streak.streak_freezes,
    },
    achievements: newAchievements,
    dailyMission: missionUpdate,
  };
};

// ── Streak Management ──────────────────────────────────

const getStreak = async (childId) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM child_streaks WHERE child_id = $1`, childId
  );
  if (rows.length > 0) return rows[0];
  const inserted = await prisma.$queryRawUnsafe(
    `INSERT INTO child_streaks (child_id) VALUES ($1) RETURNING *`, childId
  );
  return inserted[0];
};

const updateStreak = async (childId) => {
  const streak = await getStreak(childId);
  const today = new Date().toISOString().split('T')[0];

  if (streak.last_played_date === today) {
    return streak;
  }

  const yesterday = addDays(new Date(), -1).toISOString().split('T')[0];
  let newStreak = streak.current_streak;

  if (streak.last_played_date === yesterday) {
    newStreak = streak.current_streak + 1;
  } else if (streak.last_played_date) {
    const daysBefore = addDays(new Date(), -2).toISOString().split('T')[0];
    if (streak.last_played_date === daysBefore && streak.streak_freezes > 0) {
      newStreak = streak.current_streak + 1;
      await prisma.$executeRawUnsafe(
        `UPDATE child_streaks SET streak_freezes = streak_freezes - 1, updated_at = now() WHERE child_id = $1`,
        childId
      );
      logger.info(`streak.freeze_used(child=${childId})`);
    } else {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  const newLongest = Math.max(streak.longest_streak, newStreak);

  const updated = await prisma.$queryRawUnsafe(
    `UPDATE child_streaks SET current_streak = $1, longest_streak = $2, last_played_date = $3, updated_at = now()
     WHERE child_id = $4 RETURNING *`,
    newStreak, newLongest, today, childId
  );
  return updated[0];
};

const useStreakFreeze = async (childId) => {
  const streak = await getStreak(childId);
  if (streak.streak_freezes <= 0) return { used: false, remaining: 0 };
  await prisma.$executeRawUnsafe(
    `UPDATE child_streaks SET streak_freezes = streak_freezes - 1, updated_at = now() WHERE child_id = $1`,
    childId
  );
  return { used: true, remaining: streak.streak_freezes - 1 };
};

const awardStreakFreeze = async (childId) => {
  const streak = await getStreak(childId);
  if (streak.streak_freezes >= 2) return { awarded: false, current: 2 };
  await prisma.$executeRawUnsafe(
    `UPDATE child_streaks SET streak_freezes = LEAST(2, streak_freezes + 1), updated_at = now() WHERE child_id = $1`,
    childId
  );
  return { awarded: true, current: Math.min(2, streak.streak_freezes + 1) };
};

// ── Achievement Engine ─────────────────────────────────

const ACHIEVEMENT_RULES = [
  { code: 'streak_3', check: (ctx) => ctx.streak >= 3 },
  { code: 'streak_7', check: (ctx) => ctx.streak >= 7 },
  { code: 'streak_14', check: (ctx) => ctx.streak >= 14 },
  { code: 'streak_30', check: (ctx) => ctx.streak >= 30 },
  { code: 'streak_100', check: (ctx) => ctx.streak >= 100 },
  { code: 'streak_365', check: (ctx) => ctx.streak >= 365 },
  { code: 'first_star', check: (ctx) => ctx.correctAnswers >= 1 },
  { code: 'perfect_round', check: (ctx) => ctx.correctAnswers === ctx.questionsAsked && ctx.questionsAsked >= 5 },
  { code: 'no_hints', check: (ctx) => ctx.hintsUsed === 0 && ctx.questionsAsked >= 5 },
  { code: 'streak_5_game', check: (ctx) => ctx.bestStreak >= 5 },
  { code: 'streak_10_game', check: (ctx) => ctx.bestStreak >= 10 },
  { code: 'persistence_10', check: (ctx) => ctx.totalPlayed >= 10 },
  { code: 'persistence_50', check: (ctx) => ctx.totalPlayed >= 50 },
  { code: 'persistence_100', check: (ctx) => ctx.totalPlayed >= 100 },
  { code: 'questions_100', check: (ctx) => ctx.totalQuestions >= 100 },
  { code: 'questions_500', check: (ctx) => ctx.totalQuestions >= 500 },
  { code: 'questions_1000', check: (ctx) => ctx.totalQuestions >= 1000 },
  { code: 'level_5', check: (ctx) => ctx.levelAfter >= 5 },
  { code: 'level_10', check: (ctx) => ctx.levelAfter >= 10 },
  { code: 'level_25', check: (ctx) => ctx.levelAfter >= 25 },
  { code: 'level_50', check: (ctx) => ctx.levelAfter >= 50 },
  { code: 'level_100', check: (ctx) => ctx.levelAfter >= 100 },
];

const checkAchievements = async (childId, gameType, context) => {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT code FROM game_achievements WHERE child_id = $1`, childId
  );
  const existingCodes = new Set(existing.map((a) => a.code));

  const newAchievements = [];
  for (const rule of ACHIEVEMENT_RULES) {
    if (existingCodes.has(rule.code)) continue;
    if (rule.check(context)) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO game_achievements (child_id, code, game_type) VALUES ($1, $2, $3)
           ON CONFLICT (child_id, code) DO NOTHING`,
          childId, rule.code, rule.code.startsWith('streak_') ? null : gameType
        );
        newAchievements.push({ code: rule.code, announced: false });
        logger.info(`achievement.unlocked(child=${childId}, code=${rule.code})`);
      } catch (err) {
        logger.warn(`achievement.insert_error(code=${rule.code}, err=${err.message})`);
      }
    }
  }
  return newAchievements;
};

const getAchievements = async (childId) => {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM game_achievements WHERE child_id = $1 ORDER BY unlocked_at DESC`, childId
  );
};

const getUnannouncedAchievements = async (childId) => {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM game_achievements WHERE child_id = $1 AND announced = false ORDER BY unlocked_at ASC`,
    childId
  );
};

const markAchievementsAnnounced = async (childId, codes) => {
  if (!codes || codes.length === 0) return;
  const placeholders = codes.map((_, i) => `$${i + 2}`).join(',');
  await prisma.$executeRawUnsafe(
    `UPDATE game_achievements SET announced = true WHERE child_id = $1 AND code IN (${placeholders})`,
    childId, ...codes
  );
};

// ── Daily Missions ─────────────────────────────────────

const MISSION_TEMPLATES = {
  seedling: [
    { type: 'answer_any_3', target: 3, label: 'Answer 3 questions' },
    { type: 'play_session', target: 1, label: 'Play one game' },
  ],
  explorer: [
    { type: 'answer_any_5', target: 5, label: 'Answer 5 questions' },
    { type: 'correct_3', target: 3, label: 'Get 3 correct' },
    { type: 'play_session', target: 1, label: 'Play one game' },
  ],
  ranger: [
    { type: 'answer_any_8', target: 8, label: 'Answer 8 questions' },
    { type: 'correct_5', target: 5, label: 'Get 5 correct' },
    { type: 'play_2_games', target: 2, label: 'Try 2 different games' },
  ],
  commander: [
    { type: 'answer_any_10', target: 10, label: 'Answer 10 questions' },
    { type: 'correct_8', target: 8, label: 'Get 8 correct' },
    { type: 'play_2_games', target: 2, label: 'Try 2 different games' },
  ],
};

const getDailyMissions = async (childId, ageBand = 'explorer') => {
  const today = new Date().toISOString().split('T')[0];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM daily_missions WHERE child_id = $1 AND date = $2`, childId, today
  );

  if (rows.length > 0) return rows[0];

  const templates = MISSION_TEMPLATES[ageBand] || MISSION_TEMPLATES.explorer;
  const missions = templates.map((t) => ({ ...t, progress: 0, done: false }));
  const inserted = await prisma.$queryRawUnsafe(
    `INSERT INTO daily_missions (child_id, date, missions) VALUES ($1, $2, $3::jsonb) RETURNING *`,
    childId, today, JSON.stringify(missions)
  );
  return inserted[0];
};

const updateDailyMissions = async (childId, gameType, { correctAnswers, questionsAsked, completed }) => {
  const today = new Date().toISOString().split('T')[0];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM daily_missions WHERE child_id = $1 AND date = $2`, childId, today
  );
  if (rows.length === 0) return null;

  const mission = rows[0];
  const currentMissions = Array.isArray(mission.missions) ? mission.missions : [];
  const missions = currentMissions.map((m) => {
    if (m.done) return m;
    let newProgress = m.progress;
    if (m.type.startsWith('answer_any_')) newProgress += questionsAsked;
    else if (m.type.startsWith('correct_')) newProgress += correctAnswers;
    else if (m.type === 'play_session') newProgress += completed ? 1 : 0;
    else if (m.type === 'play_2_games') newProgress += completed ? 1 : 0;
    return { ...m, progress: Math.min(newProgress, m.target), done: newProgress >= m.target };
  });

  const allComplete = missions.every((m) => m.done);
  await prisma.$executeRawUnsafe(
    `UPDATE daily_missions SET missions = $1::jsonb, completed = $2, updated_at = now() WHERE child_id = $3 AND date = $4`,
    JSON.stringify(missions), allComplete, childId, today
  );
  return { missions, allComplete };
};

// ── Helpers ────────────────────────────────────────────

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = {
  getProgress,
  getAllProgress,
  endSession,
  getStreak,
  updateStreak,
  useStreakFreeze,
  awardStreakFreeze,
  getAchievements,
  getUnannouncedAchievements,
  markAchievementsAnnounced,
  getDailyMissions,
  updateDailyMissions,
  evaluateAdvancement,
  AGE_BAND,
  TIER_FROM_LEVEL,
  MILESTONE_NAMES,
};
