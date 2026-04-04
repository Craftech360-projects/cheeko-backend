-- CreateTable
CREATE TABLE "rfid_card_tap_log" (
    "id" BIGSERIAL NOT NULL,
    "event_id" VARCHAR(120),
    "session_id" VARCHAR(100),
    "mac_address" VARCHAR(20) NOT NULL,
    "device_id" UUID,
    "device_alias" VARCHAR(255),
    "kid_id" BIGINT,
    "user_id" BIGINT,
    "rfid_uid" VARCHAR(100) NOT NULL,
    "card_mapping_id" BIGINT,
    "card_type" VARCHAR(20),
    "content_pack_id" BIGINT,
    "content_pack_code" VARCHAR(100),
    "content_pack_name" VARCHAR(255),
    "latest_version" VARCHAR(50),
    "client_version" VARCHAR(50),
    "update_available" BOOLEAN DEFAULT false,
    "source" VARCHAR(30) DEFAULT 'gateway',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_card_tap_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_rfid_card_tap_log_event_id" ON "rfid_card_tap_log"("event_id");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_mac" ON "rfid_card_tap_log"("mac_address");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_uid" ON "rfid_card_tap_log"("rfid_uid");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_event_id" ON "rfid_card_tap_log"("event_id");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_device" ON "rfid_card_tap_log"("device_id");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_mapping" ON "rfid_card_tap_log"("card_mapping_id");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_pack" ON "rfid_card_tap_log"("content_pack_id");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_card_type" ON "rfid_card_tap_log"("card_type");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_update_available" ON "rfid_card_tap_log"("update_available");

-- CreateIndex
CREATE INDEX "idx_rfid_card_tap_log_created_at" ON "rfid_card_tap_log"("created_at");

-- AddForeignKey
ALTER TABLE "rfid_card_tap_log" ADD CONSTRAINT "rfid_card_tap_log_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "ai_device"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rfid_card_tap_log" ADD CONSTRAINT "rfid_card_tap_log_card_mapping_id_fkey" FOREIGN KEY ("card_mapping_id") REFERENCES "rfid_card_mapping"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rfid_card_tap_log" ADD CONSTRAINT "rfid_card_tap_log_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "rfid_content_pack"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
