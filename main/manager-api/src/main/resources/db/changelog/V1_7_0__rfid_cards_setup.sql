-- V1_7_0: RFID Cards Setup - Add content packs, questions, and card mappings
-- Adds support for 5 RFID cards with rhymes, phonics, math, colors, and animals content

-- Step 1: Create new Colors pack
INSERT INTO rfid_pack (pack_code, name, description, age_min, age_max, active, creator, create_date)
VALUES ('BLINKIT_COLORS_PACK_1', 'Colors Learning Pack 1', 'Color identification and recognition activities.', 3, 6, 1, 1, NOW());

-- Step 2: Insert Math questions (10 questions)
INSERT INTO rfid_question (code, title, prompt_text, language, category, difficulty, active, creator, create_date)
VALUES
  ('MATH_ADD_1_1', 'Addition: 1 + 1', 'What is 1 plus 1? Think carefully and tell me the answer!', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_2_2', 'Addition: 2 + 2', 'Let''s add 2 plus 2. What do you get?', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_3_3', 'Addition: 3 + 3', 'Can you add 3 plus 3 for me?', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_4_1', 'Addition: 4 + 1', 'What is 4 plus 1? Take your time!', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_5_2', 'Addition: 5 + 2', 'Let''s try 5 plus 2. What''s the answer?', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_3_4', 'Addition: 3 + 4', 'Can you solve 3 plus 4?', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_6_2', 'Addition: 6 + 2', 'What is 6 plus 2? You can do it!', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_5_5', 'Addition: 5 + 5', 'Let''s add 5 plus 5 together!', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_7_3', 'Addition: 7 + 3', 'Can you tell me what 7 plus 3 equals?', 'en', 'math', 1, 1, 1, NOW()),
  ('MATH_ADD_8_2', 'Addition: 8 + 2', 'What is 8 plus 2? This is the last one!', 'en', 'math', 1, 1, 1, NOW());

-- Step 3: Insert Colors questions (10 questions)
INSERT INTO rfid_question (code, title, prompt_text, language, category, difficulty, active, creator, create_date)
VALUES
  ('COLOR_RED', 'Identify Red', 'Can you find something red around you? Tell me what you see!', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_BLUE', 'Identify Blue', 'Look for something blue. What blue things can you see?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_YELLOW', 'Identify Yellow', 'Can you spot something yellow? Tell me about it!', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_GREEN', 'Identify Green', 'Find something green near you. What is it?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_ORANGE', 'Identify Orange', 'Look around for something orange. Can you see any?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_PURPLE', 'Identify Purple', 'Can you find something purple? What color is it?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_PINK', 'Identify Pink', 'Look for something pink. Tell me what you found!', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_BROWN', 'Identify Brown', 'Can you spot something brown around you?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_BLACK', 'Identify Black', 'Find something black. What black things do you see?', 'en', 'colors', 1, 1, 1, NOW()),
  ('COLOR_WHITE', 'Identify White', 'Look for something white near you. Can you tell me what it is?', 'en', 'colors', 1, 1, 1, NOW());

-- Step 4: Insert Animals questions (10 questions)
INSERT INTO rfid_question (code, title, prompt_text, language, category, difficulty, active, creator, create_date)
VALUES
  ('ANIMAL_DOG', 'About Dogs', 'Tell me what you know about dogs. What sound does a dog make?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_CAT', 'About Cats', 'What do you know about cats? How does a cat say hello?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_COW', 'About Cows', 'Can you tell me about cows? What sound does a cow make?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_ELEPHANT', 'About Elephants', 'Elephants are very big! What do you know about elephants?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_LION', 'About Lions', 'Lions are the king of the jungle! What sound does a lion make?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_BIRD', 'About Birds', 'Birds can fly! What do you know about birds?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_FISH', 'About Fish', 'Fish live in water. Can you tell me about fish?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_MONKEY', 'About Monkeys', 'Monkeys love to climb trees! What else do you know about monkeys?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_RABBIT', 'About Rabbits', 'Rabbits hop around! What do rabbits like to eat?', 'en', 'animals', 1, 1, 1, NOW()),
  ('ANIMAL_HORSE', 'About Horses', 'Horses can run very fast! What sound does a horse make?', 'en', 'animals', 1, 1, 1, NOW());

-- Step 5: Create RFID Card Mappings
-- Note: Question IDs will be auto-incremented, so we need to get the actual IDs
-- Assuming current max ID is 4, new questions will be IDs 5-34

-- C56C06AD → Rhymes (uses existing RHYMES_EN_01 content pack)
INSERT INTO rfid_card_mapping (rfid_uid, question_id, question_ids, pack_code, pack_id, content_pack_id, active, creator, create_date)
SELECT 'C56C06AD', NULL, NULL, 'RHYMES_EN_01', NULL, id, 1, 1, NOW()
FROM rfid_content_pack WHERE pack_code = 'RHYMES_EN_01';

-- 3D456D7E → Phonics (uses existing PHONICS_EN_01 content pack) - UPDATE existing card
UPDATE rfid_card_mapping 
SET question_id = NULL, 
    question_ids = NULL,
    pack_code = 'PHONICS_EN_01',
    pack_id = NULL,
    content_pack_id = (SELECT id FROM rfid_content_pack WHERE pack_code = 'PHONICS_EN_01'),
    updater = 1,
    update_date = NOW()
WHERE rfid_uid = '3D456D7E';

-- 13347AC9 → Math (10 questions)
-- Get the pack_id for BLINKIT_MATH_PACK_1
INSERT INTO rfid_card_mapping (rfid_uid, question_id, question_ids, pack_code, pack_id, active, creator, create_date)
SELECT 
    '13347AC9',
    (SELECT MIN(id) FROM rfid_question WHERE code = 'MATH_ADD_1_1'),
    JSON_ARRAY(
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_1_1'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_2_2'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_3_3'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_4_1'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_5_2'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_3_4'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_6_2'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_5_5'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_7_3'),
        (SELECT id FROM rfid_question WHERE code = 'MATH_ADD_8_2')
    ),
    'BLINKIT_MATH_PACK_1',
    (SELECT id FROM rfid_pack WHERE pack_code = 'BLINKIT_MATH_PACK_1'),
    1,
    1,
    NOW();

-- F67F44F4 → Colors (10 questions)
INSERT INTO rfid_card_mapping (rfid_uid, question_id, question_ids, pack_code, pack_id, active, creator, create_date)
SELECT 
    'F67F44F4',
    (SELECT MIN(id) FROM rfid_question WHERE code = 'COLOR_RED'),
    JSON_ARRAY(
        (SELECT id FROM rfid_question WHERE code = 'COLOR_RED'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_BLUE'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_YELLOW'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_GREEN'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_ORANGE'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_PURPLE'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_PINK'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_BROWN'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_BLACK'),
        (SELECT id FROM rfid_question WHERE code = 'COLOR_WHITE')
    ),
    'BLINKIT_COLORS_PACK_1',
    (SELECT id FROM rfid_pack WHERE pack_code = 'BLINKIT_COLORS_PACK_1'),
    1,
    1,
    NOW();

-- 3DA83C7E → Animals (10 questions) - UPDATE existing card
UPDATE rfid_card_mapping 
SET question_id = (SELECT MIN(id) FROM rfid_question WHERE code = 'ANIMAL_DOG'),
    question_ids = JSON_ARRAY(
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_DOG'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_CAT'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_COW'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_ELEPHANT'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_LION'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_BIRD'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_FISH'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_MONKEY'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_RABBIT'),
        (SELECT id FROM rfid_question WHERE code = 'ANIMAL_HORSE')
    ),
    pack_code = 'BLINKIT_ANIMALS_PACK_1',
    pack_id = (SELECT id FROM rfid_pack WHERE pack_code = 'BLINKIT_ANIMALS_PACK_1'),
    updater = 1,
    update_date = NOW()
WHERE rfid_uid = '3DA83C7E';
