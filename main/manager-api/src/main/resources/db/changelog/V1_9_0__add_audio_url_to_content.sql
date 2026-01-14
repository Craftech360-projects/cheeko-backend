-- ============================================================================
-- V1_9_0: Add audio_url column for CloudFront CDN audio support
-- ============================================================================
-- This migration adds support for storing CloudFront audio URLs in content packs.
-- Used primarily for animal sounds but extensible to other audio content.
-- ============================================================================

-- Add audio_url column to rfid_content_pack
ALTER TABLE rfid_content_pack
ADD COLUMN audio_url VARCHAR(500) DEFAULT NULL
COMMENT 'Base CloudFront URL for audio files (e.g., https://d23u4d6oyrni77.cloudfront.net/audio/animals/)';

-- Update ANIMALS_EN_01 pack with CloudFront base URL
UPDATE rfid_content_pack
SET audio_url = 'https://d23u4d6oyrni77.cloudfront.net/audio/animals/'
WHERE pack_code = 'ANIMALS_EN_01';
