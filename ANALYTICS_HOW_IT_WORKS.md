# Analytics System - How It Works

## Question 1: When is `analytics_user_progress` table updated?

### Answer: AUTOMATICALLY when sessions end or streaks are completed

The `analytics_user_progress` table is **automatically calculated and updated** by the Java backend. You **DON'T need to insert data** into this table manually.

### Update Triggers:

#### 1. **When a Session Ends** ✅
- **File:** `AnalyticsServiceImpl.java` (line 108-110)
- **What happens:** When `/analytics/session/end` is called, the system:
  1. Saves session end time
  2. Calculates session duration
  3. **Automatically calls `updateUserProgress(macAddress, modeType)`**
  4. This recalculates ALL stats for that user+mode combination

#### 2. **When a Streak is Completed** ✅
- **File:** `AnalyticsServiceImpl.java` (line 178-180)
- **What happens:** When `/analytics/streak` is called, the system:
  1. Records the streak
  2. **Automatically calls `updateUserProgressWithStreak()`**
  3. Updates longest streak and average streak time

### What Gets Calculated:

The system automatically aggregates data from other tables:

```java
// From analytics_game_sessions table:
- totalSessions          // COUNT of all sessions
- totalTimeSeconds       // SUM of all session durations
- totalInteractions      // SUM of all interaction counts

// From analytics_game_attempts table (for games only):
- successRatePercentage  // (Correct answers / Total answers) × 100
- skillLevel             // "beginner" (<50%), "intermediate" (50-80%), "advanced" (>80%)

// From analytics_streaks table:
- longestStreak          // Highest streak achieved
- totalStreaksCompleted  // COUNT of all streaks
- averageStreakTimeSeconds // AVERAGE time to complete streaks

// Timestamps:
- lastPlayedAt           // Last activity timestamp
- updatedAt              // Last update timestamp
```

### Current State:

**Why is the table empty right now?**
- ✅ Sessions are being tracked (`analytics_game_sessions`)
- ✅ Attempts are being tracked (`analytics_game_attempts`)
- ✅ Streaks are being tracked (`analytics_streaks`)
- ❌ BUT the progress table is only updated **when sessions END**

**To populate the table:**
1. Start a session (calls `/analytics/session/start`)
2. Play the game (records attempts)
3. **END the session** (calls `/analytics/session/end`) ← This triggers the update!

---

## Question 2: How is conversation start/end time calculated?

### Answer: Start time = when session starts, End time = when session ends

### Conversation Start Time:

**Where:** `AnalyticsServiceImpl.java` line 77
**Table:** `analytics_game_sessions.started_at`

```java
// When startSession() is called:
entity.setStartedAt(new Date());  // Current timestamp
```

**LiveKit Server calls this at:**
- `main.py` line 1007: When agent starts
- `media_api.py` line 656: When music mode starts
- `media_api.py` line 1144: When story mode starts

### Conversation End Time:

**Where:** `AnalyticsServiceImpl.java` line 96
**Table:** `analytics_game_sessions.ended_at`

```java
// When endSession() is called:
entity.setEndedAt(new Date());  // Current timestamp
```

**LiveKit Server calls this at:**
- `main.py` line 905: When agent session ends
- `media_api.py` line 680: When music session ends
- `media_api.py` line 1167: When story session ends

### Duration Calculation:

**Where:** `AnalyticsServiceImpl.java` line 100-102
**Table:** `analytics_game_sessions.duration_seconds`

```java
// Automatically calculated when session ends:
if (entity.getStartedAt() != null && entity.getEndedAt() != null) {
    long durationMs = entity.getEndedAt().getTime() - entity.getStartedAt().getTime();
    entity.setDurationSeconds((int) (durationMs / 1000));
}
```

**Formula:** `duration_seconds = (ended_at - started_at) / 1000`

---

## Question 3: Where is it stored?

### Storage Location: `analytics_game_sessions` table

**Table Schema:**
```sql
CREATE TABLE analytics_game_sessions (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id          VARCHAR(50) NOT NULL,
    mac_address         VARCHAR(50),
    agent_id            VARCHAR(32),
    mode_type           VARCHAR(50),
    started_at          DATETIME(3) NOT NULL,      ← START TIME
    ended_at            DATETIME(3),               ← END TIME
    duration_seconds    INT,                       ← CALCULATED DURATION
    interaction_count   INT DEFAULT 0,
    completion_status   VARCHAR(20),
    metadata            JSON,
    created_at          DATETIME(3),
    updated_at          DATETIME(3)
);
```

### Example Data:

```
┌────┬──────────────────┬───────────────────┬──────────────┬────────────────────────┬────────────────────────┬──────────────────┬─────────────┐
│ id │ session_id       │ mac_address       │ mode_type    │ started_at             │ ended_at               │ duration_seconds │ status      │
├────┼──────────────────┼───────────────────┼──────────────┼────────────────────────┼────────────────────────┼──────────────────┼─────────────┤
│ 1  │ session_abc123   │ AA:BB:CC:DD:EE:FF │ math_tutor   │ 2025-11-22 10:00:00    │ 2025-11-22 10:05:30    │ 330              │ victory     │
│ 2  │ session_def456   │ AA:BB:CC:DD:EE:FF │ music        │ 2025-11-22 10:10:00    │ 2025-11-22 10:25:00    │ 900              │ completed   │
│ 3  │ session_ghi789   │ AA:BB:CC:DD:EE:FF │ riddle_solver│ 2025-11-22 11:00:00    │ 2025-11-22 11:08:15    │ 495              │ interrupted │
└────┴──────────────────┴───────────────────┴──────────────┴────────────────────────┴────────────────────────┴──────────────────┴─────────────┘

Conversation start time: started_at column
Conversation end time:   ended_at column
Duration (auto-calc):    duration_seconds = (ended_at - started_at) / 1000
```

---

## Complete Workflow Example:

### Scenario: User plays Math game for 5 minutes

```javascript
// 1. User opens app → Agent starts → Session begins
// LiveKit Server (main.py:1007):
await analytics_service.start_session("math_tutor")

// Backend (Java):
POST /analytics/session/start
{
  "sessionId": "session_123",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "modeType": "math_tutor"
}

// Database INSERT into analytics_game_sessions:
started_at = 2025-11-22 10:00:00.000  ← RECORDED!
ended_at = NULL  (not ended yet)
duration_seconds = NULL  (not calculated yet)


// 2. User answers questions (records attempts)
POST /analytics/game-attempt (called multiple times)
{
  "sessionId": "session_123",
  "isCorrect": true,
  ...
}


// 3. User completes streak of 5
POST /analytics/streak
{
  "sessionId": "session_123",
  "gameType": "math_tutor",
  "streakNumber": 1,
  "questionsInStreak": 5
}
// This automatically updates analytics_user_progress with streak data!


// 4. User closes app → Session ends
// LiveKit Server (main.py:905):
await analytics_service.end_session("victory")

// Backend (Java):
POST /analytics/session/end?sessionId=session_123&completionStatus=victory

// Database UPDATE analytics_game_sessions:
ended_at = 2025-11-22 10:05:30.000  ← RECORDED!
duration_seconds = 330  ← AUTO-CALCULATED! (5 min 30 sec)
completion_status = "victory"

// 5. AUTOMATIC: updateUserProgress() is called
// This recalculates ALL stats for this user+mode:
SELECT SUM(duration_seconds) FROM analytics_game_sessions
WHERE mac_address = 'AA:BB:CC:DD:EE:FF' AND mode_type = 'math_tutor';

SELECT COUNT(*) FROM analytics_game_sessions
WHERE mac_address = 'AA:BB:CC:DD:EE:FF' AND mode_type = 'math_tutor';

... etc ...

// Database INSERT/UPDATE analytics_user_progress:
{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "modeType": "math_tutor",
  "totalSessions": 15,          ← COUNT of all sessions
  "totalTimeSeconds": 4500,     ← SUM of all durations (75 minutes total)
  "totalInteractions": 80,      ← SUM of all interactions
  "successRatePercentage": 87.5,← Correct/Total * 100
  "longestStreak": 5,           ← From analytics_streaks
  "skillLevel": "advanced",     ← Based on success rate
  "lastPlayedAt": "2025-11-22 10:05:30"
}
```

---

## Summary Table:

| What | Where Stored | When Recorded | How Calculated |
|------|--------------|---------------|----------------|
| **Conversation Start Time** | `analytics_game_sessions.started_at` | When session starts | `new Date()` when POST /session/start |
| **Conversation End Time** | `analytics_game_sessions.ended_at` | When session ends | `new Date()` when POST /session/end |
| **Duration** | `analytics_game_sessions.duration_seconds` | When session ends | `(ended_at - started_at) / 1000` |
| **User Progress Stats** | `analytics_user_progress` table | When session ends OR streak recorded | Auto-aggregated from sessions/attempts/streaks |

---

## Key Points:

1. ✅ **Start/End times are ALWAYS recorded** in `analytics_game_sessions` table
2. ✅ **Duration is AUTO-CALCULATED** when session ends (you don't need to send it)
3. ✅ **User progress is AUTO-UPDATED** when session ends (you don't need to call it)
4. ✅ **LiveKit Server handles all analytics calls** - your app just needs to use the LiveKit SDK
5. ⚠️ **Progress table only updates when sessions END** - so make sure to call `end_session()`!

---

## To Check If It's Working:

### Step 1: Check if sessions are being recorded
```sql
SELECT * FROM analytics_game_sessions
WHERE mac_address = 'YOUR_MAC_ADDRESS'
ORDER BY started_at DESC
LIMIT 10;
```

### Step 2: Check if sessions have end times
```sql
SELECT session_id, started_at, ended_at, duration_seconds
FROM analytics_game_sessions
WHERE ended_at IS NOT NULL;
```

### Step 3: Check if progress is being updated
```sql
SELECT * FROM analytics_user_progress
WHERE mac_address = 'YOUR_MAC_ADDRESS';
```

If progress table is empty but sessions table has data with `ended_at = NULL`, that means sessions are not being ended properly!

---

**Document Version:** 1.0
**Last Updated:** November 22, 2025
