# Prod manager-api release: `4b725c56` → `e3205553`

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

And on prod the two are the same action: `server.js` calls
`runPrismaMigrations()` on boot, so `pm2 restart manager-api` applies every
newly-arrived migration in one go, with no gate between them.

## Scope

18 commits, 57 files, +5192 / -414.

| area | changed | needs restart |
|---|---|---|
| `manager-api-node/src` | 13 files | **yes** |
| `manager-api-node/prisma` | 7 files (5 new migrations) | via restart |
| `manager-api-node/tests`, `scripts` | 17 files | no |
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

1. **Database backup / PITR checkpoint.** Confirm one exists and note the
   timestamp. The backfill is idempotent but it is still a write to six live
   analytics tables.
2. **`DEFAULT_PARENT_TIMEZONE`.** New in `.env.example` (`Asia/Kolkata`). Confirm
   it is set in prod's `.env` before restart, or confirm the code defaults
   safely without it.
3. **`npm install` adds a package named `i` (^0.3.7).** It appears in
   `package.json` without any import that needs it — almost certainly an
   accidental `npm i` artefact. Decide before shipping: drop it from
   `package.json` in a fix-up commit, or accept it. Do not discover it on prod.
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
   -> confirm exactly the 18 expected commits, nothing else
3. git pull
4. cd main/manager-api-node && npm install
5. npx prisma generate          <- MANDATORY, see below
6. pm2 restart manager-api      <- this applies all 5 migrations
7. pm2 logs manager-api --lines 50   -> confirm 5 migrations applied, no errors
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
2. **Rename the riddle character by hand.** The installer's `UPDATE` path sets
   only the three prompt columns — **not `agent_name`** — so prod's row stays
   `riddler`. This matters: `liveKitToollessCharacters` in the worker matches on
   `agent_name` and now contains `"bujho"`, so a `riddler` row gets handed the
   tools its own prompt forbids, silently. One guarded `UPDATE` fixes it.

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
