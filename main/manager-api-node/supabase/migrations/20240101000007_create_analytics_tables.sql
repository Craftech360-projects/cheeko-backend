-- Migration: Create Analytics Tables
-- Description: Game sessions, attempts, media playback, and user progress

-- =============================================
-- analytics_game_sessions - Game session tracking
-- =============================================
CREATE TABLE IF NOT EXISTS analytics_game_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    mac_address VARCHAR(20) NOT NULL,
    agent_id VARCHAR(36),
    mode_type VARCHAR(50) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    interaction_count INTEGER DEFAULT 0,
    completion_status VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_game_sessions_session ON analytics_game_sessions(session_id);
CREATE INDEX idx_analytics_game_sessions_mac ON analytics_game_sessions(mac_address);
CREATE INDEX idx_analytics_game_sessions_agent ON analytics_game_sessions(agent_id);
CREATE INDEX idx_analytics_game_sessions_mode ON analytics_game_sessions(mode_type);
CREATE INDEX idx_analytics_game_sessions_started ON analytics_game_sessions(started_at);

COMMENT ON TABLE analytics_game_sessions IS 'Game session tracking';
COMMENT ON COLUMN analytics_game_sessions.mode_type IS 'Conversation, Math, Riddle, WordLadder, Music, Story';
COMMENT ON COLUMN analytics_game_sessions.completion_status IS 'completed, interrupted, switched, victory, failure';
COMMENT ON COLUMN analytics_game_sessions.metadata IS 'Mode-specific data';

-- =============================================
-- analytics_game_attempts - Individual game attempts
-- =============================================
CREATE TABLE IF NOT EXISTS analytics_game_attempts (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    mac_address VARCHAR(20) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    question_text TEXT,
    question_type VARCHAR(100),
    difficulty_level VARCHAR(20),
    correct_answer VARCHAR(500),
    user_answer VARCHAR(500),
    is_correct BOOLEAN,
    attempt_number SMALLINT DEFAULT 1,
    response_time_ms INTEGER,
    answered_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_game_attempts_session ON analytics_game_attempts(session_id);
CREATE INDEX idx_analytics_game_attempts_mac ON analytics_game_attempts(mac_address);
CREATE INDEX idx_analytics_game_attempts_game ON analytics_game_attempts(game_type);
CREATE INDEX idx_analytics_game_attempts_correct ON analytics_game_attempts(is_correct);

COMMENT ON TABLE analytics_game_attempts IS 'Individual game answer attempts';
COMMENT ON COLUMN analytics_game_attempts.game_type IS 'math_tutor, riddle_solver, word_ladder';
COMMENT ON COLUMN analytics_game_attempts.question_type IS 'addition, subtraction, animal-riddle, etc.';
COMMENT ON COLUMN analytics_game_attempts.difficulty_level IS 'easy, medium, hard';
COMMENT ON COLUMN analytics_game_attempts.attempt_number IS '1 or 2 (retry)';

-- =============================================
-- analytics_media_playback - Music/story playback
-- =============================================
CREATE TABLE IF NOT EXISTS analytics_media_playback (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100),
    mac_address VARCHAR(20) NOT NULL,
    media_type VARCHAR(50) NOT NULL,
    media_id VARCHAR(100),
    media_title VARCHAR(500),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_played_seconds INTEGER,
    total_duration_seconds INTEGER,
    completion_percentage NUMERIC(5, 2),
    skip_action VARCHAR(50),
    skipped_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_media_playback_session ON analytics_media_playback(session_id);
CREATE INDEX idx_analytics_media_playback_mac ON analytics_media_playback(mac_address);
CREATE INDEX idx_analytics_media_playback_type ON analytics_media_playback(media_type);
CREATE INDEX idx_analytics_media_playback_started ON analytics_media_playback(started_at);

COMMENT ON TABLE analytics_media_playback IS 'Music and story playback tracking';
COMMENT ON COLUMN analytics_media_playback.media_type IS 'music or story';
COMMENT ON COLUMN analytics_media_playback.skip_action IS 'next, previous, stop, or NULL';
COMMENT ON COLUMN analytics_media_playback.completion_percentage IS '0-100';

-- =============================================
-- analytics_streaks - Game streak tracking
-- =============================================
CREATE TABLE IF NOT EXISTS analytics_streaks (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    mac_address VARCHAR(20) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    streak_number INTEGER NOT NULL,
    questions_in_streak INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_analytics_streaks_session ON analytics_streaks(session_id);
CREATE INDEX idx_analytics_streaks_mac ON analytics_streaks(mac_address);
CREATE INDEX idx_analytics_streaks_game ON analytics_streaks(game_type);

COMMENT ON TABLE analytics_streaks IS 'Game streak records';
COMMENT ON COLUMN analytics_streaks.streak_number IS 'Streak sequence (1, 2, 3...)';
COMMENT ON COLUMN analytics_streaks.questions_in_streak IS 'Consecutive correct answers';

-- =============================================
-- analytics_user_progress - Aggregated user stats
-- =============================================
CREATE TABLE IF NOT EXISTS analytics_user_progress (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(20) NOT NULL,
    mode_type VARCHAR(50) NOT NULL,
    total_sessions INTEGER DEFAULT 0,
    total_time_seconds BIGINT DEFAULT 0,
    total_interactions INTEGER DEFAULT 0,
    success_rate_percentage NUMERIC(5, 2),
    longest_streak INTEGER DEFAULT 0,
    total_streaks_completed INTEGER DEFAULT 0,
    average_streak_time_seconds INTEGER DEFAULT 0,
    skill_level VARCHAR(50) DEFAULT 'beginner',
    last_played_at TIMESTAMP WITH TIME ZONE,
    weekly_summary_json JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address, mode_type)
);

CREATE INDEX idx_analytics_user_progress_mac ON analytics_user_progress(mac_address);
CREATE INDEX idx_analytics_user_progress_mode ON analytics_user_progress(mode_type);
CREATE INDEX idx_analytics_user_progress_skill ON analytics_user_progress(skill_level);

COMMENT ON TABLE analytics_user_progress IS 'Aggregated user progress statistics';
COMMENT ON COLUMN analytics_user_progress.mode_type IS 'Math, Riddle, WordLadder, Music, Story, Conversation';
COMMENT ON COLUMN analytics_user_progress.skill_level IS 'beginner, intermediate, advanced';
COMMENT ON COLUMN analytics_user_progress.weekly_summary_json IS 'Dashboard data';
