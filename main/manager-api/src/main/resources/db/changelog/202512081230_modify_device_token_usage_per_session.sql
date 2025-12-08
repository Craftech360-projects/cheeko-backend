-- Modify device_token_usage table for per-session tracking with token breakdown
-- Date: 2025-12-08

-- Drop the old unique key (mac_address + usage_date)
ALTER TABLE `device_token_usage` DROP INDEX `uk_mac_date`;

-- Add session_id column
ALTER TABLE `device_token_usage`
ADD COLUMN `session_id` VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Session/Room ID' AFTER `mac_address`;

-- Add token breakdown columns for Gemini cost calculation
ALTER TABLE `device_token_usage`
ADD COLUMN `input_audio_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Audio input tokens' AFTER `session_id`,
ADD COLUMN `input_text_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Text input tokens' AFTER `input_audio_tokens`,
ADD COLUMN `input_cached_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Cached input tokens' AFTER `input_text_tokens`,
ADD COLUMN `output_audio_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Audio output tokens' AFTER `output_tokens`,
ADD COLUMN `output_text_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Text output tokens' AFTER `output_audio_tokens`;

-- Add new unique key (mac_address + session_id)
ALTER TABLE `device_token_usage`
ADD UNIQUE KEY `uk_mac_session` (`mac_address`, `session_id`);

-- Add index on session_id
ALTER TABLE `device_token_usage`
ADD INDEX `idx_session_id` (`session_id`);
