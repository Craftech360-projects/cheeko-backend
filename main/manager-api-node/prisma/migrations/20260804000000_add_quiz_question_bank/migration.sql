-- Quizzy Question Bank: curated questions + append-only answer log.
-- Progress (Cleared, current Level) is derived from quiz_question_answer and is
-- never stored, so the CHECK constraints below guard the values those queries
-- match on.

-- CreateTable
CREATE TABLE IF NOT EXISTS "quiz_question" (
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

    CONSTRAINT "quiz_question_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quiz_question_age_band_check" CHECK ("age_band" IN ('3-5', '6-8', '9+')),
    CONSTRAINT "quiz_question_level_check" CHECK ("level" >= 1)
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "quiz_question_answer" (
    "id" BIGSERIAL NOT NULL,
    "device_mac" VARCHAR(20) NOT NULL,
    "question_id" BIGINT NOT NULL,
    "result" VARCHAR(10) NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_question_answer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quiz_question_answer_result_check" CHECK ("result" IN ('correct', 'wrong', 'revealed'))
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "quiz_question_code_key" ON "quiz_question"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_quiz_question_band_lang_level" ON "quiz_question"("age_band", "language", "level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_quiz_answer_device_question" ON "quiz_question_answer"("device_mac", "question_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_quiz_answer_device_time" ON "quiz_question_answer"("device_mac", "answered_at");

-- AddForeignKey
-- RESTRICT, not CASCADE: the answer log is append-only history. Retire a
-- question with active = false; deleting one must not erase children's progress.
ALTER TABLE "quiz_question_answer" ADD CONSTRAINT "quiz_question_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
