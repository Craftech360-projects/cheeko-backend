# Known Issues — PR #137 (Dashboard) & PR #138 (Voice-Card Pairing)

**Status:** Both PRs were merged to `main` with critical fixes applied inline; the
issues below are **outstanding** and must be scheduled. Merged deliberately as
"merge now, fix later" per maintainer decision — this file is the backlog.

Date merged: 2026-07-24. Reviews: two independent read-only passes over each PR diff.

---

## P0 — Do immediately (security incident / outage risk)

### 1. Rotate `MANAGER_API_SECRET` (PR #137) — LEAKED
- **What:** `main/founder-dashboard-web/.env.production` (and a stray `.env copy.production`)
  committed the real internal service key `MANAGER_API_SECRET=da11d988-...` plus a private API URL.
- **State:** The files were removed from the working tree during the #137 merge, **but the
  value is already in git history and was pushed to `origin/dashbaord_update`** — treat it as
  compromised. Removing the file does NOT un-leak it.
- **Action:** Rotate the key in the manager env + every consumer (mqtt-gateway, workers,
  dashboards), then invalidate the old one. Add `.env*` to each web app's `.gitignore`.

### 2. IDOR on Active-Devices / Imagine routes (PR #137) — any parent reads any child
- **Where:** `main/manager-api-node/src/routes/analytics.routes.js` (`/analytics/active-devices/*`)
  and `imagine.routes.js` (`/imagine/device/:mac/images`).
- **What:** Guarded by `requireFlexAuth` (accepts any parent Firebase token) but, unlike every
  sibling route, they never call `ensureMobileOwnsMac(req,res,mac)` or `isValidMacAddress(mac)`.
- **Impact:** Any logged-in parent can read another child's full chat transcript
  (`GET /analytics/active-devices/<any-mac>/chat?date=...`); the list endpoint dumps the whole
  fleet's MACs + kid names + parent names.
- **Fix:** Move these routes to `requireAuth + requireSuperAdmin` (as the `/admin/founder/*`
  routes correctly do). They are analytics/admin surfaces, not parent-app surfaces.

### 3. Wildcard bulk-extraction amplifies #2 (PR #137)
- **Where:** `main/manager-api-node/src/services/activeDevices.service.js` — every per-device
  query uses `WHERE mac_address ILIKE ${mac}`.
- **What:** Parameterized (no SQL injection) but `ILIKE` treats `%`/`_` as wildcards and the
  routes skip MAC validation, so `GET /analytics/active-devices/%25/chat?date=...` (URL-encoded
  `%`) matches ALL devices and returns every child's chat for that day in one request.
- **Fix:** Use `=` with a normalized/validated MAC, not `ILIKE`.

---

## P1 — High (data exposure / fleet risk)

### 4. Unauthenticated card-mapping writes via `/card/tap` (PR #138)
- **Where:** `main/manager-api-node/src/routes/rfid.routes.js:~312` (`/card/tap`, no auth,
  "public endpoint for gateway ingestion") + new block in
  `rfid.service.js` `recordCardTap` (~2677–2726).
- **What:** This unauthenticated endpoint now **upserts/overwrites `rfid_card_mapping`** and
  completes/rejects pairings. Knowing a device MAC, an attacker can race the 60s pairing window
  and claim the parent's recording onto a card UID they hold, or force `rejected_non_blank`.
- **Fix:** Require `X-Service-Key` (project convention for gateway-internal endpoints) on
  `/card/tap`, or authenticate the gateway; do not let a public endpoint mutate global mappings.

### 5. Voice recordings on public, predictable, collidable URLs (PR #138)
- **Where:** upload handler names files `voicecard_${Date.now()}.mp3`;
  `upload.service.js:~48` puts them in the public CloudFront bucket at
  `rfidcontent/voicecards/voicecard_<13-digit-ms>.mp3` (1-year cache).
- **What:** Private family audio is world-readable behind a brute-forceable millisecond
  timestamp; two uploads in the same ms collide (one family hears another's recording).
- **Fix:** Use `randomUUID()` (already imported in upload.service.js) in the key, per-user
  prefix, ideally a non-public bucket with signed URLs.

### 6. Content-page game metric can exceed 100% (PR #137)
- **Where:** `founderDashboard.service.js` `getFounderContent`.
- **What:** `gameRows` keyed by `game_name||game_id`, `gameSessions` keyed by `mode_type`
  (different namespaces). Session-only entries do `if (item.plays===0) item.plays+=1` so plays
  pins at 1 while `completed` keeps rising → `completionRate` can report 1000%, poisoning the
  `avgCompletionRate` KPI.
- **Fix:** Unify the key, or count plays from session rows.

---

## P2 — Medium (correctness / behavior)

### 7. Notification opt-in behavior change shipped (PR #138)
- **Where:** `src/jobs/usageSummaryNotification.js` (commit `5ca69b50`).
- **What:** Recipient filter changed so **NULL `push_notifications` is treated as opted-IN**
  (`{ not: false }`). Parents who never touched the setting will now start receiving
  daily/weekly summary pushes. Confirm this is the intended product behavior.

### 8. Re-recorded voice cards likely play stale audio (PR #138)
- **Where:** `rfid.service.js` `createCustomVoiceCardPack` (~3186) creates packs with
  `version:null`, `content_hash:null`; handshake falls back to `latestVersion='1'` every time.
- **What:** Parent re-records (new pack) and re-pairs the same physical card; device's cached
  `clientVersion '1'` matches `latestVersion '1'` → `up_to_date` → old audio keeps playing.
- **Fix:** Set `content_hash` (hash the audio) or bump `version` per pack. (Firmware caching
  may mask this — confirm with firmware.)

### 9. Claim can overwrite another user's already-paired voice card (PR #138)
- **Where:** `rfid.service.js:~2683` `canClaimForPairing = !mapping || mapping.card_type==='custom_voice'`.
- **What:** Any already-paired voice card tapped during a window is rebound; the mapping upsert
  stores no `creator`, so ownership can't be checked. A wrong-card tap during pairing silently
  destroys the previous recording's binding.
- **Fix:** Store `creator` on the mapping and refuse to rebind a card owned by another user.

### 10. `pending_card_pairing` rows never expire server-side (PR #138)
- **What:** Expired pairings stay `status='pending'` unless a read path happens to flip them;
  no sweeper. Also `kidId` is accepted but unvalidated and unused in the claim.
- **Fix:** Add a cron/lazy sweep to mark expired pairings; drop or validate `kidId`.

### 11. Unbounded, unpaginated fleet-wide queries (PR #137)
- **Where:** `founderDashboard.service.js` — `listAllFamilies` (nested kid→parent→device, no
  `take`), `getFounderEngagement`/`getFounderOperate` (`ai_device.findMany` +
  `device_runtime_state.findMany()` + `ai_ota.findMany`, no limit).
- **What:** Returns full parent PII per call and grows linearly with the fleet.
- **Fix:** Paginate / cap before the fleet grows.

---

## P3 — Low (hardening / hygiene)

- **(PR #138)** Multer `LIMIT_FILE_SIZE` / fileFilter errors fall through to HTTP 500 instead
  of 400 (`errorHandler.js` maps only Joi/JWT/PG). Map multer errors to 400.
- **(PR #138)** Pack + `content_item` creation is not transactional (orphan pack on item
  failure, after S3 upload already happened); no cleanup of abandoned packs/uploads.
- **(PR #138)** `rejected_non_blank` update (`rfid.service.js:~2721`) is not wrapped in
  try/catch (unlike the claim branch) — a transient DB error there turns a normal tap into a
  gateway error.
- **(PR #138)** No Joi validation on the new mobile bodies (inline checks only, contra project
  convention). Schema comment says `pending|completed|expired` but code also writes
  `rejected_non_blank`.
- **(PR #137)** `summarizeHourlySessions` indexes `buckets[hour]` unguarded; on ICU builds that
  emit "24" for midnight it throws (`summarizeSessionsHeatmap` guards, this one doesn't). Use
  `hourCycle:'h23'`.
- **(PR #137)** `portGuard.js` auto-`kill`s whatever holds port 8002 on `EADDRINUSE` (only
  `SKIP_PORT_GUARD=1` disables). On a shared host it can terminate an unrelated process. Gate
  the kill behind an explicit opt-in env flag; the unit test references an `AUTO_KILL_PORT` env
  the implementation never reads.
- **(PR #137)** `main/mqtt-gateway/logs/analytics-events.ndjson` (real MACs/UUIDs/client-ids)
  is tracked in the repo. gitignore `main/mqtt-gateway/logs/`.
- **(PR #137)** CORS default allow-list now bakes in dev origins (`127.0.0.1:5173/4173`,
  Live-Server `:5500`) with `credentials:true`. Harmless when `CORS_ORIGINS` is set in prod.

---

## Fixed inline before merge (PR #138)

| Fix | File | Was |
|-----|------|-----|
| ffmpeg in image | `manager-api-node/Dockerfile` | `fluent-ffmpeg` had no binary → every upload 500 |
| startup guard | `src/config/prisma-client-guard.js` | pre-migrate deploy 500'd every card tap |
| contentPackId IDOR | `src/services/rfid.service.js` `createPendingCardPairing` | any parent could bind any pack; junk id 500'd |

## Test coverage gaps (both PRs)
- **#138:** only the reject path of `recordCardTap` is tested. Absent: claim happy-path (the
  core feature), expiry, the three new endpoints, transcoding, `autoplay` settings.
- **#137:** founder service is unit-tested (mocked Prisma); **no auth/authorization test** for
  the new `/active-devices/*` routes, and no coverage for `activeDevices.service.js` raw SQL,
  the IST date logic, or the `ILIKE` behavior.
