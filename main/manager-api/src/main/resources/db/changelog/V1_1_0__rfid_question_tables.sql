-- =====================================================
-- RFID Question Tables Migration
-- Version: 1.1.0
-- Description: Create tables for RFID question templates and card mappings
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------
-- Table: rfid_question
-- Purpose: Store reusable question prompts that can be attached to RFID cards
-- -----------------------------------------------------
CREATE TABLE `rfid_question` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `code` varchar(100) NOT NULL COMMENT 'Human-readable identifier (e.g., ANIMALS_10, MATH_ADD_1)',
  `title` varchar(255) NOT NULL COMMENT 'Short title/label (e.g., Name 10 animals)',
  `prompt_text` text NOT NULL COMMENT 'Exact text to send to Gemini when RFID is tapped',
  `language` varchar(10) DEFAULT 'en' COMMENT 'Language code (en, hi, etc.)',
  `category` varchar(50) DEFAULT NULL COMMENT 'Category (animals, math, story)',
  `difficulty` int DEFAULT 1 COMMENT 'Difficulty level (1-5)',
  `active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Active status: 0=Disabled, 1=Enabled',
  `creator` bigint DEFAULT NULL COMMENT 'Creator user ID',
  `create_date` datetime DEFAULT NULL COMMENT 'Creation date',
  `updater` bigint DEFAULT NULL COMMENT 'Last updater user ID',
  `update_date` datetime DEFAULT NULL COMMENT 'Last update date',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_category` (`category`),
  KEY `idx_language` (`language`),
  KEY `idx_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RFID Question Templates';

-- -----------------------------------------------------
-- Table: rfid_card_mapping
-- Purpose: Link physical RFID UIDs to question templates
-- -----------------------------------------------------
CREATE TABLE `rfid_card_mapping` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `rfid_uid` varchar(100) NOT NULL COMMENT 'RFID card UID (hex string format)',
  `question_id` bigint NOT NULL COMMENT 'FK to rfid_question table',
  `pack_code` varchar(100) DEFAULT NULL COMMENT 'Product/pack/SKU identifier (e.g., BLINKIT_ANIMALS_PACK_1)',
  `notes` varchar(500) DEFAULT NULL COMMENT 'Internal notes or description',
  `active` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Active status: 0=Disabled, 1=Enabled',
  `creator` bigint DEFAULT NULL COMMENT 'Creator user ID',
  `create_date` datetime DEFAULT NULL COMMENT 'Creation date',
  `updater` bigint DEFAULT NULL COMMENT 'Last updater user ID',
  `update_date` datetime DEFAULT NULL COMMENT 'Last update date',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rfid_uid` (`rfid_uid`),
  KEY `idx_question_id` (`question_id`),
  KEY `idx_pack_code` (`pack_code`),
  KEY `idx_active` (`active`),
  CONSTRAINT `fk_rfid_card_question` FOREIGN KEY (`question_id`)
    REFERENCES `rfid_question` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RFID Card to Question Mappings';

SET FOREIGN_KEY_CHECKS = 1;
