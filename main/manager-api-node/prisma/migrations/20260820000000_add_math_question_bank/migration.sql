-- Ginti's question bank: curated mental-maths problems + append-only answer log.
--
-- A mirror of the quiz bank in its CURRENT shape (post ADR-0009: one shared
-- bank, no age_band; teach_text/distractors present from birth), deliberately
-- column-identical so src/services/banks.js can query it with no per-bank field
-- mapping. Progress is derived from math_question_answer and never stored.

-- CreateTable
CREATE TABLE IF NOT EXISTS "math_question" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "accepted_answers" JSONB NOT NULL DEFAULT '[]',
    "teach_text" TEXT,
    "distractors" JSONB NOT NULL DEFAULT '[]',
    "category" VARCHAR(100),
    "level" INTEGER NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "math_question_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "math_question_level_check" CHECK ("level" >= 1)
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "math_question_answer" (
    "id" BIGSERIAL NOT NULL,
    "device_mac" VARCHAR(20) NOT NULL,
    "kid_id" BIGINT,
    "question_id" BIGINT NOT NULL,
    "result" VARCHAR(10) NOT NULL,
    "answered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "math_question_answer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "math_question_answer_result_check" CHECK ("result" IN ('correct', 'wrong', 'revealed'))
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "math_question_code_key" ON "math_question"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_math_question_lang_level" ON "math_question"("language", "level");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_math_answer_device_question" ON "math_question_answer"("device_mac", "question_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_math_answer_device_time" ON "math_question_answer"("device_mac", "answered_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_math_answer_kid_time" ON "math_question_answer"("kid_id", "answered_at");

-- AddForeignKey
-- RESTRICT, not CASCADE: the answer log is append-only history. Retire a
-- problem with active = false; deleting one must not erase children's progress.
ALTER TABLE "math_question_answer" ADD CONSTRAINT "math_question_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "math_question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
