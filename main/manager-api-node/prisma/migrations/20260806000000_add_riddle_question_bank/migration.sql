-- Riddler's question bank: curated riddles + append-only answer log.
--
-- A mirror of the quiz bank, deliberately column-identical (including
-- question_text rather than riddle_text) so one service can query either bank
-- with no per-bank field mapping. Progress is derived from
-- riddle_question_answer and never stored, so the CHECK constraints below guard
-- the values those queries match on.

-- CreateTable
CREATE TABLE IF NOT EXISTS "riddle_question" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "accepted_answers" JSONB NOT NULL DEFAULT '[]',
    "category" VARCHAR(100),
    "age_band" VARCHAR(10) NOT NULL,
    "level" INTEGER NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riddle_question_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "riddle_question_age_band_check" CHECK ("age_band" IN ('3-5', '6-8', '9+')),
    CONSTRAINT "riddle_question_level_check" CHECK ("level" >= 1)
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "riddle_question_answer" (
    "id" BIGSERIAL NOT NULL,
    "device_mac" VARCHAR(20) NOT NULL,
    "question_id" BIGINT NOT NULL,
    "result" VARCHAR(10) NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riddle_question_answer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "riddle_question_answer_result_check" CHECK ("result" IN ('correct', 'wrong', 'revealed'))
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "riddle_question_code_key" ON "riddle_question"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_riddle_question_band_lang_level" ON "riddle_question"("age_band", "language", "level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_riddle_answer_device_question" ON "riddle_question_answer"("device_mac", "question_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_riddle_answer_device_time" ON "riddle_question_answer"("device_mac", "answered_at");

-- AddForeignKey
-- RESTRICT, not CASCADE: the answer log is append-only history. Retire a riddle
-- with active = false; deleting one must not erase children's progress.
ALTER TABLE "riddle_question_answer" ADD CONSTRAINT "riddle_question_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "riddle_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
