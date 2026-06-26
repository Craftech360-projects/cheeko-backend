# Cheeko local Postgres 18 (Docker)

Local PostgreSQL 18 mirror of the remote Supabase database (application data, `public` schema only).

## Start the DB

```powershell
docker compose -f D:\cheeko-backend\main\db\cheeko-postgres.yml up -d --build
```

Wait until ready:

```powershell
docker exec cheeko-postgres pg_isready -U postgres
```

## Local connection string

```
postgresql://postgres:postgres@localhost:5432/postgres
```

Host port is **5432** (mapped to container 5432). User/pass/db are all `postgres`.

> Note: Postgres 18 images store data under a version-specific subdir, so the
> named volume `cheeko-pgdata` is mounted at `/var/lib/postgresql` (NOT
> `/var/lib/postgresql/data`). Mounting at `/data` makes the container crash-loop.

## Re-run the data copy (dump + restore)

**Easiest:** run the script (reads `DIRECT_URL` from `manager-api-node/.env`, no password needed):

```powershell
powershell -ExecutionPolicy Bypass -File D:\cheeko-backend\main\db\migrate-supabase.ps1
```

Or do it manually:

The dump uses the `postgres:18` image's own client tools (run in a throwaway
container) so the client version matches the target. `dump/` is gitignored.

Source = Supabase session pooler (port 5432, supports `pg_dump`).

**1. Dump from Supabase** (PowerShell — avoids Git Bash `/dump` path mangling).
The source URL is the `DIRECT_URL` from `manager-api-node/.env` — never hard-code
the password here. Put it in an env var first:

```powershell
$env:SUPABASE_DIRECT_URL = "<DIRECT_URL from manager-api-node/.env>?sslmode=require"
docker run --rm -v "D:/cheeko-backend/main/db/dump:/dump" postgres:18 `
  pg_dump "$env:SUPABASE_DIRECT_URL" -Fc --no-owner --no-privileges --schema=public -f /dump/cheeko.dump
```

**2. Restore into the local container** (uses `host.docker.internal` — `--network host`
does not reach localhost on Docker Desktop for Windows):

```powershell
docker run --rm -v "D:/cheeko-backend/main/db/dump:/dump" postgres:18 `
  pg_restore --no-owner --no-privileges --clean --if-exists `
  -d "postgresql://postgres:postgres@host.docker.internal:5432/postgres" /dump/cheeko.dump
```

`pg_restore` prints ~13 non-fatal errors about the missing `auth` schema
(foreign keys to `auth.users` and Supabase RLS policies using `auth.uid()`).
These are Supabase-internal and expected — all table data loads fine.

## Verify

```powershell
docker exec cheeko-postgres psql -U postgres -d postgres -c "\dt"
docker exec cheeko-postgres psql -U postgres -d postgres -c "SELECT count(*) FROM ai_agent;"
```
