# Migrate Supabase (public schema) -> local cheeko-postgres.
# Reads DIRECT_URL from manager-api-node/.env, so no password lives in this file.
# Usage:  powershell -ExecutionPolicy Bypass -File migrate-supabase.ps1

$ErrorActionPreference = "Stop"
$dump    = "D:/cheeko-backend/main/db/dump"          # forward slashes: docker-friendly on Windows
$envFile = "D:/cheeko-backend/main/manager-api-node/.env"

# --- read DIRECT_URL from .env ---
$line = Select-String -Path $envFile -Pattern '^\s*DIRECT_URL\s*=' | Select-Object -First 1
if (-not $line) { throw "DIRECT_URL not found in $envFile" }
$src = ($line.Line -replace '^\s*DIRECT_URL\s*=\s*','').Trim().Trim('"').Trim("'")
if ($src -notmatch 'sslmode=') {
  if ($src -match '\?') { $src += '&sslmode=require' } else { $src += '?sslmode=require' }
}

# --- target container must be up ---
$running = (docker inspect -f '{{.State.Running}}' cheeko-postgres 2>$null)
if ($running -ne 'true') {
  throw "cheeko-postgres is not running. Start it: docker compose -f cheeko-postgres.yml up -d"
}

New-Item -ItemType Directory -Force $dump | Out-Null

Write-Host "==> Dumping public schema from Supabase..." -ForegroundColor Cyan
docker run --rm -v "${dump}:/dump" postgres:18 `
  pg_dump $src -Fc --no-owner --no-privileges --schema=public -f /dump/cheeko.dump
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }

Write-Host "==> Restoring into local cheeko-postgres..." -ForegroundColor Cyan
# host.docker.internal reaches the host's 5432 (--network host doesn't on Docker Desktop/Windows).
# pg_restore may print non-fatal 'schema auth does not exist' errors — those are Supabase-internal, expected.
docker run --rm -v "${dump}:/dump" postgres:18 `
  pg_restore --no-owner --no-privileges --clean --if-exists `
  -d "postgresql://postgres:postgres@host.docker.internal:5432/postgres" /dump/cheeko.dump

Write-Host "==> Tables in local DB:" -ForegroundColor Cyan
docker exec cheeko-postgres psql -U postgres -d postgres -c "\dt"
Write-Host "Done." -ForegroundColor Green
