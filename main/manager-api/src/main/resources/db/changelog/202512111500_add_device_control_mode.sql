-- Add device_mode column to ai_device table
-- Device control mode: manual (user controls via app) or auto (device decides)

ALTER TABLE ai_device
ADD COLUMN device_mode VARCHAR(20) DEFAULT 'manual'
COMMENT 'Device control mode: manual/auto';

-- Update existing devices to default mode
UPDATE ai_device SET device_mode = 'manual' WHERE device_mode IS NULL;

-- Add index for faster queries
CREATE INDEX idx_device_control_mode ON ai_device(device_mode);
