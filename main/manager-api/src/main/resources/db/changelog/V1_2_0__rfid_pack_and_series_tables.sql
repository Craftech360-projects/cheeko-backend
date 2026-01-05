-- =====================================================
-- RFID Pack and Series Tables Migration
-- Version: 1.2.0
-- Description: Create tables for RFID packs and UID series ranges
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------
-- Table: rfid_pack
-- Purpose: Organize RFID cards into product packs/SKUs
-- -----------------------------------------------------
CREATE TABLE `rfid_pack` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `pack_code` varchar(100) NOT NULL COMMENT 'Unique pack identifier (e.g., BLINKIT_ANIMALS_PACK_1)',
  `name` varchar(255) NOT NULL COMMENT 'Display name',
  `description` text DEFAULT NULL COMMENT 'Pack description',
  `age_min` int DEFAULT NULL COMMENT 'Minimum recommended age',
  `age_max` int DEFAULT NULL COMMENT 'Maximum recommended age',
  `active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Active status: 0=Disabled, 1=Enabled',
  `creator` bigint DEFAULT NULL COMMENT 'Creator user ID',
  `create_date` datetime DEFAULT NULL COMMENT 'Creation date',
  `updater` bigint DEFAULT NULL COMMENT 'Last updater user ID',
  `update_date` datetime DEFAULT NULL COMMENT 'Last update date',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pack_code` (`pack_code`),
  KEY `idx_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RFID Card Packs/SKUs';

-- -----------------------------------------------------
-- Table: rfid_series
-- Purpose: Map contiguous RFID UID ranges to questions
-- -----------------------------------------------------
CREATE TABLE `rfid_series` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `start_uid` varchar(100) NOT NULL COMMENT 'Start of UID range (normalized hex string)',
  `end_uid` varchar(100) NOT NULL COMMENT 'End of UID range (normalized hex string)',
  `question_id` bigint NOT NULL COMMENT 'FK to rfid_question table',
  `pack_id` bigint DEFAULT NULL COMMENT 'FK to rfid_pack table',
  `priority` int DEFAULT 0 COMMENT 'Priority if UID matches multiple series (higher wins)',
  `notes` varchar(500) DEFAULT NULL COMMENT 'Internal notes',
  `active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Active status: 0=Disabled, 1=Enabled',
  `creator` bigint DEFAULT NULL COMMENT 'Creator user ID',
  `create_date` datetime DEFAULT NULL COMMENT 'Creation date',
  `updater` bigint DEFAULT NULL COMMENT 'Last updater user ID',
  `update_date` datetime DEFAULT NULL COMMENT 'Last update date',
  PRIMARY KEY (`id`),
  KEY `idx_start_uid` (`start_uid`),
  KEY `idx_end_uid` (`end_uid`),
  KEY `idx_question_id` (`question_id`),
  KEY `idx_pack_id` (`pack_id`),
  KEY `idx_priority` (`priority`),
  KEY `idx_active` (`active`),
  CONSTRAINT `fk_rfid_series_question` FOREIGN KEY (`question_id`)
    REFERENCES `rfid_question` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rfid_series_pack` FOREIGN KEY (`pack_id`)
    REFERENCES `rfid_pack` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RFID UID Series/Ranges';

-- -----------------------------------------------------
-- Alter: rfid_card_mapping
-- Purpose: Add pack_id FK to link cards to packs
-- -----------------------------------------------------
ALTER TABLE `rfid_card_mapping`
  ADD COLUMN `pack_id` bigint DEFAULT NULL COMMENT 'FK to rfid_pack table' AFTER `pack_code`,
  ADD KEY `idx_pack_id` (`pack_id`),
  ADD CONSTRAINT `fk_rfid_card_pack` FOREIGN KEY (`pack_id`)
    REFERENCES `rfid_pack` (`id`) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
