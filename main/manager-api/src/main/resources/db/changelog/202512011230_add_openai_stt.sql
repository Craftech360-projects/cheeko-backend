-- Add OpenAI STT provider for LiveKit integration
-- OpenAI provides high-quality speech recognition with the gpt-4o-transcribe model

-- Add OpenAI STT model provider
DELETE FROM `ai_model_provider` WHERE `id` = 'SYSTEM_ASR_OpenAI';
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`, `updater`, `update_date`) VALUES
('SYSTEM_ASR_OpenAI', 'ASR', 'openai', 'OpenAI STT', '[{"key":"model","label":"Model","type":"string"}]', 8, 1, NOW(), 1, NOW());

-- Add OpenAI STT model config
DELETE FROM `ai_model_config` WHERE `id` = 'ASR_OpenAI';
INSERT INTO `ai_model_config` VALUES ('ASR_OpenAI', 'ASR', 'OpenAI', 'OpenAI STT (gpt-4o-transcribe)', 0, 1, '{"type": "openai", "model": "gpt-4o-transcribe"}', NULL, NULL, 8, NULL, NULL, NULL, NULL);

-- Add documentation for OpenAI STT
UPDATE `ai_model_config` SET
`doc_link` = 'https://platform.openai.com/docs/guides/speech-to-text',
`remark` = 'OpenAI STT Configuration:
1. Advanced speech recognition using OpenAI''s gpt-4o-transcribe model
2. High-quality transcription with support for multiple languages
3. Configuration fields:
   - model: OpenAI STT model to use
     * gpt-4o-transcribe (recommended)
     * whisper-1 (alternative)

Requirements:
- OpenAI API key with access to transcription endpoints
- OPENAI_API_KEY environment variable set

Set in .env:
STT_PROVIDER=openai
OPENAI_STT_MODEL=gpt-4o-transcribe
OPENAI_API_KEY=your_openai_api_key_here' WHERE `id` = 'ASR_OpenAI';
