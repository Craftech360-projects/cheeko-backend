-- Increase session_id column length to accommodate longer session IDs
-- Format: {UUID}_{MAC}_{mode} can be up to 100 characters

ALTER TABLE analytics_game_sessions MODIFY COLUMN session_id VARCHAR(100) NOT NULL COMMENT 'Session/Room ID';

ALTER TABLE analytics_game_attempts MODIFY COLUMN session_id VARCHAR(100) NOT NULL COMMENT 'Session ID (FK to game_sessions)';

ALTER TABLE analytics_media_playback MODIFY COLUMN session_id VARCHAR(100) NOT NULL COMMENT 'Session ID (FK to game_sessions)';
