-- Analytics Mode Type Standardization Migration
-- Fix existing data to use consistent snake_case mode types

-- Step 1: Update analytics_game_sessions
UPDATE analytics_game_sessions 
SET mode_type = 'conversation' 
WHERE mode_type IN ('Cheeko', 'cheeko', 'CHEEKO');

UPDATE analytics_game_sessions 
SET mode_type = 'math_tutor' 
WHERE mode_type IN ('Math Tutor', 'math tutor', 'MATH TUTOR', 'MathTutor');

UPDATE analytics_game_sessions 
SET mode_type = 'riddle_solver' 
WHERE mode_type IN ('Riddle Solver', 'riddle solver', 'RIDDLE SOLVER', 'RiddleSolver');

UPDATE analytics_game_sessions 
SET mode_type = 'word_ladder' 
WHERE mode_type IN ('Word Ladder', 'word ladder', 'WORD LADDER', 'WordLadder');

UPDATE analytics_game_sessions 
SET mode_type = LOWER(mode_type)
WHERE mode_type IN ('Music', 'MUSIC', 'Story', 'STORY');

-- Step 2: Update analytics_user_progress
UPDATE analytics_user_progress 
SET mode_type = 'conversation' 
WHERE mode_type IN ('Cheeko', 'cheeko', 'CHEEKO');

UPDATE analytics_user_progress 
SET mode_type = 'math_tutor' 
WHERE mode_type IN ('Math Tutor', 'math tutor', 'MATH TUTOR', 'MathTutor');

UPDATE analytics_user_progress 
SET mode_type = 'riddle_solver' 
WHERE mode_type IN ('Riddle Solver', 'riddle solver', 'RIDDLE SOLVER', 'RiddleSolver');

UPDATE analytics_user_progress 
SET mode_type = 'word_ladder' 
WHERE mode_type IN ('Word Ladder', 'word ladder', 'WORD LADDER', 'WordLadder');

UPDATE analytics_user_progress 
SET mode_type = LOWER(mode_type)
WHERE mode_type IN ('Music', 'MUSIC', 'Story', 'STORY');

-- Step 3: Update analytics_game_attempts (game_type field)
UPDATE analytics_game_attempts 
SET game_type = 'conversation' 
WHERE game_type IN ('Cheeko', 'cheeko', 'CHEEKO');

UPDATE analytics_game_attempts 
SET game_type = 'math_tutor' 
WHERE game_type IN ('Math Tutor', 'math tutor', 'MATH TUTOR', 'MathTutor', 'Math', 'math');

UPDATE analytics_game_attempts 
SET game_type = 'riddle_solver' 
WHERE game_type IN ('Riddle Solver', 'riddle solver', 'RIDDLE SOLVER', 'RiddleSolver', 'Riddle', 'riddle');

UPDATE analytics_game_attempts 
SET game_type = 'word_ladder' 
WHERE game_type IN ('Word Ladder', 'word ladder', 'WORD LADDER', 'WordLadder');

-- Step 4: Update analytics_streaks (game_type field)
UPDATE analytics_streaks 
SET game_type = 'math_tutor' 
WHERE game_type IN ('Math Tutor', 'math tutor', 'MATH TUTOR', 'MathTutor', 'Math', 'math');

UPDATE analytics_streaks 
SET game_type = 'riddle_solver' 
WHERE game_type IN ('Riddle Solver', 'riddle solver', 'RIDDLE SOLVER', 'RiddleSolver', 'Riddle', 'riddle');

UPDATE analytics_streaks 
SET game_type = 'word_ladder' 
WHERE game_type IN ('Word Ladder', 'word ladder', 'WORD LADDER', 'WordLadder');

-- Verification queries (run after migration)
SELECT mode_type, COUNT(*) as sessions_count 
FROM analytics_game_sessions 
GROUP BY mode_type 
ORDER BY mode_type;

SELECT mode_type, COUNT(*) as progress_records 
FROM analytics_user_progress 
GROUP BY mode_type 
ORDER BY mode_type;

SELECT game_type, COUNT(*) as attempts_count 
FROM analytics_game_attempts 
GROUP BY game_type 
ORDER BY game_type;

-- Expected results after migration:
-- mode_type values should only be: conversation, math_tutor, riddle_solver, word_ladder, music, story
