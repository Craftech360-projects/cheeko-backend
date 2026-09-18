-- Lasting facts about a child, one per row, replacing the regex guesses the
-- rolling memory used to make. See docs/child-memory-storage-review.md section 7.
--
-- (kid_id, category, subject) is the de-dup key: "pet/dog" is one row per child,
-- updated when the child mentions it again. ON DELETE CASCADE so deleting the
-- child deletes everything remembered about them.

CREATE TABLE "child_facts" (
  "id"             BIGSERIAL PRIMARY KEY,
  "kid_id"         BIGINT NOT NULL,
  "category"       VARCHAR(20) NOT NULL,
  "subject"        VARCHAR(60) NOT NULL,
  "fact"           VARCHAR(300) NOT NULL,
  "first_seen"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_seen"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "source_session" TEXT,
  "expires_at"     TIMESTAMPTZ(6),
  CONSTRAINT "child_facts_kid_id_fkey"
    FOREIGN KEY ("kid_id") REFERENCES "kid_profile"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_child_facts_kid_category_subject"
  ON "child_facts" ("kid_id", "category", "subject");

CREATE INDEX "idx_child_facts_kid_last_seen"
  ON "child_facts" ("kid_id", "last_seen" DESC);
