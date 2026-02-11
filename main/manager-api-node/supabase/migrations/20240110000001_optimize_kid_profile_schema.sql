-- Optimize kid_profile table schema
-- Add additional_notes, remove unnecessary columns

-- Add additional_notes column
ALTER TABLE kid_profile 
ADD COLUMN IF NOT EXISTS additional_notes TEXT;

-- Drop unwanted columns
ALTER TABLE kid_profile 
DROP COLUMN IF EXISTS nickname,
DROP COLUMN IF EXISTS school,
DROP COLUMN IF EXISTS avatar_url,
DROP COLUMN IF EXISTS timezone;

-- Add comment
COMMENT ON COLUMN kid_profile.additional_notes IS 'Additional notes about the child from parents';
COMMENT ON COLUMN kid_profile.grade IS 'Child grade/class, auto-calculated from birth_date';

-- Update trigger is already in place from previous migration
