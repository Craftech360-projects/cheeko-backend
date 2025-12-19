-- Create stories table for storyteller agent
-- Date: 2025-12-19
-- This migration creates the stories table to store extracted story content from PDFs
-- Stories are extracted via Gemini OCR and stored here for the LiveKit storyteller agent

-- Create stories table (if not exists)
CREATE TABLE IF NOT EXISTS `stories` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT 'Auto-incrementing story ID',
    `filename` VARCHAR(255) UNIQUE NOT NULL COMMENT 'Original PDF filename (e.g., Prince_and_Star.pdf)',
    `title` VARCHAR(500) NOT NULL COMMENT 'Story title extracted from filename',
    `content` LONGTEXT NOT NULL COMMENT 'Full story text content (all pages combined)',
    `file_hash` VARCHAR(64) NOT NULL COMMENT 'MD5 hash of PDF file to detect changes',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When story was first uploaded',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'When story was last updated',
    INDEX `idx_title` (`title`),
    INDEX `idx_filename` (`filename`),
    INDEX `idx_file_hash` (`file_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Stores story content for storyteller agent';
