#!/usr/bin/env bash
# Server-side deploy for the cheeko-backend monorepo (3 services).
# Source is already rsynced by CI.
set -euo pipefail
ROOT=/opt/cheeko-backend/main

echo "==> pull latest main"
cd /opt/cheeko-backend
git fetch origin main
git reset --hard origin/main

echo "==> manager-api"
cd "$ROOT/manager-api-node"
npm ci --omit=dev || npm install --omit=dev
npx prisma generate
npx prisma migrate deploy || echo "WARN: prisma migrate deploy failed (check DB connection)"
pm2 startOrReload /opt/ecosystem.config.js --only manager-api --update-env

echo "==> mqtt-gateway"
cd "$ROOT/mqtt-gateway"
npm ci || npm install
pm2 startOrReload /opt/ecosystem.config.js --only mqtt-gateway --update-env

echo "==> dashboard (manager-web static build)"
cd "$ROOT/manager-web"
npm ci || npm install
npm run build
pm2 startOrReload /opt/ecosystem.config.js --only dashboard --update-env

echo "==> bootstrap EMQX rules (idempotent)"
bash /opt/cheeko-backend/deploy/emqx-rules.sh || echo "WARN: EMQX rule bootstrap skipped"

pm2 save
echo "==> cheeko-backend deploy done"
