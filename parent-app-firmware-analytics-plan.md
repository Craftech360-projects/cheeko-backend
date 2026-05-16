# Parent App Firmware Analytics - Implementation Plan

## Goal
Ingest firmware `analytics_event` messages via MQTT gateway, store deduplicated raw events in `manager-api-node`, and expose parent-app-ready analytics APIs so the existing Parent App analytics UI can show correct data.

## Current State (what exists today)
- MQTT gateway already subscribes `internal/server-ingest` and extracts `sender_client_id` + republished payload.
- Gateway handles settings sync messages (`settings_get`, `settings_ack`, `device_state`) but does not handle `type: analytics_event`.
- Manager API has legacy `/toy/analytics/*` endpoints based on `analytics_game_*` tables, not on firmware `analytics_event` stream.
- Parent app already has analytics screens and API client, but current models/endpoints are not aligned with firmware event schema and usage breakdown needs.

## Scope Decisions
- Keep legacy `/toy/analytics/*` endpoints intact to avoid dashboard regressions.
- Add a new firmware-analytics pipeline (ingest + raw storage + parent mobile read APIs).
- Use MAC as primary device identity for ownership checks and API paths.
- De-duplicate by `(device_id, event_id)` as requested in the firmware doc.
- Treat parent settings as bidirectional sync:
  - app-originated writes (`app -> server -> device`)
  - device-originated writes (`device -> server`, then server version bump and optional echo update)

## File-by-File Plan

### 0) Required addition from `device to app status.md` (bidirectional settings sync)
- Requirement:
  - If a setting is changed on the device, backend must also update DB (not only app-originated changes).
  - Firmware message type: `settings_changed` with full `settings` snapshot.
- File: `D:/cheeko-backend/main/mqtt-gateway/gateway/mqtt-gateway.js`
  - Add `settings_changed` handling in ingest flow.
  - Forward to Manager API `/device-sync/settings-changed`.
  - If Manager API says `shouldPublish=true`, publish normal `settings_update` back to device topic with incremented server version.
- File: `D:/cheeko-backend/main/manager-api-node/src/routes/deviceSync.routes.js`
  - Add `POST /device-sync/settings-changed`.
  - Validate `mac_address` + `payload.settings`.
- File: `D:/cheeko-backend/main/manager-api-node/src/services/deviceSettings.service.js`
  - Add `onSettingsChanged(...)`:
    - Persist device snapshot as latest server settings.
    - Increment `settings_version` monotonically.
    - Mark sync status + audit event.
    - Return `{ shouldPublish, mqttMessage }` for gateway echo publish.
  - Add short-window dedupe for rapid duplicates (same device/reason/settings snapshot).
- Expected behavior:
  - App and device both become valid sources of change.
  - Server remains source of truth via versioning.
  - Reconnect behavior stays clean because device stores latest server version after echo update.

### 1) MQTT Gateway (ingest + forward)
- File: `D:/cheeko-backend/main/mqtt-gateway/gateway/mqtt-gateway.js`
  - Add `analytics_event` branch inside `processIngestLogic(...)` before default forwarding.
  - Add `handleAnalyticsEvent(deviceId, payload, clientId)` method:
    - Validate `event_id`, `event`, `device_id`, `mac_address` (fallback to extracted `deviceId` when missing).
    - Normalize MAC to uppercase colon format.
    - Forward to Manager API `POST /device-sync/analytics-event` via `postDeviceSyncEvent(...)`.
    - Log accepted vs duplicate vs validation failure.
  - Keep behavior transport-ack only (no MQTT app-level ack back to firmware).
  - Ensure analytics events do not fall through to `handleDeviceData(...)` default path.

- File: `D:/cheeko-backend/main/mqtt-gateway/.env` and `.env.example` (if present)
  - Confirm/keep `MANAGER_API_URL` and `MANAGER_API_SECRET` values already used by `postDeviceSyncEvent`.
  - No new env required.

### 2) Manager API - DB schema for raw firmware analytics
- File: `D:/cheeko-backend/main/manager-api-node/prisma/schema.prisma`
  - Add model `device_analytics_event` with:
    - Identity: `id` UUID.
    - Dedupe keys: `device_id` (string), `event_id` (string), unique composite.
    - Device keys: `mac_address`, `sender_client_id`.
    - Firmware/runtime: `firmware`, `build_label`, `battery`, `battery_percentage`, `charging`, `discharging`, `uptime_ms`.
    - Event fields: `event_name`, `seq`, `event_timestamp` (nullable timestamptz from payload timestamp), `server_received_at`.
    - Raw payload fields: `data` JSONB, `raw_payload` JSONB.
    - Useful extracted fields for queries: `duration_ms`, `rfid_uid`, `content_id`, `content_type`, `game_id`, `score`, `reason`, `station`, `station_index`.
  - Add indexes:
    - `(mac_address, event_timestamp desc)`,
    - `(mac_address, server_received_at desc)`,
    - `(mac_address, event_name)`,
    - unique `(device_id, event_id)`.

- File: `D:/cheeko-backend/main/manager-api-node/prisma/migrations/<new_timestamp>_add_device_analytics_event/migration.sql`
  - Create table + indexes above.
  - Keep SQL style consistent with existing migration files.

### 3) Manager API - ingest endpoint from gateway
- File: `D:/cheeko-backend/main/manager-api-node/src/routes/deviceSync.routes.js`
  - Add `POST /analytics-event` (service-key protected by existing `router.use(requireServiceKey)`).
  - Validate required fields:
    - `mac_address`, `device_id`, `event_id`, `event`, `type=analytics_event`.
  - Delegate to new service method.
  - Return consistent response:
    - `accepted: true`,
    - `deduplicated: boolean`,
    - `stored_event_id` (UUID or null on duplicate).

- File: `D:/cheeko-backend/main/manager-api-node/src/services/deviceSettings.service.js` (or split to new service below)
  - Prefer creating new service file to keep settings logic clean.

- New file: `D:/cheeko-backend/main/manager-api-node/src/services/deviceAnalytics.service.js`
  - Add `ingestFirmwareAnalyticsEvent(input)`:
    - Normalize MAC.
    - Convert payload timestamp epoch sec/ms to JS Date.
    - Extract known fields from `data` for indexed columns.
    - Insert with dedupe handling (unique constraint catch).
    - Return `{ accepted, deduplicated, id }`.
  - Add query methods for parent app:
    - `getAnalyticsOverviewByMac(mac, { from, to, tz })`
    - `getAnalyticsTimeSeriesByMac(mac, { from, to, bucket })`
    - `getRecentAnalyticsEventsByMac(mac, { limit, cursor })`
    - `getBatteryTrendByMac(mac, { from, to })`

### 4) Manager API - parent mobile read APIs
- File: `D:/cheeko-backend/main/manager-api-node/src/routes/mobile.routes.js`
  - Add new Firebase-auth protected routes under MAC ownership guard:
    - `GET /devices/:mac/analytics/overview`
    - `GET /devices/:mac/analytics/timeseries`
    - `GET /devices/:mac/analytics/events`
    - `GET /devices/:mac/analytics/battery`
  - Reuse `deviceSettingsService.resolveOwnedDeviceForMobile(...)` for ownership check.

- Response contract (stable for app):
  - `overview`:
    - `totalUsageMs`, `totalUsageMinutes`
    - `cardTapCount`
    - `minutesByType: { rhyme, story, ai_talk, radio, game, other }`
    - `aiTalk: { sessionCount, totalDurationMs }`
    - `games: { launchCount, totalDurationMs, averageScore, latestScores[] }`
  - `timeseries`:
    - per day row: `date`, `totalUsageMs`, `cardTapCount`, `aiTalkDurationMs`, `radioDurationMs`, `gameDurationMs`, `storyRhymeDurationMs`.
  - `events`:
    - timeline list with normalized fields for UI rendering.
  - `battery`:
    - `latest`, `trend[]`, `lowBatteryEvents[]`.

### 5) Manager API - optional compatibility bridge (recommended)
- File: `D:/cheeko-backend/main/manager-api-node/src/services/analytics.service.js`
  - Add fallback mode to include firmware-analytics aggregates when `analytics_game_sessions` is sparse/empty.
  - This avoids blank data on current app screens while migration happens.
  - Keep existing legacy behavior first; fallback only when needed.

### 6) Parent App updates (consume new APIs)
- File: `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/services/analytics_api_service.dart`
  - Add methods:
    - `getFirmwareAnalyticsOverview(mac)`
    - `getFirmwareAnalyticsTimeseries(mac, period)`
    - `getFirmwareAnalyticsEvents(mac, limit)`
    - `getFirmwareBatteryTrend(mac, period)`
  - Keep old methods temporarily for backward compatibility.

- New models:
  - `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/models/firmware_analytics_overview.dart`
  - `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/models/firmware_analytics_timeseries.dart`
  - `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/models/firmware_analytics_event.dart`
  - `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/models/firmware_battery_trend.dart`

- File: `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/screens/analytics/analytics_screen.dart`
  - Swap primary data source to new firmware analytics APIs.
  - Keep UI structure; update bindings for:
    - total usage,
    - minutes by type,
    - card taps,
    - AI talk count/time,
    - game stats,
    - battery trend section.

- File: `D:/Cheeko-mobile_app/CheekoAI-Parent-App/lib/screens/home/home_screen.dart`
  - Optional: enrich today cards with new `overview` card tap + usage numbers if desired.

## Aggregation Rules (from doc, enforced)
- Use payload `timestamp` when present; else use `server_received_at`.
- Keep `uptime_ms` stored for reconnect-order debugging.
- Deduplicate by `device_id + event_id`.
- Preserve raw JSON for audit/debug.
- No app-level ack message required back to firmware.

## Settings Sync Rules (from `device to app status.md`, enforced)
- Device `settings_changed` must update DB settings document.
- Backend must increment settings version for every accepted change (app or device).
- `settings_ack` state and `device_state` must continue to be recorded.
- Unknown keys in device snapshot should not break ingest (store snapshot safely, validate known keys where needed).
- Optional dedupe for rapid duplicate `settings_changed` bursts should avoid unnecessary version churn.

## Verification Plan

### MQTT Gateway verification
- Publish test `analytics_event` through EMQX republish flow.
- Confirm logs:
  - `[SETTINGS-SYNC][GW-IN]` equivalent for analytics input,
  - `[GW->API] POST /device-sync/analytics-event`,
  - accepted or duplicate status.
- Publish test `settings_changed` through EMQX republish flow.
- Confirm logs:
  - gateway receives `settings_changed`,
  - API `/device-sync/settings-changed` called,
  - DB version incremented,
  - optional `settings_update` echo sent back with new version.

### Manager API verification
- Integration tests:
  - File: `D:/cheeko-backend/main/manager-api-node/tests/integration/device-sync.test.js`
    - add `/analytics-event` auth + validation coverage.
    - add `/settings-changed` auth + validation coverage.
  - New file: `.../tests/integration/mobile-device-analytics.test.js`
    - auth required, ownership required, shape checks.
- DB checks:
  - duplicate event insert does not create second row.
  - timestamp fallback works when payload timestamp missing.
  - device-originated settings changes update `device_settings.settings` and bump `settings_version`.

### Parent app verification
- Run app with a bound device MAC.
- Analytics screen should render non-zero values after firmware emits events.
- Validate period toggles (Today/Weekly/Monthly) from new timeseries endpoint.

## Rollout Order
1. DB migration + Manager API ingest route/service.
2. MQTT gateway forwarding for `analytics_event`.
3. Manager API mobile analytics read endpoints.
4. Parent app service/model/screen switch.
5. Compatibility cleanup (optional legacy endpoint fallback removal later).

## Done When
- Firmware `analytics_event` reaches DB with dedupe working.
- Parent app analytics screen shows usage, card taps, AI talk, games, and battery trend from firmware events.
- Existing settings sync and legacy analytics APIs remain unaffected.
