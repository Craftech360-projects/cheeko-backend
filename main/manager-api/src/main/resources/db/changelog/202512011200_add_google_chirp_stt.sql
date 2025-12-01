-- Add Google Chirp STT provider for LiveKit integration
-- Google Chirp provides high-quality speech recognition with support for multiple languages

-- Add Google Chirp model provider
DELETE FROM `ai_model_provider` WHERE `id` = 'SYSTEM_ASR_GoogleChirp';
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`, `updater`, `update_date`) VALUES
('SYSTEM_ASR_GoogleChirp', 'ASR', 'chirp', 'Google Chirp STT', '[{"key":"location","label":"GCP Location","type":"string"},{"key":"spoken_punctuation","label":"Spoken Punctuation","type":"boolean"}]', 7, 1, NOW(), 1, NOW());

-- Add Google Chirp model config
DELETE FROM `ai_model_config` WHERE `id` = 'ASR_GoogleChirp';
INSERT INTO `ai_model_config` VALUES ('ASR_GoogleChirp', 'ASR', 'GoogleChirp', 'Google Chirp STT', 0, 1, '{\"type\": \"chirp\", \"location\": \"asia-southeast1\", \"spoken_punctuation\": false}', NULL, NULL, 7, NULL, NULL, NULL, NULL);

-- Add documentation for Google Chirp STT
UPDATE `ai_model_config` SET
`doc_link` = 'https://cloud.google.com/speech-to-text/v2/docs/chirp-model',
`remark` = 'Google Chirp STT Configuration:
1. Advanced speech recognition using Google Cloud Speech-to-Text V2
2. Chirp is Google''s state-of-the-art speech model with improved accuracy
3. Configuration fields:
   - location: GCP region where Chirp is available
     * us-central1
     * europe-west4
     * asia-southeast1
   - spoken_punctuation: Enable detection of spoken punctuation marks

Requirements:
- Google Cloud project with Speech-to-Text API enabled
- GOOGLE_APPLICATION_CREDENTIALS environment variable set to service account key path
- Or running on GCP with appropriate service account permissions

Set in .env:
STT_PROVIDER=chirp
GOOGLE_STT_LOCATION=asia-southeast1' WHERE `id` = 'ASR_GoogleChirp';
