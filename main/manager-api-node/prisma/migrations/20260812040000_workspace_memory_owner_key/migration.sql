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

-- Which devices may have their history claimed for their current child.
--
-- A device that has served more than one child cannot: its rows are a mixture,
-- and stamping them all with the current pairing is the sibling leak this
-- migration exists to close, performed by the migration itself. DB1 has such a
-- device -- one toy, three children, 82 memory documents belonging to the two
-- earlier ones.
--
-- Membership is judged from the tables that already carry kid_id rather than
-- from a survey run by hand somewhere else, so the precondition travels with the
-- migration instead of as a comment about a different database.
CREATE TEMP TABLE _owner_key_safe_devices AS
SELECT d.mac_address, d.kid_id
  FROM ai_device d
 WHERE d.kid_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM device_memory_documents m
                    WHERE lower(m.mac_address) = lower(d.mac_address)
                      AND m.kid_id IS NOT NULL AND m.kid_id <> d.kid_id)
   AND NOT EXISTS (SELECT 1 FROM voice_sessions v
                    WHERE lower(v.mac_address) = lower(d.mac_address)
                      AND v.kid_id IS NOT NULL AND v.kid_id <> d.kid_id);

-- A row that already knows its child keeps it. The device's current pairing is
-- an inference about who made a row; kid_id is the record of it, and reaching
-- past the record to the inference is what mis-attributes a shared toy.
UPDATE device_memory_documents SET owner_key = 'kid:' || kid_id::text WHERE kid_id IS NOT NULL;
UPDATE device_memory_chunks    SET owner_key = 'kid:' || kid_id::text WHERE kid_id IS NOT NULL;

-- Everything still unattributed on a single-child device belongs to that child.
-- device_workspace_artifacts has no kid_id at all, so this is the only signal it
-- gets -- and on a multi-child device it correctly gets none.
UPDATE device_workspace_artifacts a SET owner_key = 'kid:' || s.kid_id::text
  FROM _owner_key_safe_devices s
 WHERE lower(s.mac_address) = lower(a.mac_address) AND a.owner_key IS NULL;
UPDATE device_memory_documents a SET owner_key = 'kid:' || s.kid_id::text
  FROM _owner_key_safe_devices s
 WHERE lower(s.mac_address) = lower(a.mac_address) AND a.owner_key IS NULL;
UPDATE device_memory_chunks a SET owner_key = 'kid:' || s.kid_id::text
  FROM _owner_key_safe_devices s
 WHERE lower(s.mac_address) = lower(a.mac_address) AND a.owner_key IS NULL;

-- The rest keep their own MAC: rows on an unpaired device, rows whose MAC has no
-- ai_device row, and the artifacts of a device that has served several children.
-- Keyed to the toy is the truthful statement where the child is unknowable, and
-- it leaves the rows readable and re-attributable later instead of destroyed.
UPDATE device_workspace_artifacts SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;
UPDATE device_memory_documents    SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;
UPDATE device_memory_chunks       SET owner_key = 'mac:' || lower(mac_address) WHERE owner_key IS NULL;

-- The remap must not have made two rows collide. It cannot when attribution is
-- right: two children's documents get two different keys. This stops rather than
-- deletes, because the losing row of a silent "newest wins" is a child's memory
-- and a condition that should be impossible must never be resolved quietly.
DO $$
DECLARE dupes INT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM device_workspace_artifacts GROUP BY owner_key, relative_path HAVING count(*) > 1
    UNION ALL
    SELECT 1 FROM device_memory_documents    GROUP BY owner_key, document_key  HAVING count(*) > 1
    UNION ALL
    SELECT 1 FROM device_memory_chunks       GROUP BY owner_key, content_hash  HAVING count(*) > 1
  ) collisions;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'owner_key remap produced % colliding row group(s); stopping before any row is dropped', dupes;
  END IF;
END $$;

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
