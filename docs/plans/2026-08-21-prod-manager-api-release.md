# Prod manager-api release: `4b725c56` → `98f86536`

Plan for bringing production (`139.59.7.72`) up to the current manager-api,
which is what "apply the pending migrations to prod" actually requires. Written
2026-08-21. **Nothing here has been executed.**

Production deploys need an explicit per-deploy grant — see
`cheeko-deploy-boundaries`. This is the plan, not permission.

## Why this is a release, not a migration run

Prod holds **43 migration files and 43 applied rows — nothing is pending.** The
five migrations that create `kid_character_state`, the content banks and the
math bank do not exist on that box; its tree is at `4b725c56`, which predates
them. They arrive only by moving the code forward.

**Correction, proven during the 2026-08-21 run:** this is NOT true on prod.
Prod sets `SKIP_DB_SYNC=1`, so boot logs "Skipping required Prisma table guard"
and applies nothing. The restart brings up new code against the OLD schema, and
migrations need an explicit `npx prisma migrate deploy`. That is a safer design
than dev's auto-migrate — but it means the window between restart and migrate
runs new code against a schema missing its tables, so keep the two adjacent.

## Scope

20 commits, 58 files, +5421 / -414.

Target is `98f86536`, not `e3205553`: the two pre-flight fix-ups below are
committed on top, so they ship with the release rather than being applied by
hand on the box.

| area | changed | needs restart |
|---|---|---|
| `manager-api-node/src` | 13 files | **yes** |
| `manager-api-node/prisma` | 7 files (5 new migrations) | via restart |
| `manager-api-node/tests`, `scripts` | 18 files | no |
| `admin-dashboard`, `founder-dashboard-web` | 8 files | dashboards only |
| `mqtt-gateway` | **doc only** | **no — leave gw-0..3 alone** |

The gateways carry a markdown change and nothing else. Do not restart them;
they hold live device connections.

## The five migrations

Four are purely additive — `CREATE TABLE` / `CREATE INDEX IF NOT EXISTS`, no
drops:

```
20260820000000_add_math_question_bank    math_question, math_question_answer
20260820010000_kid_character_progress    kid_character_state, kid_session_progress
20260820020000_content_banks             story/joke/why/word/spell_bank
20260820030000_kid_content_seen          kid_content_seen
```

The fifth, `20260820000000_rollups_repair_kid`, is a data backfill: it sets
`kid_id` on rows where it is `NULL` across six analytics tables, only for
devices that have a paired child. Written to be idempotent — "Re-running changes
nothing". It is the only statement in this release that writes existing prod
rows, so it is the one to have a backup for.

## Pre-flight

1. **Database backup / PITR checkpoint.** Prod is **DigitalOcean managed
   Postgres** (`db-postgresql-blr1-93302`), not Supabase — DO takes automated
   daily backups with PITR, so a restore point exists by default. For the
   backfill specifically, snapshot the exact rows it will touch first; on
   2026-08-21 that was only 93 rows across the six tables, saved to
   `/root/rollup-backfill-reversal-20260821.json`. Reversal is
   `UPDATE <t> SET kid_id=NULL WHERE id IN (...)`.
2. ~~**`DEFAULT_PARENT_TIMEZONE`.**~~ **Resolved — no action needed.** It is
   absent from prod's `.env`, and `src/utils/timezone.js:44` falls back to
   `Asia/Kolkata`, which is the same value `.env.example` suggests.
3. ~~**`npm install` adds a package named `i` (^0.3.7).**~~ **Done — fixed in
   `98f86536`.** It was worse than cruft: `i` was in `package.json` but absent
   from `package-lock.json` entirely, so manifest and lock disagreed. `npm ci`
   would have failed outright and `npm install` would have rewritten the lock
   mid-release. Nothing imports it. Removed, and the two files agree again.
4. **Confirm which Manager API the EKS worker pods call.** Still unanswered.
   Reading the k8s Secret is blocked by the permission classifier, so this needs
   a human. If the pods point at this prod manager, they have been POSTing
   progress to a database with no `kid_character_state` — those writes are
   presumably failing today, and this release silently fixes that. Worth knowing
   in advance rather than discovering it in the logs.
5. **Stop the dev box drifting further.** Dev is at `93573541`, one commit
   behind local. Harmless, but confirm the commit being shipped to prod is one
   that has actually run somewhere.

## Release steps

```
1. Back up / checkpoint the prod database.
2. git -C /root/xiaozhi-esp32-server fetch && git log --oneline HEAD..origin/main
   -> check the code delta, not the raw commit count (docs commits keep
      landing on top): `git diff --stat 4b725c56..origin/main -- main/` reads
      49 files / +4935 / -410. (The 58 / +5421 / -414 figure quoted earlier in
      this doc is the WHOLE-repo diff including docs/ — do not compare it
      against a `-- main/` filter, as an earlier draft of this line did.)
3. git pull
4. cd main/manager-api-node && npm install
5. npx prisma generate          <- MANDATORY, see below
6. pm2 restart manager-api      <- new code, schema NOT yet migrated
7. npx prisma migrate status    -> expect the 5 listed as not applied
8. npx prisma migrate deploy    <- THIS applies them (SKIP_DB_SYNC=1 on prod)
9. pm2 logs manager-api --lines 60   -> confirm no errors
```

**Step 5 is not optional.** The prisma schema changed; without `prisma generate`
first, any `select: { new_field }` throws at runtime after restart. Prisma 7's
`prisma.config.ts` does not auto-load `.env` — it needs `import 'dotenv/config'`
or generate fails on `DIRECT_URL`. Verify that is present in prod's tree before
step 5, since the fix landed on 2026-07-25 and prod is older.

## Post-release: content and characters

**Creating the tables delivers nothing on its own.** After step 7 prod still has
8 characters with old prompts and *empty* content banks. Two further steps:

1. **Install the character pack** from `cheekocharactersystem/database-import-pack`
   using `scripts/install-character-pack.js`. It both `UPDATE`s existing rows and
   `INSERT`s missing ones, so Ginti, Tikku and Vanya get created and the other
   eight get current prompts. Note `TRANSFORM` is now empty (`e3205553`), so
   Ginti installs as authored with `daily_math`.
2. **Rename the riddle character.** The installer's `UPDATE` path sets only the
   three prompt columns — **not `agent_name`** — so prod's row stays `riddler`.
   This matters: `liveKitToollessCharacters` in the worker matches on
   `agent_name` and now contains `"bujho"`, so a `riddler` row gets handed the
   tools its own prompt forbids, silently.

   `scripts/rename-riddler-to-bujho.js` ships in this release for it:

   ```
   node scripts/rename-riddler-to-bujho.js            # report only
   node scripts/rename-riddler-to-bujho.js --apply    # perform the rename
   ```

   It matches on `agent_code` rather than the display name, no-ops when the row
   is already `Bujho`, refuses if `agent_code` is duplicated, guards the write
   on the name it just read, and re-reads afterwards to confirm. Verified
   report-only against the dev box, which is already renamed.

Run these only after step 7 is verified. They are independently revertible; the
release is not.

## Verification

- `SELECT count(*) FROM _prisma_migrations` → 48, five newest dated today.
- All expected tables present (the Phase 0 audit query lists them).
- `SELECT agent_code, agent_name FROM ai_agent_template` → 11 rows, riddle
  character named `Bujho`.
- manager-api answering; a device session completes end to end.
- Parent app / dashboards still load — `founder-dashboard-web` and
  `admin-dashboard` changed too.

## Rollback

- **Code:** `git checkout 4b725c56` + `npm install` + `npx prisma generate` +
  `pm2 restart manager-api`.
- **Schema: there is no automatic rollback.** These migrations have no `down`.
  The four additive ones are safe to leave in place — old code ignores tables it
  does not know about — so the correct rollback is code-only, leaving the new
  tables orphaned until the next attempt. Dropping them is a manual, deliberate
  act and should not be part of an incident response.
- **Backfill:** not reversible by re-running. The pre-flight backup is the only
  path back for those six analytics tables, which is why step 1 exists.

## Explicitly not in this release

- **The EKS worker.** `picoclaw-livekit` runs on EKS, not this box, and is a
  separate digest-pinned rollout (`picoclaw-eks-prod-deploy`). If it is upgraded,
  the `riddler` → `Bujho` rename above must already have landed, or the tool
  gating breaks.
- **The MEMO state-type split** (`ec14877`, `1bbc725`). Pointless on prod until
  `kid_character_state` exists — which is what this release creates. Sequence it
  after, not with.
