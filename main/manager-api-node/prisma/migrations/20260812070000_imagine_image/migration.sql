-- The imagine gallery belongs to the Child.
--
-- Imagine is the only feature in this phase with no database row at all: an
-- image is a JPEG at imagine/<mac>/<uuid>.jpg and the parent's feed is a
-- ListObjectsV2 on that prefix. So there is nothing to re-key — this adds the
-- missing row instead.
--
-- Attribution lives in the row, so an S3 object never has to move. A child
-- changing toys is an UPDATE, not a bucket copy, and the keys already written
-- stay valid forever.
--
-- owner_key rather than kid_id, matching the workspace and memory stores, so a
-- single adoption statement covers all four tables and one helper builds the key.
CREATE TABLE IF NOT EXISTS imagine_image (
  id          BIGSERIAL PRIMARY KEY,
  owner_key   TEXT        NOT NULL,
  mac_address VARCHAR(20) NOT NULL,
  s3_key      TEXT        NOT NULL,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The gallery reads newest-first for one owner; this index is that query.
CREATE INDEX IF NOT EXISTS idx_imagine_image_owner_created
  ON imagine_image (owner_key, created_at DESC);

-- Makes the S3 backfill idempotent: re-running it inserts nothing new. Also
-- stops a retried upload from listing the same picture twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_imagine_image_s3_key
  ON imagine_image (s3_key);

-- Existing objects are NOT backfilled here. They live in S3, which SQL cannot
-- read, so the backfill is scripts/backfill-imagine-images.js — run it after
-- this migration. Until it runs, the gallery for a device shows only images
-- uploaded since the deploy.
