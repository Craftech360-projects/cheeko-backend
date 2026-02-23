-- Add OpenClaw fields to ai_device
ALTER TABLE "ai_device" ADD COLUMN IF NOT EXISTS "openclaw_url" TEXT;
ALTER TABLE "ai_device" ADD COLUMN IF NOT EXISTS "openclaw_token" TEXT;

-- Add OpenClaw fields to parent_profile
ALTER TABLE "parent_profile" ADD COLUMN IF NOT EXISTS "openclaw_url" TEXT;
ALTER TABLE "parent_profile" ADD COLUMN IF NOT EXISTS "openclaw_token" TEXT;

-- Create openclaw_pair_tokens table for pairing flow
CREATE TABLE IF NOT EXISTS "openclaw_pair_tokens" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" BIGINT NOT NULL,
    "token" VARCHAR(20) NOT NULL UNIQUE,
    "openclaw_url" TEXT,
    "paired" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) DEFAULT now(),
    CONSTRAINT "fk_pair_token_user" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_pair_token" ON "openclaw_pair_tokens"("token");
CREATE INDEX IF NOT EXISTS "idx_pair_token_user" ON "openclaw_pair_tokens"("user_id");
