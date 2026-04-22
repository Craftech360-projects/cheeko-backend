-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "device_id" UUID,
    "agent_id" UUID,
    "kid_id" BIGINT,
    "room_name" TEXT,
    "worker_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "last_event_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voice_sessions_status_check" CHECK ("status" IN ('active', 'ended', 'failed', 'interrupted'))
);

-- CreateTable
CREATE TABLE "voice_session_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "agent_id" UUID,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "provider_message" JSONB,
    "audio_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "voice_session_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_session_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT,
    "source_message_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_session_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_token_usage_session" (
    "id" BIGSERIAL NOT NULL,
    "session_id" TEXT NOT NULL,
    "mac_address" VARCHAR(50) NOT NULL,
    "device_id" UUID,
    "agent_id" UUID,
    "usage_date" DATE NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "input_audio_tokens" INTEGER NOT NULL DEFAULT 0,
    "input_text_tokens" INTEGER NOT NULL DEFAULT 0,
    "input_cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_audio_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_text_tokens" INTEGER NOT NULL DEFAULT 0,
    "avg_ttft_seconds" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "session_duration_seconds" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "total_response_duration_seconds" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_token_usage_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_voice_sessions_session_id" ON "voice_sessions"("session_id");

-- CreateIndex
CREATE INDEX "idx_voice_sessions_mac_started" ON "voice_sessions"("mac_address", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_voice_sessions_agent_started" ON "voice_sessions"("agent_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_voice_sessions_kid_started" ON "voice_sessions"("kid_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "idx_voice_sessions_status_last_event" ON "voice_sessions"("status", "last_event_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_voice_session_messages_session_sequence" ON "voice_session_messages"("session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_voice_session_messages_idempotency" ON "voice_session_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_voice_session_messages_mac_created" ON "voice_session_messages"("mac_address", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_voice_session_messages_session_created" ON "voice_session_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_voice_session_messages_agent_created" ON "voice_session_messages"("agent_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_voice_session_summaries_session_id" ON "voice_session_summaries"("session_id");

-- CreateIndex
CREATE INDEX "idx_voice_session_summaries_mac_updated" ON "voice_session_summaries"("mac_address", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_device_token_usage_session_session_id" ON "device_token_usage_session"("session_id");

-- CreateIndex
CREATE INDEX "idx_device_token_usage_session_mac_date" ON "device_token_usage_session"("mac_address", "usage_date" DESC);

-- CreateIndex
CREATE INDEX "idx_device_token_usage_session_agent_date" ON "device_token_usage_session"("agent_id", "usage_date" DESC);

-- CreateIndex
CREATE INDEX "idx_device_token_usage_session_date" ON "device_token_usage_session"("usage_date");

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_session_messages" ADD CONSTRAINT "voice_session_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_sessions"("session_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_session_messages" ADD CONSTRAINT "voice_session_messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "voice_session_summaries" ADD CONSTRAINT "voice_session_summaries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_sessions"("session_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "device_token_usage_session" ADD CONSTRAINT "device_token_usage_session_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_sessions"("session_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "device_token_usage_session" ADD CONSTRAINT "device_token_usage_session_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "device_token_usage_session" ADD CONSTRAINT "device_token_usage_session_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
