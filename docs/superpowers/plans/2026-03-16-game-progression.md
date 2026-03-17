# Game Progression & Engagement System — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent game progression (infinite levels, adaptive difficulty, streaks, achievements, daily missions) across all 3 Cheeko games, with API endpoints in manager-api-node and Python client in livekit-server.

**Architecture:** Game engines (Python) call manager-api-node (Express/Prisma/PostgreSQL) via HTTP at session start (load progress) and session end (save results). The API computes advancement, streak updates, and achievement triggers server-side and returns the full updated state in one response. The narrator announces milestones, achievements, and streaks using the existing agentic (OddOneOut) or template (Math/YesNo) patterns.

**Tech Stack:** Prisma 7.x (PostgreSQL), Express.js, Joi validation, Python aiohttp, LiveKit agents

**Spec:** `docs/superpowers/specs/2026-03-16-game-progression-engagement.md`

---

## File Structure

### New Files (manager-api-node)

| File | Responsibility |
|------|---------------|
| `prisma/migrations/YYYYMMDD_game_progression/migration.sql` | 5 new tables |
| `src/services/game-progress.service.js` | All progression logic (advancement, streaks, achievements, missions) |
| `src/routes/game.routes.js` | REST endpoints for progress, streaks, achievements, missions |
| `tests/integration/game-progress.test.js` | API integration tests |

### New Files (livekit-server)

| File | Responsibility |
|------|---------------|
| `src/shared/progress_client.py` | HTTP client for game progression API |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 5 new models |
| `src/routes/index.js` | Mount `/game` routes |
| `src/middleware/validation.js` | Add game schemas |
| `src/games/oddoneout_engine.py` | Load/save progress, announce milestones |
| `src/games/yesno_quiz_engine.py` | Load/save progress, announce milestones |
| `src/games/math_game_engine.py` | Load/save progress, announce milestones |
| `src/games/oddoneout_question_generator.py` | Accept difficulty_tier param |
| `src/games/yesno_quiz_question_generator.py` | Accept difficulty_tier param |

---

## Chunk 1: Database Schema + Service

### Task 1: Add Prisma models

**Files:**
- Modify: `D:\cheeko-backend\main\manager-api-node\prisma\schema.prisma`

- [ ] **Step 1: Add 5 new models to schema.prisma**

Append these models at the end of the existing schema file:

```prisma
model game_progress {
  id               String    @id @default(uuid())
  child_id         String
  game_type        String    // "math_quiz", "yesno_quiz", "oddoneout"
  level            Int       @default(1)
  age_band         String    @default("seedling") // seedling, explorer, ranger, commander
  difficulty_tier  Int       @default(1)           // 1-5
  total_stars      Int       @default(0)
  total_played     Int       @default(0)
  total_questions  Int       @default(0)
  total_correct    Int       @default(0)
  best_streak      Int       @default(0)
  recent_window    Json      @default("[]")        // last 10 answers [true, false, ...]
  avg_response_ms  Int       @default(0)
  mastered         Boolean   @default(false)
  mastered_at      DateTime?
  next_review_at   DateTime?
  review_stage     Int       @default(0)
  reviews_skipped  Int       @default(0)
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt

  @@unique([child_id, game_type])
  @@index([child_id])
  @@map("game_progress")
}

model child_streak {
  id               String    @id @default(uuid())
  child_id         String    @unique
  current_streak   Int       @default(0)
  longest_streak   Int       @default(0)
  last_played_date String?   // "2026-03-16" date only
  streak_freezes   Int       @default(0)
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt

  @@map("child_streaks")
}

model game_achievement {
  id          String    @id @default(uuid())
  child_id    String
  code        String    // "streak_7", "perfect_round", etc.
  game_type   String?   // null = cross-game achievement
  unlocked_at DateTime  @default(now())
  announced   Boolean   @default(false)

  @@unique([child_id, code])
  @@index([child_id])
  @@map("game_achievements")
}

model game_session_log {
  id              String    @id @default(uuid())
  child_id        String
  game_type       String
  age_band        String
  level           Int
  difficulty_tier Int
  stars_earned    Int
  questions_asked Int
  correct_answers Int
  best_streak     Int
  hints_used      Int       @default(0)
  avg_response_ms Int       @default(0)
  duration_secs   Int
  completed       Boolean   @default(false)
  level_before    Int
  level_after     Int
  started_at      DateTime
  ended_at        DateTime?

  @@index([child_id])
  @@index([child_id, game_type])
  @@map("game_session_logs")
}

model daily_mission {
  id          String    @id @default(uuid())
  child_id    String
  date        String    // "2026-03-16"
  missions    Json      // [{type, target, progress, done}]
  completed   Boolean   @default(false)
  created_at  DateTime  @default(now())
  updated_at  DateTime  @updatedAt

  @@unique([child_id, date])
  @@map("daily_missions")
}
```

- [ ] **Step 2: Generate and apply Prisma migration**

```bash
cd D:/cheeko-backend/main/manager-api-node
npx prisma migrate dev --name game_progression
```

Expected: Migration creates 5 tables. Prisma client regenerated.

- [ ] **Step 3: Verify tables exist**

```bash
cd D:/cheeko-backend/main/manager-api-node
npx prisma db pull --print | grep -E "game_progress|child_streak|game_achievement|game_session_log|daily_mission"
```

Expected: All 5 table names appear.

- [ ] **Step 4: Commit**

```bash
cd D:/cheeko-backend
git add main/manager-api-node/prisma/schema.prisma main/manager-api-node/prisma/migrations/
git commit -m "feat(progression): add 5 Prisma models for game progression system"
```

---

### Task 2: Create game-progress service

**Files:**
- Create: `D:\cheeko-backend\main\manager-api-node\src\services\game-progress.service.js`

This is the core business logic — handles advancement heuristic, streak calculation, achievement triggers, and session end processing.

- [ ] **Step 1: Create the service file**

```javascript
/**
 * Game progression service.
 * Handles: progress CRUD, advancement heuristic, streaks, achievements, daily missions.
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
  let progress = await prisma.game_progress.findUnique({
    where: { child_id_game_type: { child_id: childId, game_type: gameType } },
  });

  if (!progress) {
    progress = await prisma.game_progress.create({
      data: { child_id: childId, game_type: gameType },
    });
  }

  return {
    ...progress,
    difficultyTier: TIER_FROM_LEVEL(progress.level),
    nextMilestone: getNextMilestone(progress.level),
  };
};

const getAllProgress = async (childId) => {
  const rows = await prisma.game_progress.findMany({
    where: { child_id: childId },
    orderBy: { updated_at: 'desc' },
  });
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
  const updatedWindow = [...(progress.recent_window || []), ...answers].slice(-WINDOW_SIZE);

  // 3. Evaluate advancement
  const advancement = evaluateAdvancement(updatedWindow);
  let newLevel = progress.level;
  if (advancement === 'ADVANCE') newLevel = progress.level + 1;
  else if (advancement === 'DROP') newLevel = Math.max(1, progress.level - 1);

  const levelAdvanced = newLevel > progress.level;
  const levelBefore = progress.level;
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
  progress = await prisma.game_progress.update({
    where: { child_id_game_type: { child_id: childId, game_type: gameType } },
    data: {
      level: newLevel,
      age_band: ageBand || progress.age_band,
      difficulty_tier: TIER_FROM_LEVEL(newLevel),
      total_stars: progress.total_stars + starsEarned,
      total_played: progress.total_played + 1,
      total_questions: progress.total_questions + questionsAsked,
      total_correct: progress.total_correct + correctAnswers,
      best_streak: newBestStreak,
      recent_window: updatedWindow,
      avg_response_ms: avgResponseMs || progress.avg_response_ms,
      mastered,
      mastered_at: masteredAt,
      next_review_at: nextReviewAt,
      review_stage: reviewStage,
    },
  });

  // 7. Save session log
  await prisma.game_session_log.create({
    data: {
      child_id: childId,
      game_type: gameType,
      age_band: ageBand || progress.age_band,
      level: sessionLevel || levelBefore,
      difficulty_tier: TIER_FROM_LEVEL(sessionLevel || levelBefore),
      stars_earned: starsEarned,
      questions_asked: questionsAsked,
      correct_answers: correctAnswers,
      best_streak: bestStreak,
      hints_used: hintsUsed,
      avg_response_ms: avgResponseMs,
      duration_secs: durationSecs,
      completed,
      level_before: levelBefore,
      level_after: levelAfter,
      started_at: new Date(Date.now() - durationSecs * 1000),
      ended_at: new Date(),
    },
  });

  // 8. Update streak
  const streak = await updateStreak(childId);

  // 9. Check achievements
  const newAchievements = await checkAchievements(childId, gameType, {
    correctAnswers, questionsAsked, bestStreak, hintsUsed,
    levelAfter: newLevel, streak: streak.current_streak,
    totalPlayed: progress.total_played, totalQuestions: progress.total_questions,
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
      totalStars: progress.total_stars,
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
  let streak = await prisma.child_streak.findUnique({
    where: { child_id: childId },
  });
  if (!streak) {
    streak = await prisma.child_streak.create({
      data: { child_id: childId },
    });
  }
  return streak;
};

const updateStreak = async (childId) => {
  const streak = await getStreak(childId);
  const today = new Date().toISOString().split('T')[0]; // "2026-03-16"

  if (streak.last_played_date === today) {
    // Already played today — no streak change
    return streak;
  }

  const yesterday = addDays(new Date(), -1).toISOString().split('T')[0];
  let newStreak = streak.current_streak;

  if (streak.last_played_date === yesterday) {
    // Consecutive day — increment
    newStreak = streak.current_streak + 1;
  } else if (streak.last_played_date) {
    // Gap detected
    const daysBefore = addDays(new Date(), -2).toISOString().split('T')[0];
    if (streak.last_played_date === daysBefore && streak.streak_freezes > 0) {
      // Use streak freeze for yesterday
      newStreak = streak.current_streak + 1;
      await prisma.child_streak.update({
        where: { child_id: childId },
        data: { streak_freezes: streak.streak_freezes - 1 },
      });
      logger.info(`streak.freeze_used(child=${childId}, remaining=${streak.streak_freezes - 1})`);
    } else {
      // Streak broken
      newStreak = 1;
    }
  } else {
    // First time playing
    newStreak = 1;
  }

  const newLongest = Math.max(streak.longest_streak, newStreak);

  return prisma.child_streak.update({
    where: { child_id: childId },
    data: {
      current_streak: newStreak,
      longest_streak: newLongest,
      last_played_date: today,
    },
  });
};

const useStreakFreeze = async (childId) => {
  const streak = await getStreak(childId);
  if (streak.streak_freezes <= 0) return { used: false, remaining: 0 };
  const updated = await prisma.child_streak.update({
    where: { child_id: childId },
    data: { streak_freezes: streak.streak_freezes - 1 },
  });
  return { used: true, remaining: updated.streak_freezes };
};

const awardStreakFreeze = async (childId) => {
  const streak = await getStreak(childId);
  if (streak.streak_freezes >= 2) return { awarded: false, current: 2 };
  const updated = await prisma.child_streak.update({
    where: { child_id: childId },
    data: { streak_freezes: Math.min(2, streak.streak_freezes + 1) },
  });
  return { awarded: true, current: updated.streak_freezes };
};

// ── Achievement Engine ─────────────────────────────────

const ACHIEVEMENT_RULES = [
  // Streak achievements
  { code: 'streak_3', check: (ctx) => ctx.streak >= 3 },
  { code: 'streak_7', check: (ctx) => ctx.streak >= 7 },
  { code: 'streak_14', check: (ctx) => ctx.streak >= 14 },
  { code: 'streak_30', check: (ctx) => ctx.streak >= 30 },
  { code: 'streak_100', check: (ctx) => ctx.streak >= 100 },
  { code: 'streak_365', check: (ctx) => ctx.streak >= 365 },
  // Performance
  { code: 'first_star', check: (ctx) => ctx.correctAnswers >= 1 },
  { code: 'perfect_round', check: (ctx) => ctx.correctAnswers === ctx.questionsAsked && ctx.questionsAsked >= 5 },
  { code: 'no_hints', check: (ctx) => ctx.hintsUsed === 0 && ctx.questionsAsked >= 5 },
  { code: 'streak_5_game', check: (ctx) => ctx.bestStreak >= 5 },
  { code: 'streak_10_game', check: (ctx) => ctx.bestStreak >= 10 },
  // Effort
  { code: 'persistence_10', check: (ctx) => ctx.totalPlayed >= 10 },
  { code: 'persistence_50', check: (ctx) => ctx.totalPlayed >= 50 },
  { code: 'persistence_100', check: (ctx) => ctx.totalPlayed >= 100 },
  { code: 'questions_100', check: (ctx) => ctx.totalQuestions >= 100 },
  { code: 'questions_500', check: (ctx) => ctx.totalQuestions >= 500 },
  { code: 'questions_1000', check: (ctx) => ctx.totalQuestions >= 1000 },
  // Milestones
  { code: 'level_5', check: (ctx) => ctx.levelAfter >= 5 },
  { code: 'level_10', check: (ctx) => ctx.levelAfter >= 10 },
  { code: 'level_25', check: (ctx) => ctx.levelAfter >= 25 },
  { code: 'level_50', check: (ctx) => ctx.levelAfter >= 50 },
  { code: 'level_100', check: (ctx) => ctx.levelAfter >= 100 },
];

const checkAchievements = async (childId, gameType, context) => {
  // Get already unlocked
  const existing = await prisma.game_achievement.findMany({
    where: { child_id: childId },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((a) => a.code));

  const newAchievements = [];
  for (const rule of ACHIEVEMENT_RULES) {
    if (existingCodes.has(rule.code)) continue;
    if (rule.check(context)) {
      try {
        const ach = await prisma.game_achievement.create({
          data: {
            child_id: childId,
            code: rule.code,
            game_type: rule.code.startsWith('streak_') ? null : gameType,
          },
        });
        newAchievements.push({ code: rule.code, unlockedAt: ach.unlocked_at, announced: false });
        logger.info(`achievement.unlocked(child=${childId}, code=${rule.code})`);
      } catch (err) {
        // Unique constraint — already exists (race condition), skip
        if (err.code !== 'P2002') throw err;
      }
    }
  }

  return newAchievements;
};

const getAchievements = async (childId) => {
  return prisma.game_achievement.findMany({
    where: { child_id: childId },
    orderBy: { unlocked_at: 'desc' },
  });
};

const getUnannouncedAchievements = async (childId) => {
  return prisma.game_achievement.findMany({
    where: { child_id: childId, announced: false },
    orderBy: { unlocked_at: 'asc' },
  });
};

const markAchievementsAnnounced = async (childId, codes) => {
  await prisma.game_achievement.updateMany({
    where: { child_id: childId, code: { in: codes } },
    data: { announced: true },
  });
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

  let mission = await prisma.daily_mission.findUnique({
    where: { child_id_date: { child_id: childId, date: today } },
  });

  if (!mission) {
    const templates = MISSION_TEMPLATES[ageBand] || MISSION_TEMPLATES.explorer;
    const missions = templates.map((t) => ({ ...t, progress: 0, done: false }));
    mission = await prisma.daily_mission.create({
      data: { child_id: childId, date: today, missions },
    });
  }

  return mission;
};

const updateDailyMissions = async (childId, gameType, { correctAnswers, questionsAsked, completed }) => {
  const today = new Date().toISOString().split('T')[0];
  const mission = await prisma.daily_mission.findUnique({
    where: { child_id_date: { child_id: childId, date: today } },
  });

  if (!mission) return null;

  const missions = mission.missions.map((m) => {
    if (m.done) return m;
    let newProgress = m.progress;

    if (m.type.startsWith('answer_any_')) newProgress += questionsAsked;
    else if (m.type.startsWith('correct_')) newProgress += correctAnswers;
    else if (m.type === 'play_session') newProgress += completed ? 1 : 0;
    else if (m.type === 'play_2_games') newProgress += completed ? 1 : 0;

    return { ...m, progress: Math.min(newProgress, m.target), done: newProgress >= m.target };
  });

  const allComplete = missions.every((m) => m.done);

  const updated = await prisma.daily_mission.update({
    where: { child_id_date: { child_id: childId, date: today } },
    data: { missions, completed: allComplete },
  });

  return { missions: updated.missions, allComplete };
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
```

- [ ] **Step 2: Verify the service loads without errors**

```bash
cd D:/cheeko-backend/main/manager-api-node
node -e "const svc = require('./src/services/game-progress.service'); console.log(Object.keys(svc).length, 'exports OK')"
```

Expected: `17 exports OK`

- [ ] **Step 3: Commit**

```bash
cd D:/cheeko-backend
git add main/manager-api-node/src/services/game-progress.service.js
git commit -m "feat(progression): add game-progress service with advancement, streaks, achievements"
```

---

### Task 3: Create game routes

**Files:**
- Create: `D:\cheeko-backend\main\manager-api-node\src\routes\game.routes.js`
- Modify: `D:\cheeko-backend\main\manager-api-node\src\routes\index.js`
- Modify: `D:\cheeko-backend\main\manager-api-node\src\middleware\validation.js`

- [ ] **Step 1: Add Joi schemas to validation.js**

Add to the `schemas` object in `D:\cheeko-backend\main\manager-api-node\src\middleware\validation.js`:

```javascript
  // Game progression schemas
  sessionEnd: Joi.object({
    childId: Joi.string().required(),
    gameType: Joi.string().valid('math_quiz', 'yesno_quiz', 'oddoneout').required(),
    ageBand: Joi.string().valid('seedling', 'explorer', 'ranger', 'commander'),
    level: Joi.number().integer().min(1),
    starsEarned: Joi.number().integer().min(0).required(),
    questionsAsked: Joi.number().integer().min(0).required(),
    correctAnswers: Joi.number().integer().min(0).required(),
    bestStreak: Joi.number().integer().min(0).default(0),
    hintsUsed: Joi.number().integer().min(0).default(0),
    avgResponseMs: Joi.number().integer().min(0).default(0),
    durationSecs: Joi.number().integer().min(0).required(),
    completed: Joi.boolean().default(true),
    answers: Joi.array().items(Joi.boolean()).default([]),
  }),

  gameType: Joi.object({
    gameType: Joi.string().valid('math_quiz', 'yesno_quiz', 'oddoneout').required(),
  }),
```

- [ ] **Step 2: Create game.routes.js**

```javascript
/**
 * Game progression routes.
 * All endpoints use service key auth (backend-to-backend from livekit-server).
 */
const express = require('express');
const router = express.Router();
const gameProgressService = require('../services/game-progress.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireServiceKey } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { success, badRequest, notFound } = require('../utils/response');

// ── Progress ───────────────────────────────────────────

// GET /game/progress/:childId/:gameType
router.get('/progress/:childId/:gameType', requireServiceKey, asyncHandler(async (req, res) => {
  const { childId, gameType } = req.params;
  const progress = await gameProgressService.getProgress(childId, gameType);
  success(res, progress);
}));

// GET /game/progress/:childId
router.get('/progress/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const { childId } = req.params;
  const progress = await gameProgressService.getAllProgress(childId);
  success(res, progress);
}));

// POST /game/session/end
router.post('/session/end', requireServiceKey, validate({ body: schemas.sessionEnd }),
  asyncHandler(async (req, res) => {
    const result = await gameProgressService.endSession(req.body);
    success(res, result);
  })
);

// ── Streaks ────────────────────────────────────────────

// GET /game/streak/:childId
router.get('/streak/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const streak = await gameProgressService.getStreak(req.params.childId);
  success(res, streak);
}));

// POST /game/streak/:childId/freeze
router.post('/streak/:childId/freeze', requireServiceKey, asyncHandler(async (req, res) => {
  const result = await gameProgressService.useStreakFreeze(req.params.childId);
  success(res, result);
}));

// ── Achievements ───────────────────────────────────────

// GET /game/achievements/:childId
router.get('/achievements/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const achievements = await gameProgressService.getAchievements(req.params.childId);
  success(res, achievements);
}));

// GET /game/achievements/:childId/unannounced
router.get('/achievements/:childId/unannounced', requireServiceKey, asyncHandler(async (req, res) => {
  const achievements = await gameProgressService.getUnannouncedAchievements(req.params.childId);
  success(res, achievements);
}));

// POST /game/achievements/:childId/announce
router.post('/achievements/:childId/announce', requireServiceKey, asyncHandler(async (req, res) => {
  const { codes } = req.body;
  if (!codes || !Array.isArray(codes)) return badRequest(res, 'codes array required');
  await gameProgressService.markAchievementsAnnounced(req.params.childId, codes);
  success(res, { announced: codes.length });
}));

// ── Daily Missions ─────────────────────────────────────

// GET /game/missions/:childId
router.get('/missions/:childId', requireServiceKey, asyncHandler(async (req, res) => {
  const ageBand = req.query.ageBand || 'explorer';
  const missions = await gameProgressService.getDailyMissions(req.params.childId, ageBand);
  success(res, missions);
}));

module.exports = router;
```

- [ ] **Step 3: Mount routes in index.js**

In `D:\cheeko-backend\main\manager-api-node\src\routes\index.js`, add:

```javascript
const gameRoutes = require('./game.routes');
```

And in the router mounting section:

```javascript
router.use('/game', gameRoutes);
```

- [ ] **Step 4: Verify routes load**

```bash
cd D:/cheeko-backend/main/manager-api-node
node -e "const app = require('./src/app'); console.log('Routes loaded OK')"
```

Expected: `Routes loaded OK` (no errors)

- [ ] **Step 5: Commit**

```bash
cd D:/cheeko-backend
git add main/manager-api-node/src/routes/game.routes.js main/manager-api-node/src/routes/index.js main/manager-api-node/src/middleware/validation.js
git commit -m "feat(progression): add game progression API routes"
```

---

### Task 4: Write integration tests

**Files:**
- Create: `D:\cheeko-backend\main\manager-api-node\tests\integration\game-progress.test.js`

- [ ] **Step 1: Create test file**

```javascript
const request = require('supertest');
const app = require('../../src/app');

const SERVICE_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';
const TEST_CHILD = 'test-child-' + Date.now();

function withServiceKey(req) {
  return req.set('X-Service-Key', SERVICE_KEY);
}

function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
  expect(res.body).toHaveProperty('msg');
}

describe('Game Progression API', () => {

  describe('GET /toy/game/progress/:childId/:gameType', () => {
    it('returns 401 without service key', async () => {
      const res = await request(app).get(`/toy/game/progress/${TEST_CHILD}/math_quiz`);
      expect(res.statusCode).toBe(401);
    });

    it('creates default progress for new child', async () => {
      const res = await withServiceKey(
        request(app).get(`/toy/game/progress/${TEST_CHILD}/math_quiz`)
      );
      expect(res.statusCode).toBe(200);
      assertEnvelope(res);
      expect(res.body.data.level).toBe(1);
      expect(res.body.data.total_stars).toBe(0);
      expect(res.body.data.difficultyTier).toBe(1);
    });
  });

  describe('POST /toy/game/session/end', () => {
    it('rejects invalid gameType', async () => {
      const res = await withServiceKey(
        request(app).post('/toy/game/session/end').send({
          childId: TEST_CHILD,
          gameType: 'invalid_game',
          starsEarned: 3,
          questionsAsked: 5,
          correctAnswers: 3,
          durationSecs: 120,
        })
      );
      expect(res.statusCode).toBe(400);
    });

    it('processes session end and returns updated progress', async () => {
      const res = await withServiceKey(
        request(app).post('/toy/game/session/end').send({
          childId: TEST_CHILD,
          gameType: 'math_quiz',
          starsEarned: 4,
          questionsAsked: 5,
          correctAnswers: 4,
          bestStreak: 4,
          durationSecs: 120,
          completed: true,
          answers: [true, true, true, false, true],
        })
      );
      expect(res.statusCode).toBe(200);
      assertEnvelope(res);
      expect(res.body.data).toHaveProperty('progress');
      expect(res.body.data).toHaveProperty('streak');
      expect(res.body.data).toHaveProperty('achievements');
      expect(res.body.data.progress.totalStars).toBeGreaterThan(0);
      expect(res.body.data.streak.current).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /toy/game/streak/:childId', () => {
    it('returns streak data', async () => {
      const res = await withServiceKey(
        request(app).get(`/toy/game/streak/${TEST_CHILD}`)
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('current_streak');
    });
  });

  describe('GET /toy/game/achievements/:childId', () => {
    it('returns achievements list', async () => {
      const res = await withServiceKey(
        request(app).get(`/toy/game/achievements/${TEST_CHILD}`)
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns unannounced achievements', async () => {
      const res = await withServiceKey(
        request(app).get(`/toy/game/achievements/${TEST_CHILD}/unannounced`)
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /toy/game/missions/:childId', () => {
    it('creates and returns daily missions', async () => {
      const res = await withServiceKey(
        request(app).get(`/toy/game/missions/${TEST_CHILD}?ageBand=explorer`)
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('missions');
      expect(Array.isArray(res.body.data.missions)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd D:/cheeko-backend/main/manager-api-node
npm test -- --testPathPattern=game-progress
```

Expected: All tests pass (or fail on auth if SERVICE_SECRET_KEY not set — that's OK for CI).

- [ ] **Step 3: Commit**

```bash
cd D:/cheeko-backend
git add main/manager-api-node/tests/integration/game-progress.test.js
git commit -m "test(progression): add integration tests for game progression API"
```

---

## Chunk 2: Python Client + Engine Wiring

### Task 5: Create Python ProgressClient

**Files:**
- Create: `D:\cheeko-backend\main\livekit-server\src\shared\progress_client.py`

- [ ] **Step 1: Create the HTTP client**

```python
"""
HTTP client for game progression API (manager-api-node).
Used by all game engines to load/save progress.
"""

import os
import logging
import aiohttp

logger = logging.getLogger("progress_client")

DEFAULT_BASE_URL = os.getenv("MANAGER_API_URL", "http://localhost:8002/toy")
DEFAULT_SERVICE_KEY = os.getenv("SERVICE_SECRET_KEY", "")


class ProgressClient:
    """Async HTTP client for game progression endpoints."""

    def __init__(self, base_url: str = None, service_key: str = None):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.service_key = service_key or DEFAULT_SERVICE_KEY
        self._headers = {
            "Content-Type": "application/json",
            "X-Service-Key": self.service_key,
        }

    async def get_progress(self, child_id: str, game_type: str) -> dict:
        """Load progress for a child + game type. Creates default if none exists."""
        url = f"{self.base_url}/game/progress/{child_id}/{game_type}"
        return await self._get(url, "get_progress")

    async def end_session(self, session_data: dict) -> dict:
        """
        Save session results. Returns updated progress, streak, achievements, missions.

        session_data keys:
          childId, gameType, ageBand, level, starsEarned, questionsAsked,
          correctAnswers, bestStreak, hintsUsed, avgResponseMs, durationSecs,
          completed, answers
        """
        url = f"{self.base_url}/game/session/end"
        return await self._post(url, session_data, "end_session")

    async def get_streak(self, child_id: str) -> dict:
        url = f"{self.base_url}/game/streak/{child_id}"
        return await self._get(url, "get_streak")

    async def get_unannounced_achievements(self, child_id: str) -> list:
        url = f"{self.base_url}/game/achievements/{child_id}/unannounced"
        result = await self._get(url, "get_unannounced")
        return result if isinstance(result, list) else []

    async def mark_achievements_announced(self, child_id: str, codes: list) -> None:
        url = f"{self.base_url}/game/achievements/{child_id}/announce"
        await self._post(url, {"codes": codes}, "mark_announced")

    async def get_daily_missions(self, child_id: str, age_band: str = "explorer") -> dict:
        url = f"{self.base_url}/game/missions/{child_id}?ageBand={age_band}"
        return await self._get(url, "get_missions")

    # ── Internal HTTP methods ───────────────────────────

    async def _get(self, url: str, tag: str) -> dict | list:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=self._headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(f"progress.{tag}_failed(status={resp.status}, body={body[:200]})")
                        return {}
                    data = await resp.json()
                    return data.get("data", {})
        except Exception as e:
            logger.error(f"progress.{tag}_error(error={e})")
            return {}

    async def _post(self, url: str, payload: dict, tag: str) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=self._headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(f"progress.{tag}_failed(status={resp.status}, body={body[:200]})")
                        return {}
                    data = await resp.json()
                    return data.get("data", {})
        except Exception as e:
            logger.error(f"progress.{tag}_error(error={e})")
            return {}
```

- [ ] **Step 2: Verify import**

```bash
cd D:/cheeko-backend/main/livekit-server
python -c "from src.shared.progress_client import ProgressClient; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/shared/progress_client.py
git commit -m "feat(progression): add Python ProgressClient for game engines"
```

---

### Task 6: Wire ProgressClient into OddOneOut engine

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\oddoneout_engine.py`
- Modify: `D:\cheeko-backend\main\livekit-server\workers\oddoneout_worker.py`

This task adds progress loading at session start and saving at session end. The engine already has `stars`, `level`, `questions_asked` etc. We connect them to the API.

- [ ] **Step 1: Add ProgressClient to engine constructor**

In `oddoneout_engine.py`, add import at top:

```python
from src.shared.progress_client import ProgressClient
```

Add to `__init__`:

```python
self.progress_client = ProgressClient()
self.child_id = ""  # set at game start
self._session_start_time = None
self._total_hints_used = 0
self._answer_times = []  # response times in ms
```

- [ ] **Step 2: Load progress in start_game()**

At the beginning of `start_game()`, after setting `child_name`/`child_age`:

```python
self.child_id = child_id  # pass child_id from worker
self._session_start_time = asyncio.get_event_loop().time()

# Load progress from API
progress = await self.progress_client.get_progress(self.child_id, "oddoneout")
if progress:
    self.state.level = progress.get("level", 1)
    logger.info(f"engine.progress_loaded(level={self.state.level}, stars={progress.get('total_stars', 0)})")

# Load streak for narrator announcement
streak = await self.progress_client.get_streak(self.child_id)
if streak and streak.get("current_streak", 0) > 1:
    # Inject streak announcement into narrator
    streak_count = streak["current_streak"]
    logger.info(f"engine.streak(count={streak_count})")

# Load unannounced achievements
unannounced = await self.progress_client.get_unannounced_achievements(self.child_id)
if unannounced:
    codes = [a["code"] for a in unannounced]
    await self.progress_client.mark_achievements_announced(self.child_id, codes)
    logger.info(f"engine.achievements_announced(codes={codes})")
```

- [ ] **Step 3: Save progress on game complete/game over**

At the end of the game flow (when `game_complete` or `game_over`), add:

```python
# Save session to API
duration = int(asyncio.get_event_loop().time() - self._session_start_time)
avg_response = int(sum(self._answer_times) / max(1, len(self._answer_times)))
result = await self.progress_client.end_session({
    "childId": self.child_id,
    "gameType": "oddoneout",
    "ageBand": self.state.game_mode,
    "level": self.state.level,
    "starsEarned": self.state.stars,
    "questionsAsked": self.state.questions_asked,
    "correctAnswers": self.state.stars,  # in oddoneout, stars ≈ correct
    "bestStreak": self.state.consecutive_correct,
    "hintsUsed": self._total_hints_used,
    "avgResponseMs": avg_response,
    "durationSecs": duration,
    "completed": True,
    "answers": list(self.state.recent_window) if hasattr(self.state, 'recent_window') else [],
})

if result:
    prog = result.get("progress", {})
    if prog.get("levelAdvanced"):
        logger.info(f"engine.level_up(new={prog.get('levelAfter')})")
    for ach in result.get("achievements", []):
        logger.info(f"engine.achievement(code={ach['code']})")
```

- [ ] **Step 4: Pass child_id from worker to engine**

In `oddoneout_worker.py`, ensure the engine receives `child_id` when starting the game. The child_id typically comes from the room metadata or participant identity.

- [ ] **Step 5: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/games/oddoneout_engine.py main/livekit-server/workers/oddoneout_worker.py
git commit -m "feat(progression): wire ProgressClient into OddOneOut engine"
```

---

### Task 7: Wire ProgressClient into YesNo and Math engines

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\yesno_quiz_engine.py`
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\math_game_engine.py`

Same pattern as Task 6 — add ProgressClient import, load progress at start, save at end. The changes are identical in structure:

- [ ] **Step 1: Add ProgressClient to YesNo engine** (same pattern as OddOneOut Task 6)
- [ ] **Step 2: Add ProgressClient to Math engine** (same pattern as OddOneOut Task 6)
- [ ] **Step 3: Verify both engines start without import errors**

```bash
cd D:/cheeko-backend/main/livekit-server
python -c "from src.games.yesno_quiz_engine import YesNoQuizEngine; print('YesNo OK')"
python -c "from src.games.math_game_engine import MathGameEngine; print('Math OK')"
```

- [ ] **Step 4: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/games/yesno_quiz_engine.py main/livekit-server/src/games/math_game_engine.py
git commit -m "feat(progression): wire ProgressClient into YesNo and Math engines"
```

---

### Task 8: Add difficulty_tier to question generators

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\oddoneout_question_generator.py`
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\yesno_quiz_question_generator.py`

- [ ] **Step 1: Update OddOneOut question generator**

Add `difficulty_tier` parameter to `generate()`:

```python
TIER_CONFIG = {
    1: {"num_options": 3, "types": ["category"]},
    2: {"num_options": 3, "types": ["category", "color"]},
    3: {"num_options": 4, "types": ["category", "color", "size"]},
    4: {"num_options": 4, "types": ["category", "function", "abstract"]},
    5: {"num_options": 4, "types": ["category", "function", "abstract", "wordplay", "tricky"]},
}

async def generate(self, age: int, difficulty_tier: int = 1) -> dict:
    config = TIER_CONFIG.get(difficulty_tier, TIER_CONFIG[1])
    num_options = config["num_options"]
    available_types = config["types"]
    question_type = available_types[self._type_index % len(available_types)]
    self._type_index += 1
    # ... rest of generation uses num_options and question_type
```

- [ ] **Step 2: Update YesNo question generator similarly** (add tier param that maps to harder question categories)
- [ ] **Step 3: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/games/oddoneout_question_generator.py main/livekit-server/src/games/yesno_quiz_question_generator.py
git commit -m "feat(progression): add difficulty_tier support to question generators"
```

---

## Chunk 3: Narrator Announcements

### Task 9: Add progression announcements to OddOneOut narrator

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\oddoneout_narrator.py`

- [ ] **Step 1: Add streak/achievement/level-up methods**

```python
async def announce_streak(self, streak_count: int):
    """LLM announces daily streak at session start."""
    instruction = (
        f"The child has a {streak_count}-day streak! Celebrate this briefly. "
        f"If it's a milestone (7, 30, 100), make it a bigger deal. "
        f"Keep it to 1 sentence. Age: {self._child_age}."
    )
    await self._inject_and_speak(instruction, f"Day {streak_count} streak!", "streak")

async def announce_achievement(self, achievement_code: str, achievement_name: str = None):
    """LLM announces a newly unlocked achievement."""
    name = achievement_name or achievement_code.replace("_", " ").title()
    instruction = (
        f"The child just unlocked an achievement: '{name}'! "
        f"Celebrate with excitement. Tell them what they did to earn it. "
        f"Keep it to 2 sentences. Age: {self._child_age}."
    )
    await self._inject_and_speak(instruction, f"Achievement: {name}!", "achievement")

async def announce_level_up(self, new_level: int, milestone_name: str = None):
    """LLM announces level advancement."""
    milestone_text = f" You've reached the '{milestone_name}' milestone!" if milestone_name else ""
    instruction = (
        f"The child just reached Level {new_level}!{milestone_text} "
        f"Celebrate! Tell them harder questions are coming. "
        f"Keep it to 2 sentences. Age: {self._child_age}."
    )
    await self._inject_and_speak(instruction, f"Level {new_level}!", "level_up")
```

- [ ] **Step 2: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/games/oddoneout_narrator.py
git commit -m "feat(progression): add streak/achievement/level-up narration to OddOneOut"
```

---

### Task 10: Add progression announcements to YesNo and Math narrators

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\yesno_quiz_narrator.py`
- Modify: `D:\cheeko-backend\main\livekit-server\src\games\math_game_narrator.py` (if exists, or add to engine directly)

These use `session.say()` (template-based), not LLM. Add simple methods:

- [ ] **Step 1: Add to YesNo narrator**

```python
async def announce_streak(self, streak_count: int):
    milestones = {7: "a whole week", 14: "two weeks", 30: "a whole month", 100: "one hundred days"}
    if streak_count in milestones:
        await self._speak(f"Day {streak_count}! That's {milestones[streak_count]}! Amazing!", "streak")
    elif streak_count > 1:
        await self._speak(f"Day {streak_count} of your streak! Keep it going!", "streak")

async def announce_achievement(self, name: str):
    await self._speak(f"Achievement unlocked! {name}! You earned it!", "achievement")

async def announce_level_up(self, level: int, milestone_name: str = None):
    if milestone_name:
        await self._speak(f"Level {level}! You're now a {milestone_name}!", "level_up")
    else:
        await self._speak(f"You reached level {level}! Nice work!", "level_up")
```

- [ ] **Step 2: Add same methods to Math narrator** (identical pattern)
- [ ] **Step 3: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/games/yesno_quiz_narrator.py
git commit -m "feat(progression): add streak/achievement/level-up narration to YesNo and Math"
```

---

### Task 11: Add effort-based praise to system prompts

**Files:**
- Modify: `D:\cheeko-backend\main\livekit-server\src\prompts\oddoneout.yaml` (or wherever the OddOneOut system prompt lives)

- [ ] **Step 1: Add effort-praise guidelines to the OddOneOut agent system prompt**

Add to the system prompt instructions:

```
IMPORTANT BEHAVIOR — Effort-Based Praise:
- When the child gets an answer WRONG, praise their effort, not just the result.
  Good: "That was a really good try! I can tell you're thinking hard."
  Bad: "Wrong! The answer was..."
- When the child struggles but eventually succeeds, celebrate the persistence:
  "You didn't give up, and you got it! THAT is what a champion does!"
- Never use harsh buzzers or negative language. Every wrong answer is a learning moment.
```

- [ ] **Step 2: Commit**

```bash
cd D:/cheeko-backend
git add main/livekit-server/src/prompts/
git commit -m "feat(progression): add effort-based praise to game system prompts"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| **Chunk 1** (Tasks 1-4) | DB schema, service, routes, tests | Working API with full progression logic |
| **Chunk 2** (Tasks 5-8) | Python client, engine wiring, difficulty tiers | Games load/save progress, adapt difficulty |
| **Chunk 3** (Tasks 9-11) | Narrator announcements, effort praise | Kids hear streaks, achievements, level-ups |

**Total: 11 tasks, ~30 steps.**

Each chunk produces independently testable software:
- After Chunk 1: API endpoints work (test with curl/Postman)
- After Chunk 2: Game engines persist progress across sessions
- After Chunk 3: Kids experience the full engagement loop
