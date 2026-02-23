-- Migration: Add activation_code to ai_device
-- Description: Persist activation codes in DB so they survive server restarts

ALTER TABLE ai_device ADD COLUMN IF NOT EXISTS activation_code VARCHAR(10);

CREATE INDEX idx_ai_device_activation_code ON ai_device(activation_code);

COMMENT ON COLUMN ai_device.activation_code IS '6-digit OTA activation code for device binding';
