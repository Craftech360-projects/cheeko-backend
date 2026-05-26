CREATE TABLE IF NOT EXISTS "device_usage_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" BIGINT,
  "device_id" UUID,
  "mac_address" VARCHAR(20) NOT NULL,
  "date" DATE NOT NULL,
  "usage_time_seconds" INTEGER NOT NULL DEFAULT 0,
  "game_usage_seconds" INTEGER NOT NULL DEFAULT 0,
  "card_usage_seconds" INTEGER NOT NULL DEFAULT 0,
  "ai_talk_usage_seconds" INTEGER NOT NULL DEFAULT 0,
  "radio_usage_seconds" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_usage_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_usage_daily_date_mac" UNIQUE ("date", "mac_address"),
  CONSTRAINT "fk_device_usage_daily_user" FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_usage_daily_device" FOREIGN KEY ("device_id") REFERENCES "ai_device" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_device_usage_daily_user_date"
  ON "device_usage_daily"("user_id", "date");

CREATE INDEX IF NOT EXISTS "idx_device_usage_daily_mac_date"
  ON "device_usage_daily"("mac_address", "date");

CREATE TABLE IF NOT EXISTS "device_card_taps_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" BIGINT,
  "device_id" UUID,
  "mac_address" VARCHAR(20) NOT NULL,
  "date" DATE NOT NULL,
  "card_tap_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_card_taps_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_card_taps_daily_date_mac" UNIQUE ("date", "mac_address"),
  CONSTRAINT "fk_device_card_taps_daily_user" FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_card_taps_daily_device" FOREIGN KEY ("device_id") REFERENCES "ai_device" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_device_card_taps_daily_user_date"
  ON "device_card_taps_daily"("user_id", "date");

CREATE INDEX IF NOT EXISTS "idx_device_card_taps_daily_mac_date"
  ON "device_card_taps_daily"("mac_address", "date");

CREATE TABLE IF NOT EXISTS "device_ai_interactions_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" BIGINT,
  "device_id" UUID,
  "mac_address" VARCHAR(20) NOT NULL,
  "date" DATE NOT NULL,
  "ai_interaction_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_ai_interactions_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_ai_interactions_daily_date_mac" UNIQUE ("date", "mac_address"),
  CONSTRAINT "fk_device_ai_interactions_daily_user" FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_ai_interactions_daily_device" FOREIGN KEY ("device_id") REFERENCES "ai_device" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_device_ai_interactions_daily_user_date"
  ON "device_ai_interactions_daily"("user_id", "date");

CREATE INDEX IF NOT EXISTS "idx_device_ai_interactions_daily_mac_date"
  ON "device_ai_interactions_daily"("mac_address", "date");

CREATE TABLE IF NOT EXISTS "device_games_played" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" BIGINT,
  "device_id" UUID,
  "mac_address" VARCHAR(20) NOT NULL,
  "activity_date" DATE NOT NULL,
  "game_id" VARCHAR(80),
  "game_name" VARCHAR(200),
  "level" VARCHAR(80),
  "difficulty_level" VARCHAR(80),
  "score" INTEGER,
  "duration_ms" INTEGER,
  "played_at" TIMESTAMPTZ(6) NOT NULL,
  "source_device_event_pk" UUID NOT NULL,
  "source_event_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_games_played_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_games_played_source_event_pk" UNIQUE ("source_device_event_pk"),
  CONSTRAINT "fk_device_games_played_user" FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_games_played_device" FOREIGN KEY ("device_id") REFERENCES "ai_device" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_games_played_raw_event" FOREIGN KEY ("source_device_event_pk") REFERENCES "device_analytics_event" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_device_games_played_mac_played"
  ON "device_games_played"("mac_address", "played_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_games_played_user_played"
  ON "device_games_played"("user_id", "played_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_games_played_date_mac"
  ON "device_games_played"("activity_date", "mac_address");

CREATE TABLE IF NOT EXISTS "device_radio_played" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" BIGINT,
  "device_id" UUID,
  "mac_address" VARCHAR(20) NOT NULL,
  "activity_date" DATE NOT NULL,
  "station" VARCHAR(120),
  "duration_ms" INTEGER,
  "played_at" TIMESTAMPTZ(6) NOT NULL,
  "source_device_event_pk" UUID NOT NULL,
  "source_event_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_radio_played_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_device_radio_played_source_event_pk" UNIQUE ("source_device_event_pk"),
  CONSTRAINT "fk_device_radio_played_user" FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_radio_played_device" FOREIGN KEY ("device_id") REFERENCES "ai_device" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_device_radio_played_raw_event" FOREIGN KEY ("source_device_event_pk") REFERENCES "device_analytics_event" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_device_radio_played_mac_played"
  ON "device_radio_played"("mac_address", "played_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_radio_played_user_played"
  ON "device_radio_played"("user_id", "played_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_radio_played_station_played"
  ON "device_radio_played"("station", "played_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_device_radio_played_date_mac"
  ON "device_radio_played"("activity_date", "mac_address");
