CREATE TABLE IF NOT EXISTS "device_analytics_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "device_id" VARCHAR(100) NOT NULL,
  "event_id" VARCHAR(120) NOT NULL,
  "mac_address" VARCHAR(20) NOT NULL,
  "sender_client_id" VARCHAR(255),
  "board" VARCHAR(50),
  "firmware" VARCHAR(100),
  "build_label" VARCHAR(100),
  "seq" INTEGER,
  "uptime_ms" BIGINT,
  "event_name" VARCHAR(80) NOT NULL,
  "event_timestamp" TIMESTAMPTZ(6),
  "server_received_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "battery" INTEGER,
  "battery_percentage" INTEGER,
  "charging" BOOLEAN,
  "discharging" BOOLEAN,
  "duration_ms" INTEGER,
  "rfid_uid" VARCHAR(120),
  "content_id" VARCHAR(120),
  "content_type" VARCHAR(50),
  "game_id" VARCHAR(80),
  "score" INTEGER,
  "reason" VARCHAR(120),
  "station" VARCHAR(120),
  "station_index" INTEGER,
  "data" JSONB NOT NULL DEFAULT '{}',
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "device_analytics_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_analytics_event_device_event" UNIQUE ("device_id", "event_id")
);

CREATE INDEX IF NOT EXISTS "idx_device_analytics_event_mac_event_ts"
  ON "device_analytics_event"("mac_address", "event_timestamp" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_analytics_event_mac_received"
  ON "device_analytics_event"("mac_address", "server_received_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_analytics_event_mac_name"
  ON "device_analytics_event"("mac_address", "event_name");
