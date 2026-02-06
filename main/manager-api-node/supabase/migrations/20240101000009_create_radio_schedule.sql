-- Migration: Create Radio Schedule Table
-- Description: Schedule for the radio agent broadcast programs

-- =============================================
-- radio_schedule - Radio broadcast schedule
-- =============================================
CREATE TABLE IF NOT EXISTS radio_schedule (
    id BIGSERIAL PRIMARY KEY,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    program_name VARCHAR(255) NOT NULL,
    playlist_id VARCHAR(100),
    stream_url TEXT,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_radio_schedule_active ON radio_schedule(is_active);
CREATE INDEX idx_radio_schedule_start ON radio_schedule(start_time);

COMMENT ON TABLE radio_schedule IS 'Radio agent broadcast schedule';
COMMENT ON COLUMN radio_schedule.start_time IS 'Program start time (HH:MM:SS)';
COMMENT ON COLUMN radio_schedule.end_time IS 'Program end time (HH:MM:SS)';
COMMENT ON COLUMN radio_schedule.program_name IS 'Display name for the program';
COMMENT ON COLUMN radio_schedule.playlist_id IS 'Language/category for MusicService lookup (e.g., English, Hindi)';
COMMENT ON COLUMN radio_schedule.stream_url IS 'Direct stream URL (optional, overrides playlist_id)';
COMMENT ON COLUMN radio_schedule.is_active IS 'Whether this schedule slot is active';
COMMENT ON COLUMN radio_schedule.metadata IS 'Additional program metadata (DJ name, description, etc.)';
