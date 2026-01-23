-- Add Analytics tables

-- Game Sessions
CREATE TABLE IF NOT EXISTS analytics_game_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    mac_address VARCHAR(50) NOT NULL,
    agent_id UUID,
    mode_type VARCHAR(50) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    interaction_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_mac ON analytics_game_sessions(mac_address);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_game_sessions(started_at);

-- Game Attempts
CREATE TABLE IF NOT EXISTS analytics_game_attempts (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    question TEXT,
    user_answer TEXT,
    correct_answer TEXT,
    is_correct BOOLEAN,
    attempt_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_attempts_session ON analytics_game_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_attempts_mac ON analytics_game_attempts(mac_address);

-- Media Playback
CREATE TABLE IF NOT EXISTS analytics_media_playback (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    content_id BIGINT,
    content_type VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    position_seconds INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_media_mac ON analytics_media_playback(mac_address);
CREATE INDEX IF NOT EXISTS idx_analytics_media_content ON analytics_media_playback(content_id);

-- Streaks
CREATE TABLE IF NOT EXISTS analytics_streaks (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    streak_type VARCHAR(50) NOT NULL,
    streak_date DATE NOT NULL,
    streak_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address, streak_type, streak_date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_streaks_mac ON analytics_streaks(mac_address);

-- User Progress
CREATE TABLE IF NOT EXISTS analytics_user_progress (
    id BIGSERIAL PRIMARY KEY,
    mac_address VARCHAR(50) NOT NULL,
    kid_id BIGINT,
    total_sessions INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    total_games_played INTEGER DEFAULT 0,
    total_correct_answers INTEGER DEFAULT 0,
    total_wrong_answers INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(mac_address)
);

CREATE INDEX IF NOT EXISTS idx_analytics_progress_mac ON analytics_user_progress(mac_address);
