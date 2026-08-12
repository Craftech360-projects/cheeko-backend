-- The workspace and durable memory belong to the Child.
--
-- USER.md, MEMORY.md, the memory/state ledgers and every memory document were
-- keyed on the MAC, so replacing a toy lost all of it and a hand-me-down handed
-- it to a sibling.
--
-- These three tables get owner_key rather than a nullable kid_id, because all
-- three carry compound uniques and Postgres treats NULLs as DISTINCT in a
-- unique index: UNIQUE(kid_id, relative_path) would let an unpaired device
-- write ten MEMORY.md rows, and Prisma's compound-unique `where` cannot take a
-- null, so every upsert would need a read-then-branch instead of a key swap.
--
--   owner_key = 'kid:<id>'          when the device is paired
--   owner_key = 'mac:<address>'     when it is not
--
-- The namespacing is also what makes the fallback safe. A row stamped kid:123
-- is not in the mac: namespace, so no MAC-scoped read can reach it and the
-- sibling leak is impossible by construction rather than by remembering a
-- guard at every call site.

ALTER TABLE device_workspace_artifacts ADD COLUMN IF NOT EXISTS owner_key TEXT;
ALTER TABLE device_memory_documents    ADD COLUMN IF NOT EXISTS owner_key TEXT;
ALTER TABLE device_memory_chunks       ADD COLUMN IF NOT EXISTS owner_key TEXT;

-- Paired devices resolve to their child; everything else keeps its own MAC.
UPDATE device_workspace_artifacts a SET owner_key = 'kid:' || d.kid_id::text
  FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL;
UPDATE device_memory_documents a SET owner_key = 'kid:' || d.kid_id::text
  FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL;
UPDATE device_memory_chunks a SET owner_key = 'kid:' || d.kid_id::text
  FROM ai_device d WHERE lower(d.mac_address) = lower(a.mac_address) AND d.kid_id IS NOT NULL;

-- Includes rows whose MAC has no ai_device row at all. A survey on 2026-08-12
-- found none, but they would otherwise be left NULL and fail the NOT NULL below.
UPDATE device_workspace_artifacts SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;
UPDATE device_memory_documents    SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;
UPDATE device_memory_chunks       SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;

-- Collapse any pair that the remap made non-unique, newest wins. This can only
-- fire where one child owns two devices; the same survey found zero such kids,
-- so on that data these delete nothing. They are here so the migration is safe
-- to run somewhere the survey has not been repeated.
DELETE FROM device_workspace_artifacts a USING device_workspace_artifacts b
 WHERE a.owner_key = b.owner_key AND a.relative_path = b.relative_path
   AND (a.updated_at, a.id) < (b.updated_at, b.id);
DELETE FROM device_memory_documents a USING device_memory_documents b
 WHERE a.owner_key = b.owner_key AND a.document_key = b.document_key
   AND (a.updated_at, a.id) < (b.updated_at, b.id);
DELETE FROM device_memory_chunks a USING device_memory_chunks b
 WHERE a.owner_key = b.owner_key AND a.content_hash = b.content_hash
   AND (a.created_at, a.id) < (b.created_at, b.id);

ALTER TABLE device_workspace_artifacts ALTER COLUMN owner_key SET NOT NULL;
ALTER TABLE device_memory_documents    ALTER COLUMN owner_key SET NOT NULL;
ALTER TABLE device_memory_chunks       ALTER COLUMN owner_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_workspace_artifacts_owner_path
  ON device_workspace_artifacts (owner_key, relative_path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_memory_documents_owner_key
  ON device_memory_documents (owner_key, document_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_memory_chunks_owner_hash
  ON device_memory_chunks (owner_key, content_hash);

-- The old (mac_address, ...) uniques stay for this release. They remain
-- satisfiable — mac_address is still written on every row — and keeping them
-- makes the rollback a code revert rather than a restore. Drop them in a
-- follow-up once this has soaked.
