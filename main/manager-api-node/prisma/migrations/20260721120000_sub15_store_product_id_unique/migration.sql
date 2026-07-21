-- SUB-15 review fix: duplicate store_product_id would make plan lookup
-- nondeterministic; nullable unique costs nothing (Postgres allows many NULLs).
CREATE UNIQUE INDEX "subscription_plans_store_product_id_key" ON "subscription_plans"("store_product_id");
