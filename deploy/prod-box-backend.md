# Production Backend Deployment (139.59.7.72)

The production backend box runs the manager API, the MQTT gateways and the
dashboards. It serves `ota.cheekoai.in`.

> **This file is mirrored in two repos** — `picoclaw/deploy/prod/README.md`
> and `cheeko-backend/deploy/prod-box-backend.md`. It documents backend code that
> lives in cheeko-backend but sits beside the EKS and dev-box docs in picoclaw,
> so the three environments are findable from one place. **Edit both copies**, or
> the one you did not touch becomes a confident lie.

**The voice worker does not run here.** `picoclaw-livekit` runs on EKS — see
`picoclaw/deploy/README.md` and `picoclaw/deploy/k8s/`. A backend release and a worker release
are separate deploys with separate rollbacks.

> Production deploys require an **explicit per-deploy grant**. A grant covers
> one deploy; it does not carry to the next one. The dev box
> (`picoclaw/deploy/dev/README.md`) is the only standing permission.

## Current Target

| | |
|---|---|
| Host | `root@139.59.7.72` |
| Serves | `ota.cheekoai.in` |
| Repo | `/root/xiaozhi-esp32-server`, branch `main` |
| Database | **DigitalOcean managed Postgres** `db-postgresql-blr1-93302`, port 25060 |
| Boot migrations | **disabled** — `SKIP_DB_SYNC=1` |

The database is DigitalOcean managed, **not Supabase** like dev. That matters
twice: automated daily backups with PITR exist by default, and the TLS chain
behaves differently (see Common Problems).

## What Runs Here

| pm2 name | notes |
|---|---|
| `manager-api` | the release target |
| `gw-0` … `gw-3` | live device connections — do not restart casually |
| `admin-dashboard`, `manager-web`, `lineart` | restart only if their code changed |
| `pm2-logrotate` | module |

## The One Thing That Differs From Dev

**A restart does not migrate.** Prod sets `SKIP_DB_SYNC=1`, so boot logs

```
Skipping required Prisma table guard (SKIP_DB_SYNC=1).
Run `npx prisma migrate deploy` before enabling routes that need recent schema tables.
```

and applies nothing. The service comes up on **new code against the old
schema**, and migrations wait for an explicit command.

This is safer than dev's auto-migrate, but it means the window between restart
and migrate runs new code against tables that do not exist yet. Keep the two
steps adjacent, and expect route errors if you pause between them.

## Pre-Flight

1. **Backup / PITR checkpoint.** DO takes daily backups, so a restore point
   exists. For any migration that writes existing rows rather than only creating
   tables, snapshot the affected rows first — a primary-key list of exactly what
   will change is small and makes the write reversible.
2. **Read the pending migrations before running them.** `CREATE TABLE` is safe
   to apply blind; `UPDATE`, `DELETE` and `ALTER … DROP` are not.
3. **Verify the incoming delta is what you expect** — filtered to the code, not
   the whole repo, so documentation commits do not inflate the count:

   ```bash
   git -C /root/xiaozhi-esp32-server fetch origin
   git -C /root/xiaozhi-esp32-server diff --stat HEAD..origin/main -- main/
   ```

4. **Check whether `mqtt-gateway` actually changed.** If the diff there is
   docs-only, the gateways stay up.
5. **New environment variables.** Compare `.env.example` against prod's `.env`.
   A missing key is only a problem if the code has no fallback — check the
   fallback before adding anything.

## Deploy Order

```bash
# 1. backup / checkpoint confirmed

# 2. code
cd /root/xiaozhi-esp32-server
git pull --ff-only origin main

# 3. dependencies and client
cd main/manager-api-node
npm install
npx prisma generate            # MANDATORY when prisma/ changed

# 4. restart onto new code (schema NOT yet migrated)
pm2 restart manager-api

# 5. migrations, explicitly
npx prisma migrate status      # confirm the pending list is what you read
npx prisma migrate deploy

# 6. verify
pm2 logs manager-api --lines 60 --nostream
```

Leave `gw-0` … `gw-3` alone unless gateway code changed.

## Characters, Prompts And Banks

Schema alone delivers nothing — new tables arrive empty and the character
prompts are whatever was last installed. Three separate steps, in this order:

```bash
cd /root/xiaozhi-esp32-server/main/manager-api-node

# prompts + bank content for characters that already have rows
node scripts/install-character-pack.js <pack-dir>            # dry run first
node scripts/install-character-pack.js <pack-dir> --apply

# rows for characters this environment does not have yet
node scripts/create-missing-character-rows.js <pack-dir> --apply

# display-name fix, if this environment predates the rename
node scripts/rename-riddler-to-bujho.js --apply
```

Notes that cost time if you do not know them:

- The installer **updates existing rows and skips absent ones** — it prints
  `MISSING row for agent_code=…` and moves on. `create-missing-character-rows.js`
  exists for exactly that gap.
- The installer's `UPDATE` path never touches `agent_name`, so a rename must be
  applied separately. This matters: the worker's toolless-character list matches
  on the display name, and a stale name hands a character the tools its own
  prompt forbids, silently.
- New rows copy model and voice wiring from Cheeko. **The voice is a
  placeholder** — those characters will sound like Cheeko until real voices are
  chosen. Decide before children reach them.
- No manager-api restart is needed for prompt changes; templates are not cached.

**Worker code before prompts, never the reverse.** The EKS worker scores a fixed
set of MEMO `type=` labels. A prompt emitting a label the running worker does
not recognise records no verdicts at all. If a prompt change depends on a worker
change, roll EKS first and let it soak.

## Verify After Deployment

```bash
node scripts/character-check.js <MAC>      # after a real device session
```

Look for: one state row per character with distinct `state_type` values, a
non-zero count in SCORED BANKS for the bank just played, and a real
`parent_summary` once a day completes.

Database-level checks worth running:

```sql
SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT agent_code, agent_name FROM ai_agent_template ORDER BY agent_code;
```

## Rollback

- **Code:** `git checkout <previous-sha>`, `npm install`, `npx prisma generate`,
  `pm2 restart manager-api`.
- **Schema: there is no automatic rollback.** These migrations have no `down`.
  Additive ones are safe to leave in place — old code ignores tables it does not
  know about — so the correct incident response is code-only, leaving new tables
  orphaned until the next attempt. Dropping them is a deliberate, separate act.
- **Data backfills are not reversible by re-running.** The pre-flight snapshot
  or the PITR checkpoint is the only way back.
- **Prompts:** the installer writes a full dump to
  `backups/character-pack-<date>/` before every `--apply`.

## Common Problems

### `self-signed certificate in certificate chain`

Newer `pg` treats `sslmode=require` as an alias for `verify-full`, which rejects
the managed provider's chain outright. The scripts here strip the parameter and
configure verification on the `ssl` option instead:

```js
connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, ''),
ssl: { rejectUnauthorized: false },
```

Any new script hitting this database needs the same treatment.

### `npm ci` fails, or `npm install` rewrites the lockfile

`package.json` and `package-lock.json` have disagreed before — a dependency
present in the manifest and absent from the lock. Reconcile it in a commit
before the release rather than discovering it mid-deploy on the box.

### A character exists but sounds wrong

Voice comes from `ai_agent_template` (`sarvam_voice_id` / `tts_voice_id`), not
from any config file on the host. Rows created by
`create-missing-character-rows.js` inherit Cheeko's voice by design.

### `no unique or exclusion constraint matching the ON CONFLICT specification`

`ai_agent_template.agent_code` carries **no unique constraint**. Use a
`NOT EXISTS` guard in the `SELECT` rather than `ON CONFLICT`.
