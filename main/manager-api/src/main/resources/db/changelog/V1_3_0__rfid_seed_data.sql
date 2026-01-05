-- ============================================================================
-- RFID Seed Data Migration
-- Version: 1.3.0
-- Description: Sample data for RFID questions, packs, card mappings, and series
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- =========================================
-- 1) Question templates
-- =========================================

INSERT INTO rfid_question
    (id, code, title, prompt_text, language, category, difficulty, active, creator, create_date)
VALUES
    -- Q1: Name 10 animals
    (1,
     'ANIMALS_10',
     'Name 10 animals',
     'Can you name 10 different animals? Say them one by one, and I will count with you.',
     'en',
     'animals',
     1,
     1,
     1,
     NOW()),

    -- Q2: Simple addition
    (2,
     'MATH_ADD_1',
     'Add two numbers up to 10',
     'Let''s do a quick math problem. What is 4 plus 5?',
     'en',
     'math',
     1,
     1,
     1,
     NOW()),

    -- Q3: Animal story
    (3,
     'STORY_ANIMAL',
     'Short animal story',
     'I will tell you a very short story about a brave little animal. Listen carefully, and afterwards I will ask you what happened.',
     'en',
     'story',
     1,
     1,
     1,
     NOW()),

    -- Q4: Colors question
    (4,
     'COLORS_5',
     'Name 5 colors',
     'Can you name 5 different colors? Say them slowly so I can hear each one.',
     'en',
     'colors',
     1,
     1,
     1,
     NOW());

-- =========================================
-- 2) Packs (Blinkit SKUs, etc.)
-- =========================================

INSERT INTO rfid_pack
    (id, pack_code, name, description, age_min, age_max, active, creator, create_date)
VALUES
    (1,
     'BLINKIT_ANIMALS_PACK_1',
     'Animals Question Pack 1',
     'A pack of RFID cards that trigger animal-themed questions.',
     3,
     8,
     1,
     1,
     NOW()),

    (2,
     'BLINKIT_MATH_PACK_1',
     'Math Practice Pack 1',
     'Basic addition questions for early learners.',
     5,
     9,
     1,
     1,
     NOW()),

    (3,
     'BLINKIT_STORY_PACK_1',
     'Animal Stories Pack 1',
     'Short animal stories for listening and comprehension.',
     4,
     9,
     1,
     1,
     NOW());

-- =========================================
-- 3) Exact RFID → Question mappings
--    (one row per physical UID)
-- =========================================

INSERT INTO rfid_card_mapping
    (id, rfid_uid, question_id, pack_code, pack_id, notes, active, creator, create_date)
VALUES
    -- Two different cards that both ask "Name 10 animals"
    (1,
     '001122334455',
     1,
     'BLINKIT_ANIMALS_PACK_1',
     1,
     'Animals pack card A: name 10 animals',
     1,
     1,
     NOW()),

    (2,
     '001122334456',
     1,
     'BLINKIT_ANIMALS_PACK_1',
     1,
     'Animals pack card B: name 10 animals',
     1,
     1,
     NOW()),

    -- One card mapped to the math question
    (3,
     '00A1B2C3D4E5',
     2,
     'BLINKIT_MATH_PACK_1',
     2,
     'Math pack: 4 + 5 question',
     1,
     1,
     NOW()),

    -- One card mapped to the animal story
    (4,
     '00FFEEDDCCBB',
     3,
     'BLINKIT_STORY_PACK_1',
     3,
     'Story pack: short animal story',
     1,
     1,
     NOW());

-- =========================================
-- 4) UID ranges per pack (optional)
--    If you want to define ranges instead of
--    one row per UID, use rfid_series.
-- =========================================

INSERT INTO rfid_series
    (id, start_uid, end_uid, question_id, pack_id, priority, notes, active, creator, create_date)
VALUES
    -- Any UID from 1000..1999 → ANIMALS_10
    (1,
     '000000001000',
     '000000001999',
     1,
     1,
     10,
     'Animals pack range: UIDs 1000-1999',
     1,
     1,
     NOW()),

    -- Any UID from 2000..2099 → MATH_ADD_1
    (2,
     '000000002000',
     '000000002099',
     2,
     2,
     10,
     'Math pack range: UIDs 2000-2099',
     1,
     1,
     NOW()),

    -- Any UID from 3000..3099 → STORY_ANIMAL
    (3,
     '000000003000',
     '000000003099',
     3,
     3,
     10,
     'Story pack range: UIDs 3000-3099',
     1,
     1,
     NOW()),

    -- Any UID from 4000..4099 → COLORS_5
    (4,
     '000000004000',
     '000000004099',
     4,
     1,
     10,
     'Colors range: UIDs 4000-4099',
     1,
     1,
     NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
