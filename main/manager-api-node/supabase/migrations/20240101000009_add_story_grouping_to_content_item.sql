-- Migration: Add story grouping columns to content_item
-- Description: Enables grouped content (story packs) where items are organized
--              into stories/groups. NULL story_number = flat item (backward compatible).

ALTER TABLE content_item
    ADD COLUMN IF NOT EXISTS story_number INTEGER,
    ADD COLUMN IF NOT EXISTS story_title VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_content_item_story
    ON content_item(content_pack_id, story_number, item_number);

COMMENT ON COLUMN content_item.story_number IS 'Group index for story packs. NULL = flat item. 1,2,3... = story group number';
COMMENT ON COLUMN content_item.story_title IS 'Display title for the story group (e.g. "The Lion King"). NULL for flat items';
