-- Content encryption keys (spec §6). Both columns hold ciphertext produced by
-- contentCrypto.encryptAtRest under CONTENT_MASTER_KEY: a database dump must
-- not hand out pack keys or device secrets.
--
-- SAFE ON A LIVE DATABASE: nullable, no default, metadata-only. Existing rows
-- get NULL, which every reader treats as "not encrypted".

ALTER TABLE rfid_content_pack
  ADD COLUMN IF NOT EXISTS content_key BYTEA;

ALTER TABLE ai_device
  ADD COLUMN IF NOT EXISTS content_secret BYTEA;
