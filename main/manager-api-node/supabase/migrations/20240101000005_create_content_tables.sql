-- Migration: Create Content Tables
-- Description: Content library and playlists for music/stories

-- =============================================
-- content_library - Content repository
-- =============================================
CREATE TABLE IF NOT EXISTS content_library (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title VARCHAR(500) NOT NULL,
    romanized VARCHAR(500),
    filename VARCHAR(500),
    content_type VARCHAR(50) NOT NULL,
    category VARCHAR(255),
    alternatives JSONB DEFAULT '[]',
    aws_s3_url VARCHAR(1000),
    duration_seconds INTEGER,
    file_size_bytes BIGINT,
    is_active SMALLINT DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_content_library_type ON content_library(content_type);
CREATE INDEX idx_content_library_category ON content_library(category);
CREATE INDEX idx_content_library_active ON content_library(is_active);
CREATE INDEX idx_content_library_title ON content_library(title);

-- Full-text search index
CREATE INDEX idx_content_library_search ON content_library
    USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(romanized, '')));

COMMENT ON TABLE content_library IS 'Music and story content repository';
COMMENT ON COLUMN content_library.content_type IS 'music or story';
COMMENT ON COLUMN content_library.category IS 'Language for music, Genre for stories';
COMMENT ON COLUMN content_library.alternatives IS 'JSON array of alternative search terms';
COMMENT ON COLUMN content_library.is_active IS '0=inactive, 1=active';

-- =============================================
-- content_items - Individual content items
-- =============================================
CREATE TABLE IF NOT EXISTS content_items (
    id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title VARCHAR(500) NOT NULL,
    romanized VARCHAR(500),
    filename VARCHAR(500),
    content_type VARCHAR(50) NOT NULL,
    category VARCHAR(255),
    alternatives JSONB DEFAULT '[]',
    file_url VARCHAR(1000),
    thumbnail_url VARCHAR(1000),
    duration_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_content_items_type ON content_items(content_type);
CREATE INDEX idx_content_items_category ON content_items(category);

COMMENT ON TABLE content_items IS 'Individual content items';

-- =============================================
-- music_playlist - Music playlist associations
-- =============================================
CREATE TABLE IF NOT EXISTS music_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL REFERENCES ai_device(id) ON DELETE CASCADE,
    content_id VARCHAR(36) NOT NULL REFERENCES content_library(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, content_id)
);

CREATE INDEX idx_music_playlist_device ON music_playlist(device_id);
CREATE INDEX idx_music_playlist_position ON music_playlist(device_id, position);

COMMENT ON TABLE music_playlist IS 'Device music playlists';
COMMENT ON COLUMN music_playlist.position IS '0-based playlist order';

-- =============================================
-- story_playlist - Story playlist associations
-- =============================================
CREATE TABLE IF NOT EXISTS story_playlist (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(36) NOT NULL REFERENCES ai_device(id) ON DELETE CASCADE,
    content_id VARCHAR(36) NOT NULL REFERENCES content_library(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, content_id)
);

CREATE INDEX idx_story_playlist_device ON story_playlist(device_id);
CREATE INDEX idx_story_playlist_position ON story_playlist(device_id, position);

COMMENT ON TABLE story_playlist IS 'Device story playlists';
COMMENT ON COLUMN story_playlist.position IS '0-based playlist order';
