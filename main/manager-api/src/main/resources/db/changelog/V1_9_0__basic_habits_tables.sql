-- V1_9_0: Basic Habits Tables
-- Creates tables for habit packs, habits, and habit steps with media
-- CDN Base URL: https://d23u4d6oyrni77.cloudfront.net

-- Table 1: habit_pack (pack metadata)
CREATE TABLE IF NOT EXISTS habit_pack (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    pack_code       VARCHAR(50) NOT NULL UNIQUE,
    name            VARCHAR(200),
    description     TEXT,
    total_habits    INT DEFAULT 0,
    language        VARCHAR(10) DEFAULT 'en',
    version         VARCHAR(20) DEFAULT '1.0.0',
    content_hash    VARCHAR(64),
    active          TINYINT DEFAULT 1,
    creator         BIGINT,
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updater         BIGINT,
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table 2: habit (individual habits)
CREATE TABLE IF NOT EXISTS habit (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    pack_id         BIGINT NOT NULL,
    habit_code      VARCHAR(50) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    sequence        INT NOT NULL,
    total_steps     INT DEFAULT 10,
    thumbnail_url   VARCHAR(500),
    active          TINYINT DEFAULT 1,
    creator         BIGINT,
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updater         BIGINT,
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_habit_pack FOREIGN KEY (pack_id) REFERENCES habit_pack(id) ON DELETE CASCADE
);

-- Table 3: habit_step (steps with media)
CREATE TABLE IF NOT EXISTS habit_step (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    habit_id        BIGINT NOT NULL,
    step_number     INT NOT NULL,
    title           VARCHAR(200),
    instruction_text TEXT,
    audio_url       VARCHAR(500),
    audio_size_bytes BIGINT,
    audio_duration_ms INT,
    images_json     JSON,
    active          TINYINT DEFAULT 1,
    creator         BIGINT,
    create_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updater         BIGINT,
    update_date     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_habit_step (habit_id, step_number),
    CONSTRAINT fk_habit_step_habit FOREIGN KEY (habit_id) REFERENCES habit(id) ON DELETE CASCADE
);

-- Add habit_id column to rfid_card_mapping table
ALTER TABLE rfid_card_mapping ADD COLUMN habit_id BIGINT;
ALTER TABLE rfid_card_mapping ADD CONSTRAINT fk_rfid_habit FOREIGN KEY (habit_id) REFERENCES habit(id) ON DELETE SET NULL;

-- Insert seed data for habit pack
INSERT INTO habit_pack (pack_code, name, description, total_habits, language, version)
VALUES ('HABITS_EN_01', 'Basic Habits Pack', 'Essential daily habits for children', 5, 'en', '1.0.0');

SET @pack_id = LAST_INSERT_ID();

-- Insert 5 habits with correct step counts
INSERT INTO habit (pack_id, habit_code, name, description, sequence, total_steps, thumbnail_url) VALUES
(@pack_id, 'bed-time', 'Bed Time Routine', 'How to prepare for a good night sleep', 1, 10, 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-01/image.png'),
(@pack_id, 'brush-teeth', 'Brushing Teeth', 'How to brush teeth properly', 2, 10, 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-02/image.png'),
(@pack_id, 'wash-hands', 'Washing Hands', 'Proper hand washing technique', 3, 10, 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-01/image.png'),
(@pack_id, 'meal-time', 'Meal Time', 'Good eating habits and manners', 4, 8, 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-01/image.png'),
(@pack_id, 'tie-shoelace', 'Tying Shoelace', 'How to tie shoelaces step by step', 5, 9, 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-01/image.png');

-- =============================================
-- BED-TIME HABIT (10 steps)
-- =============================================
SET @bed_time_id = (SELECT id FROM habit WHERE habit_code = 'bed-time');

INSERT INTO habit_step (habit_id, step_number, title, instruction_text, audio_url, audio_size_bytes, images_json) VALUES
(@bed_time_id, 1, 'Start your routine', 'It is time to get ready for bed.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-01/audio.mp3', 62212,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-01/image.png","sizeBytes":21387,"sequence":1}]'),
(@bed_time_id, 2, 'Put on pajamas', 'Change into your comfy pajamas.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-02/audio.mp3', 49255,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-02/image.png","sizeBytes":33091,"sequence":1}]'),
(@bed_time_id, 3, 'Brush your teeth', 'Time to brush those teeth clean!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-03/audio.mp3', 73497,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-03/image.png","sizeBytes":23215,"sequence":1}]'),
(@bed_time_id, 4, 'Use the bathroom', 'Go to the bathroom before bed.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-04/audio.mp3', 65974,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-04/image.png","sizeBytes":27390,"sequence":1}]'),
(@bed_time_id, 5, 'Wash your face', 'Wash your face with water.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-05/audio.mp3', 65974,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-05/image.png","sizeBytes":33254,"sequence":1}]'),
(@bed_time_id, 6, 'Pick a story', 'Choose a bedtime story to read.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-06/audio.mp3', 59704,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-06/image.png","sizeBytes":48131,"sequence":1}]'),
(@bed_time_id, 7, 'Get into bed', 'Climb into your cozy bed.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-07/audio.mp3', 54271,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-07/image.png","sizeBytes":23621,"sequence":1}]'),
(@bed_time_id, 8, 'Story time', 'Listen to or read your bedtime story.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-08/audio.mp3', 59704,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-08/image.png","sizeBytes":27674,"sequence":1}]'),
(@bed_time_id, 9, 'Hugs and kisses', 'Give goodnight hugs and kisses.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-09/audio.mp3', 63466,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-09/image.png","sizeBytes":32783,"sequence":1}]'),
(@bed_time_id, 10, 'Lights out', 'Close your eyes and sweet dreams!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-10/audio.mp3', 85200,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/bed-time/step-10/image.png","sizeBytes":31704,"sequence":1}]');

-- =============================================
-- BRUSH-TEETH HABIT (10 steps)
-- Note: step-01 image is missing, using step-02 image as fallback
-- =============================================
SET @brush_teeth_id = (SELECT id FROM habit WHERE habit_code = 'brush-teeth');

INSERT INTO habit_step (habit_id, step_number, title, instruction_text, audio_url, audio_size_bytes, images_json) VALUES
(@brush_teeth_id, 1, 'Get your toothbrush', 'Pick up your toothbrush.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-01/audio.mp3', 76005,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-02/image.png","sizeBytes":26152,"sequence":1}]'),
(@brush_teeth_id, 2, 'Apply toothpaste', 'Squeeze a pea-sized amount of toothpaste.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-02/audio.mp3', 92723,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-02/image.png","sizeBytes":26152,"sequence":1}]'),
(@brush_teeth_id, 3, 'Brush front teeth', 'Brush the front of your teeth.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-03/audio.mp3', 95231,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-03/image.png","sizeBytes":35496,"sequence":1}]'),
(@brush_teeth_id, 4, 'Brush outer sides', 'Brush the outer sides in circles.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-04/audio.mp3', 96485,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-04/image.png","sizeBytes":31943,"sequence":1}]'),
(@brush_teeth_id, 5, 'Brush inner sides', 'Brush the inner sides of your teeth.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-05/audio.mp3', 91469,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-05/image.png","sizeBytes":30436,"sequence":1}]'),
(@brush_teeth_id, 6, 'Brush chewing surfaces', 'Brush the tops of your back teeth.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-06/audio.mp3', 98992,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-06/image.png","sizeBytes":26356,"sequence":1}]'),
(@brush_teeth_id, 7, 'Brush your tongue', 'Gently brush your tongue.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-07/audio.mp3', 104426,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-07/image.png","sizeBytes":25252,"sequence":1}]'),
(@brush_teeth_id, 8, 'Rinse your mouth', 'Rinse your mouth with water.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-08/audio.mp3', 56779,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-08/image.png","sizeBytes":24310,"sequence":1}]'),
(@brush_teeth_id, 9, 'Clean your toothbrush', 'Rinse your toothbrush and put it away.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-09/audio.mp3', 60958,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-09/image.png","sizeBytes":26982,"sequence":1}]'),
(@brush_teeth_id, 10, 'Sparkling smile', 'All done! Show off that sparkling smile!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-10/audio.mp3', 110695,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/brush-teeth/step-10/image.png","sizeBytes":39910,"sequence":1}]');

-- =============================================
-- WASH-HANDS HABIT (10 steps)
-- =============================================
SET @wash_hands_id = (SELECT id FROM habit WHERE habit_code = 'wash-hands');

INSERT INTO habit_step (habit_id, step_number, title, instruction_text, audio_url, audio_size_bytes, images_json) VALUES
(@wash_hands_id, 1, 'Turn on water', 'Turn on the tap with warm water.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-01/audio.mp3', 56779,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-01/image.png","sizeBytes":28594,"sequence":1}]'),
(@wash_hands_id, 2, 'Wet your hands', 'Put your hands under the water.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-02/audio.mp3', 48001,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-02/image.png","sizeBytes":26418,"sequence":1}]'),
(@wash_hands_id, 3, 'Get some soap', 'Pump some soap onto your hands.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-03/audio.mp3', 58032,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-03/image.png","sizeBytes":38093,"sequence":1}]'),
(@wash_hands_id, 4, 'Rub your palms', 'Rub your palms together to make bubbles!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-04/audio.mp3', 54271,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-04/image.png","sizeBytes":21909,"sequence":1}]'),
(@wash_hands_id, 5, 'Between fingers', 'Scrub between your fingers.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-05/audio.mp3', 62212,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-05/image.png","sizeBytes":21187,"sequence":1}]'),
(@wash_hands_id, 6, 'Back of hands', 'Rub the back of each hand.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-06/audio.mp3', 58032,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-06/image.png","sizeBytes":31559,"sequence":1}]'),
(@wash_hands_id, 7, 'Clean your thumbs', 'Rub around each thumb.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-07/audio.mp3', 63466,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-07/image.png","sizeBytes":54678,"sequence":1}]'),
(@wash_hands_id, 8, 'Rinse the soap', 'Rinse all the soap off.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-08/audio.mp3', 49255,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-08/image.png","sizeBytes":32002,"sequence":1}]'),
(@wash_hands_id, 9, 'Turn off water', 'Turn off the tap.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-09/audio.mp3', 48001,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-09/image.png","sizeBytes":27431,"sequence":1}]'),
(@wash_hands_id, 10, 'Dry your hands', 'Dry your hands with a clean towel. All clean!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-10/audio.mp3', 70989,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/wash-hands/step-10/image.png","sizeBytes":35410,"sequence":1}]');

-- =============================================
-- MEAL-TIME HABIT (8 steps)
-- =============================================
SET @meal_time_id = (SELECT id FROM habit WHERE habit_code = 'meal-time');

INSERT INTO habit_step (habit_id, step_number, title, instruction_text, audio_url, audio_size_bytes, images_json) VALUES
(@meal_time_id, 1, 'Wash your hands', 'Always wash your hands before eating.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-01/audio.mp3', 68481,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-01/image.png","sizeBytes":22293,"sequence":1}]'),
(@meal_time_id, 2, 'Sit properly', 'Sit up straight in your chair.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-02/audio.mp3', 62212,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-02/image.png","sizeBytes":40030,"sequence":1}]'),
(@meal_time_id, 3, 'Napkin in lap', 'Put your napkin on your lap.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-03/audio.mp3', 51763,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-03/image.png","sizeBytes":44418,"sequence":1}]'),
(@meal_time_id, 4, 'Wait for everyone', 'Wait for everyone to be served.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-04/audio.mp3', 51763,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-04/image.png","sizeBytes":31505,"sequence":1}]'),
(@meal_time_id, 5, 'Take small bites', 'Take small bites and chew well.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-05/audio.mp3', 53017,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-05/image.png","sizeBytes":50335,"sequence":1}]'),
(@meal_time_id, 6, 'Chew with mouth closed', 'Finish chewing before you talk.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-06/audio.mp3', 98992,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-06/image.png","sizeBytes":41375,"sequence":1}]'),
(@meal_time_id, 7, 'Use utensils', 'Use your fork and spoon properly.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-07/audio.mp3', 48001,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-07/image.png","sizeBytes":31292,"sequence":1}]'),
(@meal_time_id, 8, 'Say thank you', 'Say thank you when done. Good manners!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-08/audio.mp3', 58032,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/meal-time/step-08/image.png","sizeBytes":37806,"sequence":1}]');

-- =============================================
-- TIE-SHOELACE HABIT (9 steps)
-- =============================================
SET @tie_shoelace_id = (SELECT id FROM habit WHERE habit_code = 'tie-shoelace');

INSERT INTO habit_step (habit_id, step_number, title, instruction_text, audio_url, audio_size_bytes, images_json) VALUES
(@tie_shoelace_id, 1, 'Hold the laces', 'Hold one lace in each hand.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-01/audio.mp3', 67228,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-01/image.png","sizeBytes":42243,"sequence":1}]'),
(@tie_shoelace_id, 2, 'Cross the laces', 'Cross the right lace over the left.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-02/audio.mp3', 56779,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-02/image.png","sizeBytes":31915,"sequence":1}]'),
(@tie_shoelace_id, 3, 'Tuck and pull', 'Tuck one lace under and pull tight.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-03/audio.mp3', 62212,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-03/image.png","sizeBytes":51670,"sequence":1}]'),
(@tie_shoelace_id, 4, 'Make a loop', 'Make a loop with one lace - bunny ear one!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-04/audio.mp3', 49255,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-04/image.png","sizeBytes":54346,"sequence":1}]'),
(@tie_shoelace_id, 5, 'Hold the loop', 'Pinch the base of the loop.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-05/audio.mp3', 55525,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-05/image.png","sizeBytes":57927,"sequence":1}]'),
(@tie_shoelace_id, 6, 'Wrap around', 'Wrap the other lace around the loop.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-06/audio.mp3', 53017,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-06/image.png","sizeBytes":47388,"sequence":1}]'),
(@tie_shoelace_id, 7, 'Push through', 'Push through to make bunny ear two!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-07/audio.mp3', 59704,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-07/image.png","sizeBytes":60785,"sequence":1}]'),
(@tie_shoelace_id, 8, 'Pull tight', 'Pull both loops to tighten the bow.',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-08/audio.mp3', 53017,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-08/image.png","sizeBytes":54248,"sequence":1}]'),
(@tie_shoelace_id, 9, 'All done!', 'Great job! Your shoe is tied!',
 'https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-09/audio.mp3', 73497,
 '[{"url":"https://d23u4d6oyrni77.cloudfront.net/habits/tie-shoelace/step-09/image.png","sizeBytes":49749,"sequence":1}]');
