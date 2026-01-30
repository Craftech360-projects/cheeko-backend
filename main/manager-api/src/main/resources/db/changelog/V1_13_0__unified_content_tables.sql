-- ============================================================================
-- Cheeko ESP32 Server - Unified Content Tables Migration
-- Version: 1.13.0
-- Created: 2026-01-27
-- Description: Creates unified content_item table
-- ============================================================================

SET NAMES utf8mb4;

-- ============================================================================
-- SECTION 1: CREATE UNIFIED content_item TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS `content_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `content_pack_id` BIGINT NOT NULL COMMENT 'FK to rfid_content_pack',
    `item_number` INT NOT NULL COMMENT 'Sequence number within pack (1-based)',
    `title` VARCHAR(200) NOT NULL COMMENT 'Item title',
    `description` TEXT COMMENT 'Item description/instruction text',
    `audio_url` VARCHAR(500) COMMENT 'Audio file URL',
    `audio_size_bytes` BIGINT COMMENT 'Audio file size in bytes',
    `audio_duration_ms` INT COMMENT 'Audio duration in milliseconds',
    `images_json` JSON COMMENT 'Array of image objects [{url, sizeBytes, sequence}]',
    `lyrics_text` TEXT COMMENT 'Lyrics or content text (for rhymes)',
    `active` TINYINT DEFAULT 1 COMMENT 'Is active: 0=No, 1=Yes',
    `creator` BIGINT DEFAULT NULL COMMENT 'Creator',
    `create_date` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
    `updater` BIGINT DEFAULT NULL COMMENT 'Updater',
    `update_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_pack_item` (`content_pack_id`, `item_number`),
    KEY `idx_content_pack_id` (`content_pack_id`),
    KEY `idx_active` (`active`),
    CONSTRAINT `fk_content_item_pack` FOREIGN KEY (`content_pack_id`)
        REFERENCES `rfid_content_pack` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Unified content items (rhymes, habit steps, etc.)';

-- ============================================================================
-- SECTION 2: DROP OLD FOREIGN KEY AND COLUMN (if exists)
-- Uses prepared statements for conditional DDL
-- ============================================================================

-- Drop the habit_id foreign key constraint if it exists
SET @fk_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rfid_card_mapping'
    AND CONSTRAINT_NAME = 'fk_rfid_habit');
SET @sql = IF(@fk_exists > 0,
    'ALTER TABLE `rfid_card_mapping` DROP FOREIGN KEY `fk_rfid_habit`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop the habit_id column if it exists
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rfid_card_mapping'
    AND COLUMN_NAME = 'habit_id');
SET @sql = IF(@col_exists > 0,
    'ALTER TABLE `rfid_card_mapping` DROP COLUMN `habit_id`',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 3: DROP OLD TABLES (safe - uses IF EXISTS)
-- These tables were never created in this database
-- ============================================================================

DROP TABLE IF EXISTS `rhyme_item`;
DROP TABLE IF EXISTS `habit_step`;
DROP TABLE IF EXISTS `habit`;
DROP TABLE IF EXISTS `habit_pack`;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
