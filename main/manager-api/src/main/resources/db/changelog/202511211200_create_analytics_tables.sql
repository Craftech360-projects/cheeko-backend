-- Analytics Tables for Game Metrics and Usage Tracking

-- 1. Game Sessions Table - Universal session tracking for all modes
DROP TABLE IF EXISTS analytics_game_sessions;
CREATE TABLE analytics_game_sessions
(
    id                  BIGINT AUTO_INCREMENT COMMENT 'Primary Key ID' PRIMARY KEY,
    session_id          VARCHAR(50) NOT NULL COMMENT 'Session/Room ID',
    mac_address         VARCHAR(50) COMMENT 'Device MAC Address',
    agent_id            VARCHAR(32) COMMENT 'Agent ID',
    mode_type           VARCHAR(50) COMMENT 'Mode type: Conversation, Math, Riddle, WordLadder, Music, Story',
    started_at          DATETIME(3) NOT NULL COMMENT 'Session start timestamp',
    ended_at            DATETIME(3) COMMENT 'Session end timestamp',
    duration_seconds    INT COMMENT 'Session duration in seconds (calculated)',
    interaction_count   INT DEFAULT 0 COMMENT 'Number of interactions (questions/songs/turns)',
    completion_status   VARCHAR(20) COMMENT 'completed, interrupted, switched, victory, failure',
    metadata            JSON COMMENT 'Mode-specific extra data',
    created_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL COMMENT 'Record creation time',
    updated_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Record update time',
    INDEX idx_sessions_mac (mac_address),
    INDEX idx_sessions_session_id (session_id),
    INDEX idx_sessions_mode (mode_type),
    INDEX idx_sessions_started (started_at),
    INDEX idx_sessions_mac_mode_started (mac_address, mode_type, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'Analytics: Game Sessions and Usage Tracking';

-- 2. Game Attempts Table - Question/Answer/Move tracking for games
DROP TABLE IF EXISTS analytics_game_attempts;
CREATE TABLE analytics_game_attempts
(
    id                  BIGINT AUTO_INCREMENT COMMENT 'Primary Key ID' PRIMARY KEY,
    session_id          VARCHAR(50) NOT NULL COMMENT 'Session ID (FK to game_sessions)',
    mac_address         VARCHAR(50) COMMENT 'Device MAC Address',
    game_type           VARCHAR(50) NOT NULL COMMENT 'math_tutor, riddle_solver, word_ladder',
    question_text       TEXT COMMENT 'The question/riddle/word challenge',
    question_type       VARCHAR(50) COMMENT 'addition, subtraction, animal-riddle, etc.',
    difficulty_level    VARCHAR(20) COMMENT 'easy, medium, hard',
    correct_answer      VARCHAR(255) COMMENT 'Expected answer',
    user_answer         VARCHAR(255) COMMENT 'User provided answer',
    is_correct          BOOLEAN COMMENT 'Answer correctness',
    attempt_number      TINYINT DEFAULT 1 COMMENT '1 or 2 (retry)',
    response_time_ms    INT COMMENT 'Time to answer in milliseconds',
    answered_at         DATETIME(3) NOT NULL COMMENT 'Answer timestamp',
    metadata            JSON COMMENT 'Game-specific extra data',
    created_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL COMMENT 'Record creation time',
    INDEX idx_attempts_session (session_id),
    INDEX idx_attempts_mac (mac_address),
    INDEX idx_attempts_game_type (game_type),
    INDEX idx_attempts_answered (answered_at),
    INDEX idx_attempts_mac_game_answered (mac_address, game_type, answered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'Analytics: Game Attempts and Performance';

-- 3. Media Playback Events Table - Music/Story tracking
DROP TABLE IF EXISTS analytics_media_playback;
CREATE TABLE analytics_media_playback
(
    id                      BIGINT AUTO_INCREMENT COMMENT 'Primary Key ID' PRIMARY KEY,
    session_id              VARCHAR(50) NOT NULL COMMENT 'Session ID (FK to game_sessions)',
    mac_address             VARCHAR(50) COMMENT 'Device MAC Address',
    media_type              VARCHAR(20) NOT NULL COMMENT 'music or story',
    media_id                VARCHAR(100) COMMENT 'Song/Story identifier',
    media_title             VARCHAR(255) COMMENT 'Song/Story name',
    started_at              DATETIME(3) NOT NULL COMMENT 'Playback start timestamp',
    ended_at                DATETIME(3) COMMENT 'Playback end timestamp',
    duration_played_seconds INT COMMENT 'Actual listen time in seconds',
    total_duration_seconds  INT COMMENT 'Full media length in seconds',
    completion_percentage   DECIMAL(5,2) COMMENT 'Percentage listened (0-100)',
    skip_action             VARCHAR(20) COMMENT 'next, previous, stop, or NULL',
    skipped_at              DATETIME(3) COMMENT 'Timestamp if skipped',
    metadata                JSON COMMENT 'Extra playback data',
    created_at              DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL COMMENT 'Record creation time',
    INDEX idx_media_session (session_id),
    INDEX idx_media_mac (mac_address),
    INDEX idx_media_type (media_type),
    INDEX idx_media_id (media_id),
    INDEX idx_media_started (started_at),
    INDEX idx_media_mac_type_started (mac_address, media_type, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'Analytics: Music and Story Playback';

-- 4. User Progress Table - Aggregated stats per user per mode
DROP TABLE IF EXISTS analytics_user_progress;
CREATE TABLE analytics_user_progress
(
    id                      BIGINT AUTO_INCREMENT COMMENT 'Primary Key ID' PRIMARY KEY,
    mac_address             VARCHAR(50) NOT NULL COMMENT 'Device MAC Address',
    mode_type               VARCHAR(50) NOT NULL COMMENT 'Math, Riddle, WordLadder, Music, Story, Conversation',
    total_sessions          INT DEFAULT 0 COMMENT 'Total session count',
    total_time_seconds      BIGINT DEFAULT 0 COMMENT 'Cumulative time spent',
    total_interactions      INT DEFAULT 0 COMMENT 'Total questions/songs/turns',
    success_rate_percentage DECIMAL(5,2) COMMENT 'Accuracy for games (0-100)',
    longest_streak          INT DEFAULT 0 COMMENT 'Best streak for games',
    skill_level             VARCHAR(20) COMMENT 'beginner, intermediate, advanced',
    last_played_at          DATETIME(3) COMMENT 'Last activity timestamp',
    weekly_summary_json     JSON COMMENT 'Weekly summary for dashboard',
    created_at              DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL COMMENT 'Record creation time',
    updated_at              DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Record update time',
    UNIQUE KEY uk_progress_mac_mode (mac_address, mode_type),
    INDEX idx_progress_mac (mac_address),
    INDEX idx_progress_last_played (last_played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'Analytics: User Progress and Aggregated Stats';
