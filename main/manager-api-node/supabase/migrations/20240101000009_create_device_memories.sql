-- Device memories table for Cheeko memory system (Tier 2: Qdrant backend)
-- Stores markdown files (profile, daily_log) per device MAC address.
-- Vectors are stored in Qdrant; this table handles text content only.

CREATE TABLE IF NOT EXISTS device_memories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    mac_id TEXT NOT NULL,
    file_type TEXT NOT NULL,          -- 'profile', 'daily_log'
    file_date DATE,                   -- NULL for profile, date for daily logs
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Unique constraint for upsert: one file per (mac, type, date)
    CONSTRAINT uq_device_memory UNIQUE (mac_id, file_type, file_date)
);

-- Index for fast lookup by device
CREATE INDEX IF NOT EXISTS idx_device_memories_mac ON device_memories(mac_id);

-- Index for listing daily logs by date
CREATE INDEX IF NOT EXISTS idx_device_memories_date ON device_memories(file_date)
    WHERE file_date IS NOT NULL;

-- Comment
COMMENT ON TABLE device_memories IS 'Per-device markdown files for Cheeko memory system (profile, daily logs)';
