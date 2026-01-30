-- V1_11_0__rhyme_audio_cache.sql
-- Add cached audio URLs column to rfid_content_pack for rhyme caching
-- JSON object maps sequence → CloudFront URL

ALTER TABLE rfid_content_pack
ADD COLUMN cached_audio_urls JSON DEFAULT NULL
COMMENT 'JSON: {"1": "https://cdn.../1.mp3", "2": "https://cdn.../2.mp3"}';
