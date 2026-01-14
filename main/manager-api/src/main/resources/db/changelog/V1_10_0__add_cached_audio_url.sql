-- V1_10_0: Add cached_audio_url column to rfid_question table
-- Purpose: Cache AI-generated audio responses to avoid regenerating every scan

-- Add cached_audio_url column for AI-generated response caching
ALTER TABLE rfid_question
ADD COLUMN cached_audio_url VARCHAR(500) DEFAULT NULL
COMMENT 'S3/CloudFront URL for cached AI-generated audio response';

-- Add index for faster lookups on cached audio
CREATE INDEX idx_rfid_question_cached_audio ON rfid_question(cached_audio_url);
