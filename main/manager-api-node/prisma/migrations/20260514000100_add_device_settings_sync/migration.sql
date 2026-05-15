-- Create table: device_settings
CREATE TABLE IF NOT EXISTS "device_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mac_address" VARCHAR(20) NOT NULL,
  "device_id" VARCHAR(100),
  "settings_version" INTEGER NOT NULL DEFAULT 1,
  "settings" JSONB NOT NULL DEFAULT '{"volume":70,"brightness":80,"auto_listen":false,"system_sound":true,"system_prompt":true,"vibration":true,"sleep_enabled":true,"quiet_hours":{"enabled":false,"start":"21:00","end":"07:00"}}',
  "sync_status" VARCHAR(30) NOT NULL DEFAULT 'synced',
  "last_ack_status" VARCHAR(30),
  "last_ack_reason" TEXT,
  "last_sent_version" INTEGER,
  "last_applied_version" INTEGER,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_settings_mac_address_key" UNIQUE ("mac_address")
);

CREATE INDEX IF NOT EXISTS "idx_device_settings_mac" ON "device_settings"("mac_address");
CREATE INDEX IF NOT EXISTS "idx_device_settings_version" ON "device_settings"("settings_version");
CREATE INDEX IF NOT EXISTS "idx_device_settings_sync_status" ON "device_settings"("sync_status");

-- Create table: device_runtime_state
CREATE TABLE IF NOT EXISTS "device_runtime_state" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mac_address" VARCHAR(20) NOT NULL,
  "device_id" VARCHAR(100),
  "online" BOOLEAN NOT NULL DEFAULT false,
  "last_seen_at" TIMESTAMPTZ(6),
  "firmware" VARCHAR(100),
  "build_label" VARCHAR(100),
  "mode" VARCHAR(50),
  "network" VARCHAR(50),
  "battery" INTEGER,
  "charging" BOOLEAN,
  "discharging" BOOLEAN,
  "settings_version" INTEGER,
  "reason" VARCHAR(50),
  "raw_state" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_runtime_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_runtime_state_mac_address_key" UNIQUE ("mac_address")
);

CREATE INDEX IF NOT EXISTS "idx_device_runtime_state_mac" ON "device_runtime_state"("mac_address");
CREATE INDEX IF NOT EXISTS "idx_device_runtime_state_online" ON "device_runtime_state"("online");
CREATE INDEX IF NOT EXISTS "idx_device_runtime_state_last_seen" ON "device_runtime_state"("last_seen_at");

-- Create table: device_sync_event
CREATE TABLE IF NOT EXISTS "device_sync_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mac_address" VARCHAR(20) NOT NULL,
  "device_id" VARCHAR(100),
  "sender_client_id" VARCHAR(255),
  "event_type" VARCHAR(40) NOT NULL,
  "version" INTEGER,
  "status" VARCHAR(30),
  "reason" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_sync_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_device_sync_event_mac" ON "device_sync_event"("mac_address");
CREATE INDEX IF NOT EXISTS "idx_device_sync_event_type" ON "device_sync_event"("event_type");
CREATE INDEX IF NOT EXISTS "idx_device_sync_event_created_at" ON "device_sync_event"("created_at");
