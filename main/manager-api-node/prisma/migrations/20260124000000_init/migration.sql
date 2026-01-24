-- Prisma Initial Migration
-- This migration was generated from prisma/schema.prisma
-- Created: 2026-01-24

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "sys_user" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "super_admin" SMALLINT NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_token" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expire_date" TIMESTAMPTZ(6) NOT NULL,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_user_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_params" (
    "id" BIGSERIAL NOT NULL,
    "param_code" VARCHAR(100) NOT NULL,
    "param_value" TEXT,
    "value_type" VARCHAR(50) NOT NULL DEFAULT 'string',
    "param_type" SMALLINT NOT NULL DEFAULT 1,
    "remark" VARCHAR(500),
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_dict_type" (
    "id" BIGSERIAL NOT NULL,
    "dict_type" VARCHAR(100) NOT NULL,
    "dict_name" VARCHAR(255) NOT NULL,
    "remark" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_dict_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_dict_data" (
    "id" BIGSERIAL NOT NULL,
    "dict_type_id" BIGINT NOT NULL,
    "dict_label" VARCHAR(255) NOT NULL,
    "dict_value" VARCHAR(255) NOT NULL,
    "remark" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sys_dict_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_profile" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "supabase_user_id" VARCHAR(100),
    "full_name" VARCHAR(255),
    "email" VARCHAR(255),
    "phone_number" VARCHAR(50),
    "preferred_language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "timezone" VARCHAR(100),
    "notification_preferences" JSONB NOT NULL DEFAULT '{}',
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "terms_accepted_at" TIMESTAMPTZ(6),
    "privacy_policy_accepted_at" TIMESTAMPTZ(6),
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_profile" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "name" VARCHAR(255) NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "interests" JSONB NOT NULL DEFAULT '[]',
    "avatar_url" VARCHAR(500),
    "primary_language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "additional_notes" TEXT,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_learning_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" BIGINT,
    "subject" VARCHAR(100) NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "score" INTEGER,
    "time_spent" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_learning_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_activity_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" BIGINT,
    "activity_type" VARCHAR(50) NOT NULL,
    "content_type" VARCHAR(50),
    "content_id" UUID,
    "duration" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_provider" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "model_type" VARCHAR(50) NOT NULL,
    "provider_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_config" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "model_type" VARCHAR(50) NOT NULL,
    "model_code" VARCHAR(100) NOT NULL,
    "model_name" VARCHAR(255) NOT NULL,
    "is_default" SMALLINT NOT NULL DEFAULT 0,
    "is_enabled" SMALLINT NOT NULL DEFAULT 1,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "doc_link" VARCHAR(500),
    "remark" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tts_voice" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "tts_model_id" VARCHAR(36),
    "tts_voice" VARCHAR(100),
    "name" VARCHAR(255) NOT NULL,
    "languages" VARCHAR(255),
    "remark" VARCHAR(500),
    "reference_audio" VARCHAR(500),
    "reference_text" TEXT,
    "voice_demo" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tts_voice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" BIGINT,
    "agent_code" VARCHAR(100),
    "agent_name" VARCHAR(255) NOT NULL,
    "asr_model_id" VARCHAR(36),
    "vad_model_id" VARCHAR(36),
    "llm_model_id" VARCHAR(36),
    "vllm_model_id" VARCHAR(36),
    "tts_model_id" VARCHAR(36),
    "tts_voice_id" VARCHAR(36),
    "mem_model_id" VARCHAR(36),
    "intent_model_id" VARCHAR(36),
    "chat_history_conf" SMALLINT NOT NULL DEFAULT 0,
    "system_prompt" TEXT,
    "summary_memory" TEXT,
    "lang_code" VARCHAR(10) NOT NULL DEFAULT 'en',
    "language" VARCHAR(50) NOT NULL DEFAULT 'English',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_template" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "agent_code" VARCHAR(100),
    "agent_name" VARCHAR(255) NOT NULL,
    "asr_model_id" VARCHAR(36),
    "vad_model_id" VARCHAR(36),
    "llm_model_id" VARCHAR(36),
    "vllm_model_id" VARCHAR(36),
    "tts_model_id" VARCHAR(36),
    "tts_voice_id" VARCHAR(36),
    "mem_model_id" VARCHAR(36),
    "intent_model_id" VARCHAR(36),
    "chat_history_conf" SMALLINT NOT NULL DEFAULT 0,
    "system_prompt" TEXT,
    "summary_memory" TEXT,
    "lang_code" VARCHAR(10) NOT NULL DEFAULT 'en',
    "language" VARCHAR(50) NOT NULL DEFAULT 'English',
    "is_visible" SMALLINT NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_chat_history" (
    "id" BIGSERIAL NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "agent_id" VARCHAR(36),
    "session_id" VARCHAR(100) NOT NULL,
    "chat_type" SMALLINT NOT NULL,
    "content" TEXT,
    "audio_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_chat_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_plugin_mapping" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" VARCHAR(36) NOT NULL,
    "plugin_id" VARCHAR(100) NOT NULL,
    "param_info" JSONB NOT NULL DEFAULT '{}',
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_plugin_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_mcp_access_point" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" VARCHAR(36),
    "mcp_server_url" VARCHAR(500),
    "mcp_server_name" VARCHAR(255),
    "is_enabled" SMALLINT NOT NULL DEFAULT 1,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_mcp_access_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_device" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" BIGINT,
    "mac_address" VARCHAR(20) NOT NULL,
    "last_connected_at" TIMESTAMPTZ(6),
    "auto_update" SMALLINT NOT NULL DEFAULT 1,
    "board" VARCHAR(100),
    "alias" VARCHAR(255),
    "agent_id" VARCHAR(36),
    "kid_id" BIGINT,
    "mode" VARCHAR(50) NOT NULL DEFAULT 'conversation',
    "device_mode" VARCHAR(50) NOT NULL DEFAULT 'auto',
    "app_version" VARCHAR(50),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_token_usage" (
    "id" BIGSERIAL NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "session_id" VARCHAR(100),
    "usage_date" DATE NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "input_audio_tokens" BIGINT NOT NULL DEFAULT 0,
    "input_text_tokens" BIGINT NOT NULL DEFAULT 0,
    "input_cached_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_audio_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_text_tokens" BIGINT NOT NULL DEFAULT 0,
    "session_duration_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_ttft_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "total_response_duration_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "session_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_ota" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "firmware_name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100),
    "version" VARCHAR(50) NOT NULL,
    "size" BIGINT,
    "remark" TEXT,
    "firmware_path" VARCHAR(500),
    "force_update" SMALLINT NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_ota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_library" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "title" VARCHAR(500) NOT NULL,
    "romanized" VARCHAR(500),
    "filename" VARCHAR(500),
    "content_type" VARCHAR(50) NOT NULL,
    "category" VARCHAR(255),
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "aws_s3_url" VARCHAR(1000),
    "duration_seconds" INTEGER,
    "file_size_bytes" BIGINT,
    "is_active" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" VARCHAR(36) NOT NULL DEFAULT gen_random_uuid()::text,
    "title" VARCHAR(500) NOT NULL,
    "romanized" VARCHAR(500),
    "filename" VARCHAR(500),
    "content_type" VARCHAR(50) NOT NULL,
    "category" VARCHAR(255),
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "file_url" VARCHAR(1000),
    "thumbnail_url" VARCHAR(1000),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_playlist" (
    "id" BIGSERIAL NOT NULL,
    "device_id" VARCHAR(36) NOT NULL,
    "content_id" VARCHAR(36) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_playlist" (
    "id" BIGSERIAL NOT NULL,
    "device_id" VARCHAR(36) NOT NULL,
    "content_id" VARCHAR(36) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_music" (
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
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_music_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_story" (
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
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_textbook" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(300) NOT NULL,
    "subject" VARCHAR(100),
    "grade" VARCHAR(50),
    "language" VARCHAR(50),
    "publisher" VARCHAR(200),
    "cover_url" VARCHAR(500),
    "description" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_textbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_textbook_chapter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "textbook_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "content" TEXT,
    "audio_url" VARCHAR(500),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_textbook_chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_pack" (
    "id" BIGSERIAL NOT NULL,
    "pack_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_question" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "category" VARCHAR(100),
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_content_pack" (
    "id" BIGSERIAL NOT NULL,
    "pack_code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "content_type" VARCHAR(50) NOT NULL DEFAULT 'prompt',
    "content_md" TEXT,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_content_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_series" (
    "id" BIGSERIAL NOT NULL,
    "start_uid" VARCHAR(50) NOT NULL,
    "end_uid" VARCHAR(50) NOT NULL,
    "question_id" BIGINT,
    "pack_id" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_card_mapping" (
    "id" BIGSERIAL NOT NULL,
    "rfid_uid" VARCHAR(50) NOT NULL,
    "question_id" BIGINT,
    "question_ids" JSONB NOT NULL DEFAULT '[]',
    "pack_code" VARCHAR(100),
    "pack_id" BIGINT,
    "content_pack_id" BIGINT,
    "notes" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_card_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_scan_log" (
    "id" BIGSERIAL NOT NULL,
    "mac_address" VARCHAR(50) NOT NULL,
    "rfid_uid" VARCHAR(100) NOT NULL,
    "action_taken" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_scan_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfid_tags" (
    "id" BIGSERIAL NOT NULL,
    "uid" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255),
    "description" TEXT,
    "content_type" VARCHAR(50),
    "content_id" BIGINT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "creator" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_game_sessions" (
    "id" BIGSERIAL NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "agent_id" VARCHAR(36),
    "mode_type" VARCHAR(50) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "completion_status" VARCHAR(50),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_game_attempts" (
    "id" BIGSERIAL NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "game_type" VARCHAR(50) NOT NULL,
    "question_text" TEXT,
    "question_type" VARCHAR(100),
    "difficulty_level" VARCHAR(20),
    "correct_answer" VARCHAR(500),
    "user_answer" VARCHAR(500),
    "is_correct" BOOLEAN,
    "attempt_number" SMALLINT NOT NULL DEFAULT 1,
    "response_time_ms" INTEGER,
    "answered_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_game_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_media_playback" (
    "id" BIGSERIAL NOT NULL,
    "session_id" VARCHAR(100),
    "mac_address" VARCHAR(20) NOT NULL,
    "media_type" VARCHAR(50) NOT NULL,
    "media_id" VARCHAR(100),
    "media_title" VARCHAR(500),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_played_seconds" INTEGER,
    "total_duration_seconds" INTEGER,
    "completion_percentage" DECIMAL(5,2),
    "skip_action" VARCHAR(50),
    "skipped_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_media_playback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_streaks" (
    "id" BIGSERIAL NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "game_type" VARCHAR(50) NOT NULL,
    "streak_number" INTEGER NOT NULL,
    "questions_in_streak" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_user_progress" (
    "id" BIGSERIAL NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "mode_type" VARCHAR(50) NOT NULL,
    "kid_id" BIGINT,
    "total_sessions" INTEGER NOT NULL DEFAULT 0,
    "total_time_seconds" BIGINT NOT NULL DEFAULT 0,
    "total_interactions" INTEGER NOT NULL DEFAULT 0,
    "success_rate_percentage" DECIMAL(5,2),
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "total_streaks_completed" INTEGER NOT NULL DEFAULT 0,
    "average_streak_time_seconds" INTEGER NOT NULL DEFAULT 0,
    "skill_level" VARCHAR(50) NOT NULL DEFAULT 'beginner',
    "last_played_at" TIMESTAMPTZ(6),
    "weekly_summary_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_user_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_username_key" ON "sys_user"("username");

-- CreateIndex
CREATE INDEX "sys_user_username_idx" ON "sys_user"("username");

-- CreateIndex
CREATE INDEX "sys_user_status_idx" ON "sys_user"("status");

-- CreateIndex
CREATE INDEX "sys_user_token_user_id_idx" ON "sys_user_token"("user_id");

-- CreateIndex
CREATE INDEX "sys_user_token_token_idx" ON "sys_user_token"("token");

-- CreateIndex
CREATE INDEX "sys_user_token_expire_date_idx" ON "sys_user_token"("expire_date");

-- CreateIndex
CREATE UNIQUE INDEX "sys_params_param_code_key" ON "sys_params"("param_code");

-- CreateIndex
CREATE INDEX "sys_params_param_code_idx" ON "sys_params"("param_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_dict_type_dict_type_key" ON "sys_dict_type"("dict_type");

-- CreateIndex
CREATE INDEX "sys_dict_type_dict_type_idx" ON "sys_dict_type"("dict_type");

-- CreateIndex
CREATE INDEX "sys_dict_data_dict_type_id_idx" ON "sys_dict_data"("dict_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_profile_user_id_key" ON "parent_profile"("user_id");

-- CreateIndex
CREATE INDEX "parent_profile_user_id_idx" ON "parent_profile"("user_id");

-- CreateIndex
CREATE INDEX "parent_profile_supabase_user_id_idx" ON "parent_profile"("supabase_user_id");

-- CreateIndex
CREATE INDEX "parent_profile_email_idx" ON "parent_profile"("email");

-- CreateIndex
CREATE INDEX "kid_profile_user_id_idx" ON "kid_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "kid_learning_progress_kid_id_subject_topic_key" ON "kid_learning_progress"("kid_id", "subject", "topic");

-- CreateIndex
CREATE INDEX "ai_model_provider_model_type_idx" ON "ai_model_provider"("model_type");

-- CreateIndex
CREATE INDEX "ai_model_provider_provider_code_idx" ON "ai_model_provider"("provider_code");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_provider_model_type_provider_code_key" ON "ai_model_provider"("model_type", "provider_code");

-- CreateIndex
CREATE INDEX "ai_model_config_model_type_idx" ON "ai_model_config"("model_type");

-- CreateIndex
CREATE INDEX "ai_model_config_model_code_idx" ON "ai_model_config"("model_code");

-- CreateIndex
CREATE INDEX "ai_model_config_is_default_idx" ON "ai_model_config"("is_default");

-- CreateIndex
CREATE INDEX "ai_tts_voice_tts_model_id_idx" ON "ai_tts_voice"("tts_model_id");

-- CreateIndex
CREATE INDEX "ai_tts_voice_name_idx" ON "ai_tts_voice"("name");

-- CreateIndex
CREATE INDEX "ai_agent_user_id_idx" ON "ai_agent"("user_id");

-- CreateIndex
CREATE INDEX "ai_agent_agent_code_idx" ON "ai_agent"("agent_code");

-- CreateIndex
CREATE INDEX "ai_agent_template_agent_code_idx" ON "ai_agent_template"("agent_code");

-- CreateIndex
CREATE INDEX "ai_agent_template_is_visible_idx" ON "ai_agent_template"("is_visible");

-- CreateIndex
CREATE INDEX "ai_agent_chat_history_mac_address_idx" ON "ai_agent_chat_history"("mac_address");

-- CreateIndex
CREATE INDEX "ai_agent_chat_history_agent_id_idx" ON "ai_agent_chat_history"("agent_id");

-- CreateIndex
CREATE INDEX "ai_agent_chat_history_session_id_idx" ON "ai_agent_chat_history"("session_id");

-- CreateIndex
CREATE INDEX "ai_agent_chat_history_created_at_idx" ON "ai_agent_chat_history"("created_at");

-- CreateIndex
CREATE INDEX "ai_agent_plugin_mapping_agent_id_idx" ON "ai_agent_plugin_mapping"("agent_id");

-- CreateIndex
CREATE INDEX "ai_agent_plugin_mapping_plugin_id_idx" ON "ai_agent_plugin_mapping"("plugin_id");

-- CreateIndex
CREATE INDEX "ai_agent_mcp_access_point_agent_id_idx" ON "ai_agent_mcp_access_point"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_device_mac_address_key" ON "ai_device"("mac_address");

-- CreateIndex
CREATE INDEX "ai_device_user_id_idx" ON "ai_device"("user_id");

-- CreateIndex
CREATE INDEX "ai_device_mac_address_idx" ON "ai_device"("mac_address");

-- CreateIndex
CREATE INDEX "ai_device_agent_id_idx" ON "ai_device"("agent_id");

-- CreateIndex
CREATE INDEX "ai_device_kid_id_idx" ON "ai_device"("kid_id");

-- CreateIndex
CREATE INDEX "device_token_usage_mac_address_idx" ON "device_token_usage"("mac_address");

-- CreateIndex
CREATE INDEX "device_token_usage_usage_date_idx" ON "device_token_usage"("usage_date");

-- CreateIndex
CREATE INDEX "device_token_usage_session_id_idx" ON "device_token_usage"("session_id");

-- CreateIndex
CREATE INDEX "ai_ota_version_idx" ON "ai_ota"("version");

-- CreateIndex
CREATE INDEX "ai_ota_type_idx" ON "ai_ota"("type");

-- CreateIndex
CREATE INDEX "content_library_content_type_idx" ON "content_library"("content_type");

-- CreateIndex
CREATE INDEX "content_library_category_idx" ON "content_library"("category");

-- CreateIndex
CREATE INDEX "content_library_is_active_idx" ON "content_library"("is_active");

-- CreateIndex
CREATE INDEX "content_library_title_idx" ON "content_library"("title");

-- CreateIndex
CREATE INDEX "content_items_content_type_idx" ON "content_items"("content_type");

-- CreateIndex
CREATE INDEX "content_items_category_idx" ON "content_items"("category");

-- CreateIndex
CREATE INDEX "music_playlist_device_id_idx" ON "music_playlist"("device_id");

-- CreateIndex
CREATE INDEX "music_playlist_device_id_position_idx" ON "music_playlist"("device_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "music_playlist_device_id_content_id_key" ON "music_playlist"("device_id", "content_id");

-- CreateIndex
CREATE INDEX "story_playlist_device_id_idx" ON "story_playlist"("device_id");

-- CreateIndex
CREATE INDEX "story_playlist_device_id_position_idx" ON "story_playlist"("device_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "story_playlist_device_id_content_id_key" ON "story_playlist"("device_id", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfid_pack_pack_code_key" ON "rfid_pack"("pack_code");

-- CreateIndex
CREATE INDEX "rfid_pack_pack_code_idx" ON "rfid_pack"("pack_code");

-- CreateIndex
CREATE INDEX "rfid_pack_active_idx" ON "rfid_pack"("active");

-- CreateIndex
CREATE UNIQUE INDEX "rfid_question_code_key" ON "rfid_question"("code");

-- CreateIndex
CREATE INDEX "rfid_question_code_idx" ON "rfid_question"("code");

-- CreateIndex
CREATE INDEX "rfid_question_category_idx" ON "rfid_question"("category");

-- CreateIndex
CREATE INDEX "rfid_question_language_idx" ON "rfid_question"("language");

-- CreateIndex
CREATE INDEX "rfid_question_active_idx" ON "rfid_question"("active");

-- CreateIndex
CREATE UNIQUE INDEX "rfid_content_pack_pack_code_key" ON "rfid_content_pack"("pack_code");

-- CreateIndex
CREATE INDEX "rfid_content_pack_pack_code_idx" ON "rfid_content_pack"("pack_code");

-- CreateIndex
CREATE INDEX "rfid_content_pack_content_type_idx" ON "rfid_content_pack"("content_type");

-- CreateIndex
CREATE INDEX "rfid_content_pack_active_idx" ON "rfid_content_pack"("active");

-- CreateIndex
CREATE INDEX "rfid_series_start_uid_end_uid_idx" ON "rfid_series"("start_uid", "end_uid");

-- CreateIndex
CREATE INDEX "rfid_series_question_id_idx" ON "rfid_series"("question_id");

-- CreateIndex
CREATE INDEX "rfid_series_pack_id_idx" ON "rfid_series"("pack_id");

-- CreateIndex
CREATE INDEX "rfid_series_active_idx" ON "rfid_series"("active");

-- CreateIndex
CREATE UNIQUE INDEX "rfid_card_mapping_rfid_uid_key" ON "rfid_card_mapping"("rfid_uid");

-- CreateIndex
CREATE INDEX "rfid_card_mapping_rfid_uid_idx" ON "rfid_card_mapping"("rfid_uid");

-- CreateIndex
CREATE INDEX "rfid_card_mapping_question_id_idx" ON "rfid_card_mapping"("question_id");

-- CreateIndex
CREATE INDEX "rfid_card_mapping_pack_id_idx" ON "rfid_card_mapping"("pack_id");

-- CreateIndex
CREATE INDEX "rfid_card_mapping_content_pack_id_idx" ON "rfid_card_mapping"("content_pack_id");

-- CreateIndex
CREATE INDEX "rfid_card_mapping_active_idx" ON "rfid_card_mapping"("active");

-- CreateIndex
CREATE UNIQUE INDEX "rfid_tags_uid_key" ON "rfid_tags"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_game_sessions_session_id_key" ON "analytics_game_sessions"("session_id");

-- CreateIndex
CREATE INDEX "analytics_game_sessions_session_id_idx" ON "analytics_game_sessions"("session_id");

-- CreateIndex
CREATE INDEX "analytics_game_sessions_mac_address_idx" ON "analytics_game_sessions"("mac_address");

-- CreateIndex
CREATE INDEX "analytics_game_sessions_agent_id_idx" ON "analytics_game_sessions"("agent_id");

-- CreateIndex
CREATE INDEX "analytics_game_sessions_mode_type_idx" ON "analytics_game_sessions"("mode_type");

-- CreateIndex
CREATE INDEX "analytics_game_sessions_started_at_idx" ON "analytics_game_sessions"("started_at");

-- CreateIndex
CREATE INDEX "analytics_game_attempts_session_id_idx" ON "analytics_game_attempts"("session_id");

-- CreateIndex
CREATE INDEX "analytics_game_attempts_mac_address_idx" ON "analytics_game_attempts"("mac_address");

-- CreateIndex
CREATE INDEX "analytics_game_attempts_game_type_idx" ON "analytics_game_attempts"("game_type");

-- CreateIndex
CREATE INDEX "analytics_game_attempts_is_correct_idx" ON "analytics_game_attempts"("is_correct");

-- CreateIndex
CREATE INDEX "analytics_media_playback_session_id_idx" ON "analytics_media_playback"("session_id");

-- CreateIndex
CREATE INDEX "analytics_media_playback_mac_address_idx" ON "analytics_media_playback"("mac_address");

-- CreateIndex
CREATE INDEX "analytics_media_playback_media_type_idx" ON "analytics_media_playback"("media_type");

-- CreateIndex
CREATE INDEX "analytics_media_playback_started_at_idx" ON "analytics_media_playback"("started_at");

-- CreateIndex
CREATE INDEX "analytics_streaks_session_id_idx" ON "analytics_streaks"("session_id");

-- CreateIndex
CREATE INDEX "analytics_streaks_mac_address_idx" ON "analytics_streaks"("mac_address");

-- CreateIndex
CREATE INDEX "analytics_streaks_game_type_idx" ON "analytics_streaks"("game_type");

-- CreateIndex
CREATE INDEX "analytics_user_progress_mac_address_idx" ON "analytics_user_progress"("mac_address");

-- CreateIndex
CREATE INDEX "analytics_user_progress_mode_type_idx" ON "analytics_user_progress"("mode_type");

-- CreateIndex
CREATE INDEX "analytics_user_progress_skill_level_idx" ON "analytics_user_progress"("skill_level");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_user_progress_mac_address_mode_type_key" ON "analytics_user_progress"("mac_address", "mode_type");

-- AddForeignKey
ALTER TABLE "sys_user_token" ADD CONSTRAINT "sys_user_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_dict_data" ADD CONSTRAINT "sys_dict_data_dict_type_id_fkey" FOREIGN KEY ("dict_type_id") REFERENCES "sys_dict_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_profile" ADD CONSTRAINT "parent_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_profile" ADD CONSTRAINT "kid_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_learning_progress" ADD CONSTRAINT "kid_learning_progress_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_activity_log" ADD CONSTRAINT "kid_activity_log_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tts_voice" ADD CONSTRAINT "ai_tts_voice_tts_model_id_fkey" FOREIGN KEY ("tts_model_id") REFERENCES "ai_model_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_chat_history" ADD CONSTRAINT "ai_agent_chat_history_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_plugin_mapping" ADD CONSTRAINT "ai_agent_plugin_mapping_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_mcp_access_point" ADD CONSTRAINT "ai_agent_mcp_access_point_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_device" ADD CONSTRAINT "ai_device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_device" ADD CONSTRAINT "ai_device_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_device" ADD CONSTRAINT "ai_device_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_playlist" ADD CONSTRAINT "music_playlist_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_playlist" ADD CONSTRAINT "music_playlist_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_playlist" ADD CONSTRAINT "story_playlist_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_playlist" ADD CONSTRAINT "story_playlist_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_textbook_chapter" ADD CONSTRAINT "ai_textbook_chapter_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "ai_textbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfid_series" ADD CONSTRAINT "rfid_series_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "rfid_question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfid_series" ADD CONSTRAINT "rfid_series_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "rfid_pack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "rfid_question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "rfid_pack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfid_card_mapping" ADD CONSTRAINT "rfid_card_mapping_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "rfid_content_pack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_user_progress" ADD CONSTRAINT "analytics_user_progress_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
