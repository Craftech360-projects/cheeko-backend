CREATE TABLE "workspace_locks" (
  "device_mac" VARCHAR(20) NOT NULL,
  "holder_id" TEXT NOT NULL,
  "fencing_token" BIGINT NOT NULL DEFAULT 1,
  "lease_expires_at" TIMESTAMPTZ NOT NULL,
  "heartbeat_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "workspace_locks_pkey" PRIMARY KEY ("device_mac")
);

CREATE INDEX "idx_workspace_locks_lease_expires_at"
  ON "workspace_locks"("lease_expires_at");
