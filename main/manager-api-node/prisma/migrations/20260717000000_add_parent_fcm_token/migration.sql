-- fcm_token was added to schema.prisma in May ("app notif", 3649c17d) with no
-- migration, so every push path (plan-gate, trial reminders, usage summaries)
-- throws "column does not exist" against this DB. SUB-2 criterion 4 needs it.
ALTER TABLE "parent_profile"
  ADD COLUMN IF NOT EXISTS "fcm_token" VARCHAR(500);
