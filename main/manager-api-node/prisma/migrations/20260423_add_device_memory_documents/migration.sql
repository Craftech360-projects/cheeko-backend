CREATE TABLE "device_memory_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "mac_address" varchar(20) NOT NULL,
  "device_id" uuid,
  "agent_id" uuid,
  "kid_id" bigint,
  "document_key" text NOT NULL,
  "memory_type" text NOT NULL,
  "memory_date" date,
  "content" text NOT NULL,
  "source" text NOT NULL DEFAULT 'manager_api',
  "session_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fk_device_memory_documents_device" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_memory_documents_agent" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_memory_documents_kid" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "uq_device_memory_documents_mac_key" UNIQUE ("mac_address", "document_key")
);

CREATE TABLE "device_memory_chunks" (
  "id" bigserial PRIMARY KEY,
  "document_id" uuid NOT NULL,
  "mac_address" varchar(20) NOT NULL,
  "device_id" uuid,
  "agent_id" uuid,
  "kid_id" bigint,
  "content" text NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "category" text DEFAULT 'general',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fk_device_memory_chunks_document" FOREIGN KEY ("document_id") REFERENCES "device_memory_documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_memory_chunks_device" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_memory_chunks_agent" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_memory_chunks_kid" FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "uq_device_memory_chunks_mac_hash" UNIQUE ("mac_address", "content_hash")
);

CREATE INDEX "idx_device_memory_documents_mac_updated" ON "device_memory_documents"("mac_address", "updated_at" DESC);
CREATE INDEX "idx_device_memory_documents_kid_updated" ON "device_memory_documents"("kid_id", "updated_at" DESC);
CREATE INDEX "idx_device_memory_documents_session" ON "device_memory_documents"("session_id");
CREATE INDEX "idx_device_memory_chunks_document" ON "device_memory_chunks"("document_id");
CREATE INDEX "idx_device_memory_chunks_mac_created" ON "device_memory_chunks"("mac_address", "created_at" DESC);
CREATE INDEX "idx_device_memory_chunks_kid_created" ON "device_memory_chunks"("kid_id", "created_at" DESC);
