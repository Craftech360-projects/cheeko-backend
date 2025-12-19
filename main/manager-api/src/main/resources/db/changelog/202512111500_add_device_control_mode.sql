-- Add device_mode column to ai_device table (idempotent)
-- Device control mode: manual (user controls via app) or auto (device decides)

-- Step 1: Add column if it doesn't exist
SET @column_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_device'
    AND COLUMN_NAME = 'device_mode');
SET @sql = IF(@column_exists = 0,
    'ALTER TABLE ai_device ADD COLUMN device_mode VARCHAR(20) DEFAULT \'manual\' COMMENT \'Device control mode: manual/auto\'',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2: Update existing devices to default mode
UPDATE ai_device SET device_mode = 'manual' WHERE device_mode IS NULL;

-- Step 3: Add index if it doesn't exist
SET @index_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_device'
    AND INDEX_NAME = 'idx_device_control_mode');
SET @sql = IF(@index_exists = 0,
    'CREATE INDEX idx_device_control_mode ON ai_device(device_mode)',
    'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
