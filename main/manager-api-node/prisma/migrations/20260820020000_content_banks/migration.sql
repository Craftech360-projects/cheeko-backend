-- Content banks for the UNSCORED characters: Masti (jokes), Tara (wonders),
-- Mitthu (words), Nani (stories), Tikku (spelling words).
--
-- Content tables ONLY — no answer tables, no level derivation, no day gate.
-- These characters have no verdict to log: their no-repeat and progression
-- logic lives in their MEMO, which kid_character_state now persists. The
-- runtime serves items; the prompt plays the game.
--
-- Separate typed tables (not one JSONB table) so each bank can be authored,
-- levelled and grown independently in the admin, mirroring quiz/riddle/math.

CREATE TABLE IF NOT EXISTS "joke_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(100),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "setup" TEXT NOT NULL,
    "punchline" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "joke_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "joke_bank_code_key" ON "joke_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_joke_bank_lang_level" ON "joke_bank"("language", "level");

CREATE TABLE IF NOT EXISTS "why_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(100),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "question_text" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "wow_fact" TEXT,
    "try_at_home" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "why_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "why_bank_code_key" ON "why_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_why_bank_lang_level" ON "why_bank"("language", "level");

CREATE TABLE IF NOT EXISTS "word_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "category" VARCHAR(100),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "word" TEXT NOT NULL,
    "item_type" VARCHAR(50),
    "meaning_simple" TEXT,
    "example_sentence" TEXT,
    "phonics_chunks" TEXT,
    "spell_difficulty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "word_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "word_bank_code_key" ON "word_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_word_bank_lang_level" ON "word_bank"("language", "level");

CREATE TABLE IF NOT EXISTS "story_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "tantra" VARCHAR(100),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "moral" TEXT,
    "characters" TEXT,
    "beat1_hook" TEXT,
    "beat2_setting" TEXT,
    "beat3_plot_entry" TEXT,
    "beat4_first_half" TEXT,
    "beat5_second_half" TEXT,
    "beat6_ending" TEXT,
    "choice_question" TEXT,
    "choice_option_a" TEXT,
    "choice_option_b" TEXT,
    "sounds" TEXT,
    "kahavat" TEXT,
    "personalize" TEXT,
    "safety_notes" TEXT,
    "beats_total" INTEGER NOT NULL DEFAULT 6,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "story_bank_code_key" ON "story_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_story_bank_lang_level" ON "story_bank"("language", "level");

CREATE TABLE IF NOT EXISTS "spell_bank" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "word" TEXT NOT NULL,
    "phonics_chunks" TEXT,
    "meaning_simple" TEXT,
    "example_sentence" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "create_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spell_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "spell_bank_code_key" ON "spell_bank"("code");
CREATE INDEX IF NOT EXISTS "idx_spell_bank_lang_level" ON "spell_bank"("language", "level");
