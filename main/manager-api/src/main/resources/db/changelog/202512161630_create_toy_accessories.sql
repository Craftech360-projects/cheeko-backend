-- ============================================
-- Create toy_accessories table for RC car and other accessory bindings
-- Author: claude
-- Date: 2025-12-16
-- ============================================

-- Create toy_accessories table
CREATE TABLE IF NOT EXISTS toy_accessories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT 'Primary key',
    user_id BIGINT NOT NULL COMMENT 'User who owns the toy (from ai_device.user_id)',
    toy_mac VARCHAR(20) NOT NULL COMMENT 'Parent toy MAC address (normalized, no colons)',
    accessory_mac VARCHAR(20) NOT NULL COMMENT 'Accessory MAC address (normalized, no colons)',
    accessory_type VARCHAR(20) NOT NULL DEFAULT 'car' COMMENT 'Accessory type: car, lamp, sensor, etc.',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Created timestamp',

    UNIQUE KEY uk_accessory_mac (accessory_mac),
    INDEX idx_toy_mac (toy_mac),
    INDEX idx_user_id (user_id),
    INDEX idx_toy_type (toy_mac, accessory_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Toy accessories binding table (RC car, lamp, etc.)';
