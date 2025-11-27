-- Remove text fields from analytics_game_attempts (we only want numbers)
-- Make question_text, correct_answer, user_answer, metadata nullable and don't use them
ALTER TABLE analytics_game_attempts
    MODIFY COLUMN question_text TEXT NULL COMMENT 'DEPRECATED - Not used anymore',
    MODIFY COLUMN correct_answer VARCHAR(255) NULL COMMENT 'DEPRECATED - Not used anymore',
    MODIFY COLUMN user_answer VARCHAR(255) NULL COMMENT 'DEPRECATED - Not used anymore',
    MODIFY COLUMN metadata JSON NULL COMMENT 'DEPRECATED - Not used anymore';

-- Create new table for streak tracking
DROP TABLE IF EXISTS analytics_streaks;
CREATE TABLE analytics_streaks
(
    id                  BIGINT AUTO_INCREMENT COMMENT 'Primary Key ID' PRIMARY KEY,
    session_id          VARCHAR(100) NOT NULL COMMENT 'Session ID (FK to game_sessions)',
    mac_address         VARCHAR(50) NOT NULL COMMENT 'Device MAC Address',
    game_type           VARCHAR(50) NOT NULL COMMENT 'math_tutor, riddle_solver, word_ladder',
    streak_number       INT NOT NULL COMMENT 'Streak number in this session (1, 2, 3...)',
    questions_in_streak INT NOT NULL COMMENT 'Number of consecutive correct answers in this streak',
    started_at          DATETIME(3) NOT NULL COMMENT 'Streak start timestamp',
    ended_at            DATETIME(3) NOT NULL COMMENT 'Streak end timestamp',
    duration_seconds    INT NOT NULL COMMENT 'Time taken to complete the streak',
    created_at          DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL COMMENT 'Record creation time',
    INDEX idx_streaks_session (session_id),
    INDEX idx_streaks_mac (mac_address),
    INDEX idx_streaks_game_type (game_type),
    INDEX idx_streaks_mac_game (mac_address, game_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'Analytics: Streak Completions';

-- Add streak count to user progress table
ALTER TABLE analytics_user_progress
    ADD COLUMN total_streaks_completed INT DEFAULT 0 COMMENT 'Total number of streaks completed' AFTER longest_streak,
    ADD COLUMN average_streak_time_seconds INT COMMENT 'Average time to complete a streak' AFTER total_streaks_completed;
