-- Drop the mac-based uniques the owner_key migration left behind.
--
-- 20260812040000 added (owner_key, <unique>) and kept the old (mac_address,
-- <unique>) indexes deliberately, on the reasoning that they "remain satisfiable
-- -- mac_address is still written on every row". That holds only while a
-- device's rows all share one owner_key. It does not hold for the case that
-- migration exists to protect.
--
-- A toy that served two children is excluded from the owner_key remap on
-- purpose: stamping its mixed history onto whoever is paired now is the sibling
-- leak the whole change was written to close. Those rows therefore keep
-- owner_key = 'mac:<address>'. The running code then computes 'kid:<id>' for the
-- current child, finds no row under that key, and inserts -- which the old
-- mac-based unique rejects, because a mac: row already holds that path.
--
-- Seen on production 2026-08-17: device 00:16:3e:ac:b5:38, paired to kid 106,
-- previously served kid 74. Every workspace-sync and workspace-files PUT
-- returned 500 while the session itself succeeded, so the toy talked normally
-- and silently persisted nothing.
--
-- The (owner_key, ...) uniques are the real constraint and are already in place.
-- Two rows sharing a mac and a path under different owner keys is now the
-- intended shape, not a violation: one namespace per child, plus the device's
-- own unattributed history.
-- Dropped as CONSTRAINTs, not indexes. A Prisma @@unique creates a unique
-- constraint, and Postgres refuses DROP INDEX on the index backing one.
ALTER TABLE device_workspace_artifacts DROP CONSTRAINT IF EXISTS uq_device_workspace_artifacts_mac_path;
ALTER TABLE device_memory_documents    DROP CONSTRAINT IF EXISTS uq_device_memory_documents_mac_key;
ALTER TABLE device_memory_chunks       DROP CONSTRAINT IF EXISTS uq_device_memory_chunks_mac_hash;

-- Belt and braces for a database where they were created as plain indexes.
DROP INDEX IF EXISTS uq_device_workspace_artifacts_mac_path;
DROP INDEX IF EXISTS uq_device_memory_documents_mac_key;
DROP INDEX IF EXISTS uq_device_memory_chunks_mac_hash;
