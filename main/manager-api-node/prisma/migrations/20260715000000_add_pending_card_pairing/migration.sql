-- CreateTable
CREATE TABLE "pending_card_pairing" (
    "id" BIGSERIAL NOT NULL,
    "mac_address" VARCHAR(20) NOT NULL,
    "content_pack_id" BIGINT NOT NULL,
    "kid_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "rfid_uid" VARCHAR(100),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_card_pairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_pending_card_pairing_mac_status" ON "pending_card_pairing"("mac_address", "status");
