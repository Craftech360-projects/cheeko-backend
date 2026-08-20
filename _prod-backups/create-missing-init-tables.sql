CREATE TABLE IF NOT EXISTS "ai_agent_plugin_mapping" (
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

CREATE TABLE IF NOT EXISTS "ai_agent_mcp_access_point" (
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

CREATE TABLE IF NOT EXISTS "content_items" (
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

CREATE INDEX IF NOT EXISTS "ai_agent_plugin_mapping_agent_id_idx" ON "ai_agent_plugin_mapping"("agent_id");
CREATE INDEX IF NOT EXISTS "ai_agent_plugin_mapping_plugin_id_idx" ON "ai_agent_plugin_mapping"("plugin_id");
CREATE INDEX IF NOT EXISTS "ai_agent_mcp_access_point_agent_id_idx" ON "ai_agent_mcp_access_point"("agent_id");
CREATE INDEX IF NOT EXISTS "content_items_content_type_idx" ON "content_items"("content_type");
CREATE INDEX IF NOT EXISTS "content_items_category_idx" ON "content_items"("category");
ALTER TABLE "ai_agent_plugin_mapping" ADD CONSTRAINT "ai_agent_plugin_mapping_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_mcp_access_point" ADD CONSTRAINT "ai_agent_mcp_access_point_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
