# Cheeko Game Progression & Engagement System

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Persistent progression, achievements, and engagement mechanics across all Cheeko games so kids never "finish" and always have a reason to come back.

**Architecture:** Game engines save progress to PostgreSQL via manager-api-node (Prisma). Session resume via LiveKit participant metadata. LLM narrator announces milestones and achievements dynamically.

**Tech Stack:** Prisma ORM, Express.js API, Python game engines (HTTP client), LiveKit metadata

---

## 1. Core Design Principles

### 1.1 Dual-Track Progression (from Prodigy)

```
Track 1: SKILL LEVEL (adaptive, per game type)
  → Controls question difficulty
  → Based on accuracy + response time (ZPD heuristic)
  → Independent per game type
  → Infinite — LLM always generates harder questions

Track 2: ENGAGEMENT (always moves forward)
  → Stars, streaks, collectibles, milestones
  → Never blocked by academic struggle
  → Rewards effort AND correctness
```

### 1.2 Infinite Levels, Milestone Celebrations

Levels never end. The LLM generates questions at the child's current difficulty tier. Every 5 levels → milestone celebration. Content difficulty scales via tier system:

```
Level  1-5:   Tier 1 — Obvious, generous hints, 3 options
Level  6-10:  Tier 2 — Less obvious, standard hints
Level 11-15:  Tier 3 — Requires thinking, fewer hints
Level 16-20:  Tier 4 — Tricky within age vocabulary
Level 21-25:  Tier 5 — Expert for age band
Level 26+:    Tier 5 continues — fresh questions, same difficulty ceiling
```

When child ages into next band, level continues (doesn't reset) but new question types unlock:

```
Seedling (3-5):  3 options, concrete categories (animals/food/colors)
Explorer (6-8):  3-4 options, moderate categories, adjective-based
Ranger (9-11):   4 options, function/abstract, timed bonus available
Commander (12+): 4 options, tricky/wordplay/debate, challenge modes
```

### 1.3 Per-Session Flow

```
Session Start:
  1. Fetch progress from API: GET /toy/game/progress/:childId/:gameType
  2. Announce streak: "Day 14! You're on fire!"
  3. Check unannounced achievements → narrate them
  4. Check if spaced review is due → offer review or new game
  5. Announce daily mission if applicable

During Game:
  6. Each answer updates sliding window (last 10 answers)
  7. Track response time per answer
  8. Check achievement triggers after each answer
  9. Variable ratio surprise rewards (not every correct answer)

Session End:
  10. POST session record to API
  11. Run advancement heuristic (ADVANCE / STAY / DROP)
  12. Update level if changed → celebrate
  13. Update daily streak
  14. Check & save new achievements
  15. Announce milestones
  16. Tease next session: "Come back tomorrow for a surprise!"
```

---

## 2. Advancement Heuristic (Zone of Proximal Development)

```python
WINDOW_SIZE = 10  # last N answers
ADVANCE_THRESHOLD = 0.80  # 80% accuracy
DROP_THRESHOLD = 0.45  # below 45% → too hard
ADVANCE_MIN_QUESTIONS = 10  # minimum questions before level change

def evaluate_advancement(recent_answers: list[bool], avg_response_ms: int) -> str:
    """
    Returns: "ADVANCE", "STAY", or "DROP"

    Starting values — test plan:
    - ADVANCE at 80%: If kids advance and immediately fail 3+, raise to 85%
    - DROP at 45%: If kids get stuck and frustrated, raise to 50%
    - Window 10: If advancement feels too fast, increase to 15
    """
    if len(recent_answers) < ADVANCE_MIN_QUESTIONS:
        return "STAY"

    window = recent_answers[-WINDOW_SIZE:]
    accuracy = sum(window) / len(window)

    if accuracy >= ADVANCE_THRESHOLD:
        return "ADVANCE"
    elif accuracy < DROP_THRESHOLD:
        return "DROP"
    else:
        return "STAY"
```

---

## 3. Engagement Mechanics

### 3.1 Streak System (Priority 1 — Duolingo's #1 retention driver)

```
Daily streak tracked per child (not per game).
Streak increments when child plays ANY game on a calendar day.

Milestones:
  3 days  → "Three days in a row! You're getting started!"
  7 days  → "A whole week! You're on fire!" + streak_7 achievement
  14 days → "Two weeks! Incredible!"
  30 days → "One month! You're a legend!" + streak_30 achievement
  100 days → "ONE HUNDRED DAYS!" + full celebration + streak_100
  365 days → "A whole year! You're the greatest!" + streak_365

Streak Freeze:
  Earned by completing a "hard challenge" (all correct, no hints)
  Max 2 streak freezes stored at a time
  Auto-consumed on a missed day
  AI announces: "Your magic shield protected your streak!"
```

### 3.2 Audio Celebration Hierarchy (Priority 2)

```
Tier 1 — Correct answer:
  SFX: Short chime (0.3s)
  Voice: "That's right!" / "Correct!" (varies)

Tier 2 — Streak in-game (3 correct in a row):
  SFX: Rising musical phrase (1s)
  Voice: "Three in a row! You're on fire!"

Tier 3 — Level milestone (every 5 levels):
  SFX: Full celebration jingle + applause (3s)
  Voice: "You just reached Level 10! Shining Star!"

Tier 4 — Achievement unlocked:
  SFX: Achievement fanfare + sparkle sound (3s)
  Voice: "Achievement unlocked: Perfect Round! Not a single mistake!"

Tier 5 — Major milestone (new age band, streak 100, etc.):
  SFX: Extended fanfare + music (5-8s)
  Voice: Full LLM-generated celebration speech
```

### 3.3 Effort-Based Praise (Priority 3 — prompt engineering only)

```
Wrong answer reactions (LLM narrator):
  - "That was a really good try! I can tell you're thinking hard."
  - "Interesting answer! Not quite, but I love that you tried."
  - "Almost! You're so close. Want to try again?"

After struggle + success:
  - "You didn't give up, and you got it! THAT is what a champion does!"

Persistence tracking:
  - 3+ wrong on same question type: "You've been working really hard on these. I'm proud of you!"

Effort achievements:
  - "never_give_up": Answer wrong 3 times then get it right
  - "try_everything": Play all game types in one day
  - "persistence_10": Complete 10 sessions regardless of score
```

### 3.4 Mentor Reversal (Priority 4 — from Moxie)

```
Occasionally, Cheeko "asks the child for help":
  - "I've been trying to figure out which one doesn't belong. Can you teach me?"
  - After child answers: "Ohhh! That makes so much sense! You're such a good teacher!"
  - "Thanks to you, I learned 8 new things this week!"

Implementation: System prompt variation that activates every ~5th session.
Cheeko pretends to be the student, child corrects it.
```

### 3.5 Variable Ratio Surprises (Priority 5)

```
Not every correct answer gets the same reward.
Surprise events fire on a variable schedule (every 3-8 correct answers):

Surprise types:
  - "BONUS STAR! That one counted double!"
  - "You found a hidden fact! Did you know..." [fun fact]
  - "Mystery sound unlocked! Listen... [silly SFX]"
  - "Cheeko joke time! Why did the... [kid-friendly joke]"

Schedule: random.randint(3, 8) correct answers between surprises.
Never on the same interval twice in a row.
```

### 3.6 Daily Missions (Priority 6)

```
Generated per child per day. Simple, achievable goals.

Seedling (3-5):
  - "Answer 3 questions today" (any game)
  - "Play one game with Cheeko"

Explorer (6-8):
  - "Get 3 stars in Odd One Out"
  - "Try 2 different games today"
  - "Get 3 in a row in Math Quiz"

Ranger (9-12):
  - "Get a perfect round in any game"
  - "Answer 5 questions without using hints"
  - "Try Commander mode"

Commander (13+):
  - "Beat your best streak"
  - "Complete a session in under 3 minutes"
  - "Get 5 hard questions right"

Weekly chain: Complete 5/7 daily missions → weekly reward
```

### 3.7 Named Milestones (replaces finite levels)

```
Every 5 levels in ANY game triggers a named milestone:

Level 5:   Rising Star ⭐
Level 10:  Shining Star 🌟
Level 15:  Shooting Star 💫
Level 20:  Super Star ✨
Level 25:  Mega Star 🔥
Level 30:  Ultra Star ⚡
Level 40:  Galactic Star 🌌
Level 50:  Legend 👑
Level 75:  Grand Legend 🏆
Level 100: Centurion 🎖️
Level 150: Mythic 🐉
Level 200: Transcendent 🌈

Each milestone:
  - Unique celebration narration (LLM-generated)
  - Unique SFX
  - Visible in "My Stars" when child asks
```

---

## 4. Achievement System

### 4.1 Achievement Categories

**Streak Achievements:**
| Code | Name | Trigger |
|------|------|---------|
| `streak_3` | Getting Started | 3-day streak |
| `streak_7` | Weekly Warrior | 7-day streak |
| `streak_14` | Fortnight Hero | 14-day streak |
| `streak_30` | Monthly Legend | 30-day streak |
| `streak_100` | Century Streak | 100-day streak |
| `streak_365` | Year of Wonder | 365-day streak |

**Performance Achievements:**
| Code | Name | Trigger |
|------|------|---------|
| `first_star` | First Star | Earn first star ever |
| `perfect_round` | Perfect Round | Complete a session with 0 wrong |
| `no_hints` | Independent Thinker | Complete session without hints |
| `speed_3` | Lightning Brain | Answer 3 questions within 3s each |
| `streak_5_game` | Hot Streak | 5 correct in a row (in-game) |
| `streak_10_game` | On Fire | 10 correct in a row (in-game) |
| `comeback_kid` | Comeback Kid | Win commander mode with 1 life left |

**Effort Achievements:**
| Code | Name | Trigger |
|------|------|---------|
| `never_give_up` | Never Give Up | Get wrong 3x, then correct |
| `try_everything` | Curious Mind | Play all game types in one day |
| `persistence_10` | Dedicated Learner | Complete 10 sessions total |
| `persistence_50` | Super Student | Complete 50 sessions total |
| `persistence_100` | Scholar | Complete 100 sessions total |
| `questions_100` | Century Club | Answer 100 questions total |
| `questions_500` | Knowledge Seeker | Answer 500 questions total |
| `questions_1000` | Wisdom Master | Answer 1000 questions total |

**Milestone Achievements:**
| Code | Name | Trigger |
|------|------|---------|
| `level_5` | Rising Star | Reach level 5 in any game |
| `level_10` | Shining Star | Reach level 10 in any game |
| `level_25` | Mega Star | Reach level 25 in any game |
| `level_50` | Legend | Reach level 50 in any game |
| `level_100` | Centurion | Reach level 100 in any game |
| `band_explorer` | Explorer Unlocked | Advance to Explorer band |
| `band_ranger` | Ranger Unlocked | Advance to Ranger band |
| `band_commander` | Commander Unlocked | Advance to Commander band |

**Cross-Game Achievements:**
| Code | Name | Trigger |
|------|------|---------|
| `all_games_played` | Explorer | Play every available game type |
| `all_level_5` | Well Rounded | Reach level 5 in ALL game types |
| `all_level_10` | Renaissance Kid | Reach level 10 in ALL game types |
| `daily_7` | Weekly Champion | Complete 7 daily missions in a row |
| `daily_30` | Monthly Champion | Complete 30 daily missions |

### 4.2 Achievement Announcement

Achievements are announced by the LLM narrator at session start (for achievements earned during previous session's save) or immediately when triggered mid-session.

```
LLM instruction for achievement announcement:
"[ACHIEVEMENT] The child just unlocked '{achievement_name}'!
 Celebrate this with excitement and tell them what they did to earn it.
 Keep it to 2 sentences. Make it feel special."
```

---

## 5. Spaced Repetition (from Duolingo "Cracking")

```
When a game type reaches "mastery threshold" (Level 25 with 90%+ accuracy):
  - Mark skill as "mastered"
  - Enter review schedule: 1 day → 3 days → 7 days → 14 days → 30 days

If review is due at session start:
  AI: "Your animal categories are getting rusty! Quick 3-question review?"

If review passed (2/3 correct):
  - Advance to next review interval
  - "Your skills are sharp as ever!"

If review failed:
  - Reset to previous interval
  - "Let's practice a bit more. You'll get it back!"

If review skipped 3 times:
  - Skill "cracks" — drops back one level
  - AI: "Oh no! Your [game] skills are fading. Let's bring them back!"
```

---

## 6. Data Model (Prisma)

```prisma
model GameProgress {
  id              String    @id @default(uuid())
  childId         String    @map("child_id")
  gameType        String    @map("game_type")    // "math_quiz", "yesno_quiz", "oddoneout"
  level           Int       @default(1)
  ageBand         String    @default("seedling") @map("age_band")
  difficultyTier  Int       @default(1) @map("difficulty_tier")  // 1-5, derived from level
  totalStars      Int       @default(0) @map("total_stars")
  totalPlayed     Int       @default(0) @map("total_played")     // sessions
  totalQuestions  Int       @default(0) @map("total_questions")
  totalCorrect    Int       @default(0) @map("total_correct")
  bestStreak      Int       @default(0) @map("best_streak")      // in-game streak record
  recentWindow    Json      @default("[]") @map("recent_window") // last 10 answers [true/false]
  avgResponseMs   Int       @default(0) @map("avg_response_ms")

  // Spaced repetition
  mastered        Boolean   @default(false)
  masteredAt      DateTime? @map("mastered_at")
  nextReviewAt    DateTime? @map("next_review_at")
  reviewStage     Int       @default(0) @map("review_stage")     // 0,1,3,7,14,30
  reviewsSkipped  Int       @default(0) @map("reviews_skipped")

  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@unique([childId, gameType])
  @@map("game_progress")
}

model ChildStreak {
  id              String    @id @default(uuid())
  childId         String    @unique @map("child_id")
  currentStreak   Int       @default(0) @map("current_streak")
  longestStreak   Int       @default(0) @map("longest_streak")
  lastPlayedDate  String?   @map("last_played_date")  // "2026-03-16" (date only)
  streakFreezes   Int       @default(0) @map("streak_freezes")   // max 2

  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@map("child_streaks")
}

model Achievement {
  id          String   @id @default(uuid())
  childId     String   @map("child_id")
  code        String                        // "streak_7", "perfect_round"
  gameType    String?  @map("game_type")    // null = cross-game
  unlockedAt  DateTime @default(now()) @map("unlocked_at")
  announced   Boolean  @default(false)      // has narrator spoken it?

  @@unique([childId, code])
  @@map("achievements")
}

model GameSession {
  id              String    @id @default(uuid())
  childId         String    @map("child_id")
  gameType        String    @map("game_type")
  ageBand         String    @map("age_band")
  level           Int
  difficultyTier  Int       @map("difficulty_tier")
  starsEarned     Int       @map("stars_earned")
  questionsAsked  Int       @map("questions_asked")
  correctAnswers  Int       @map("correct_answers")
  bestStreak      Int       @map("best_streak")
  hintsUsed       Int       @default(0) @map("hints_used")
  avgResponseMs   Int       @default(0) @map("avg_response_ms")
  durationSecs    Int       @map("duration_secs")
  completed       Boolean   @default(false)
  levelAdvanced   Boolean   @default(false) @map("level_advanced")
  levelBefore     Int       @map("level_before")
  levelAfter      Int       @map("level_after")
  startedAt       DateTime  @map("started_at")
  endedAt         DateTime? @map("ended_at")

  @@map("game_sessions")
}

model DailyMission {
  id          String   @id @default(uuid())
  childId     String   @map("child_id")
  date        String                      // "2026-03-16"
  missions    Json                        // [{type:"answer_3",target:3,progress:2,done:false}]
  completed   Boolean  @default(false)    // all missions done

  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([childId, date])
  @@map("daily_missions")
}
```

---

## 7. API Endpoints (manager-api-node)

```
# Progress
GET    /toy/game/progress/:childId/:gameType     → current progress + difficulty tier
GET    /toy/game/progress/:childId               → all game progress for child
POST   /toy/game/session/end                      → save session + update progress + check achievements

# Streaks
GET    /toy/game/streak/:childId                  → current streak info
POST   /toy/game/streak/:childId/freeze           → use a streak freeze

# Achievements
GET    /toy/game/achievements/:childId            → all achievements
POST   /toy/game/achievements/:childId/announce   → mark achievements as announced

# Daily Missions
GET    /toy/game/missions/:childId                → today's missions (auto-generate if none)
POST   /toy/game/missions/:childId/progress       → update mission progress

# Leaderboard (future)
GET    /toy/game/leaderboard/:gameType            → top players (optional, for older kids)
```

### 7.1 Session End Payload

```json
POST /toy/game/session/end
{
  "childId": "child_123",
  "gameType": "oddoneout",
  "ageBand": "explorer",
  "level": 12,
  "starsEarned": 4,
  "questionsAsked": 5,
  "correctAnswers": 4,
  "bestStreak": 4,
  "hintsUsed": 1,
  "avgResponseMs": 4200,
  "durationSecs": 180,
  "completed": true,
  "answers": [true, true, true, false, true]
}
```

### 7.2 Session End Response

```json
{
  "progress": {
    "level": 13,
    "levelAdvanced": true,
    "difficultyTier": 3,
    "totalStars": 89,
    "milestone": { "name": "Shooting Star", "level": 15, "distance": 2 }
  },
  "streak": {
    "current": 14,
    "longest": 14,
    "isNew": true,
    "milestone": null
  },
  "achievements": [
    { "code": "streak_14", "name": "Fortnight Hero", "announced": false }
  ],
  "dailyMission": {
    "progress": [
      { "type": "answer_3_oddoneout", "target": 3, "progress": 3, "done": true }
    ],
    "allComplete": true,
    "weeklyChain": 5
  },
  "review": null
}
```

---

## 8. Game Engine Integration

### 8.1 Shared ProgressClient (Python)

```python
# src/shared/progress_client.py
# Used by all game engines to load/save progress

class ProgressClient:
    """HTTP client for game progression API."""

    def __init__(self, base_url: str, service_key: str):
        self.base_url = base_url
        self.service_key = service_key

    async def get_progress(self, child_id: str, game_type: str) -> dict
    async def end_session(self, session_data: dict) -> dict
    async def get_streak(self, child_id: str) -> dict
    async def get_unannounced_achievements(self, child_id: str) -> list
    async def mark_achievements_announced(self, child_id: str, codes: list) -> None
    async def get_daily_missions(self, child_id: str) -> dict
    async def update_mission_progress(self, child_id: str, event: str) -> dict
```

### 8.2 Engine Changes (all 3 games)

```python
# At session start (in engine.__init__ or start_game):
progress = await self.progress_client.get_progress(child_id, game_type)
self.state.level = progress["level"]
self.state.difficulty_tier = progress["difficultyTier"]

# Narrator announces streak + achievements:
streak = await self.progress_client.get_streak(child_id)
achievements = await self.progress_client.get_unannounced_achievements(child_id)

# At session end:
result = await self.progress_client.end_session({...})
if result["progress"]["levelAdvanced"]:
    await self.narrator.announce_level_up(result["progress"]["level"])
for ach in result["achievements"]:
    await self.narrator.announce_achievement(ach)
```

### 8.3 Difficulty Tier → Question Generator

```python
# Question generators receive difficulty_tier (1-5) and age_band
# Tier maps to question complexity:

TIER_CONFIG = {
    1: {"num_options": 3, "hint_delay": 20, "timeout": 45, "types": ["category"]},
    2: {"num_options": 3, "hint_delay": 15, "timeout": 35, "types": ["category", "color"]},
    3: {"num_options": 4, "hint_delay": 15, "timeout": 30, "types": ["category", "color", "size"]},
    4: {"num_options": 4, "hint_delay": 12, "timeout": 25, "types": ["category", "function", "abstract"]},
    5: {"num_options": 4, "hint_delay": 10, "timeout": 20, "types": ["category", "function", "abstract", "wordplay", "tricky"]},
}
```

---

## 9. Implementation Plan

### Phase 1: Database + API (backend only, no game changes)

**Task 1:** Prisma migration — create all 5 tables
**Task 2:** Progress routes + service (GET/POST progress)
**Task 3:** Streak routes + service (GET streak, POST freeze)
**Task 4:** Achievement routes + service (GET achievements, POST announce)
**Task 5:** Session end logic (update progress + streak + check achievements)
**Task 6:** Daily mission generator + routes

### Phase 2: Python shared client + engine wiring

**Task 7:** ProgressClient (Python HTTP client)
**Task 8:** Wire into OddOneOut engine (load progress, save session, announce)
**Task 9:** Wire into YesNo engine
**Task 10:** Wire into Math engine
**Task 11:** Difficulty tier → question generator mapping

### Phase 3: Narrator integration

**Task 12:** Streak announcement at session start
**Task 13:** Achievement announcement (mid-session + start)
**Task 14:** Level-up celebration with milestone names
**Task 15:** Effort-based praise (prompt engineering)
**Task 16:** Mentor reversal mode (every ~5th session)

### Phase 4: Engagement mechanics

**Task 17:** Variable ratio surprise rewards
**Task 18:** Daily mission checking mid-session
**Task 19:** Audio celebration hierarchy (SFX tiers)
**Task 20:** Spaced repetition review flow

### Phase 5: Frontend

**Task 21:** Progress display in React dashboard
**Task 22:** Achievement gallery
**Task 23:** Streak display
**Task 24:** Level milestone animations

---

## 10. Testing Strategy

### Smoke Test: Advancement Heuristic
```
1. Simulate 10 correct answers → should ADVANCE
2. Simulate 10 wrong answers → should DROP
3. Simulate mixed (6/10 correct) → should STAY
4. Simulate < 10 total → should STAY (not enough data)
```

### Integration Test: Full Session Flow
```
1. Start session with no existing progress → level 1, tier 1
2. Complete 5/5 correct → POST session end
3. Verify: level advanced, stars updated, streak incremented
4. Verify: "first_star" achievement created
5. Start new session → verify progress loaded correctly
6. Verify: streak announced, achievement announced + marked
```

### Edge Cases
```
- Child plays at 11:59 PM, session ends at 12:01 AM → streak for which day?
  → Use session START date for streak
- Child disconnects mid-session → partial save via LiveKit metadata
  → On reconnect, resume from metadata, don't double-count
- Child plays same game twice in one day → streak only increments once
  → lastPlayedDate check prevents double increment
- Level drops below 1 → floor at 1
- Streak freeze with 0 freezes → no-op, streak resets
```
