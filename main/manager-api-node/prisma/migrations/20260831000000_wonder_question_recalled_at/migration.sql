-- Retire a Wonder Question once it has been served back to the child.
--
-- Without this the read was "the newest row for this child", forever: the row
-- was replaced only when a DIFFERENT one was stored, and the write happens only
-- in the after-Question-Ten MEMO. A session that ends at question seven, a
-- second session on a day already complete, or a model that echoes the question
-- it was just given (refused as a duplicate) all leave the same row newest — so
-- the child was asked the same thing at the top of every session. Observed on
-- dev: kid 21 was recalled to the same food-house question from 2026-08-23 to
-- 2026-08-31, across six sessions in which he answered or declined it.
ALTER TABLE kid_wonder_question
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

-- Every existing row has already been served, most of them many times over.
-- Backfilling them as recalled is what stops the fix re-asking each child their
-- oldest question once more on the way in.
UPDATE kid_wonder_question SET recalled_at = now() WHERE recalled_at IS NULL;

-- The serving read: "the newest one this child has not been recalled to yet".
CREATE INDEX IF NOT EXISTS idx_kid_wonder_kid_pending
  ON kid_wonder_question (kid_id, asked_at DESC) WHERE recalled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kid_wonder_device_pending
  ON kid_wonder_question (device_mac, asked_at DESC) WHERE recalled_at IS NULL;
