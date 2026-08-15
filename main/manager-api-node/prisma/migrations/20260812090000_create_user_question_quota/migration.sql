-- user_question_quota is declared in schema.prisma and read unguarded by the
-- founder family-360 page (founderDashboard.service.js), but the table has never
-- existed in any database. That findFirst sits inside a Promise.all, so the
-- endpoint throws every time it is called.
--
-- 009 was meant to delete what the survey proved dead. This is the opposite
-- case: schema and database disagree, and the fix is to make the database match
-- the schema rather than tear out a page written to work. Nothing increments
-- questions_used yet, so the counter reads zero until the feature that fills it
-- exists — a working page showing zero, rather than a 500.
--
-- Shaped to match the existing Prisma model exactly, including the cascade and
-- both secondary indexes, so this introduces no drift.
CREATE TABLE IF NOT EXISTS user_question_quota (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT      NOT NULL,
  month_key       VARCHAR(7)  NOT NULL,
  questions_used  INTEGER     NOT NULL DEFAULT 0,
  extra_purchased INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT user_question_quota_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES sys_user (id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS user_question_quota_user_id_month_key_key
  ON user_question_quota (user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_user_question_quota_month_key
  ON user_question_quota (month_key);
CREATE INDEX IF NOT EXISTS idx_user_question_quota_user_id
  ON user_question_quota (user_id);
