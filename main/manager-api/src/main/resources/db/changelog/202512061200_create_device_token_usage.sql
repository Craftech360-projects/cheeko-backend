-- Create device_token_usage table for tracking token usage per device per day
-- Date: 2025-12-06

CREATE TABLE IF NOT EXISTS `device_token_usage` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `mac_address` VARCHAR(20) NOT NULL COMMENT 'Device MAC address',
    `usage_date` DATE NOT NULL COMMENT 'Usage date',
    `input_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Total input tokens for the day',
    `output_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT 'Total output tokens for the day',
    `session_count` INT NOT NULL DEFAULT 0 COMMENT 'Number of sessions that day',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'First record time',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_mac_date` (`mac_address`, `usage_date`),
    INDEX `idx_mac_address` (`mac_address`),
    INDEX `idx_usage_date` (`usage_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Device token usage tracking per day';
