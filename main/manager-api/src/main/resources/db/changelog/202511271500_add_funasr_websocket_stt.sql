-- Add FunASR WebSocket STT provider for LiveKit integration
-- This provider supports streaming STT with 2-pass mode

-- Add FunASR WebSocket model provider
DELETE FROM `ai_model_provider` WHERE `id` = 'SYSTEM_ASR_FunASRWebSocket';
INSERT INTO `ai_model_provider` (`id`, `model_type`, `provider_code`, `name`, `fields`, `sort`, `creator`, `create_date`, `updater`, `update_date`) VALUES
('SYSTEM_ASR_FunASRWebSocket', 'ASR', 'funasr', 'FunASR WebSocket STT', '[{"key":"host","label":"Server Host","type":"string"},{"key":"port","label":"Server Port","type":"number"},{"key":"use_ssl","label":"Use SSL","type":"boolean"},{"key":"mode","label":"Recognition Mode","type":"string"},{"key":"language","label":"Language","type":"string"},{"key":"use_itn","label":"Enable ITN","type":"boolean"},{"key":"hotwords","label":"Hotwords","type":"string"}]', 6, 1, NOW(), 1, NOW());

-- Add FunASR WebSocket model config
DELETE FROM `ai_model_config` WHERE `id` = 'ASR_FunASRWebSocket';
INSERT INTO `ai_model_config` VALUES ('ASR_FunASRWebSocket', 'ASR', 'FunASRWebSocket', 'FunASR WebSocket STT', 0, 1, '{\"type\": \"funasr\", \"host\": \"127.0.0.1\", \"port\": 10096, \"use_ssl\": false, \"mode\": \"2pass\", \"language\": \"en\", \"use_itn\": true, \"hotwords\": \"\"}', NULL, NULL, 6, NULL, NULL, NULL, NULL);

-- Add documentation for FunASR WebSocket STT
UPDATE `ai_model_config` SET
`doc_link` = 'https://github.com/modelscope/FunASR',
`remark` = 'FunASR WebSocket STT Configuration:
1. Streaming speech recognition using FunASR WebSocket server
2. Supports three modes:
   - 2pass: Best quality with real-time interim results and refined final results
   - online: Fast streaming with interim results only
   - offline: Best accuracy, processes complete audio
3. Configuration fields:
   - host: FunASR server address (default: 127.0.0.1)
   - port: WebSocket port (default: 10096)
   - use_ssl: Enable WSS for secure connections
   - mode: Recognition mode (2pass, online, offline)
   - language: Language code (en, zh, etc.)
   - use_itn: Enable Inverse Text Normalization
   - hotwords: Custom hotwords for better recognition

Deploy FunASR server:
docker run -d -p 10096:10095 --privileged=true registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12

For GPU support, see: https://github.com/modelscope/FunASR/blob/main/runtime/docs/SDK_advanced_guide_online_zh.md' WHERE `id` = 'ASR_FunASRWebSocket';
