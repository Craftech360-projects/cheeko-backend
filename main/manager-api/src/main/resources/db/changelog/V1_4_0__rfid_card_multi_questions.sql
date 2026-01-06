-- V1_4_0: Add support for multiple questions per RFID card
-- Adds question_ids JSON column to store array of question IDs

ALTER TABLE rfid_card_mapping
ADD COLUMN question_ids JSON NULL COMMENT 'JSON array of question IDs for multi-question support';

-- Migrate existing question_id data to question_ids array
UPDATE rfid_card_mapping
SET question_ids = JSON_ARRAY(question_id)
WHERE question_id IS NOT NULL AND question_ids IS NULL;
