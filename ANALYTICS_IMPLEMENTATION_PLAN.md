# Analytics Implementation Plan

## Overview
This document outlines the backend implementation plan for capturing and storing analytics data for the Cheeko toy's game modes and usage patterns.

---

## Scope: What Will Be Implemented

We will implement analytics tracking for:
1. **Overall Usage Metrics** - How the toy is being used across all modes
2. **Math Solver Metrics** - Performance and engagement in math games
3. **Riddle Solver Metrics** - Performance and engagement in riddle games
4. **Word Ladder Metrics** - Performance and engagement in word ladder games
5. **Music/Story Metrics** - Listening behavior and preferences

---

## 1. Overall Usage Metrics

### What Will Be Captured:
- **Session Tracking**: Every time a child uses the toy, we'll record when they started, when they finished, and which mode they used
- **Active Time**: Total minutes spent with the toy per day/week/month
- **Mode Preferences**: Which modes are used most often (Conversation, Math, Riddle, Word Ladder, Music, Story)
- **Usage Patterns**: What time of day the toy is used most
- **Session Count**: How many play sessions happen per day/week/month
- **Mode Switching**: How often children switch between different modes

### How It Will Work:
- When a child starts interacting with the toy, we create a session record with a start timestamp
- When they stop or switch modes, we save the end timestamp and calculate the duration
- All this data is stored in a database table called `game_sessions`

### What You Can See Later:
- "Child played for 45 minutes today across 3 sessions"
- "Most used mode this week: Math Solver"
- "Peak usage time: 4-6 PM"
- "Switched between modes 12 times this week"

---

## 2. Math Solver Metrics

### What Will Be Captured:
- **Questions Asked**: Every math question presented to the child
- **Answers Given**: What the child answered (both correct and incorrect)
- **Correctness**: Whether each answer was right or wrong
- **Time Taken**: How long the child took to answer each question
- **Question Type**: What operation was being practiced (addition, subtraction, multiplication, division)
- **Attempt Count**: Whether they got it right on the first try or needed a second attempt
- **Session Performance**: Total correct vs incorrect per session

### How It Will Work:
- Every time a math question is asked, we record it with a timestamp
- When the child answers, we record their response, whether it's correct, and how long they took
- If they need a retry (second attempt), we track that too
- All this data is stored in a table called `game_attempts` with type='math_tutor'

### What You Can See Later:
- "Child answered 25 math questions this week with 80% accuracy"
- "Strongest skill: Addition (95% correct)"
- "Needs practice: Subtraction (60% correct)"
- "Average time per question: 8 seconds"
- "Got 18 questions right on first try, 7 needed a second attempt"

---

## 3. Riddle Solver Metrics

### What Will Be Captured:
- **Riddles Presented**: Every riddle asked
- **Answers Given**: What the child guessed
- **Correctness**: Whether they solved it or not
- **Time Taken**: How long to solve each riddle
- **Attempt Count**: First try vs second try success
- **Session Performance**: Riddles attempted vs riddles solved

### How It Will Work:
- Same as math - every riddle interaction is recorded
- We track the riddle text, correct answer, user's answer, correctness, and timing
- Stored in `game_attempts` table with type='riddle_solver'

### What You Can See Later:
- "Child attempted 15 riddles this week, solved 12 (80% success rate)"
- "Average time to solve: 12 seconds"
- "Best streak: 3 riddles in a row"
- "Needed second attempts: 4 riddles"

---

## 4. Word Ladder Metrics

### What Will Be Captured:
- **Games Played**: Each word ladder game session
- **Word Chain**: The complete sequence of words the child created
- **Moves Made**: How many words in the ladder
- **Success/Failure**: Whether they completed the game or failed
- **Invalid Moves**: When they said a word that didn't work
- **Longest Ladder**: Best performance (most words successfully chained)

### How It Will Work:
- Each word ladder game creates a session record
- Every word the child says is validated and recorded
- We track whether it was a valid move or not
- Final game outcome (victory or gave up after failures) is saved
- Stored in `game_attempts` with type='word_ladder'

### What You Can See Later:
- "Child played 8 word ladder games this week"
- "Completed 6 successfully (75% win rate)"
- "Longest ladder achieved: 7 words"
- "Average ladder length: 5 words"
- "Total vocabulary words used: 45 unique words"

---

## 5. Music/Story Metrics

### What Will Be Captured:
- **Songs/Stories Played**: Which content was selected
- **Play Duration**: How long each song/story was listened to
- **Completion Rate**: Did they listen to the full song/story or skip it?
- **Skip Behavior**: How often they press next/previous buttons
- **Favorites**: Most frequently played songs/stories
- **Total Listening Time**: Total minutes spent listening per day/week

### How It Will Work:
- When a song or story starts playing, we record the start time and content ID
- When it ends (or is skipped), we record the end time
- We calculate how much was actually listened to vs the total duration
- If they press next/previous/stop, we track that as a skip event
- All stored in a table called `media_playback_events`

### What You Can See Later:
- "Child listened to 12 songs this week (total 35 minutes)"
- "Most played song: 'Twinkle Twinkle' (played 5 times)"
- "Story completion rate: 85% (listened fully to most stories)"
- "Skipped songs: 3 times"
- "Favorite story: 'The Little Elephant' (played 4 times)"

---

## Database Changes

### New Tables to Be Created:
1. **`game_sessions`** - Stores every play session (when, how long, which mode)
2. **`game_attempts`** - Stores every question/answer/move for Math/Riddle/WordLadder
3. **`media_playback_events`** - Stores every song/story played
4. **`user_progress`** - Stores summarized statistics per user (updated automatically)

### Existing Tables:
- No changes to existing tables
- Chat history continues to work as-is

---

## API Endpoints (New)

### For Recording Data (Backend will call these):
- `POST /analytics/session/start` - Start tracking a new session
- `POST /analytics/session/end` - End session and save duration
- `POST /analytics/game-attempt` - Record a question/answer/move
- `POST /analytics/media-event` - Record song/story playback

### For Retrieving Analytics (Apps/Dashboard can call these):
- `GET /analytics/user/{macAddress}/overall` - Get overall usage stats
- `GET /analytics/user/{macAddress}/math` - Get math performance stats
- `GET /analytics/user/{macAddress}/riddle` - Get riddle performance stats
- `GET /analytics/user/{macAddress}/wordladder` - Get word ladder stats
- `GET /analytics/user/{macAddress}/media` - Get music/story listening stats
- `GET /analytics/sessions/{macAddress}` - Get session history (last 30 days)

---

## What Gets Modified

### Backend (Manager-API - Java):
- Add 1 new database migration file (creates 4 tables)
- Add 4 new Java entity classes (represent the tables)
- Add 4 new repository interfaces (database access)
- Add 1 analytics service class (business logic)
- Add analytics endpoints to controller (REST APIs)

### Agent (LiveKit-Server - Python):
- Create 1 new analytics service module
- Modify math game function to send attempt data
- Modify riddle game function to send attempt data
- Modify word ladder game function to send move data
- Modify music/story playback to send media events
- Track session start/end times

### What Stays Unchanged:
- Game logic (how games work) - no changes
- Chat functionality - no changes
- Existing APIs - no changes
- Database structure for other features - no changes

---

## Privacy & Data Storage

- All data is linked to the device MAC address (not personal information)
- Only gameplay metrics are stored (no audio recordings or sensitive data)
- Data can be deleted on request
- Analytics are aggregated and anonymized for insights

---

## Timeline Estimate

- **Database schema creation**: 1-2 hours
- **Java backend (entities, repos, services, APIs)**: 4-6 hours
- **Python agent integration**: 3-4 hours
- **Testing and validation**: 2-3 hours

**Total estimated effort**: 10-15 hours of development

---

## What This Enables in the Future

Once this is implemented, you can:
- Build a parent dashboard showing child's learning progress
- Generate weekly learning reports
- Identify which skills need more practice
- Show engagement trends and usage patterns
- Understand content preferences (favorite songs/stories)
- Track learning improvement over time
- Export data for reports or charts

---

## Summary

This implementation will create a complete analytics foundation for the Cheeko toy, capturing all gameplay interactions and usage patterns without changing how the toy currently works. The data will be stored securely and can be retrieved through simple API calls for dashboards, reports, or mobile apps.
