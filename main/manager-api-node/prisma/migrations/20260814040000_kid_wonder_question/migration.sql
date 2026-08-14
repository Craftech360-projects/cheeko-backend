-- The Wonder Question (M4, ADR-0009 / quizzy-redesign 015).
--
-- At the end of a quiz Quizzy asks one open question with no right answer, and
-- opens the NEXT session by remembering it. It is never scored and never gates
-- anything — it is the only part of the redesign aimed at what a child thinks
-- about when the toy is switched off.
--
-- Needs a table rather than memory/state/ because that directory is pruned after
-- 48 hours (quiz_state.go). A child who plays Friday and comes back Monday would
-- find Quizzy had forgotten — which is worse than never having asked.
--
-- NOT exposed to the parent app, deliberately. It is a record of a child's
-- private curiosity, and a child who knows their wondering is reported may
-- wonder differently or stop saying the odd ones out loud. Showing it later is
-- additive; un-showing it after parents have seen it is not.
CREATE TABLE IF NOT EXISTS kid_wonder_question (
  id          BIGSERIAL PRIMARY KEY,
  device_mac  VARCHAR(20) NOT NULL,
  kid_id      BIGINT,
  question    TEXT        NOT NULL,
  asked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read: "the most recent one for this child", newest first.
CREATE INDEX IF NOT EXISTS idx_kid_wonder_kid_time ON kid_wonder_question (kid_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_kid_wonder_device_time ON kid_wonder_question (device_mac, asked_at DESC);
