ALTER TABLE ai_device
  ADD COLUMN device_mode VARCHAR(20) DEFAULT 'manual'
  COMMENT 'Device control mode: manual/auto';

  -- Update existing devices to default mode
  UPDATE ai_device SET device_mode = 'manual' WHERE device_mode IS NULL;