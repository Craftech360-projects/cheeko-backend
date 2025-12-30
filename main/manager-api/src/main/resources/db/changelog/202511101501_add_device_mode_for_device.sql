-- Add device_mode column to ai_device table (if not exists)
SET @dbname = DATABASE();
SET @tablename = 'ai_device';
SET @columnname = 'device_mode';
SET @preparedStatement = (SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @dbname
       AND TABLE_NAME = @tablename
       AND COLUMN_NAME = @columnname) > 0,
    'SELECT 1',
    'ALTER TABLE ai_device ADD COLUMN device_mode VARCHAR(20) DEFAULT ''manual'' COMMENT ''Device control mode: manual/auto'''
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Update existing devices to default mode
UPDATE ai_device SET device_mode = 'manual' WHERE device_mode IS NULL;
