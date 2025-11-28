# UI to Backend API Mapping - Analytics Screen

## Analysis of UI Design vs Backend Capabilities

---

## ✅ FULLY SUPPORTED (Can fetch directly)

### 1. **Learning Time (4h 20m)**
**UI Shows:** Total time spent today/this week/this month

**Backend API:**
```http
GET /analytics/usage/daily/{macAddress}?date=2025-11-22
GET /analytics/usage/weekly/{macAddress}
```

**Response Fields:**
```json
{
  "totalUsageSeconds": 15600,
  "totalUsageMinutes": 260,
  "totalUsageHours": 4.33
}
```

**Status:** ✅ **FULLY SUPPORTED**

---

### 2. **Success Rate (85%)**
**UI Shows:** Overall correctness percentage

**Backend API:**
```http
GET /analytics/user/{macAddress}/overall
```

**Or from individual games:**
```http
GET /analytics/user/{macAddress}/math
GET /analytics/user/{macAddress}/riddle
GET /analytics/user/{macAddress}/wordladder
```

**Response Fields:**
```json
{
  "successRatePercentage": 85.5
}
```

**How to calculate overall:**
- Option A: Get from `analytics_user_progress` table (aggregated across all games)
- Option B: Calculate average of all game success rates

**Status:** ✅ **FULLY SUPPORTED**

---

### 3. **Questions (142)**
**UI Shows:** Total number of questions answered

**Backend API:**
```http
GET /analytics/user-progress/{macAddress}
```

**Response Fields:**
```json
{
  "totalInteractions": 142  // Sum across all modes
}
```

**Or count from:**
```http
GET /analytics/attempts?macAddress={macAddress}&limit=1000
```

**Status:** ✅ **FULLY SUPPORTED**

---

### 4. **Weekly Activity Chart**
**UI Shows:** Bar chart with daily usage (Mon-Sun)

**Backend API:**
```http
GET /analytics/usage/weekly/{macAddress}
```

**Response Format:**
```json
[
  {
    "date": "2025-11-18",
    "totalUsageMinutes": 30,
    "sessionCount": 2
  },
  {
    "date": "2025-11-19",
    "totalUsageMinutes": 45,
    "sessionCount": 3
  },
  // ... 7 days total
]
```

**Map to UI:**
- X-axis: date → day of week (Mon, Tue, Wed...)
- Y-axis: totalUsageMinutes → bar height
- Average: Calculate from 7 days

**Status:** ✅ **FULLY SUPPORTED**

---

### 5. **Time by Activity**
**UI Shows:**
- Conversation: 2h 15m
- Music: 1h 45m
- Story: 3h 10m

**Backend API:**
```http
GET /analytics/usage/daily/{macAddress}
```

**Response Format:**
```json
{
  "breakdownByCharacter": {
    "conversation": {
      "seconds": 8100,
      "minutes": 135,
      "sessions": 3
    },
    "music": {
      "seconds": 6300,
      "minutes": 105,
      "sessions": 2
    },
    "story": {
      "seconds": 11400,
      "minutes": 190,
      "sessions": 4
    }
  }
}
```

**Status:** ✅ **FULLY SUPPORTED**

---

### 6. **Subject Mastery**
**UI Shows:**
- Math Tutor: Intermediate (progress bar)
- Riddle Solver: Advanced (progress bar)
- Word Ladder: Beginner (progress bar)

**Backend API:**
```http
GET /analytics/user-progress/{macAddress}
```

**Response Format:**
```json
[
  {
    "modeType": "math_tutor",
    "skillLevel": "intermediate",
    "successRatePercentage": 67.5
  },
  {
    "modeType": "riddle_solver",
    "skillLevel": "advanced",
    "successRatePercentage": 85.0
  },
  {
    "modeType": "word_ladder",
    "skillLevel": "beginner",
    "successRatePercentage": 45.0
  }
]
```

**Map to UI:**
- skillLevel: "beginner" / "intermediate" / "advanced"
- Progress bar fill: Use `successRatePercentage`

**Status:** ✅ **FULLY SUPPORTED**

---

### 7. **Recent Activity**
**UI Shows:**
- Math Session - 5/5 Correct - Just now - 12m
- Story Time - Completed - 2 hours ago - 25m
- Riddle Challenge - 3/5 Correct - Yesterday - 8m

**Backend API:**
```http
GET /analytics/sessions/{macAddress}?limit=10
```

**Response Format:**
```json
{
  "list": [
    {
      "modeType": "math_tutor",
      "startedAt": "2025-11-22T13:00:00",
      "endedAt": "2025-11-22T13:12:00",
      "durationSeconds": 720,
      "completionStatus": "victory",
      "interactionCount": 5
    },
    {
      "modeType": "story",
      "startedAt": "2025-11-22T11:00:00",
      "endedAt": "2025-11-22T11:25:00",
      "durationSeconds": 1500,
      "completionStatus": "completed"
    }
  ]
}
```

**Additional API for correct/incorrect count:**
```http
GET /analytics/attempts?sessionId={sessionId}
```

**Status:** ✅ **FULLY SUPPORTED** (requires 2 API calls per session for correct/incorrect count)

---

## ⚠️ PARTIALLY SUPPORTED (Need calculation/workaround)

### 8. **Best: 7 (in Active Streak card)**
**UI Shows:** Highest streak achieved

**Backend has:**
```http
GET /analytics/user-progress/{macAddress}/{modeType}
```

**Response:**
```json
{
  "longestStreak": 7  // But this is GAME streak (5 correct in a row), NOT daily login streak
}
```

**Problem:**
- Backend tracks **GAME STREAKS** (5 correct answers in a row within a session)
- UI shows **DAILY LOGIN STREAKS** (consecutive days active)
- These are DIFFERENT concepts!

**Workaround:**
- Use `longestStreak` but change UI label to "Best Game Streak" or "Longest Win Streak"
- OR ignore this field if you want daily login streaks

**Status:** ⚠️ **WRONG DATA TYPE** (game streak ≠ daily login streak)

---

## ❌ NOT SUPPORTED (Missing from backend)

### 9. **Active Streak (5 Days)**
**UI Shows:** Consecutive days user has been active

**Backend Status:** ❌ **NOT TRACKED**

**What we have:**
- Game streaks (5 correct in a row)
- Session data with dates

**What we DON'T have:**
- Daily login/activity tracking
- Consecutive days calculation

**Workaround Options:**

**Option A: Calculate from session data**
```sql
-- Find consecutive days with sessions
SELECT DATE(started_at) as activity_date
FROM analytics_game_sessions
WHERE mac_address = 'AA:BB:CC:DD:EE:FF'
GROUP BY DATE(started_at)
ORDER BY activity_date DESC;

-- App needs to calculate consecutive days from this
```

**Option B: Add new table (requires backend changes)**
```sql
CREATE TABLE analytics_daily_activity (
    id BIGINT PRIMARY KEY,
    mac_address VARCHAR(50),
    activity_date DATE,
    sessions_count INT,
    total_time_seconds INT,
    UNIQUE KEY (mac_address, activity_date)
);
```

**Status:** ❌ **NOT IMPLEMENTED** - Need to calculate client-side OR add new backend feature

---

### 10. **Percentage Changes (+12%, +5%, +24)**
**UI Shows:**
- Learning Time: +12%
- Success Rate: +5%
- Questions: +24

**Backend Status:** ❌ **NOT TRACKED**

**What we have:**
- Current values (today's time, current success rate, total questions)

**What we DON'T have:**
- Historical comparison data
- Previous period values
- Trend calculations

**Workaround:**
- Store previous period data in app/local storage
- Calculate percentage change client-side
- OR add new backend feature to track historical metrics

**Status:** ❌ **NOT IMPLEMENTED** - Need client-side calculation OR backend changes

---

## Summary Table

| UI Element | Backend Support | API Endpoint | Status |
|------------|----------------|--------------|--------|
| Learning Time (4h 20m) | ✅ Full | `/analytics/usage/daily/{mac}` | ✅ Ready |
| Success Rate (85%) | ✅ Full | `/analytics/user/{mac}/overall` | ✅ Ready |
| Questions (142) | ✅ Full | `/analytics/user-progress/{mac}` | ✅ Ready |
| Weekly Activity Chart | ✅ Full | `/analytics/usage/weekly/{mac}` | ✅ Ready |
| Time by Activity | ✅ Full | `/analytics/usage/daily/{mac}` | ✅ Ready |
| Subject Mastery | ✅ Full | `/analytics/user-progress/{mac}` | ✅ Ready |
| Recent Activity | ✅ Full | `/analytics/sessions/{mac}` | ✅ Ready |
| Best Streak (Best: 7) | ⚠️ Partial | `/analytics/user-progress/{mac}` | ⚠️ Different meaning |
| Active Streak (5 Days) | ❌ Missing | N/A | ❌ Need to build |
| % Changes (+12%, +5%) | ❌ Missing | N/A | ❌ Need to build |

---

## Recommendations

### Option 1: Use Current Backend (Minimal Changes)
**What works:**
- ✅ 7 out of 10 features work perfectly
- ⚠️ Change "Active Streak" to "Win Streak" (use game streak data)
- ❌ Remove percentage changes (or calculate client-side)

### Option 2: Add Missing Features (Backend Changes)
**Add these features:**
1. Daily login streak tracking
2. Historical metrics for trend analysis
3. New API endpoints:
   - `GET /analytics/daily-streak/{macAddress}` - Returns consecutive days active
   - `GET /analytics/trends/{macAddress}?period=week` - Returns comparison data

---

## Example API Calls for This UI

### Load Analytics Screen (Today View)
```javascript
// 1. Get today's usage
GET /analytics/usage/daily/{macAddress}
→ Returns: Learning Time (4h 20m), Time by Activity breakdown

// 2. Get overall stats
GET /analytics/user/{macAddress}/overall
→ Returns: Success Rate (85%), Total Questions (142)

// 3. Get subject mastery
GET /analytics/user-progress/{macAddress}
→ Returns: Math/Riddle/Word Ladder skill levels

// 4. Get recent activity
GET /analytics/sessions/{macAddress}?limit=5
→ Returns: Recent sessions list

// 5. For each recent session, get attempt details
GET /analytics/attempts?sessionId={sessionId}
→ Returns: Correct/incorrect count (5/5 Correct)

// ❌ Active Streak: Not available (need to build)
// ❌ % Changes: Not available (need to build)
```

### Load Analytics Screen (This Week View)
```javascript
// 1. Get weekly usage
GET /analytics/usage/weekly/{macAddress}
→ Returns: 7 days of data for chart + total learning time

// Rest same as above
```

---

## Final Answer

**Can we fetch everything from backend?**

| Answer | Count | Percentage |
|--------|-------|------------|
| ✅ Yes, fully supported | 7 items | 70% |
| ⚠️ Partially (wrong data type) | 1 item | 10% |
| ❌ No, not implemented | 2 items | 20% |

**Conclusion:**
- **70% of the UI is ready to implement** with current backend
- **10% needs label changes** (game streak vs daily streak)
- **20% requires new features** (daily login streak, trend analysis)

**Recommendation for app developer:**
Start implementing the 70% that works, then decide if you want to:
1. Modify the UI to match available data (easiest)
2. Add missing backend features (better long-term)

---

**Document Version:** 1.0
**Last Updated:** November 22, 2025
