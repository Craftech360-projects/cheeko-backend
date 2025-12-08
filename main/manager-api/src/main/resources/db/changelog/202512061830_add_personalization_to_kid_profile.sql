-- Add personalization fields to kid_profile table
-- Primary language for AI conversations and additional parent-provided context

-- Add primary_language column
ALTER TABLE `kid_profile`
ADD COLUMN `primary_language` VARCHAR(50) DEFAULT 'English' COMMENT 'Primary language for AI conversations (English, Hindi, Kannada, Malayalam, etc.)';

-- Add additional_notes column
ALTER TABLE `kid_profile`
ADD COLUMN `additional_notes` TEXT DEFAULT NULL COMMENT 'Parent-provided context about child personality, traits, likes, dislikes, challenges';

-- Add index for language filtering (optional, for future analytics)
CREATE INDEX `idx_primary_language` ON `kid_profile` (`primary_language`);
