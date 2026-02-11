-- Cheeko Backend - Complete Database Schema
-- Generated from live Supabase (project: fivhnaqizzcjckxvagfe)
-- Updated: 2026-02-11

-- =====================================================
-- SCHEMA
-- =====================================================
CREATE SCHEMA IF NOT EXISTS "public";

-- =====================================================
-- TABLES
-- =====================================================

-- sys_user
CREATE TABLE IF NOT EXISTS "sys_user" (
    "id" BIGINT NOT NULL DEFAULT nextval('sys_user_id_seq'::regclass),
    "username" VARCHAR(100),
    "password" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "nickname" VARCHAR(100),
    "avatar" VARCHAR(500),
    "gender" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "role" VARCHAR(50) DEFAULT 'user'::character varying,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- sys_user_token
CREATE TABLE IF NOT EXISTS "sys_user_token" (
    "id" BIGINT NOT NULL DEFAULT nextval('sys_user_token_id_seq'::regclass),
    "user_id" BIGINT NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expire_date" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_token_pkey" PRIMARY KEY ("id")
);

-- sys_params
CREATE TABLE IF NOT EXISTS "sys_params" (
    "id" BIGINT NOT NULL DEFAULT nextval('sys_params_id_seq'::regclass),
    "param_code" VARCHAR(100) NOT NULL,
    "param_value" TEXT,
    "value_type" VARCHAR(50) DEFAULT 'string'::character varying,
    "param_type" INTEGER DEFAULT 1,
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_params_pkey" PRIMARY KEY ("id")
);

-- sys_dict_type
CREATE TABLE IF NOT EXISTS "sys_dict_type" (
    "id" BIGINT NOT NULL DEFAULT nextval('sys_dict_type_id_seq'::regclass),
    "dict_type" VARCHAR(100) NOT NULL,
    "dict_name" VARCHAR(255) NOT NULL,
    "remark" VARCHAR(500),
    "sort" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_dict_type_pkey" PRIMARY KEY ("id")
);

-- sys_dict_data
CREATE TABLE IF NOT EXISTS "sys_dict_data" (
    "id" BIGINT NOT NULL DEFAULT nextval('sys_dict_data_id_seq'::regclass),
    "dict_type_id" BIGINT,
    "dict_type" VARCHAR(100),
    "dict_label" VARCHAR(255) NOT NULL,
    "dict_value" VARCHAR(255) NOT NULL,
    "remark" VARCHAR(500),
    "sort" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_dict_data_pkey" PRIMARY KEY ("id")
);

-- parent_profiles (RLS enabled)
CREATE TABLE IF NOT EXISTS "parent_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "sys_user_id" BIGINT,
    "display_name" TEXT,
    "email" TEXT,
    "phone_number" TEXT,
    "avatar_url" TEXT,
    "preferred_language" TEXT DEFAULT 'en'::text,
    "timezone" TEXT DEFAULT 'UTC'::text,
    "notification_preferences" JSONB DEFAULT '{"push": true, "email": true, "daily_summary": true}'::jsonb,
    "onboarding_completed" BOOLEAN DEFAULT false,
    "terms_accepted_at" TIMESTAMPTZ,
    "privacy_policy_accepted_at" TIMESTAMPTZ,
    "terms_version" TEXT,
    "fcm_token" TEXT,
    "java_user_id" INTEGER,
    "java_token" TEXT,
    "generated_password_hash" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),
    "parent_name" TEXT,
    "email_notifications" BOOLEAN DEFAULT true,
    "push_notifications" BOOLEAN DEFAULT true,
    "weekly_report" BOOLEAN DEFAULT true,

    CONSTRAINT "parent_profiles_pkey" PRIMARY KEY ("id")
);

-- kid_profile
CREATE TABLE IF NOT EXISTS "kid_profile" (
    "id" BIGINT NOT NULL DEFAULT nextval('kid_profile_id_seq'::regclass),
    "user_id" BIGINT,
    "name" VARCHAR(100) NOT NULL,
    "birth_date" DATE,
    "gender" VARCHAR(20),
    "grade" VARCHAR(50),
    "interests" TEXT[],
    "language" VARCHAR(10) DEFAULT 'en'::character varying,
    "preferences" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),
    "additional_notes" TEXT,

    CONSTRAINT "kid_profile_pkey" PRIMARY KEY ("id")
);

-- kid_learning_progress
CREATE TABLE IF NOT EXISTS "kid_learning_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" BIGINT,
    "subject" VARCHAR(100) NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "score" INTEGER,
    "time_spent" INTEGER,
    "completed" BOOLEAN DEFAULT false,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "kid_learning_progress_pkey" PRIMARY KEY ("id")
);

-- kid_activity_log
CREATE TABLE IF NOT EXISTS "kid_activity_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" BIGINT,
    "activity_type" VARCHAR(50) NOT NULL,
    "content_type" VARCHAR(50),
    "content_id" UUID,
    "duration" INTEGER,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "kid_activity_log_pkey" PRIMARY KEY ("id")
);

-- ai_model_provider
CREATE TABLE IF NOT EXISTS "ai_model_provider" (
    "id" VARCHAR(36) NOT NULL DEFAULT (gen_random_uuid())::text,
    "model_type" VARCHAR(50) NOT NULL,
    "provider_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_provider_pkey" PRIMARY KEY ("id")
);

-- ai_model_config
CREATE TABLE IF NOT EXISTS "ai_model_config" (
    "id" VARCHAR(36) NOT NULL DEFAULT (gen_random_uuid())::text,
    "model_type" VARCHAR(50) NOT NULL,
    "model_code" VARCHAR(100) NOT NULL,
    "model_name" VARCHAR(255) NOT NULL,
    "is_default" SMALLINT NOT NULL DEFAULT 0,
    "is_enabled" SMALLINT NOT NULL DEFAULT 1,
    "config_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "doc_link" VARCHAR(500),
    "remark" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_config_pkey" PRIMARY KEY ("id")
);

-- ai_tts_voice
CREATE TABLE IF NOT EXISTS "ai_tts_voice" (
    "id" VARCHAR(36) NOT NULL DEFAULT (gen_random_uuid())::text,
    "tts_model_id" VARCHAR(36),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "languages" VARCHAR(255),
    "name" VARCHAR(255) NOT NULL,
    "reference_audio" VARCHAR(500),
    "reference_text" TEXT,
    "remark" VARCHAR(500),
    "tts_voice" VARCHAR(100),
    "update_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "voice_demo" VARCHAR(500),

    CONSTRAINT "ai_tts_voice_pkey" PRIMARY KEY ("id")
);

-- ai_agent
CREATE TABLE IF NOT EXISTS "ai_agent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" BIGINT,
    "agent_code" VARCHAR(100),
    "agent_name" VARCHAR(200) NOT NULL,
    "asr_model_id" UUID,
    "vad_model_id" UUID,
    "llm_model_id" UUID,
    "vllm_model_id" UUID,
    "tts_model_id" UUID,
    "tts_voice_id" UUID,
    "mem_model_id" UUID,
    "intent_model_id" UUID,
    "chat_history_conf" INTEGER DEFAULT 0,
    "system_prompt" TEXT,
    "summary_memory" TEXT,
    "lang_code" VARCHAR(10) DEFAULT 'en'::character varying,
    "language" VARCHAR(50) DEFAULT 'English'::character varying,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_agent_pkey" PRIMARY KEY ("id")
);

-- ai_agent_template
CREATE TABLE IF NOT EXISTS "ai_agent_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_code" VARCHAR(100),
    "agent_name" VARCHAR(200) NOT NULL,
    "asr_model_id" UUID,
    "vad_model_id" UUID,
    "llm_model_id" UUID,
    "vllm_model_id" UUID,
    "tts_model_id" UUID,
    "tts_voice_id" UUID,
    "mem_model_id" UUID,
    "intent_model_id" UUID,
    "chat_history_conf" INTEGER DEFAULT 1,
    "system_prompt" TEXT,
    "summary_memory" TEXT,
    "lang_code" VARCHAR(10) DEFAULT 'en'::character varying,
    "language" VARCHAR(50) DEFAULT 'English'::character varying,
    "sort" INTEGER DEFAULT 0,
    "is_visible" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_template_pkey" PRIMARY KEY ("id")
);

-- ai_agent_chat_history
CREATE TABLE IF NOT EXISTS "ai_agent_chat_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mac_address" VARCHAR(20),
    "agent_id" UUID,
    "session_id" VARCHAR(100) NOT NULL,
    "chat_type" INTEGER NOT NULL,
    "content" TEXT,
    "audio_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_agent_chat_history_pkey" PRIMARY KEY ("id")
);

-- ai_device
CREATE TABLE IF NOT EXISTS "ai_device" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" BIGINT,
    "mac_address" VARCHAR(20) NOT NULL,
    "last_connected_at" TIMESTAMPTZ,
    "auto_update" SMALLINT DEFAULT 1,
    "board" VARCHAR(100),
    "alias" VARCHAR(255),
    "agent_id" UUID,
    "kid_id" BIGINT,
    "mode" VARCHAR(50) DEFAULT 'conversation'::character varying,
    "device_mode" VARCHAR(50) DEFAULT 'auto'::character varying,
    "app_version" VARCHAR(50),
    "sort" INTEGER DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_device_pkey" PRIMARY KEY ("id")
);

-- device_token_usage
CREATE TABLE IF NOT EXISTS "device_token_usage" (
    "id" BIGINT NOT NULL DEFAULT nextval('device_token_usage_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "session_id" VARCHAR(100),
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "avg_ttft_seconds" NUMERIC DEFAULT 0,
    "message_count" INTEGER DEFAULT 0,
    "session_count" INTEGER DEFAULT 0,
    "usage_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "input_audio_tokens" INTEGER DEFAULT 0,
    "input_cached_tokens" INTEGER DEFAULT 0,
    "input_text_tokens" INTEGER DEFAULT 0,
    "output_audio_tokens" INTEGER DEFAULT 0,
    "output_text_tokens" INTEGER DEFAULT 0,
    "session_duration_seconds" NUMERIC DEFAULT 0,
    "total_response_duration_seconds" NUMERIC DEFAULT 0,

    CONSTRAINT "device_token_usage_pkey" PRIMARY KEY ("id")
);

-- ai_ota
CREATE TABLE IF NOT EXISTS "ai_ota" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firmware_name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "size" INTEGER,
    "remark" TEXT,
    "firmware_path" VARCHAR(500),
    "force_update" INTEGER DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_ota_pkey" PRIMARY KEY ("id")
);

-- content_library
CREATE TABLE IF NOT EXISTS "content_library" (
    "id" BIGINT NOT NULL DEFAULT nextval('content_library_id_seq'::regclass),
    "content_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "url" VARCHAR(1000),
    "thumbnail_url" VARCHAR(500),
    "duration_seconds" INTEGER,
    "category" VARCHAR(100),
    "tags" JSONB DEFAULT '[]'::jsonb,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "language" VARCHAR(50) DEFAULT 'en'::character varying,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "status" INTEGER DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_library_pkey" PRIMARY KEY ("id")
);

-- device_playlist
CREATE TABLE IF NOT EXISTS "device_playlist" (
    "id" BIGINT NOT NULL DEFAULT nextval('device_playlist_id_seq'::regclass),
    "device_id" BIGINT,
    "mac_address" VARCHAR(50),
    "content_id" BIGINT,
    "playlist_type" VARCHAR(50) DEFAULT 'music'::character varying,
    "position" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_playlist_pkey" PRIMARY KEY ("id")
);

-- music_playlist
CREATE TABLE IF NOT EXISTS "music_playlist" (
    "id" BIGINT NOT NULL DEFAULT nextval('music_playlist_id_seq'::regclass),
    "device_id" UUID NOT NULL,
    "content_id" BIGINT NOT NULL,
    "position" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_playlist_pkey" PRIMARY KEY ("id")
);

-- story_playlist
CREATE TABLE IF NOT EXISTS "story_playlist" (
    "id" BIGINT NOT NULL DEFAULT nextval('story_playlist_id_seq'::regclass),
    "device_id" UUID NOT NULL,
    "content_id" BIGINT NOT NULL,
    "position" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_playlist_pkey" PRIMARY KEY ("id")
);

-- ai_music
CREATE TABLE IF NOT EXISTS "ai_music" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(300) NOT NULL,
    "artist" VARCHAR(200),
    "album" VARCHAR(200),
    "category" VARCHAR(100),
    "language" VARCHAR(50),
    "duration" INTEGER,
    "file_url" VARCHAR(500),
    "cover_url" VARCHAR(500),
    "lyrics" TEXT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_music_pkey" PRIMARY KEY ("id")
);

-- ai_story
CREATE TABLE IF NOT EXISTS "ai_story" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(300) NOT NULL,
    "author" VARCHAR(200),
    "category" VARCHAR(100),
    "language" VARCHAR(50),
    "age_group" VARCHAR(50),
    "duration" INTEGER,
    "content" TEXT,
    "audio_url" VARCHAR(500),
    "cover_url" VARCHAR(500),
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_story_pkey" PRIMARY KEY ("id")
);

-- ai_textbook
CREATE TABLE IF NOT EXISTS "ai_textbook" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(300) NOT NULL,
    "subject" VARCHAR(100),
    "grade" VARCHAR(50),
    "language" VARCHAR(50),
    "publisher" VARCHAR(200),
    "cover_url" VARCHAR(500),
    "description" TEXT,
    "sort" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_textbook_pkey" PRIMARY KEY ("id")
);

-- ai_textbook_chapter
CREATE TABLE IF NOT EXISTS "ai_textbook_chapter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "textbook_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "content" TEXT,
    "audio_url" VARCHAR(500),
    "sort" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_textbook_chapter_pkey" PRIMARY KEY ("id")
);

-- ai_rfid_tag
CREATE TABLE IF NOT EXISTS "ai_rfid_tag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uid" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200),
    "description" TEXT,
    "content_type" VARCHAR(50),
    "content_id" UUID,
    "action_type" VARCHAR(50),
    "action_params" JSONB,
    "device_mac" VARCHAR(20),
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT now(),
    "updated_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_rfid_tag_pkey" PRIMARY KEY ("id")
);

-- ai_rfid_scan_log
CREATE TABLE IF NOT EXISTS "ai_rfid_scan_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mac_address" VARCHAR(20),
    "rfid_uid" VARCHAR(50),
    "tag_id" UUID,
    "created_at" TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT "ai_rfid_scan_log_pkey" PRIMARY KEY ("id")
);

-- rfid_pack
CREATE TABLE IF NOT EXISTS "rfid_pack" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_pack_id_seq'::regclass),
    "pack_name" VARCHAR(255) NOT NULL,
    "pack_code" VARCHAR(100),
    "description" TEXT,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "language" VARCHAR(50) DEFAULT 'en'::character varying,
    "active" BOOLEAN DEFAULT true,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_pack_pkey" PRIMARY KEY ("id")
);

-- rfid_question
CREATE TABLE IF NOT EXISTS "rfid_question" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_question_id_seq'::regclass),
    "code" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "system_prompt_override" TEXT,
    "allow_caching" BOOLEAN DEFAULT true,
    "cached_audio_url" VARCHAR(500),
    "language" VARCHAR(10) DEFAULT 'en'::character varying,
    "category" VARCHAR(100),
    "difficulty" INTEGER DEFAULT 1,
    "active" BOOLEAN DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_question_pkey" PRIMARY KEY ("id")
);

-- rfid_content_pack
CREATE TABLE IF NOT EXISTS "rfid_content_pack" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_content_pack_id_seq'::regclass),
    "pack_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "content_type" VARCHAR(50) DEFAULT 'prompt'::character varying,
    "total_items" INTEGER DEFAULT 0,
    "language" VARCHAR(10) DEFAULT 'en'::character varying,
    "version" INTEGER DEFAULT 1,
    "status" VARCHAR(20) DEFAULT 'draft'::character varying,
    "age_range" VARCHAR(20),
    "thumbnail_url" VARCHAR(500),
    "content_md" TEXT,
    "cached_audio_urls" TEXT,
    "content_hash" VARCHAR(100),
    "active" BOOLEAN DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_content_pack_pkey" PRIMARY KEY ("id")
);

-- content_item
CREATE TABLE IF NOT EXISTS "content_item" (
    "id" BIGINT NOT NULL DEFAULT nextval('content_item_id_seq'::regclass),
    "content_pack_id" BIGINT,
    "item_number" INTEGER NOT NULL,
    "title" VARCHAR(255),
    "description" TEXT,
    "audio_url" VARCHAR(500),
    "image_url" VARCHAR(500),
    "content_text" TEXT,
    "audio_duration_ms" BIGINT,
    "active" BOOLEAN DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_item_pkey" PRIMARY KEY ("id")
);

-- rfid_question_pack
CREATE TABLE IF NOT EXISTS "rfid_question_pack" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_question_pack_id_seq'::regclass),
    "pack_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "question_ids" JSONB DEFAULT '[]'::jsonb,
    "language" VARCHAR(10) DEFAULT 'en'::character varying,
    "category" VARCHAR(100),
    "version" INTEGER DEFAULT 1,
    "status" VARCHAR(20) DEFAULT 'draft'::character varying,
    "active" BOOLEAN DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_question_pack_pkey" PRIMARY KEY ("id")
);

-- rfid_series
CREATE TABLE IF NOT EXISTS "rfid_series" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_series_id_seq'::regclass),
    "series_name" VARCHAR(255),
    "start_uid" VARCHAR(100) NOT NULL,
    "end_uid" VARCHAR(100) NOT NULL,
    "content_pack_id" BIGINT,
    "priority" INTEGER DEFAULT 0,
    "status" INTEGER DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "question_pack_id" BIGINT,

    CONSTRAINT "rfid_series_pkey" PRIMARY KEY ("id")
);

-- rfid_card_mapping
CREATE TABLE IF NOT EXISTS "rfid_card_mapping" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_card_mapping_id_seq'::regclass),
    "rfid_uid" VARCHAR(100) NOT NULL,
    "content_pack_id" BIGINT,
    "pack_id" BIGINT,
    "question_id" BIGINT,
    "question_pack_id" BIGINT,
    "question_ids" JSONB DEFAULT '[]'::jsonb,
    "pack_code" VARCHAR(100),
    "action_type" VARCHAR(50) DEFAULT 'content'::character varying,
    "action_data" JSONB DEFAULT '{}'::jsonb,
    "notes" TEXT,
    "active" BOOLEAN DEFAULT true,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_card_mapping_pkey" PRIMARY KEY ("id")
);

-- rfid_scan_log
CREATE TABLE IF NOT EXISTS "rfid_scan_log" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_scan_log_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "rfid_uid" VARCHAR(100) NOT NULL,
    "action_taken" VARCHAR(100),
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_scan_log_pkey" PRIMARY KEY ("id")
);

-- rfid_tags
CREATE TABLE IF NOT EXISTS "rfid_tags" (
    "id" BIGINT NOT NULL DEFAULT nextval('rfid_tags_id_seq'::regclass),
    "uid" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255),
    "description" TEXT,
    "content_type" VARCHAR(50),
    "content_id" BIGINT,
    "status" INTEGER DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_tags_pkey" PRIMARY KEY ("id")
);

-- game_session
CREATE TABLE IF NOT EXISTS "game_session" (
    "id" BIGINT NOT NULL DEFAULT nextval('game_session_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "game_type" VARCHAR(50) NOT NULL,
    "session_id" VARCHAR(100),
    "started_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "total_attempts" INTEGER DEFAULT 0,
    "correct_attempts" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_session_pkey" PRIMARY KEY ("id")
);

-- radio_schedule (RLS enabled)
CREATE TABLE IF NOT EXISTS "radio_schedule" (
    "id" BIGINT NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "program_name" TEXT NOT NULL,
    "playlist_id" TEXT,
    "stream_url" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    "day_of_week" SMALLINT,

    CONSTRAINT "radio_schedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_day_of_week" CHECK (((day_of_week >= 0) AND (day_of_week <= 6)) OR (day_of_week IS NULL))
);

-- email_report_config
CREATE TABLE IF NOT EXISTS "email_report_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_hour" INTEGER NOT NULL DEFAULT 8,
    "schedule_timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata'::character varying,
    "recipients" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "sections" JSONB NOT NULL DEFAULT '{"alerts": true, "tokens": true, "content": true, "devices": true, "summary": true, "learning": true}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_report_config_pkey" PRIMARY KEY ("id")
);

-- email_report_history
CREATE TABLE IF NOT EXISTS "email_report_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_date" DATE NOT NULL,
    "recipients" TEXT[],
    "status" VARCHAR(50) NOT NULL,
    "error_message" TEXT,
    "report_data" JSONB DEFAULT '{}'::jsonb,
    "sent_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_report_history_pkey" PRIMARY KEY ("id")
);

-- analytics_game_sessions
CREATE TABLE IF NOT EXISTS "analytics_game_sessions" (
    "id" BIGINT NOT NULL DEFAULT nextval('analytics_game_sessions_id_seq'::regclass),
    "session_id" VARCHAR(100) NOT NULL,
    "mac_address" VARCHAR(50) NOT NULL,
    "agent_id" UUID,
    "mode_type" VARCHAR(50) NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "interaction_count" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "completion_status" VARCHAR(50) DEFAULT 'completed'::character varying,

    CONSTRAINT "analytics_game_sessions_pkey" PRIMARY KEY ("id")
);

-- analytics_game_attempts
CREATE TABLE IF NOT EXISTS "analytics_game_attempts" (
    "id" BIGINT NOT NULL DEFAULT nextval('analytics_game_attempts_id_seq'::regclass),
    "session_id" VARCHAR(100) NOT NULL,
    "mac_address" VARCHAR(50) NOT NULL,
    "game_type" VARCHAR(50) NOT NULL,
    "user_answer" TEXT,
    "correct_answer" TEXT,
    "is_correct" BOOLEAN,
    "attempt_time" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "response_time_ms" INTEGER,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ,
    "attempt_number" INTEGER DEFAULT 1,
    "difficulty_level" VARCHAR(20),
    "question_type" VARCHAR(50),
    "question_text" TEXT,

    CONSTRAINT "analytics_game_attempts_pkey" PRIMARY KEY ("id")
);

-- analytics_media_playback
CREATE TABLE IF NOT EXISTS "analytics_media_playback" (
    "id" BIGINT NOT NULL DEFAULT nextval('analytics_media_playback_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "content_id" BIGINT,
    "content_type" VARCHAR(50) NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "position_seconds" INTEGER DEFAULT 0,
    "duration_seconds" INTEGER,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_media_playback_pkey" PRIMARY KEY ("id")
);

-- analytics_streaks
CREATE TABLE IF NOT EXISTS "analytics_streaks" (
    "id" BIGINT NOT NULL DEFAULT nextval('analytics_streaks_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "streak_type" VARCHAR(50) NOT NULL,
    "streak_date" DATE NOT NULL,
    "streak_count" INTEGER DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_streaks_pkey" PRIMARY KEY ("id")
);

-- analytics_user_progress
CREATE TABLE IF NOT EXISTS "analytics_user_progress" (
    "id" BIGINT NOT NULL DEFAULT nextval('analytics_user_progress_id_seq'::regclass),
    "mac_address" VARCHAR(50) NOT NULL,
    "kid_id" BIGINT,
    "total_sessions" INTEGER DEFAULT 0,
    "total_duration_seconds" INTEGER DEFAULT 0,
    "total_games_played" INTEGER DEFAULT 0,
    "total_correct_answers" INTEGER DEFAULT 0,
    "total_wrong_answers" INTEGER DEFAULT 0,
    "current_streak" INTEGER DEFAULT 0,
    "longest_streak" INTEGER DEFAULT 0,
    "last_activity_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_user_progress_pkey" PRIMARY KEY ("id")
);

-- =====================================================
-- UNIQUE CONSTRAINTS
-- =====================================================

ALTER TABLE "sys_user" ADD CONSTRAINT "sys_user_username_key" UNIQUE ("username");
ALTER TABLE "sys_user" ADD CONSTRAINT "sys_user_email_key" UNIQUE ("email");
ALTER TABLE "sys_params" ADD CONSTRAINT "sys_params_param_code_key" UNIQUE ("param_code");
ALTER TABLE "sys_dict_type" ADD CONSTRAINT "sys_dict_type_dict_type_key" UNIQUE ("dict_type");
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_user_id_key" UNIQUE ("user_id");
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_sys_user_id_key" UNIQUE ("sys_user_id");
ALTER TABLE "ai_model_provider" ADD CONSTRAINT "ai_model_provider_model_type_provider_code_key" UNIQUE ("model_type", "provider_code");
ALTER TABLE "ai_ota" ADD CONSTRAINT "ai_ota_type_version_key" UNIQUE ("type", "version");
ALTER TABLE "ai_device" ADD CONSTRAINT "ai_device_mac_address_key" UNIQUE ("mac_address");
ALTER TABLE "ai_rfid_tag" ADD CONSTRAINT "ai_rfid_tag_uid_key" UNIQUE ("uid");
ALTER TABLE "device_token_usage" ADD CONSTRAINT "device_token_usage_mac_address_usage_date_key" UNIQUE ("mac_address", "usage_date");
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_content_pack_id_item_number_key" UNIQUE ("content_pack_id", "item_number");
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_pack_sequence_key" UNIQUE ("content_pack_id", "item_number");
ALTER TABLE "music_playlist" ADD CONSTRAINT "music_playlist_device_id_content_id_key" UNIQUE ("device_id", "content_id");
ALTER TABLE "story_playlist" ADD CONSTRAINT "story_playlist_device_id_content_id_key" UNIQUE ("device_id", "content_id");
ALTER TABLE "kid_learning_progress" ADD CONSTRAINT "kid_learning_progress_kid_id_subject_topic_key" UNIQUE ("kid_id", "subject", "topic");
ALTER TABLE "rfid_pack" ADD CONSTRAINT "rfid_pack_pack_code_key" UNIQUE ("pack_code");
ALTER TABLE "rfid_question" ADD CONSTRAINT "rfid_question_code_key" UNIQUE ("code");
ALTER TABLE "rfid_content_pack" ADD CONSTRAINT "rfid_content_pack_pack_code_key" UNIQUE ("pack_code");
ALTER TABLE "rfid_question_pack" ADD CONSTRAINT "rfid_question_pack_pack_code_key" UNIQUE ("pack_code");
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_rfid_uid_key" UNIQUE ("rfid_uid");
ALTER TABLE "rfid_tags" ADD CONSTRAINT "rfid_tags_uid_key" UNIQUE ("uid");
ALTER TABLE "analytics_game_sessions" ADD CONSTRAINT "analytics_game_sessions_session_id_key" UNIQUE ("session_id");
ALTER TABLE "analytics_streaks" ADD CONSTRAINT "analytics_streaks_mac_address_streak_type_streak_date_key" UNIQUE ("mac_address", "streak_type", "streak_date");
ALTER TABLE "analytics_user_progress" ADD CONSTRAINT "analytics_user_progress_mac_address_key" UNIQUE ("mac_address");

-- =====================================================
-- INDEXES
-- =====================================================

-- sys_user
CREATE INDEX IF NOT EXISTS "idx_sys_user_token_user_id" ON "sys_user_token" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_sys_user_token_token" ON "sys_user_token" ("token");
CREATE INDEX IF NOT EXISTS "idx_sys_user_token_expire" ON "sys_user_token" ("expire_date");

-- sys_dict_data
CREATE INDEX IF NOT EXISTS "idx_sys_dict_data_type" ON "sys_dict_data" ("dict_type");

-- parent_profiles
CREATE INDEX IF NOT EXISTS "idx_parent_profiles_user_id" ON "parent_profiles" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_parent_profiles_sys_user_id" ON "parent_profiles" ("sys_user_id");
CREATE INDEX IF NOT EXISTS "idx_parent_profiles_email" ON "parent_profiles" ("email");
CREATE INDEX IF NOT EXISTS "idx_parent_profiles_created_at" ON "parent_profiles" ("created_at" DESC);

-- kid_profile
CREATE INDEX IF NOT EXISTS "idx_kid_profile_user" ON "kid_profile" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_kid_profile_user_id" ON "kid_profile" ("user_id");

-- ai_model_provider
CREATE INDEX IF NOT EXISTS "ai_model_provider_model_type_idx" ON "ai_model_provider" ("model_type");
CREATE INDEX IF NOT EXISTS "ai_model_provider_provider_code_idx" ON "ai_model_provider" ("provider_code");

-- ai_model_config
CREATE INDEX IF NOT EXISTS "ai_model_config_model_type_idx" ON "ai_model_config" ("model_type");
CREATE INDEX IF NOT EXISTS "ai_model_config_model_code_idx" ON "ai_model_config" ("model_code");
CREATE INDEX IF NOT EXISTS "ai_model_config_is_default_idx" ON "ai_model_config" ("is_default");

-- ai_agent
CREATE INDEX IF NOT EXISTS "idx_ai_agent_user" ON "ai_agent" ("user_id");

-- ai_agent_template
CREATE INDEX IF NOT EXISTS "ai_agent_template_agent_code_idx" ON "ai_agent_template" ("agent_code");
CREATE INDEX IF NOT EXISTS "ai_agent_template_is_visible_idx" ON "ai_agent_template" ("is_visible");

-- ai_agent_chat_history
CREATE INDEX IF NOT EXISTS "idx_chat_history_agent" ON "ai_agent_chat_history" ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_chat_history_session" ON "ai_agent_chat_history" ("session_id");

-- ai_device
CREATE INDEX IF NOT EXISTS "idx_ai_device_user" ON "ai_device" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_device_mac" ON "ai_device" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_ai_device_agent" ON "ai_device" ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_ai_device_kid" ON "ai_device" ("kid_id");

-- device_token_usage
CREATE INDEX IF NOT EXISTS "idx_device_token_usage_mac" ON "device_token_usage" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_device_token_usage_date" ON "device_token_usage" ("usage_date");

-- ai_ota
CREATE INDEX IF NOT EXISTS "idx_ai_ota_type" ON "ai_ota" ("type");
CREATE INDEX IF NOT EXISTS "idx_ai_ota_version" ON "ai_ota" ("version");

-- ai_rfid_tag
CREATE INDEX IF NOT EXISTS "idx_rfid_uid" ON "ai_rfid_tag" ("uid");

-- content_library
CREATE INDEX IF NOT EXISTS "idx_content_library_type" ON "content_library" ("content_type");
CREATE INDEX IF NOT EXISTS "idx_content_library_category" ON "content_library" ("category");

-- content_item
CREATE INDEX IF NOT EXISTS "idx_content_item_pack" ON "content_item" ("content_pack_id");

-- device_playlist
CREATE INDEX IF NOT EXISTS "idx_device_playlist_mac" ON "device_playlist" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_device_playlist_type" ON "device_playlist" ("playlist_type");

-- rfid_pack
CREATE INDEX IF NOT EXISTS "idx_rfid_pack_code" ON "rfid_pack" ("pack_code");
CREATE INDEX IF NOT EXISTS "idx_rfid_pack_active" ON "rfid_pack" ("active");

-- rfid_question
CREATE INDEX IF NOT EXISTS "idx_rfid_question_code" ON "rfid_question" ("code");
CREATE INDEX IF NOT EXISTS "idx_rfid_question_active" ON "rfid_question" ("active");

-- rfid_content_pack
CREATE INDEX IF NOT EXISTS "idx_rfid_content_pack_code" ON "rfid_content_pack" ("pack_code");

-- rfid_question_pack
CREATE INDEX IF NOT EXISTS "idx_rfid_question_pack_code" ON "rfid_question_pack" ("pack_code");
CREATE INDEX IF NOT EXISTS "idx_rfid_question_pack_active" ON "rfid_question_pack" ("active");

-- rfid_series
CREATE INDEX IF NOT EXISTS "idx_rfid_series_range" ON "rfid_series" ("start_uid", "end_uid");

-- rfid_card_mapping
CREATE INDEX IF NOT EXISTS "idx_rfid_card_mapping_uid" ON "rfid_card_mapping" ("rfid_uid");

-- game_session
CREATE INDEX IF NOT EXISTS "idx_game_session_mac" ON "game_session" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_game_session_type" ON "game_session" ("game_type");

-- radio_schedule
CREATE INDEX IF NOT EXISTS "idx_radio_schedule_day_time" ON "radio_schedule" ("day_of_week", "start_time");

-- analytics_game_sessions
CREATE INDEX IF NOT EXISTS "idx_analytics_sessions_mac" ON "analytics_game_sessions" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_analytics_sessions_started" ON "analytics_game_sessions" ("started_at");

-- analytics_game_attempts
CREATE INDEX IF NOT EXISTS "idx_analytics_attempts_session" ON "analytics_game_attempts" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_analytics_attempts_mac" ON "analytics_game_attempts" ("mac_address");
CREATE INDEX IF NOT EXISTS "idx_analytics_attempts_game" ON "analytics_game_attempts" ("game_type");
CREATE INDEX IF NOT EXISTS "idx_analytics_attempts_correct" ON "analytics_game_attempts" ("is_correct");

-- analytics_media_playback
CREATE INDEX IF NOT EXISTS "idx_analytics_media_mac" ON "analytics_media_playback" ("mac_address");

-- =====================================================
-- FOREIGN KEYS
-- =====================================================

-- sys_user_token -> sys_user
ALTER TABLE "sys_user_token" ADD CONSTRAINT "sys_user_token_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE;

-- sys_dict_data -> sys_dict_type
ALTER TABLE "sys_dict_data" ADD CONSTRAINT "sys_dict_data_dict_type_id_fkey"
    FOREIGN KEY ("dict_type_id") REFERENCES "sys_dict_type"("id") ON DELETE CASCADE;

-- parent_profiles -> auth.users (Supabase Auth)
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;

-- parent_profiles -> sys_user
ALTER TABLE "parent_profiles" ADD CONSTRAINT "parent_profiles_sys_user_id_fkey"
    FOREIGN KEY ("sys_user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE;

-- kid_profile -> sys_user
ALTER TABLE "kid_profile" ADD CONSTRAINT "kid_profile_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sys_user"("id");

-- kid_learning_progress -> kid_profile
ALTER TABLE "kid_learning_progress" ADD CONSTRAINT "kid_learning_progress_kid_id_fkey"
    FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id");

-- kid_activity_log -> kid_profile
ALTER TABLE "kid_activity_log" ADD CONSTRAINT "kid_activity_log_kid_id_fkey"
    FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id");

-- ai_tts_voice -> ai_model_config
ALTER TABLE "ai_tts_voice" ADD CONSTRAINT "ai_tts_voice_tts_model_id_fkey"
    FOREIGN KEY ("tts_model_id") REFERENCES "ai_model_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ai_agent -> sys_user
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sys_user"("id");

-- ai_agent_chat_history -> ai_agent
ALTER TABLE "ai_agent_chat_history" ADD CONSTRAINT "ai_agent_chat_history_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id");

-- ai_device -> sys_user
ALTER TABLE "ai_device" ADD CONSTRAINT "ai_device_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE SET NULL;

-- ai_textbook_chapter -> ai_textbook
ALTER TABLE "ai_textbook_chapter" ADD CONSTRAINT "ai_textbook_chapter_textbook_id_fkey"
    FOREIGN KEY ("textbook_id") REFERENCES "ai_textbook"("id") ON DELETE CASCADE;

-- ai_rfid_scan_log -> ai_rfid_tag
ALTER TABLE "ai_rfid_scan_log" ADD CONSTRAINT "ai_rfid_scan_log_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "ai_rfid_tag"("id");

-- device_playlist -> content_library
ALTER TABLE "device_playlist" ADD CONSTRAINT "device_playlist_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "content_library"("id") ON DELETE CASCADE;

-- content_item -> rfid_content_pack
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_content_pack_id_fkey"
    FOREIGN KEY ("content_pack_id") REFERENCES "rfid_content_pack"("id") ON DELETE CASCADE;

-- rfid_series -> rfid_content_pack
ALTER TABLE "rfid_series" ADD CONSTRAINT "rfid_series_content_pack_id_fkey"
    FOREIGN KEY ("content_pack_id") REFERENCES "rfid_content_pack"("id") ON DELETE SET NULL;

-- rfid_series -> rfid_question_pack
ALTER TABLE "rfid_series" ADD CONSTRAINT "rfid_series_question_pack_id_fkey"
    FOREIGN KEY ("question_pack_id") REFERENCES "rfid_question_pack"("id") ON DELETE SET NULL;

-- rfid_card_mapping -> rfid_question
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "rfid_question"("id") ON DELETE SET NULL;

-- rfid_card_mapping -> rfid_pack
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_pack_id_fkey"
    FOREIGN KEY ("pack_id") REFERENCES "rfid_pack"("id") ON DELETE SET NULL;

-- rfid_card_mapping -> rfid_content_pack
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_content_pack_id_fkey"
    FOREIGN KEY ("content_pack_id") REFERENCES "rfid_content_pack"("id") ON DELETE SET NULL;

-- rfid_card_mapping -> rfid_question_pack
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_question_pack_id_fkey"
    FOREIGN KEY ("question_pack_id") REFERENCES "rfid_question_pack"("id") ON DELETE SET NULL;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on parent_profiles
ALTER TABLE "parent_profiles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access parent profiles" ON "parent_profiles"
    FOR ALL USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Service role has full access to parent profiles" ON "parent_profiles"
    FOR ALL USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Users can view own parent profile" ON "parent_profiles"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own parent profile" ON "parent_profiles"
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own parent profile" ON "parent_profiles"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert their own parent profile" ON "parent_profiles"
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own parent profile" ON "parent_profiles"
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own parent profile" ON "parent_profiles"
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own parent profile" ON "parent_profiles"
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own parent profile" ON "parent_profiles"
    FOR DELETE USING (auth.uid() = user_id);

-- Enable RLS on radio_schedule
ALTER TABLE "radio_schedule" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON "radio_schedule"
    FOR SELECT USING (true);

CREATE POLICY "Enable write access for service role" ON "radio_schedule"
    FOR ALL USING (auth.role() = 'service_role'::text);
