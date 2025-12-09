-- Add total_tokens generated column to device_token_usage table
-- Date: 2025-12-08

ALTER TABLE `device_token_usage`
ADD COLUMN `total_tokens` BIGINT GENERATED ALWAYS AS (`input_tokens` + `output_tokens`) STORED
COMMENT 'Total tokens (input + output) - auto-calculated';
