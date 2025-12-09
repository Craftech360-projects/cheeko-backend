-- Modify device_token_usage table for per-session tracking with token breakdown
-- Date: 2025-12-08
-- This migration is idempotent and handles partial runs

-- Step 1: Add session_id column if it doesn't exist
-- Note: The column may already exist from a partial previous run
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'session_id');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `session_id` VARCHAR(100) NOT NULL DEFAULT \'\' COMMENT \'Session/Room ID\' AFTER `mac_address`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2: Add input_audio_tokens column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'input_audio_tokens');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `input_audio_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT \'Audio input tokens\' AFTER `session_id`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3: Add input_text_tokens column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'input_text_tokens');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `input_text_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT \'Text input tokens\' AFTER `input_audio_tokens`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 4: Add input_cached_tokens column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'input_cached_tokens');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `input_cached_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT \'Cached input tokens\' AFTER `input_text_tokens`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 5: Add output_audio_tokens column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'output_audio_tokens');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `output_audio_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT \'Audio output tokens\' AFTER `output_tokens`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 6: Add output_text_tokens column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'output_text_tokens');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `output_text_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT \'Text output tokens\' AFTER `output_audio_tokens`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 7: Drop the old unique key (mac_address + usage_date) if it exists
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND INDEX_NAME = 'uk_mac_date');
SET @sql = IF(@index_exists > 0,
    'ALTER TABLE `device_token_usage` DROP INDEX `uk_mac_date`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 8: Clean up duplicate entries before adding unique constraint
-- Keep only the entry with the highest id for each mac_address + session_id combination
DELETE t1 FROM `device_token_usage` t1
INNER JOIN `device_token_usage` t2
ON t1.mac_address = t2.mac_address
AND t1.session_id = t2.session_id
AND t1.id < t2.id;

-- Step 9: Add new unique key (mac_address + session_id) if it doesn't exist
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND INDEX_NAME = 'uk_mac_session');
SET @sql = IF(@index_exists = 0,
    'ALTER TABLE `device_token_usage` ADD UNIQUE KEY `uk_mac_session` (`mac_address`, `session_id`)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 10: Add index on session_id if it doesn't exist
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND INDEX_NAME = 'idx_session_id');
SET @sql = IF(@index_exists = 0,
    'ALTER TABLE `device_token_usage` ADD INDEX `idx_session_id` (`session_id`)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
