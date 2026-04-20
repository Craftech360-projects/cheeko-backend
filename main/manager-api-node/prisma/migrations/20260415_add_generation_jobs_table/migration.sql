CREATE TABLE "generation_job" (
    "id" BIGSERIAL NOT NULL,
    "creator_content_id" BIGINT NOT NULL,
    "topic" VARCHAR(255) NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "job_status" VARCHAR(50) NOT NULL DEFAULT 'queued',
    "generation_mode" VARCHAR(100),
    "language" VARCHAR(50) DEFAULT 'en',
    "job_payload" JSONB DEFAULT '{}',
    "result_summary" JSONB DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_generation_job_content" ON "generation_job"("creator_content_id");
CREATE INDEX "idx_generation_job_status" ON "generation_job"("job_status");
CREATE INDEX "idx_generation_job_requested_by" ON "generation_job"("requested_by");

ALTER TABLE "generation_job"
ADD CONSTRAINT "generation_job_creator_content_id_fkey"
FOREIGN KEY ("creator_content_id") REFERENCES "creator_content"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;
