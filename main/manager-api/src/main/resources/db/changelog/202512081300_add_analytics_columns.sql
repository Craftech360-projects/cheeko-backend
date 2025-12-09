-- Add analytics columns to device_token_usage table for dashboard metrics
-- Date: 2025-12-08
-- This migration is idempotent and handles partial runs

-- Add session duration tracking (if not exists)
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'session_duration_seconds');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `session_duration_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT \'Total session duration in seconds\' AFTER `output_text_tokens`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add average time to first token (latency) (if not exists)
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'avg_ttft_seconds');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `avg_ttft_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT \'Average time to first token in seconds\' AFTER `session_duration_seconds`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add message count (if not exists)
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'message_count');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `message_count` INT NOT NULL DEFAULT 0 COMMENT \'Number of conversation turns/messages\' AFTER `avg_ttft_seconds`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add total response duration for averaging (if not exists)
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND COLUMN_NAME = 'total_response_duration_seconds');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `device_token_usage` ADD COLUMN `total_response_duration_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT \'Total response generation duration\' AFTER `message_count`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for date-based analytics queries (if not exists)
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'device_token_usage'
    AND INDEX_NAME = 'idx_usage_date');
SET @sql = IF(@index_exists = 0,
    'ALTER TABLE `device_token_usage` ADD INDEX `idx_usage_date` (`usage_date`)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
