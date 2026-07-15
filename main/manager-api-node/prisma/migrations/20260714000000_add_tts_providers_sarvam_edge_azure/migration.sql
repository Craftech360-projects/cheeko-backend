-- Seed three additional TTS providers so operators can activate them via
-- PUT /toy/livekit/providers/active/tts or the admin dashboard. The picoclaw
-- LiveKit worker implements the synthesis clients; these rows are data only.
--
-- Notes:
--   sarvam — bulbul:v3; language_code is resolved per session from the child's
--            language by the worker (not stored here). sample_rate_hz feeds the
--            request sample_rate.
--   edge   — free, keyless Microsoft endpoint (developer path). voice_id is an
--            Edge voice name; no api_key needed.
--   azure  — region/endpoint and key come from the worker env
--            (AZURE_SPEECH_REGION / AZURE_SPEECH_KEY); api_key here is optional.

INSERT INTO "tts_providers" ("provider_name", "api_key", "voice_id", "model_id", "output_format", "sample_rate_hz", "temperature", "is_active", "priority")
VALUES
  ('sarvam', '', 'pooja', 'bulbul:v3', 'pcm_24000', 24000, NULL, FALSE, 40),
  ('edge', '', 'en-US-AnaNeural', NULL, 'pcm_24000', 24000, NULL, FALSE, 50),
  ('azure', '', 'en-US-AnaNeural', 'centralindia', 'pcm_24000', 24000, NULL, FALSE, 60)
ON CONFLICT ("provider_name") DO NOTHING;
