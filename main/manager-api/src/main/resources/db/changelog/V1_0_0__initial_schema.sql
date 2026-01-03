-- ============================================================================
-- Cheeko ESP32 Server - Initial Database Schema
-- Version: 1.0.0
-- Created: 2026-01-03
-- Description: Complete schema with all tables, seed data, and plugin mappings
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- SECTION 1: SYSTEM TABLES
-- ============================================================================

-- System User
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  `id` bigint NOT NULL COMMENT 'id',
  `username` varchar(50) NOT NULL COMMENT 'Username',
  `password` varchar(100) DEFAULT NULL COMMENT 'Password',
  `super_admin` tinyint unsigned DEFAULT NULL COMMENT 'Super admin: 0=No, 1=Yes',
  `status` tinyint DEFAULT NULL COMMENT 'Status: 0=Disabled, 1=Enabled',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='System User';

-- System User Token
DROP TABLE IF EXISTS `sys_user_token`;
CREATE TABLE `sys_user_token` (
  `id` bigint NOT NULL COMMENT 'id',
  `user_id` bigint NOT NULL COMMENT 'User ID',
  `token` varchar(100) NOT NULL COMMENT 'User token',
  `expire_date` datetime DEFAULT NULL COMMENT 'Expire time',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`),
  UNIQUE KEY `uk_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='System User Token';

-- System Parameters
DROP TABLE IF EXISTS `sys_params`;
CREATE TABLE `sys_params` (
  `id` bigint NOT NULL COMMENT 'id',
  `param_code` varchar(32) DEFAULT NULL COMMENT 'Parameter code',
  `param_value` varchar(2000) DEFAULT NULL COMMENT 'Parameter value',
  `value_type` varchar(20) DEFAULT 'string' COMMENT 'Value type: string, number, boolean, json, array',
  `param_type` tinyint unsigned DEFAULT 1 COMMENT 'Type: 0=System, 1=User',
  `remark` varchar(200) DEFAULT NULL COMMENT 'Remark',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_param_code` (`param_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='System Parameters';

-- Dictionary Type
DROP TABLE IF EXISTS `sys_dict_type`;
CREATE TABLE `sys_dict_type` (
  `id` bigint NOT NULL COMMENT 'id',
  `dict_type` varchar(100) NOT NULL COMMENT 'Dictionary type',
  `dict_name` varchar(255) NOT NULL COMMENT 'Dictionary name',
  `remark` varchar(255) DEFAULT NULL COMMENT 'Remark',
  `sort` int unsigned DEFAULT NULL COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Dictionary Type';

-- Dictionary Data
DROP TABLE IF EXISTS `sys_dict_data`;
CREATE TABLE `sys_dict_data` (
  `id` bigint NOT NULL COMMENT 'id',
  `dict_type_id` bigint NOT NULL COMMENT 'Dictionary type ID',
  `dict_label` varchar(255) NOT NULL COMMENT 'Dictionary label',
  `dict_value` varchar(255) DEFAULT NULL COMMENT 'Dictionary value',
  `remark` varchar(255) DEFAULT NULL COMMENT 'Remark',
  `sort` int unsigned DEFAULT NULL COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dict_type_value` (`dict_type_id`, `dict_value`),
  KEY `idx_sort` (`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Dictionary Data';

-- ============================================================================
-- SECTION 2: PROFILE TABLES
-- ============================================================================

-- Kid Profile
DROP TABLE IF EXISTS `kid_profile`;
CREATE TABLE `kid_profile` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `user_id` bigint NOT NULL COMMENT 'FK to sys_user table (parent)',
  `name` varchar(100) NOT NULL COMMENT 'Child name',
  `date_of_birth` date NOT NULL COMMENT 'Child date of birth',
  `gender` varchar(20) DEFAULT NULL COMMENT 'Child gender (male/female/other)',
  `interests` text COMMENT 'JSON array of child interests',
  `avatar_url` varchar(500) DEFAULT NULL COMMENT 'Avatar URL',
  `primary_language` varchar(50) DEFAULT 'English' COMMENT 'Primary language for AI conversations',
  `additional_notes` text COMMENT 'Parent-provided context about child',
  `creator` bigint DEFAULT NULL COMMENT 'Creator user ID',
  `create_date` datetime DEFAULT NULL COMMENT 'Creation date',
  `updater` bigint DEFAULT NULL COMMENT 'Last updater user ID',
  `update_date` datetime DEFAULT NULL COMMENT 'Last update date',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_primary_language` (`primary_language`),
  CONSTRAINT `fk_kid_profile_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Kid profiles table';

-- Parent Profile
DROP TABLE IF EXISTS `parent_profile`;
CREATE TABLE `parent_profile` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `user_id` bigint NOT NULL COMMENT 'FK to sys_user table',
  `full_name` varchar(100) DEFAULT NULL COMMENT 'Parent full name',
  `email` varchar(255) DEFAULT NULL COMMENT 'Email address',
  `phone` varchar(20) DEFAULT NULL COMMENT 'Phone number',
  `avatar_url` varchar(500) DEFAULT NULL COMMENT 'Avatar URL',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_parent_profile_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Parent profiles table';

-- ============================================================================
-- SECTION 3: AI MODEL TABLES
-- ============================================================================

-- Model Provider
DROP TABLE IF EXISTS `ai_model_provider`;
CREATE TABLE `ai_model_provider` (
  `id` varchar(32) NOT NULL COMMENT 'Primary key',
  `model_type` varchar(20) DEFAULT NULL COMMENT 'Model type (Memory/ASR/VAD/LLM/TTS/Plugin)',
  `provider_code` varchar(50) DEFAULT NULL COMMENT 'Provider code',
  `name` varchar(50) DEFAULT NULL COMMENT 'Provider name',
  `fields` json DEFAULT NULL COMMENT 'Provider fields (JSON)',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_model_type` (`model_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Model Provider';

-- Model Config
DROP TABLE IF EXISTS `ai_model_config`;
CREATE TABLE `ai_model_config` (
  `id` varchar(32) NOT NULL COMMENT 'Primary key',
  `model_type` varchar(20) DEFAULT NULL COMMENT 'Model type (Memory/ASR/VAD/LLM/TTS)',
  `model_code` varchar(50) DEFAULT NULL COMMENT 'Model code',
  `model_name` varchar(50) DEFAULT NULL COMMENT 'Model name',
  `is_default` tinyint(1) DEFAULT 0 COMMENT 'Is default: 0=No, 1=Yes',
  `is_enabled` tinyint(1) DEFAULT 0 COMMENT 'Is enabled',
  `config_json` json DEFAULT NULL COMMENT 'Model config (JSON)',
  `doc_link` varchar(200) DEFAULT NULL COMMENT 'Documentation link',
  `remark` varchar(255) DEFAULT NULL COMMENT 'Remark',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_model_type` (`model_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Model Config';

-- TTS Voice
DROP TABLE IF EXISTS `ai_tts_voice`;
CREATE TABLE `ai_tts_voice` (
  `id` varchar(32) NOT NULL COMMENT 'Primary key',
  `tts_model_id` varchar(32) DEFAULT NULL COMMENT 'TTS model ID',
  `name` varchar(20) DEFAULT NULL COMMENT 'Voice name',
  `tts_voice` varchar(50) DEFAULT NULL COMMENT 'Voice code',
  `languages` varchar(50) DEFAULT NULL COMMENT 'Languages',
  `voice_demo` varchar(500) DEFAULT NULL COMMENT 'Voice demo URL',
  `reference_audio` varchar(500) DEFAULT NULL COMMENT 'Reference audio',
  `reference_text` text COMMENT 'Reference text',
  `remark` varchar(255) DEFAULT NULL COMMENT 'Remark',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_tts_model_id` (`tts_model_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='TTS Voice';

-- ============================================================================
-- SECTION 4: AI AGENT TABLES
-- ============================================================================

-- Agent Template
DROP TABLE IF EXISTS `ai_agent_template`;
CREATE TABLE `ai_agent_template` (
  `id` varchar(32) NOT NULL COMMENT 'Unique identifier',
  `agent_code` varchar(36) DEFAULT NULL COMMENT 'Agent code',
  `agent_name` varchar(64) DEFAULT NULL COMMENT 'Agent name',
  `asr_model_id` varchar(32) DEFAULT NULL COMMENT 'ASR model ID',
  `vad_model_id` varchar(64) DEFAULT NULL COMMENT 'VAD model ID',
  `llm_model_id` varchar(32) DEFAULT NULL COMMENT 'LLM model ID',
  `vllm_model_id` varchar(32) DEFAULT 'VLLM_ChatGLMVLLM' COMMENT 'VLLM model ID',
  `tts_model_id` varchar(32) DEFAULT NULL COMMENT 'TTS model ID',
  `tts_voice_id` varchar(32) DEFAULT NULL COMMENT 'Voice ID',
  `mem_model_id` varchar(32) DEFAULT NULL COMMENT 'Memory model ID',
  `intent_model_id` varchar(32) DEFAULT NULL COMMENT 'Intent model ID',
  `chat_history_conf` int DEFAULT 1 COMMENT 'Chat history config: 0=None, 1=Text, 2=Text+Audio',
  `summary_memory` text COMMENT 'Summary memory',
  `system_prompt` text COMMENT 'System prompt',
  `lang_code` varchar(10) DEFAULT NULL COMMENT 'Language code',
  `language` varchar(10) DEFAULT NULL COMMENT 'Language',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `is_visible` int DEFAULT 1 COMMENT 'Is visible: 0=No, 1=Yes',
  `creator` bigint DEFAULT NULL COMMENT 'Creator ID',
  `created_at` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater ID',
  `updated_at` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent Template';

-- Agent
DROP TABLE IF EXISTS `ai_agent`;
CREATE TABLE `ai_agent` (
  `id` varchar(32) NOT NULL COMMENT 'Unique identifier',
  `template_id` varchar(32) DEFAULT NULL COMMENT 'FK to ai_agent_template.id',
  `user_id` bigint DEFAULT NULL COMMENT 'User ID',
  `agent_code` varchar(36) DEFAULT NULL COMMENT 'Agent code',
  `agent_name` varchar(64) DEFAULT NULL COMMENT 'Agent name',
  `asr_model_id` varchar(32) DEFAULT NULL COMMENT 'ASR model ID',
  `vad_model_id` varchar(64) DEFAULT NULL COMMENT 'VAD model ID',
  `llm_model_id` varchar(32) DEFAULT NULL COMMENT 'LLM model ID',
  `vllm_model_id` varchar(32) DEFAULT 'VLLM_ChatGLMVLLM' COMMENT 'VLLM model ID',
  `tts_model_id` varchar(32) DEFAULT NULL COMMENT 'TTS model ID',
  `tts_voice_id` varchar(32) DEFAULT NULL COMMENT 'Voice ID',
  `mem_model_id` varchar(32) DEFAULT NULL COMMENT 'Memory model ID',
  `intent_model_id` varchar(32) DEFAULT NULL COMMENT 'Intent model ID',
  `chat_history_conf` int DEFAULT 1 COMMENT 'Chat history config',
  `system_prompt` text COMMENT 'System prompt',
  `summary_memory` text COMMENT 'Summary memory',
  `lang_code` varchar(10) DEFAULT NULL COMMENT 'Language code',
  `language` varchar(10) DEFAULT NULL COMMENT 'Language',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `creator` bigint DEFAULT NULL COMMENT 'Creator ID',
  `created_at` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater ID',
  `updated_at` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_template_id` (`template_id`),
  CONSTRAINT `fk_agent_template` FOREIGN KEY (`template_id`) REFERENCES `ai_agent_template` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent';

-- Agent Chat History
DROP TABLE IF EXISTS `ai_agent_chat_history`;
CREATE TABLE `ai_agent_chat_history` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `mac_address` varchar(50) DEFAULT NULL COMMENT 'MAC address',
  `agent_id` varchar(32) DEFAULT NULL COMMENT 'Agent ID',
  `session_id` varchar(100) NOT NULL COMMENT 'Session ID',
  `chat_type` tinyint DEFAULT NULL COMMENT 'Message type: 1=User, 2=Agent',
  `content` varchar(1024) DEFAULT NULL COMMENT 'Chat content',
  `audio_id` varchar(32) DEFAULT NULL COMMENT 'Audio ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_agent_id` (`agent_id`),
  KEY `idx_agent_session_created` (`agent_id`, `session_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent Chat History';

-- Agent Plugin Mapping
DROP TABLE IF EXISTS `ai_agent_plugin_mapping`;
CREATE TABLE `ai_agent_plugin_mapping` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `agent_id` varchar(32) NOT NULL COMMENT 'Agent ID',
  `plugin_id` varchar(32) NOT NULL COMMENT 'Plugin ID',
  `param_info` json NOT NULL COMMENT 'Plugin parameters',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_plugin` (`agent_id`, `plugin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Agent Plugin Mapping';

-- ============================================================================
-- SECTION 5: DEVICE TABLES
-- ============================================================================

-- Device
DROP TABLE IF EXISTS `ai_device`;
CREATE TABLE `ai_device` (
  `id` varchar(32) NOT NULL COMMENT 'Unique identifier',
  `user_id` bigint DEFAULT NULL COMMENT 'User ID',
  `mac_address` varchar(50) DEFAULT NULL COMMENT 'MAC address',
  `last_connected_at` datetime DEFAULT NULL COMMENT 'Last connected time',
  `auto_update` tinyint unsigned DEFAULT 0 COMMENT 'Auto update: 0=Off, 1=On',
  `board` varchar(50) DEFAULT NULL COMMENT 'Hardware type',
  `alias` varchar(64) DEFAULT NULL COMMENT 'Device alias',
  `agent_id` varchar(32) DEFAULT NULL COMMENT 'Agent ID',
  `kid_id` bigint DEFAULT NULL COMMENT 'FK to kid_profile',
  `location` varchar(100) DEFAULT NULL COMMENT 'Device location',
  `app_version` varchar(20) DEFAULT NULL COMMENT 'Firmware version',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `mode` varchar(20) DEFAULT 'conversation' COMMENT 'Device mode: conversation/music/story',
  `device_mode` varchar(20) DEFAULT 'manual' COMMENT 'Control mode: manual/auto',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_mac_address` (`mac_address`),
  KEY `idx_kid_id` (`kid_id`),
  KEY `idx_mode` (`mode`),
  KEY `idx_device_mode` (`device_mode`),
  CONSTRAINT `fk_device_kid` FOREIGN KEY (`kid_id`) REFERENCES `kid_profile` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Device';

-- Device Token Usage
DROP TABLE IF EXISTS `device_token_usage`;
CREATE TABLE `device_token_usage` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `mac_address` varchar(20) NOT NULL COMMENT 'Device MAC address',
  `session_id` varchar(100) NOT NULL DEFAULT '' COMMENT 'Session ID',
  `input_audio_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Audio input tokens',
  `input_text_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Text input tokens',
  `input_cached_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Cached input tokens',
  `usage_date` date NOT NULL COMMENT 'Usage date',
  `input_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Total input tokens',
  `output_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Total output tokens',
  `output_audio_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Audio output tokens',
  `output_text_tokens` bigint NOT NULL DEFAULT 0 COMMENT 'Text output tokens',
  `session_duration_seconds` decimal(10,3) DEFAULT NULL COMMENT 'Session duration',
  `avg_ttft_seconds` decimal(10,3) DEFAULT NULL COMMENT 'Average time to first token',
  `message_count` int NOT NULL DEFAULT 0 COMMENT 'Message count',
  `total_response_duration_seconds` decimal(10,3) DEFAULT NULL COMMENT 'Total response duration',
  `session_count` int NOT NULL DEFAULT 0 COMMENT 'Session count',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
  `total_tokens` bigint GENERATED ALWAYS AS (`input_tokens` + `output_tokens`) STORED COMMENT 'Total tokens',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mac_session` (`mac_address`, `session_id`),
  KEY `idx_mac_address` (`mac_address`),
  KEY `idx_usage_date` (`usage_date`),
  KEY `idx_session_id` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Device Token Usage';

-- OTA Firmware
DROP TABLE IF EXISTS `ai_ota`;
CREATE TABLE `ai_ota` (
  `id` varchar(32) NOT NULL COMMENT 'ID',
  `firmware_name` varchar(100) DEFAULT NULL COMMENT 'Firmware name',
  `type` varchar(50) DEFAULT NULL COMMENT 'Firmware type',
  `version` varchar(50) DEFAULT NULL COMMENT 'Version',
  `size` bigint DEFAULT NULL COMMENT 'File size (bytes)',
  `remark` varchar(500) DEFAULT NULL COMMENT 'Remark',
  `firmware_path` varchar(255) DEFAULT NULL COMMENT 'Firmware path',
  `sort` int unsigned DEFAULT 0 COMMENT 'Sort order',
  `force_update` tinyint(1) DEFAULT 0 COMMENT 'Force update: 0=No, 1=Yes',
  `updater` bigint DEFAULT NULL COMMENT 'Updater',
  `update_date` datetime DEFAULT NULL COMMENT 'Update time',
  `creator` bigint DEFAULT NULL COMMENT 'Creator',
  `create_date` datetime DEFAULT NULL COMMENT 'Create time',
  PRIMARY KEY (`id`),
  KEY `idx_force_update_type` (`type`, `force_update`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OTA Firmware';

-- ============================================================================
-- SECTION 6: CONTENT TABLES
-- ============================================================================

-- Content Items
DROP TABLE IF EXISTS `content_items`;
CREATE TABLE `content_items` (
  `id` char(36) NOT NULL COMMENT 'Unique identifier (UUID)',
  `title` text NOT NULL COMMENT 'Display title',
  `romanized` text COMMENT 'Romanized version of title',
  `filename` text NOT NULL COMMENT 'Audio filename',
  `content_type` varchar(50) NOT NULL COMMENT 'Type: music or story',
  `category` varchar(100) NOT NULL COMMENT 'Content category',
  `alternatives` json DEFAULT NULL COMMENT 'Alternative titles/spellings',
  `file_url` text COMMENT 'File storage URL',
  `duration_seconds` int DEFAULT NULL COMMENT 'Duration in seconds',
  `thumbnail_url` varchar(500) DEFAULT NULL COMMENT 'Thumbnail image URL',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_content_type` (`content_type`),
  KEY `idx_category` (`category`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `chk_content_type` CHECK (`content_type` IN ('music', 'story'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Content Library';

-- Music Playlist
DROP TABLE IF EXISTS `music_playlist`;
CREATE TABLE `music_playlist` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `device_id` varchar(32) NOT NULL COMMENT 'Device ID',
  `content_id` char(36) NOT NULL COMMENT 'Content ID',
  `position` int NOT NULL COMMENT 'Position in playlist',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_position` (`device_id`, `position`),
  KEY `idx_device_position` (`device_id`, `position`),
  KEY `idx_device_content` (`device_id`, `content_id`),
  KEY `fk_music_content` (`content_id`),
  CONSTRAINT `fk_music_content` FOREIGN KEY (`content_id`) REFERENCES `content_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_music_device` FOREIGN KEY (`device_id`) REFERENCES `ai_device` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Music Playlist';

-- Story Playlist
DROP TABLE IF EXISTS `story_playlist`;
CREATE TABLE `story_playlist` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `device_id` varchar(32) NOT NULL COMMENT 'Device ID',
  `content_id` char(36) NOT NULL COMMENT 'Content ID',
  `position` int NOT NULL COMMENT 'Position in playlist',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP COMMENT 'Create time',
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_position` (`device_id`, `position`),
  KEY `idx_device_position` (`device_id`, `position`),
  KEY `idx_device_content` (`device_id`, `content_id`),
  KEY `fk_story_content` (`content_id`),
  CONSTRAINT `fk_story_content` FOREIGN KEY (`content_id`) REFERENCES `content_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_story_device` FOREIGN KEY (`device_id`) REFERENCES `ai_device` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Story Playlist';

-- ============================================================================
-- SECTION 7: ANALYTICS TABLES
-- ============================================================================

-- Analytics Game Sessions
DROP TABLE IF EXISTS `analytics_game_sessions`;
CREATE TABLE `analytics_game_sessions` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` varchar(100) NOT NULL COMMENT 'Session ID',
  `mac_address` varchar(50) DEFAULT NULL COMMENT 'Device MAC',
  `agent_id` varchar(32) DEFAULT NULL COMMENT 'Agent ID',
  `mode_type` varchar(50) DEFAULT NULL COMMENT 'Mode type',
  `started_at` datetime(3) NOT NULL COMMENT 'Start time',
  `ended_at` datetime(3) DEFAULT NULL COMMENT 'End time',
  `duration_seconds` int DEFAULT NULL COMMENT 'Duration',
  `interaction_count` int DEFAULT 0 COMMENT 'Interaction count',
  `completion_status` varchar(20) DEFAULT NULL COMMENT 'Status',
  `metadata` json DEFAULT NULL COMMENT 'Metadata',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Update time',
  PRIMARY KEY (`id`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_mode` (`mode_type`),
  KEY `idx_started` (`started_at`),
  KEY `idx_mac_mode_started` (`mac_address`, `mode_type`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Analytics Game Sessions';

-- Analytics Game Attempts
DROP TABLE IF EXISTS `analytics_game_attempts`;
CREATE TABLE `analytics_game_attempts` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` varchar(100) NOT NULL COMMENT 'Session ID',
  `mac_address` varchar(50) DEFAULT NULL COMMENT 'Device MAC',
  `game_type` varchar(50) NOT NULL COMMENT 'Game type',
  `question_text` text COMMENT 'Question text',
  `question_type` varchar(50) DEFAULT NULL COMMENT 'Question type',
  `difficulty_level` varchar(20) DEFAULT NULL COMMENT 'Difficulty',
  `correct_answer` varchar(255) DEFAULT NULL COMMENT 'Correct answer',
  `user_answer` varchar(255) DEFAULT NULL COMMENT 'User answer',
  `is_correct` tinyint(1) DEFAULT NULL COMMENT 'Is correct',
  `attempt_number` tinyint DEFAULT 1 COMMENT 'Attempt number',
  `response_time_ms` int DEFAULT NULL COMMENT 'Response time',
  `answered_at` datetime(3) NOT NULL COMMENT 'Answer time',
  `metadata` json DEFAULT NULL COMMENT 'Metadata',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_game_type` (`game_type`),
  KEY `idx_answered` (`answered_at`),
  KEY `idx_mac_game_answered` (`mac_address`, `game_type`, `answered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Analytics Game Attempts';

-- Analytics Media Playback
DROP TABLE IF EXISTS `analytics_media_playback`;
CREATE TABLE `analytics_media_playback` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` varchar(100) NOT NULL COMMENT 'Session ID',
  `mac_address` varchar(50) DEFAULT NULL COMMENT 'Device MAC',
  `media_type` varchar(20) NOT NULL COMMENT 'Media type',
  `media_id` varchar(100) DEFAULT NULL COMMENT 'Media ID',
  `media_title` varchar(255) DEFAULT NULL COMMENT 'Media title',
  `started_at` datetime(3) NOT NULL COMMENT 'Start time',
  `ended_at` datetime(3) DEFAULT NULL COMMENT 'End time',
  `duration_played_seconds` int DEFAULT NULL COMMENT 'Duration played',
  `total_duration_seconds` int DEFAULT NULL COMMENT 'Total duration',
  `completion_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Completion %',
  `skip_action` varchar(20) DEFAULT NULL COMMENT 'Skip action',
  `skipped_at` datetime(3) DEFAULT NULL COMMENT 'Skip time',
  `metadata` json DEFAULT NULL COMMENT 'Metadata',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_media_type` (`media_type`),
  KEY `idx_media_id` (`media_id`),
  KEY `idx_started` (`started_at`),
  KEY `idx_mac_type_started` (`mac_address`, `media_type`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Analytics Media Playback';

-- Analytics Streaks
DROP TABLE IF EXISTS `analytics_streaks`;
CREATE TABLE `analytics_streaks` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `session_id` varchar(100) NOT NULL COMMENT 'Session ID',
  `mac_address` varchar(50) NOT NULL COMMENT 'Device MAC',
  `game_type` varchar(50) NOT NULL COMMENT 'Game type',
  `streak_number` int NOT NULL COMMENT 'Streak number',
  `questions_in_streak` int NOT NULL COMMENT 'Questions in streak',
  `started_at` datetime(3) NOT NULL COMMENT 'Start time',
  `ended_at` datetime(3) NOT NULL COMMENT 'End time',
  `duration_seconds` int NOT NULL COMMENT 'Duration',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_game_type` (`game_type`),
  KEY `idx_mac_game` (`mac_address`, `game_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Analytics Streaks';

-- Analytics User Progress
DROP TABLE IF EXISTS `analytics_user_progress`;
CREATE TABLE `analytics_user_progress` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
  `mac_address` varchar(50) NOT NULL COMMENT 'Device MAC',
  `mode_type` varchar(50) NOT NULL COMMENT 'Mode type',
  `total_sessions` int DEFAULT 0 COMMENT 'Total sessions',
  `total_time_seconds` bigint DEFAULT 0 COMMENT 'Total time',
  `total_interactions` int DEFAULT 0 COMMENT 'Total interactions',
  `success_rate_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Success rate',
  `longest_streak` int DEFAULT 0 COMMENT 'Longest streak',
  `total_streaks_completed` int DEFAULT 0 COMMENT 'Total streaks',
  `average_streak_time_seconds` int DEFAULT NULL COMMENT 'Average streak time',
  `skill_level` varchar(20) DEFAULT NULL COMMENT 'Skill level',
  `last_played_at` datetime(3) DEFAULT NULL COMMENT 'Last played',
  `weekly_summary_json` json DEFAULT NULL COMMENT 'Weekly summary',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Create time',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'Update time',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mac_mode` (`mac_address`, `mode_type`),
  KEY `idx_mac` (`mac_address`),
  KEY `idx_last_played` (`last_played_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Analytics User Progress';

-- ============================================================================
-- SECTION 8: SEED DATA - SYSTEM
-- ============================================================================

-- Default admin user (password: admin)
INSERT INTO `sys_user` (`id`, `username`, `password`, `super_admin`, `status`, `creator`, `create_date`, `updater`, `update_date`) VALUES
(1, 'admin', '$2a$10$012Kx2ba5jzqr9gLlG4MX.bnQJTD9UWqF57XDo2N3.fPtLne02u/m', 1, 1, 1, NOW(), 1, NOW());

-- System parameters
INSERT INTO `sys_params` (`id`, `param_code`, `param_value`, `value_type`, `param_type`, `remark`, `creator`, `create_date`) VALUES
(102, 'server.secret', 'da11d988-f105-4e71-b095-da62ada82189', 'string', 1, 'Server secret key for authentication', NULL, NOW()),
(103, 'server.allow_user_register', 'true', 'boolean', 1, 'Allow user self-registration', NULL, NOW()),
(104, 'server.fronted_url', 'http://localhost:8001', 'string', 1, 'Frontend URL for device binding QR code', NULL, NOW()),
(106, 'server.websocket', 'ws://localhost:8000/xiaozhi/v1/', 'string', 1, 'WebSocket server URLs (semicolon separated)', NULL, NOW()),
(107, 'server.ota', 'http://localhost:8002/toy/ota/', 'string', 1, 'OTA firmware update URL', NULL, NOW()),
(108, 'server.name', 'cheeko-esp32-server', 'string', 1, 'Server name', NULL, NOW()),
(302, 'close_connection_no_voice_time', '120', 'number', 1, 'Time to disconnect when no voice input (seconds)', NULL, NOW()),
(305, 'enable_greeting', 'true', 'boolean', 1, 'Enable greeting message on connection', NULL, NOW()),
(309, 'cheeko', '{\n  "type": "hello",\n  "version": 1,\n  "transport": "websocket",\n  "audio_params": {\n    "format": "opus",\n    "sample_rate": 16000,\n    "channels": 1,\n    "frame_duration": 60\n  }\n}', 'json', 1, 'Protocol configuration JSON', NULL, NOW()),
(310, 'wakeup_words', 'hello cheeko;hey cheeko;cheeko cheeko;hey assistant;hello assistant;wake up;listen to me;hey buddy', 'array', 1, 'Wake word list for wake word recognition', NULL, NOW()),
(500, 'end_prompt.enable', 'true', 'boolean', 1, 'Enable end prompt feature', NULL, NOW()),
(501, 'end_prompt.prompt', 'Goodbye! Looking forward to chatting with you again!', 'string', 1, 'End prompt message template', NULL, NOW()),
(600, 'mqtt.broker', 'localhost', 'string', 1, 'MQTT broker IP address or hostname', NULL, NOW()),
(601, 'mqtt.port', '1883', 'string', 1, 'MQTT broker port', NULL, NOW()),
(602, 'mqtt.signature_key', 'test-signature-key-12345', 'string', 1, 'MQTT password signature key for HMAC-SHA256', NULL, NOW()),
(701, 'server.enable_mobile_register', 'false', 'boolean', 1, 'Enable mobile registration', NULL, NOW()),
(702, 'server.beian_icp_num', '', 'string', 1, 'ICP registration number', NULL, NOW()),
(703, 'server.beian_ga_num', '', 'string', 1, 'GA registration number', NULL, NOW());

-- Dictionary types
INSERT INTO `sys_dict_type` (`id`, `dict_type`, `dict_name`, `remark`, `sort`, `creator`, `create_date`, `updater`, `update_date`) VALUES
(101, 'FIRMWARE_TYPE', 'Firmware Type', 'Firmware types dictionary', 0, 1, NOW(), 1, NOW()),
(102, 'MOBILE_AREA', 'Mobile Area', 'Mobile area codes dictionary', 0, 1, NOW(), 1, NOW());

-- Dictionary data - Firmware types
INSERT INTO `sys_dict_data` (`id`, `dict_type_id`, `dict_label`, `dict_value`, `remark`, `sort`) VALUES
(101001, 101, 'Bread Compact WiFi', 'bread-compact-wifi', 'Bread Compact WiFi', 1),
(101002, 101, 'Bread Compact WiFi + LCD', 'bread-compact-wifi-lcd', 'Bread Compact WiFi + LCD', 2),
(101003, 101, 'Bread Compact ML307 AT', 'bread-compact-ml307', 'Bread Compact ML307 AT', 3),
(101004, 101, 'Bread WiFi ESP32 DevKit', 'bread-compact-esp32', 'Bread WiFi ESP32 DevKit', 4),
(101005, 101, 'Bread WiFi + LCD ESP32 DevKit', 'bread-compact-esp32-lcd', 'Bread WiFi + LCD ESP32 DevKit', 5),
(101006, 101, 'DFRobot Beetle K10', 'df-k10', 'DFRobot Beetle K10', 6),
(101007, 101, 'ESP32 CGC', 'esp32-cgc', 'ESP32 CGC', 7),
(101008, 101, 'ESP BOX 3', 'esp-box-3', 'ESP BOX 3', 8),
(101009, 101, 'ESP BOX', 'esp-box', 'ESP BOX', 9),
(101010, 101, 'ESP BOX Lite', 'esp-box-lite', 'ESP BOX Lite', 10),
(101011, 101, 'Kevin Box 1', 'kevin-box-1', 'Kevin Box 1', 11),
(101012, 101, 'Kevin Box 2', 'kevin-box-2', 'Kevin Box 2', 12),
(101013, 101, 'Kevin C3', 'kevin-c3', 'Kevin C3', 13),
(101014, 101, 'Kevin SP V3 Dev Board', 'kevin-sp-v3-dev', 'Kevin SP V3 Dev Board', 14),
(101015, 101, 'Kevin SP V4 Dev Board', 'kevin-sp-v4-dev', 'Kevin SP V4 Dev Board', 15),
(101016, 101, 'Yuying 3.13 LCD Dev Board', 'kevin-yuying-313lcd', 'Yuying 3.13 LCD Dev Board', 16),
(101017, 101, 'LiChuang ESP32-S3 Dev Board', 'lichuang-dev', 'LiChuang ESP32-S3 Dev Board', 17),
(101018, 101, 'LiChuang ESP32-C3 Dev Board', 'lichuang-c3-dev', 'LiChuang ESP32-C3 Dev Board', 18),
(101019, 101, 'Magiclick 2.4', 'magiclick-2p4', 'Magiclick 2.4', 19),
(101020, 101, 'Magiclick 2.5', 'magiclick-2p5', 'Magiclick 2.5', 20),
(101021, 101, 'Magiclick C3', 'magiclick-c3', 'Magiclick C3', 21),
(101022, 101, 'Magiclick C3 V2', 'magiclick-c3-v2', 'Magiclick C3 V2', 22),
(101023, 101, 'M5Stack CoreS3', 'm5stack-core-s3', 'M5Stack CoreS3', 23),
(101024, 101, 'AtomS3 + Echo Base', 'atoms3-echo-base', 'AtomS3 + Echo Base', 24),
(101025, 101, 'AtomS3R + Echo Base', 'atoms3r-echo-base', 'AtomS3R + Echo Base', 25),
(101026, 101, 'AtomS3R CAM/M12 + Echo Base', 'atoms3r-cam-m12-echo-base', 'AtomS3R CAM/M12 + Echo Base', 26),
(101027, 101, 'AtomMatrix + Echo Base', 'atommatrix-echo-base', 'AtomMatrix + Echo Base', 27),
(101028, 101, 'X Mini C3', 'xmini-c3', 'X Mini C3', 28),
(101029, 101, 'ESP32S3 KORVO2 V3 Dev Board', 'esp32s3-korvo2-v3', 'ESP32S3 KORVO2 V3 Dev Board', 29),
(101030, 101, 'ESP SparkBot Dev Board', 'esp-sparkbot', 'ESP SparkBot Dev Board', 30),
(101031, 101, 'ESP-Spot-S3', 'esp-spot-s3', 'ESP-Spot-S3', 31),
(101032, 101, 'Waveshare ESP32-S3-Touch-AMOLED-1.8', 'esp32-s3-touch-amoled-1.8', 'Waveshare ESP32-S3-Touch-AMOLED-1.8', 32),
(101033, 101, 'Waveshare ESP32-S3-Touch-LCD-1.85C', 'esp32-s3-touch-lcd-1.85c', 'Waveshare ESP32-S3-Touch-LCD-1.85C', 33),
(101034, 101, 'Waveshare ESP32-S3-Touch-LCD-1.85', 'esp32-s3-touch-lcd-1.85', 'Waveshare ESP32-S3-Touch-LCD-1.85', 34),
(101035, 101, 'Waveshare ESP32-S3-Touch-LCD-1.46', 'esp32-s3-touch-lcd-1.46', 'Waveshare ESP32-S3-Touch-LCD-1.46', 35),
(101036, 101, 'Waveshare ESP32-S3-Touch-LCD-3.5', 'esp32-s3-touch-lcd-3.5', 'Waveshare ESP32-S3-Touch-LCD-3.5', 36),
(101037, 101, 'Tudouzi', 'tudouzi', 'Tudouzi', 37),
(101038, 101, 'LILYGO T-Circle-S3', 'lilygo-t-circle-s3', 'LILYGO T-Circle-S3', 38),
(101039, 101, 'LILYGO T-CameraPlus-S3', 'lilygo-t-cameraplus-s3', 'LILYGO T-CameraPlus-S3', 39),
(101040, 101, 'Movecall Moji AI Dev Board', 'movecall-moji-esp32s3', 'Movecall Moji AI Dev Board', 40),
(101041, 101, 'Movecall CuiCan AI Board', 'movecall-cuican-esp32s3', 'Movecall CuiCan AI Board', 41),
(101042, 101, 'Alientek DNESP32S3 Dev Board', 'atk-dnesp32s3', 'Alientek DNESP32S3 Dev Board', 42),
(101043, 101, 'Alientek DNESP32S3-BOX', 'atk-dnesp32s3-box', 'Alientek DNESP32S3-BOX', 43),
(101044, 101, 'DuDu CHATX (WiFi)', 'du-chatx', 'DuDu CHATX (WiFi)', 44),
(101045, 101, 'TaiJi Pi ESP32S3', 'taiji-pi-s3', 'TaiJi Pi ESP32S3', 45),
(101046, 101, 'XingZhi Cube 0.85 (WiFi)', 'xingzhi-cube-0.85tft-wifi', 'XingZhi Cube 0.85 (WiFi)', 46),
(101047, 101, 'XingZhi Cube 0.85 (ML307)', 'xingzhi-cube-0.85tft-ml307', 'XingZhi Cube 0.85 (ML307)', 47),
(101048, 101, 'XingZhi Cube 0.96 (WiFi)', 'xingzhi-cube-0.96oled-wifi', 'XingZhi Cube 0.96 (WiFi)', 48),
(101049, 101, 'XingZhi Cube 0.96 (ML307)', 'xingzhi-cube-0.96oled-ml307', 'XingZhi Cube 0.96 (ML307)', 49),
(101050, 101, 'XingZhi Cube 1.54 (WiFi)', 'xingzhi-cube-1.54tft-wifi', 'XingZhi Cube 1.54 (WiFi)', 50),
(101051, 101, 'XingZhi Cube 1.54 (ML307)', 'xingzhi-cube-1.54tft-ml307', 'XingZhi Cube 1.54 (ML307)', 51),
(101052, 101, 'SenseCAP Watcher', 'sensecap-watcher', 'SenseCAP Watcher', 52),
(101053, 101, 'DoIT AI Voice Box', 'doit-s3-aibox', 'DoIT AI Voice Box', 53),
(101054, 101, 'MixGo Nova', 'mixgo-nova', 'MixGo Nova', 54),
(101055, 101, 'DoIT AI 01 Kit', 'doit-ai-01-kit', 'DoIT AI 01 Kit', 55);

-- Dictionary data - Mobile area codes
INSERT INTO `sys_dict_data` (`id`, `dict_type_id`, `dict_label`, `dict_value`, `remark`, `sort`) VALUES
(102001, 102, 'China', '+86', 'China', 1),
(102002, 102, 'Hong Kong', '+852', 'Hong Kong', 2),
(102003, 102, 'Macau', '+853', 'Macau', 3),
(102004, 102, 'Taiwan', '+886', 'Taiwan', 4),
(102005, 102, 'USA/Canada', '+1', 'USA/Canada', 5),
(102006, 102, 'United Kingdom', '+44', 'United Kingdom', 6),
(102007, 102, 'France', '+33', 'France', 7),
(102008, 102, 'Italy', '+39', 'Italy', 8),
(102009, 102, 'Germany', '+49', 'Germany', 9),
(102010, 102, 'Poland', '+48', 'Poland', 10),
(102011, 102, 'Switzerland', '+41', 'Switzerland', 11),
(102012, 102, 'Spain', '+34', 'Spain', 12),
(102013, 102, 'Denmark', '+45', 'Denmark', 13),
(102014, 102, 'Malaysia', '+60', 'Malaysia', 14),
(102015, 102, 'Australia', '+61', 'Australia', 15),
(102016, 102, 'Indonesia', '+62', 'Indonesia', 16),
(102017, 102, 'Philippines', '+63', 'Philippines', 17),
(102018, 102, 'New Zealand', '+64', 'New Zealand', 18),
(102019, 102, 'Singapore', '+65', 'Singapore', 19),
(102020, 102, 'Thailand', '+66', 'Thailand', 20),
(102021, 102, 'Japan', '+81', 'Japan', 21),
(102022, 102, 'South Korea', '+82', 'South Korea', 22),
(102023, 102, 'Vietnam', '+84', 'Vietnam', 23),
(102024, 102, 'India', '+91', 'India', 24),
(102025, 102, 'Pakistan', '+92', 'Pakistan', 25),
(102026, 102, 'Nigeria', '+234', 'Nigeria', 26),
(102027, 102, 'Bangladesh', '+880', 'Bangladesh', 27),
(102028, 102, 'Saudi Arabia', '+966', 'Saudi Arabia', 28),
(102029, 102, 'UAE', '+971', 'United Arab Emirates', 29),
(102030, 102, 'Brazil', '+55', 'Brazil', 30),
(102031, 102, 'Mexico', '+52', 'Mexico', 31),
(102032, 102, 'Chile', '+56', 'Chile', 32),
(102033, 102, 'Argentina', '+54', 'Argentina', 33),
(102034, 102, 'Egypt', '+20', 'Egypt', 34),
(102035, 102, 'South Africa', '+27', 'South Africa', 35),
(102036, 102, 'Kenya', '+254', 'Kenya', 36),
(102037, 102, 'Tanzania', '+255', 'Tanzania', 37),
(102038, 102, 'Russia', '+7', 'Russia', 38);

-- ============================================================================
-- SECTION 9: SEED DATA - MODEL PROVIDERS (LLM/TTS + PLUGINS)
-- ============================================================================

-- Model Providers - LLM
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`) VALUES
('PROVIDER_LLM_GROQ', 'LLM', 'groq', 'Groq LLM', '[{"key": "api_key", "type": "string", "label": "API Key"}, {"key": "model_name", "type": "string", "label": "Model Name"}, {"key": "base_url", "type": "string", "label": "Base URL"}]', 0, 1, NOW()),
('PROVIDER_LLM_OPENAI', 'LLM', 'openai', 'OpenAI', '[{"key": "api_key", "type": "string", "label": "API Key"}, {"key": "model_name", "type": "string", "label": "Model Name"}, {"key": "base_url", "type": "string", "label": "Base URL"}]', 1, 1, NOW());

-- Model Providers - TTS
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`) VALUES
('PROVIDER_TTS_GROQ', 'TTS', 'groq_tts', 'Groq TTS', '[{"key": "api_key", "type": "string", "label": "API Key"}, {"key": "model", "type": "string", "label": "Model"}, {"key": "voice", "type": "string", "label": "Voice"}]', 0, 1, NOW()),
('PROVIDER_TTS_EDGE', 'TTS', 'edge', 'Edge TTS', '[{"key": "voice", "type": "string", "label": "Voice"}, {"key": "output_dir", "type": "string", "label": "Output Dir"}]', 1, 1, NOW()),
('PROVIDER_TTS_ELEVENLABS', 'TTS', 'elevenlabs', 'ElevenLabs', '[{"key": "api_key", "type": "string", "label": "API Key"}, {"key": "voice_id", "type": "string", "label": "Voice ID"}, {"key": "model_id", "type": "string", "label": "Model ID"}]', 2, 1, NOW());

-- Model Providers - PLUGINS
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`) VALUES
('SYSTEM_PLUGIN_MUSIC', 'Plugin', 'play_music', 'Music Playback', '[]', 10, 1, NOW()),
('SYSTEM_PLUGIN_STORY', 'Plugin', 'play_story', 'Story Playback', '[]', 11, 1, NOW()),
('SYSTEM_PLUGIN_WEATHER', 'Plugin', 'get_weather', 'Weather Query', '[{"key": "api_key", "type": "string", "label": "Weather API Key"}, {"key": "default_location", "type": "string", "label": "Default Location"}]', 20, 1, NOW()),
('SYSTEM_PLUGIN_HA_GET_STATE', 'Plugin', 'hass_get_state', 'HomeAssistant State Query', '[{"key": "base_url", "type": "string", "label": "HA Server URL"}, {"key": "api_key", "type": "string", "label": "HA API Token"}, {"key": "devices", "type": "array", "label": "Device List"}]', 30, 1, NOW()),
('SYSTEM_PLUGIN_HA_SET_STATE', 'Plugin', 'hass_set_state', 'HomeAssistant State Control', '[]', 31, 1, NOW()),
('SYSTEM_PLUGIN_HA_PLAY_MUSIC', 'Plugin', 'hass_play_music', 'HomeAssistant Music', '[]', 32, 1, NOW());

-- ============================================================================
-- SECTION 10: SEED DATA - MODEL CONFIGS
-- ============================================================================

-- Default model configs
INSERT INTO `ai_model_config` (`id`, `model_type`, `model_code`, `model_name`, `is_default`, `is_enabled`, `config_json`, `sort`, `creator`, `create_date`) VALUES
('LLM_Groq_Default', 'llm', 'Groq', 'Groq LLM', 1, 1, '{"type": "groq", "api_key": "", "base_url": "https://api.groq.com/openai/v1", "model_name": "llama-3.3-70b-versatile"}', 1, 1, NOW()),
('TTS_EdgeTTS', 'tts', 'EdgeTTS', 'Edge TTS', 1, 1, '{"type": "edge", "voice": "en-US-AnaNeural", "output_dir": "tmp/"}', 1, 1, NOW()),
('ASR_FunASR', 'asr', 'FunASR', 'FunASR', 1, 1, '{"type": "fun_asr"}', 1, 1, NOW()),
('VAD_SileroVAD', 'vad', 'SileroVAD', 'Silero VAD', 1, 1, '{"type": "silero_vad"}', 1, 1, NOW()),
('Memory_mem_local_short', 'memory', 'mem_local_short', 'Local Short Memory', 1, 1, '{"type": "mem_local_short"}', 1, 1, NOW()),
('Memory_nomem', 'memory', 'nomem', 'No Memory', 0, 1, '{"type": "nomem"}', 2, 1, NOW()),
('Intent_function_call', 'intent', 'function_call', 'Function Call', 1, 1, '{"type": "function_call"}', 1, 1, NOW());

-- TTS Voices
INSERT INTO `ai_tts_voice` (`id`, `tts_model_id`, `name`, `tts_voice`, `languages`, `sort`, `creator`, `create_date`) VALUES
('TTS_EdgeTTS0001', 'TTS_EdgeTTS', 'Ana (US)', 'en-US-AnaNeural', 'English', 1, 1, NOW()),
('TTS_EdgeTTS0002', 'TTS_EdgeTTS', 'Jenny (US)', 'en-US-JennyNeural', 'English', 2, 1, NOW()),
('TTS_EdgeTTS0003', 'TTS_EdgeTTS', 'Guy (US)', 'en-US-GuyNeural', 'English', 3, 1, NOW()),
('TTS_EdgeTTS0004', 'TTS_EdgeTTS', 'Aria (US)', 'en-US-AriaNeural', 'English', 4, 1, NOW());

-- ============================================================================
-- SECTION 11: SEED DATA - AGENT TEMPLATES
-- ============================================================================

-- Agent Templates
INSERT INTO `ai_agent_template` (`id`, `agent_code`, `agent_name`, `asr_model_id`, `vad_model_id`, `llm_model_id`, `tts_model_id`, `tts_voice_id`, `mem_model_id`, `intent_model_id`, `chat_history_conf`, `system_prompt`, `lang_code`, `language`, `sort`, `is_visible`, `creator`, `created_at`) VALUES
('TEMPLATE_CHEEKO', 'Cheeko', 'Cheeko', 'ASR_FunASR', 'VAD_SileroVAD', 'LLM_Groq_Default', 'TTS_EdgeTTS', 'TTS_EdgeTTS0001', 'Memory_mem_local_short', 'Intent_function_call', 1, 'You are CHEEKO, a fun, witty, and slightly mischievous AI friend for kids. Be energetic, dramatic, and expressive. Use Indian cultural references and expressions. Always be supportive and warm.', 'en', 'English', 0, 1, 1, NOW()),
('TEMPLATE_MATH_TUTOR', 'math_tutor', 'Math Tutor', 'ASR_FunASR', 'VAD_SileroVAD', 'LLM_Groq_Default', 'TTS_EdgeTTS', 'TTS_EdgeTTS0001', 'Memory_mem_local_short', 'Intent_function_call', 1, 'You are CHEEKO the Math Commander. Create fun math adventures with story-based problems. Use Indian contexts like cricket, festivals, and food. Celebrate correct answers enthusiastically!', 'en', 'English', 10, 1, 1, NOW()),
('TEMPLATE_WORD_LADDER', 'word_ladder', 'Word Ladder', 'ASR_FunASR', 'VAD_SileroVAD', 'LLM_Groq_Default', 'TTS_EdgeTTS', 'TTS_EdgeTTS0001', 'Memory_mem_local_short', 'Intent_function_call', 1, 'You are CHEEKO the Word Engine Pilot. Play word chain games where each word must start with the last letter of the previous word. Build chains of 10 words to win!', 'en', 'English', 11, 1, 1, NOW()),
('TEMPLATE_RIDDLE_SOLVER', 'riddle_solver', 'Riddle Solver', 'ASR_FunASR', 'VAD_SileroVAD', 'LLM_Groq_Default', 'TTS_EdgeTTS', 'TTS_EdgeTTS0001', 'Memory_mem_local_short', 'Intent_function_call', 1, 'You are CHEEKO the Master of Mysteries. Present riddles in mysterious locations. Use Indian objects and cultural references. Celebrate when riddles are solved!', 'en', 'English', 12, 1, 1, NOW()),
('TEMPLATE_STORYTELLER', 'storyteller', 'StoryTeller', 'ASR_FunASR', 'VAD_SileroVAD', 'LLM_Groq_Default', 'TTS_EdgeTTS', 'TTS_EdgeTTS0001', 'Memory_nomem', 'Intent_function_call', 2, 'You are CHEEKO the Storyteller. Read stories expressively with different voices for characters. Use sound effects and dramatic pauses. Also recite shlokas and mantras peacefully.', 'en', 'English', 13, 1, 1, NOW());

-- ============================================================================
-- SECTION 12: PLUGIN MAPPINGS FOR DEFAULT TEMPLATES
-- ============================================================================

-- Map play_music and play_story plugins to all templates
INSERT INTO `ai_agent_plugin_mapping` (`agent_id`, `plugin_id`, `param_info`) VALUES
('TEMPLATE_CHEEKO', 'SYSTEM_PLUGIN_MUSIC', '{}'),
('TEMPLATE_CHEEKO', 'SYSTEM_PLUGIN_STORY', '{}'),
('TEMPLATE_MATH_TUTOR', 'SYSTEM_PLUGIN_MUSIC', '{}'),
('TEMPLATE_MATH_TUTOR', 'SYSTEM_PLUGIN_STORY', '{}'),
('TEMPLATE_WORD_LADDER', 'SYSTEM_PLUGIN_MUSIC', '{}'),
('TEMPLATE_WORD_LADDER', 'SYSTEM_PLUGIN_STORY', '{}'),
('TEMPLATE_RIDDLE_SOLVER', 'SYSTEM_PLUGIN_MUSIC', '{}'),
('TEMPLATE_RIDDLE_SOLVER', 'SYSTEM_PLUGIN_STORY', '{}'),
('TEMPLATE_STORYTELLER', 'SYSTEM_PLUGIN_MUSIC', '{}'),
('TEMPLATE_STORYTELLER', 'SYSTEM_PLUGIN_STORY', '{}');

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
