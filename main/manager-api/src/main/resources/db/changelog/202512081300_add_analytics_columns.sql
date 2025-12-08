-- Add analytics columns to device_token_usage table for dashboard metrics
-- Date: 2025-12-08

-- Add session duration tracking
ALTER TABLE `device_token_usage`
ADD COLUMN `session_duration_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT 'Total session duration in seconds' AFTER `output_text_tokens`;

-- Add average time to first token (latency)
ALTER TABLE `device_token_usage`
ADD COLUMN `avg_ttft_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT 'Average time to first token in seconds' AFTER `session_duration_seconds`;

-- Add message count
ALTER TABLE `device_token_usage`
ADD COLUMN `message_count` INT NOT NULL DEFAULT 0 COMMENT 'Number of conversation turns/messages' AFTER `avg_ttft_seconds`;

-- Add total response duration for averaging
ALTER TABLE `device_token_usage`
ADD COLUMN `total_response_duration_seconds` DECIMAL(10, 3) DEFAULT NULL COMMENT 'Total response generation duration' AFTER `message_count`;

-- Add index for date-based analytics queries
ALTER TABLE `device_token_usage`
ADD INDEX `idx_usage_date` (`usage_date`);
