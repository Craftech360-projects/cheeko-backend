-- SUB-15: RevenueCat/IAP columns
ALTER TABLE "subscription_plans" ADD COLUMN "store_product_id" TEXT;
ALTER TABLE "device_subscriptions" ADD COLUMN "store" TEXT;
ALTER TABLE "device_subscriptions" ADD COLUMN "rc_original_transaction_id" TEXT;

-- Seed product ids for the 3 launch tiers (SUB-17 creates the same ids in both consoles)
UPDATE "subscription_plans" SET "store_product_id" = 'cheeko_' || "tier" || '_monthly'
WHERE "tier" IN ('starter', 'family', 'premium');
