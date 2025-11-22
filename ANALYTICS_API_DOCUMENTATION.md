# Analytics API Documentation for App Developers

## Overview
This document explains the analytics system for tracking user interactions with the Cheeko device. Use these APIs to record and retrieve user activity data.

---

## Authentication
**All analytics APIs require server authentication:**
- Add header: `secret: <your-server-secret>`
- OR header: `Authorization: Bearer <your-server-secret>`

Base URL: `https://your-api-url.com/analytics`

---

## 1. Game Sessions Tracking

### Table: `analytics_game_sessions`
**What it tracks:** Every session (conversation) with the device - Math games, Riddles, Music, Story, Chat, Word Ladder, etc.

**When to use:**
- START session when user begins any mode
- END session when user stops or switches mode

### APIs

#### Start a New Session
```http
POST /analytics/session/start
Content-Type: application/json

{
  "sessionId": "unique-session-id",      // Required: Generate unique ID
  "macAddress": "AA:BB:CC:DD:EE:FF",    // Required: Device MAC
  "agentId": "agent-123",                // Optional: Agent ID
  "modeType": "math_tutor"               // Required: See mode types below
}
```

**Mode Types:**
- `math_tutor` - Math game
- `riddle_solver` - Riddle game
- `word_ladder` - Word ladder game
- `music` - Music playback
- `story` - Story playback
- `conversation` - General chat

**Response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": "unique-session-id"
}
```

#### End a Session
```http
POST /analytics/session/end?sessionId=unique-session-id&completionStatus=completed
```

**Completion Status:**
- `completed` - User finished normally
- `interrupted` - User stopped mid-way
- `switched` - User switched to another mode
- `victory` - User won the game (5 correct in a row)
- `failure` - User failed/gave up

#### Get Session by ID
```http
GET /analytics/sessions/123
```

#### List All Sessions (with filters)
```http
GET /analytics/sessions?macAddress=AA:BB:CC:DD:EE:FF&modeType=math_tutor&page=1&limit=20
```

**Query Parameters:**
- `macAddress` (optional) - Filter by device
- `modeType` (optional) - Filter by mode
- `startDate` (optional) - Format: YYYY-MM-DD
- `endDate` (optional) - Format: YYYY-MM-DD
- `page` (optional, default: 1)
- `limit` (optional, default: 10)

---

## 2. Game Attempts Tracking

### Table: `analytics_game_attempts`
**What it tracks:** Each question/answer in Math, Riddle, or Word Ladder games (only statistics, NO text content)

**When to use:**
- Record AFTER each answer attempt in games
- Track correctness, response time, difficulty

### APIs

#### Record Game Attempt
```http
POST /analytics/game-attempt
Content-Type: application/json

{
  "sessionId": "unique-session-id",      // Required: From session start
  "macAddress": "AA:BB:CC:DD:EE:FF",    // Required
  "gameType": "math_tutor",              // Required: math_tutor, riddle_solver, word_ladder
  "questionType": "addition",            // Optional: addition, subtraction, etc.
  "difficultyLevel": "easy",             // Optional: easy, medium, hard
  "isCorrect": true,                     // Required: true/false
  "attemptNumber": 1,                    // Required: 1 or 2 (first attempt or retry)
  "responseTimeMs": 3500                 // Optional: Time taken in milliseconds
}
```

**Response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": null
}
```

#### Get Attempt by ID
```http
GET /analytics/attempts/123
```

#### List All Attempts (with filters)
```http
GET /analytics/attempts?macAddress=AA:BB:CC:DD:EE:FF&gameType=math_tutor&page=1&limit=20
```

**Query Parameters:**
- `macAddress` (optional)
- `sessionId` (optional)
- `gameType` (optional)
- `page` (optional, default: 1)
- `limit` (optional, default: 10)

---

## 3. Media Playback Tracking

### Table: `analytics_media_playback`
**What it tracks:** Music and Story playback events

**When to use:**
- Record when music/story starts playing
- Record when music/story ends or is skipped

### APIs

#### Record Media Playback
```http
POST /analytics/media-event
Content-Type: application/json

{
  "sessionId": "unique-session-id",           // Required
  "macAddress": "AA:BB:CC:DD:EE:FF",         // Required
  "mediaType": "music",                       // Required: "music" or "story"
  "mediaId": "song-123",                      // Optional: Song/Story ID
  "mediaTitle": "Twinkle Twinkle Little Star", // Optional
  "durationPlayedSeconds": 45,                // Optional: How long they listened
  "totalDurationSeconds": 120,                // Optional: Full media length
  "completionPercentage": 37.5,               // Optional: Calculated percentage
  "skipAction": "next"                        // Optional: "next", "previous", "stop", or null
}
```

#### Get Playback by ID
```http
GET /analytics/media-playback/123
```

#### List All Playbacks (with filters)
```http
GET /analytics/media-playback?macAddress=AA:BB:CC:DD:EE:FF&mediaType=music&page=1&limit=20
```

**Query Parameters:**
- `macAddress` (optional)
- `sessionId` (optional)
- `mediaType` (optional) - "music" or "story"
- `page` (optional, default: 1)
- `limit` (optional, default: 10)

---

## 4. Streak Tracking

### Table: `analytics_streaks`
**What it tracks:** When user completes a streak (5 correct answers in a row)

**When to use:**
- Record ONLY when user achieves 5 correct answers in a row
- Track how long it took to complete the streak

### APIs

#### Record Streak Completion
```http
POST /analytics/streak
Content-Type: application/json

{
  "sessionId": "unique-session-id",     // Required
  "macAddress": "AA:BB:CC:DD:EE:FF",   // Required
  "gameType": "math_tutor",             // Required: math_tutor, riddle_solver, word_ladder
  "streakNumber": 1,                    // Required: 1st streak, 2nd streak, etc.
  "questionsInStreak": 5,               // Required: Always 5 (streak requirement)
  "durationSeconds": 180                // Required: Time taken to complete streak
}
```

#### Get Streak by ID
```http
GET /analytics/streaks/123
```

#### List All Streaks (with filters)
```http
GET /analytics/streaks?macAddress=AA:BB:CC:DD:EE:FF&gameType=math_tutor&page=1&limit=20
```

**Query Parameters:**
- `macAddress` (optional)
- `sessionId` (optional)
- `gameType` (optional)
- `page` (optional, default: 1)
- `limit` (optional, default: 10)

---

## 5. User Progress Summary

### Table: `analytics_user_progress`
**What it tracks:** Aggregated stats per user per mode (auto-calculated, updated periodically)

**When to use:**
- READ ONLY - Don't create/update directly
- Server automatically updates this table
- Use for displaying user stats in app

### APIs

#### Update User Progress (Server Call)
```http
POST /analytics/user-progress/update?macAddress=AA:BB:CC:DD:EE:FF&modeType=math_tutor
```
**Note:** This is called automatically by server, but you can trigger manually if needed.

#### Get Progress for Specific Mode
```http
GET /analytics/user-progress/AA:BB:CC:DD:EE:FF/math_tutor
```

**Response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": 1,
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "modeType": "math_tutor",
    "totalSessions": 15,
    "totalTimeSeconds": 3600,
    "totalInteractions": 75,
    "successRatePercentage": 85.5,
    "longestStreak": 5,
    "totalStreaksCompleted": 3,
    "averageStreakTimeSeconds": 120,
    "skillLevel": "intermediate",
    "lastPlayedAt": "2025-11-22T10:30:00"
  }
}
```

#### Get All Progress for User
```http
GET /analytics/user-progress/AA:BB:CC:DD:EE:FF
```

**Response:** Array of progress for all modes the user has played.

---

## 6. Daily Usage Statistics

### What it tracks: Total device usage time per day with breakdown by character/mode

### APIs

#### Get Daily Usage
```http
GET /analytics/usage/daily/AA:BB:CC:DD:EE:FF?date=2025-11-22
```

**Query Parameters:**
- `date` (optional) - Format: YYYY-MM-DD, defaults to today

**Response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "date": "2025-11-22",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "totalUsageSeconds": 3600,
    "totalUsageMinutes": 60,
    "totalUsageHours": 1.00,
    "sessionCount": 5,
    "breakdownByCharacter": {
      "math_tutor": {
        "seconds": 1200,
        "minutes": 20,
        "sessions": 2
      },
      "music": {
        "seconds": 1500,
        "minutes": 25,
        "sessions": 2
      },
      "riddle_solver": {
        "seconds": 900,
        "minutes": 15,
        "sessions": 1
      }
    }
  }
}
```

#### Get Weekly Usage (Last 7 Days)
```http
GET /analytics/usage/weekly/AA:BB:CC:DD:EE:FF
```

**Response:** Array of daily usage for past 7 days

---

## 7. Additional Stats APIs

### Get Overall Stats
```http
GET /analytics/user/AA:BB:CC:DD:EE:FF/overall
```

Returns combined stats across all modes.

### Get Math Game Stats
```http
GET /analytics/user/AA:BB:CC:DD:EE:FF/math
```

### Get Riddle Game Stats
```http
GET /analytics/user/AA:BB:CC:DD:EE:FF/riddle
```

### Get Word Ladder Stats
```http
GET /analytics/user/AA:BB:CC:DD:EE:FF/wordladder
```

### Get Media Stats
```http
GET /analytics/user/AA:BB:CC:DD:EE:FF/media?mediaType=music
```

**Query Parameters:**
- `mediaType` (required) - "music" or "story"

### Get Recent Sessions
```http
GET /analytics/sessions/AA:BB:CC:DD:EE:FF?limit=30
```

**Query Parameters:**
- `limit` (optional, default: 30) - Number of recent sessions

---

## Typical Workflow Examples

### Example 1: Math Game Session

```javascript
// 1. User starts math game
POST /analytics/session/start
{
  "sessionId": "session_123",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "modeType": "math_tutor"
}

// 2. User answers question 1 (correct)
POST /analytics/game-attempt
{
  "sessionId": "session_123",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "gameType": "math_tutor",
  "questionType": "addition",
  "difficultyLevel": "easy",
  "isCorrect": true,
  "attemptNumber": 1,
  "responseTimeMs": 3000
}

// 3. User answers questions 2-5 (all correct)
// ... repeat POST /analytics/game-attempt for each ...

// 4. User completes streak of 5!
POST /analytics/streak
{
  "sessionId": "session_123",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "gameType": "math_tutor",
  "streakNumber": 1,
  "questionsInStreak": 5,
  "durationSeconds": 180
}

// 5. User ends session
POST /analytics/session/end?sessionId=session_123&completionStatus=victory
```

### Example 2: Music Playback

```javascript
// 1. User starts music session
POST /analytics/session/start
{
  "sessionId": "session_456",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "modeType": "music"
}

// 2. User plays a song
POST /analytics/media-event
{
  "sessionId": "session_456",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "mediaType": "music",
  "mediaId": "song-123",
  "mediaTitle": "Twinkle Twinkle",
  "durationPlayedSeconds": 45,
  "totalDurationSeconds": 120,
  "completionPercentage": 37.5,
  "skipAction": "next"
}

// 3. User ends music session
POST /analytics/session/end?sessionId=session_456&completionStatus=completed
```

### Example 3: Get User Dashboard Stats

```javascript
// Get today's usage
GET /analytics/usage/daily/AA:BB:CC:DD:EE:FF

// Get weekly trend
GET /analytics/usage/weekly/AA:BB:CC:DD:EE:FF

// Get math game progress
GET /analytics/user/AA:BB:CC:DD:EE:FF/math

// Get recent activity
GET /analytics/sessions/AA:BB:CC:DD:EE:FF?limit=10
```

---

## Database Tables Summary

| Table Name | Purpose | Records |
|------------|---------|---------|
| `analytics_game_sessions` | All sessions/conversations | When session starts/ends |
| `analytics_game_attempts` | Game questions/answers (stats only) | After each answer |
| `analytics_media_playback` | Music/story playback | When media plays |
| `analytics_streaks` | Completed streaks (5 in a row) | When streak achieved |
| `analytics_user_progress` | Aggregated user stats | Auto-updated by server |

---

## Important Notes

1. **NO TEXT CONTENT**: Analytics tracks only numbers/statistics. Never store question text, answers, or conversation content.

2. **Privacy**: Only store MAC address, no personal information.

3. **Streak = 5**: User must get **5 correct answers in a row** to complete a streak (not 3!).

4. **Session IDs**: Generate unique session IDs for each session (use timestamp + random).

5. **Error Handling**: All APIs return:
   - `code: 0` = success
   - `code: non-zero` = error (check `msg` field)

6. **Pagination**: Default is 10 items per page. Use `page` and `limit` parameters for large datasets.

---

## Need Help?

- Check API response `msg` field for error details
- Verify `secret` header is included
- Ensure MAC address format is correct: `AA:BB:CC:DD:EE:FF`
- Session ID must exist before recording attempts/streaks

---

**Document Version:** 1.0
**Last Updated:** November 22, 2025
