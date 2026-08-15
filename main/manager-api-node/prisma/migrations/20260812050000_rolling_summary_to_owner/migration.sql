-- The rolling conversation summary belongs to the Child.
--
-- It was already written to device_memory_documents (document_key 'summary'),
-- which 003 made owner-keyed — but it was ALSO written to ai_agent.summary_memory,
-- and that row is the Character, shared by every device using it. So a sibling
-- inheriting a toy read the previous child's rolling memory through the fallback,
-- and two children on the same character overwrote each other.
--
-- The service stops writing the column and stops reading it. This strands whatever
-- is in it for any device that has no summary document yet, so seed one first.
INSERT INTO device_memory_documents (
  mac_address, owner_key, device_id, agent_id, kid_id,
  document_key, memory_type, content, source, metadata, created_at, updated_at
)
SELECT
  d.mac_address,
  COALESCE('kid:' || d.kid_id::text, 'mac:' || lower(d.mac_address)),
  d.id,
  d.agent_id,
  d.kid_id,
  'summary',
  'summary',
  a.summary_memory,
  'migration:rolling-summary-to-owner',
  '{"rollingMemory": true, "migratedFrom": "ai_agent.summary_memory"}'::jsonb,
  now(),
  now()
FROM ai_device d
JOIN ai_agent a ON a.id = d.agent_id
WHERE a.summary_memory IS NOT NULL
  AND btrim(a.summary_memory) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM device_memory_documents m
    WHERE m.owner_key = COALESCE('kid:' || d.kid_id::text, 'mac:' || lower(d.mac_address))
      AND m.document_key = 'summary'
  );

-- ai_agent.summary_memory is deliberately left in place and left populated. It is
-- still edited through the character CRUD and the admin dashboard, and it is the
-- rollback path: reverting the service code makes it authoritative again. It is
-- simply no longer read or written by the per-child rolling memory.
