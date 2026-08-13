-- The two consent timestamps parent_profile has always been declared with, but
-- has never had in a database migrated up from MySQL.
--
-- They entered schema.prisma in ea5ea984 ("pp & tos in backend") and exist only
-- inside 20260124000000_init, which no live database ever ran -- the tables
-- predate the migration history. Prisma selects every declared column, so the
-- absent pair made P2022 the answer to any read or write of parent_profile:
-- GET/PUT /api/mobile/parent-profile, the FCM token endpoints, GET
-- /api/mobile/user-state and the onboarding flag all returned 500 in the parent
-- app, on every environment, since that commit.
--
-- Nullable and untouched by any backfill: a NULL here means "never recorded",
-- which is the truth for every row that exists today. Guarded so it is safe to
-- replay on a database that already has them.
ALTER TABLE parent_profile
  ADD COLUMN IF NOT EXISTS privacy_policy_accepted_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS consent_accepted_at        TIMESTAMPTZ(6);
