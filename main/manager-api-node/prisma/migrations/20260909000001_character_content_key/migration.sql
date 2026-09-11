-- Character artwork encryption key (spec §6, follow-up to
-- 20260909000000_content_encryption). Holds ciphertext produced by
-- contentCrypto.encryptAtRest under CONTENT_MASTER_KEY: a database dump must
-- not hand out a character's art key.
--
-- A separate migration rather than an edit to 20260909000000_content_encryption:
-- that migration is already applied, and editing it after the fact would leave
-- Prisma's checksum stale and this column would never land on a database that
-- already ran it.
--
-- SAFE ON A LIVE DATABASE: nullable, no default, metadata-only. Existing rows
-- get NULL, which every reader treats as "not encrypted".

ALTER TABLE ai_agent_template
  ADD COLUMN IF NOT EXISTS art_content_key BYTEA;
