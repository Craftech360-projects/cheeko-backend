-- ============================================================================
-- Cheeko ESP32 Server - Rhyme Item Table
-- Version: 1.12.0
-- Created: 2026-01-27
-- Description: Creates rhyme_item table for storing individual rhyme audio URLs
--              similar to habit_step for habits
-- ============================================================================

SET NAMES utf8mb4;

-- ============================================================================
-- SECTION 1: CREATE RHYME_ITEM TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS `rhyme_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `content_pack_id` BIGINT NOT NULL COMMENT 'FK to rfid_content_pack',
    `item_number` INT NOT NULL COMMENT 'Sequence number within pack (1-based)',
    `title` VARCHAR(200) NOT NULL COMMENT 'Item title (e.g., Twinkle Twinkle Little Star)',
    `lyrics_text` TEXT COMMENT 'Lyrics/content text',
    `audio_url` VARCHAR(500) COMMENT 'S3/CloudFront audio URL',
    `audio_size_bytes` BIGINT COMMENT 'Audio file size in bytes',
    `audio_duration_ms` INT COMMENT 'Audio duration in milliseconds',
    `active` TINYINT DEFAULT 1 COMMENT 'Is active: 0=No, 1=Yes',
    `creator` BIGINT DEFAULT NULL COMMENT 'Creator',
    `create_date` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
    `updater` BIGINT DEFAULT NULL COMMENT 'Updater',
    `update_date` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_pack_item` (`content_pack_id`, `item_number`),
    KEY `idx_content_pack_id` (`content_pack_id`),
    KEY `idx_active` (`active`),
    CONSTRAINT `fk_rhyme_item_content_pack` FOREIGN KEY (`content_pack_id`)
        REFERENCES `rfid_content_pack` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Rhyme items with audio URLs';

-- ============================================================================
-- SECTION 2: ADD VERSION COLUMN TO RFID_CONTENT_PACK (if not exists)
-- ============================================================================

-- Add version column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rfid_content_pack' AND COLUMN_NAME = 'version');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `rfid_content_pack` ADD COLUMN `version` VARCHAR(20) DEFAULT ''1.0.0'' COMMENT ''Content version for cache validation''',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add content_hash column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rfid_content_pack' AND COLUMN_NAME = 'content_hash');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE `rfid_content_pack` ADD COLUMN `content_hash` VARCHAR(64) DEFAULT NULL COMMENT ''Content hash for cache validation''',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================================
-- SECTION 3: SEED DATA FOR RHYMES_EN_01
-- ============================================================================

INSERT IGNORE INTO `rhyme_item` (`content_pack_id`, `item_number`, `title`, `audio_url`, `audio_size_bytes`) VALUES
(1, 1, 'Twinkle Twinkle Little Star', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/twinkle twinkle little star.mp3', 375706),
(1, 2, 'Humpty Dumpty Sat on a Wall', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Humpty Dumpty Sat on a Wall.mp3', 221901),
(1, 3, 'Incy Wincy Spider', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Incy Wincy Spider.mp3', 267059),
(1, 4, 'Row Row Row Your Boat', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Row Row Row Your Boat.mp3', 162099),
(1, 5, 'Mary Had a Little Lamb', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Mary Had a Little Lamb.mp3', 306688),
(1, 6, 'Hickory Dickory Dock', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Hickory Dickory Dock.mp3', 172134),
(1, 7, 'Jack and Jill Went Up the Hill', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Jack and Jill Went Up the Hill.mp3', 311706),
(1, 8, 'Itsy Bitsy Spider', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Itsy Bitsy Spider.mp3', 277032),
(1, 9, 'Hey Diddle Diddle', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/Hey Diddle Diddle.mp3', 237363),
(1, 10, 'London Bridge Is Falling Down', 'https://d23u4d6oyrni77.cloudfront.net/rhymes/London Bridge Is Falling Down.mp3', 283341);

-- Update content pack with version
UPDATE `rfid_content_pack` SET `version` = '1.0.0', `content_hash` = MD5(CONCAT(id, '-', NOW())) WHERE `pack_code` = 'RHYMES_EN_01';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
