CREATE TABLE "device_workspace_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mac_address" VARCHAR(20) NOT NULL,
  "device_id" UUID,
  "agent_id" UUID,
  "session_id" TEXT,
  "relative_path" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "content_type" TEXT NOT NULL DEFAULT 'text/plain',
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "sha256" VARCHAR(64) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "device_workspace_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_workspace_artifacts_mac_path" UNIQUE ("mac_address", "relative_path"),
  CONSTRAINT "fk_device_workspace_artifacts_device" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_workspace_artifacts_agent" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "ck_device_workspace_artifacts_size" CHECK ("size_bytes" >= 0 AND "size_bytes" <= 262144),
  CONSTRAINT "ck_device_workspace_artifacts_relative_path" CHECK (
    "relative_path" <> ''
    AND "relative_path" !~ '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))'
  )
);

CREATE INDEX "idx_device_workspace_artifacts_mac_updated" ON "device_workspace_artifacts"("mac_address", "updated_at" DESC);
CREATE INDEX "idx_device_workspace_artifacts_agent_updated" ON "device_workspace_artifacts"("agent_id", "updated_at" DESC);
CREATE INDEX "idx_device_workspace_artifacts_session" ON "device_workspace_artifacts"("session_id");
