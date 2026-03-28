-- CreateTable
CREATE TABLE "rfid_category" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon_url" VARCHAR(500),
    "display_order" INTEGER DEFAULT 0,
    "active" BOOLEAN DEFAULT true,
    "creator" BIGINT,
    "create_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updater" BIGINT,
    "update_date" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfid_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_rfid_category_code" ON "rfid_category"("code");

-- CreateIndex
CREATE INDEX "idx_rfid_category_active" ON "rfid_category"("active");
