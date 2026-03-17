-- Game Progression System Tables
-- Created: 2026-03-17

CREATE TABLE IF NOT EXISTS game_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id VARCHAR(100) NOT NULL,
  game_type VARCHAR(50) NOT NULL,
  level INT NOT NULL DEFAULT 1,
  age_band VARCHAR(20) NOT NULL DEFAULT 'seedling',
  difficulty_tier INT NOT NULL DEFAULT 1,
  total_stars INT NOT NULL DEFAULT 0,
  total_played INT NOT NULL DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0,
  total_correct INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  recent_window JSONB NOT NULL DEFAULT '[]',
  avg_response_ms INT NOT NULL DEFAULT 0,
  mastered BOOLEAN NOT NULL DEFAULT false,
  mastered_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  review_stage INT NOT NULL DEFAULT 0,
  reviews_skipped INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, game_type)
);
CREATE INDEX IF NOT EXISTS idx_game_progress_child ON game_progress(child_id);

CREATE TABLE IF NOT EXISTS child_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id VARCHAR(100) NOT NULL UNIQUE,
  current_streak INT NOT NULL DEFAULT 0,
  longest_streak INT NOT NULL DEFAULT 0,
  last_played_date VARCHAR(10),
  streak_freezes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL,
  game_type VARCHAR(50),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  announced BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(child_id, code)
);
CREATE INDEX IF NOT EXISTS idx_game_achievements_child ON game_achievements(child_id);

CREATE TABLE IF NOT EXISTS game_session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id VARCHAR(100) NOT NULL,
  game_type VARCHAR(50) NOT NULL,
  age_band VARCHAR(20) NOT NULL,
  level INT NOT NULL,
  difficulty_tier INT NOT NULL,
  stars_earned INT NOT NULL,
  questions_asked INT NOT NULL,
  correct_answers INT NOT NULL,
  best_streak INT NOT NULL,
  hints_used INT NOT NULL DEFAULT 0,
  avg_response_ms INT NOT NULL DEFAULT 0,
  duration_secs INT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  level_before INT NOT NULL,
  level_after INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_game_session_logs_child ON game_session_logs(child_id);
CREATE INDEX IF NOT EXISTS idx_game_session_logs_child_game ON game_session_logs(child_id, game_type);

CREATE TABLE IF NOT EXISTS daily_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id VARCHAR(100) NOT NULL,
  date VARCHAR(10) NOT NULL,
  missions JSONB NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_missions_child ON daily_missions(child_id);
