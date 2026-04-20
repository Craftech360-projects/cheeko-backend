CREATE TABLE "creator_content" (
  "id" BIGSERIAL NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "content_type" VARCHAR(50) NOT NULL DEFAULT 'music',
  "source_type" VARCHAR(50) NOT NULL DEFAULT 'upload',
  "language" VARCHAR(50) DEFAULT 'en',
  "category" VARCHAR(100),
  "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
  "creator_id" BIGINT NOT NULL,
  "reviewer_id" BIGINT,
  "review_notes" TEXT,
  "aws_uploaded_at" TIMESTAMPTZ(6),
  "published_ref_type" VARCHAR(50),
  "published_ref_id" VARCHAR(100),
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creator_content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "creator_content_asset" (
  "id" BIGSERIAL NOT NULL,
  "creator_content_id" BIGINT NOT NULL,
  "asset_type" VARCHAR(50) NOT NULL,
  "storage_type" VARCHAR(50) NOT NULL DEFAULT 'draft',
  "original_filename" VARCHAR(255),
  "mime_type" VARCHAR(100),
  "local_path" VARCHAR(1000),
  "aws_url" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creator_content_asset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_creator_content_asset_type" ON "creator_content_asset" ("creator_content_id", "asset_type");
CREATE INDEX "idx_creator_content_creator" ON "creator_content" ("creator_id");
CREATE INDEX "idx_creator_content_reviewer" ON "creator_content" ("reviewer_id");
CREATE INDEX "idx_creator_content_status" ON "creator_content" ("status");
CREATE INDEX "idx_creator_content_type" ON "creator_content" ("content_type");
CREATE INDEX "idx_creator_content_asset_content" ON "creator_content_asset" ("creator_content_id");

ALTER TABLE "creator_content"
  ADD CONSTRAINT "creator_content_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "sys_user"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "creator_content"
  ADD CONSTRAINT "creator_content_reviewer_id_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "sys_user"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "creator_content_asset"
  ADD CONSTRAINT "creator_content_asset_creator_content_id_fkey"
  FOREIGN KEY ("creator_content_id") REFERENCES "creator_content"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
