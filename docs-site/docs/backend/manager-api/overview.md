---
id: overview
sidebar_position: 1
---

# Manager API Overview

The `manager-api-node` is the backend REST API for the Cheeko platform, built with Node.js/Express. All endpoints share the base path `/toy`.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Database | DigitalOcean Managed PostgreSQL via Prisma ORM |
| Auth (admin) | Custom token lookup (`sys_user_token` table, Prisma) |
| Auth (mobile) | Firebase ID tokens (`firebase-admin` SDK) |
| Base path | `/toy` |
| Port | `8002` |
| API docs | `/toy/doc.html` (Swagger UI) |

## Middleware Stack

Middleware is applied in the following order in `src/app.js`:

| Middleware | File | Purpose |
|---|---|---|
| `helmet` | `express` | Sets secure HTTP headers (CORS resource policy: cross-origin) |
| `cors` | `express` | Allows configurable origins; defaults to `localhost:8080` and `localhost:3000`. Reads `CORS_ORIGINS` env var. |
| `trust proxy` | `express` | Enables correct IP identification behind nginx/load balancer |
| Rate limiter | `express-rate-limit` | 5000 req / 15 min window per IP; returns `429` with `{ code: 429, msg: "..." }` |
| `express.json` | `express` | Parses JSON bodies up to 10 MB |
| `express.urlencoded` | `express` | Parses URL-encoded bodies up to 10 MB |
| XSS filter | `src/middleware/xssFilter.js` | Sanitizes request body/query to strip XSS payloads |
| Request ID | `src/middleware/requestId.js` | Attaches a unique `X-Request-ID` to every request |
| Morgan logger | `morgan` | HTTP access logging; dev format in development, compact format in production |
| Routes | `src/routes/index.js` | All API routes under `/toy` |
| 404 handler | `src/middleware/errorHandler.js` | Returns `{ code: 404, msg: "..." }` for unknown routes |
| Global error handler | `src/middleware/errorHandler.js` | Returns `{ code: 500, msg: "..." }` for unhandled errors |

## Authentication

Two dedicated middleware files handle authentication:

### `src/middleware/auth.js` — Custom token + service key auth

Tokens are stored in the `sys_user_token` database table (Prisma). Exported middleware:

| Export | Behavior |
|---|---|
| `requireAuth` | Verifies `Bearer <token>` against `sys_user_token`. Attaches `req.user`. |
| `requireAdmin` | Like `requireAuth` but also checks `user.role === 'admin'` or `super_admin === 1`. Accepts service key as bypass. |
| `requireServiceKey` | Verifies `X-Service-Key` header equals `SERVICE_SECRET_KEY` env var. Sets `req.isServiceAuth = true`. |
| `requireDualAuth` | Accepts either a valid Bearer token or a valid service key. |
| `optionalAuth` | Tries both methods; attaches `req.user` or `req.isServiceAuth` if valid, but never rejects. |
| `requireSuperAdmin` | Must be chained after `requireAuth`; checks `super_admin === 1`. |

### `src/middleware/flexAuth.js` — Firebase + custom token (dual mobile/admin)

Used on routes that serve both the Flutter mobile app and the web admin dashboard.

| Client | Token type | Flow |
|---|---|---|
| Flutter app | Firebase ID token | `admin.auth().verifyIdToken(token)` → finds or creates `sys_user` row → sets `req.firebaseUser`, `req.mobileUser`, `req.user` |
| Admin web dashboard | Custom JWT | Falls back to `verifyCustomToken` → sets `req.user` |

If neither check succeeds, returns `401 Unauthorized`.

## Route Overview

All routes are mounted under the `/toy` context path.

| Mount path | Module file | Description |
|---|---|---|
| `/toy/user` | `auth.routes.js` | Login, registration, user management |
| `/toy/device` | `device.routes.js` | ESP32 device registration, binding, mode control, OTA |
| `/toy/agent` | `agent.routes.js` | AI agent config, prompts, character switching, chat history |
| `/toy/content` | `content.routes.js` | Music, stories, content library, file upload |
| `/toy/admin/rfid` | `rfid.routes.js` | RFID card mappings, packs, RAG lookup |
| `/toy/api/mobile` | `mobile.routes.js`, `profile.routes.js` | Firebase-backed mobile endpoints (kid profiles, etc.) |
| `/toy/models` | `model.routes.js` | AI model management |
| `/toy/analytics` | `analytics.routes.js` | Game sessions, media playback, usage stats |
| `/toy/system` | `system.routes.js` | System settings |
| `/toy/admin` | `admin.routes.js` | Admin utilities |
| `/toy/config` | `config.routes.js` | Runtime configuration |
| `/toy/usage` | `usage.routes.js` | Usage tracking |
| `/toy/ota` | `ota.routes.js` | OTA firmware check (device-facing) |
| `/toy/otaMag` | `otaMag.routes.js` | OTA firmware management (admin) |
| `/toy/admin/server` | `server.routes.js` | Server management |
| `/toy/admin/params` | `params.routes.js` | System parameters |
| `/toy/admin/dict` | `dict.routes.js` | Data dictionary |
| `/toy/ttsVoice` | `ttsVoice.routes.js` | TTS voice configuration |
| `/toy/admin/email-reports` | `emailReport.routes.js` | Email report scheduling |

## Health Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | App health (uptime, timestamp) |
| `GET` | `/toy/health` | None | API health with environment info |
| `GET` | `/toy/health/db` | None | Tests Prisma → DigitalOcean PostgreSQL connection |
| `GET` | `/toy/pub-config` | None | Public feature flags (`rfid`, `analytics`, `rag`, `memory`) |

## Standard Response Envelope

All API responses use the same envelope:

```json
{
  "code": 0,
  "msg": "success",
  "data": { ... }
}
```

Error responses set `code` to a non-zero value (e.g. `400`, `401`, `403`, `404`, `500`) and `data` to `null`.

## Running the API

```bash
cd main/manager-api-node
npm install

# Development (auto-reload)
npm run dev

# Production
npm start

# Tests
npm test
npm run test:coverage
```

### Required Environment Variables

```bash
PORT=8002
NODE_ENV=development

# Primary database
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require

# Supabase (legacy admin auth only)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Service-to-service auth (LiveKit agents, MQTT gateway)
SERVICE_SECRET_KEY=your-service-secret

# Firebase (mobile app auth)
FIREBASE_SERVICE_ACCOUNT_KEY=<base64 or path>

# Vector search
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key

# Memory/personalization
MEM0_API_KEY=your-mem0-api-key
```
