-- Migration: Add day_of_week column to radio_schedule
-- Description: Enables 7-day weekly scheduling (0=Sunday, 1=Monday, ... 6=Saturday)
-- NULL means "every day" (backwards compatible with existing data)

ALTER TABLE radio_schedule
    ADD COLUMN day_of_week SMALLINT;

-- Constraint: day_of_week must be 0-6 or NULL
ALTER TABLE radio_schedule
    ADD CONSTRAINT chk_day_of_week CHECK (day_of_week BETWEEN 0 AND 6 OR day_of_week IS NULL);

-- Index for efficient day+time lookups
CREATE INDEX idx_radio_schedule_day_time ON radio_schedule(day_of_week, start_time);

COMMENT ON COLUMN radio_schedule.day_of_week IS 'Day of week (0=Sunday, 1=Monday, ... 6=Saturday). NULL means every day.';
