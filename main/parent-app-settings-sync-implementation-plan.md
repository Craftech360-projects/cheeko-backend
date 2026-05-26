# Parent App Settings Sync Implementation Plan (MAC-primary)

Date: 2026-05-14
Scope: mqtt-gateway + manager-api-node
Decision: mac_address is the primary device identifier for settings sync. Firmware device_id is stored as metadata only.

## 1) mqtt-gateway changes

### 1.1 File: D:\cheeko-backend\main\mqtt-gateway\gateway\mqtt-gateway.js

Tasks:
1. Keep existing subscription to internal/server-ingest unchanged.
2. In processIngestLogic(...), add explicit handlers for:
   - settings_get
   - settings_ack
   - device_state
3. Ensure these message types do not fall through to generic session routing.
4. Normalize MAC from sender_client_id (existing format parsing) and use it as primary key when calling manager-api.
5. Forward payloads to manager-api with:
   - mac_address (required)
   - sender_client_id (required)
   - device_id (optional, from firmware payload)
   - original message payload
6. Harden payload parsing:
   - Accept orginal_payload (current EMQX rule)
   - Also accept original_payload (fallback)
   - Validate object shape before reading .type

Verification:
1. Simulated settings_get reaches manager-api and returns decision.
2. Simulated settings_ack updates manager-api.
3. Simulated device_state updates manager-api.
4. No regressions in existing hello/mode/card flows.

### 1.2 File: D:\cheeko-backend\main\mqtt-gateway\gateway\internal-command-server.js (new)

Tasks:
1. Add lightweight internal HTTP server for manager-api to request device publishes.
2. Endpoints:
   - POST /internal/settings/publish-update
   - POST /internal/settings/ping
3. Auth with shared secret header (X-Service-Key).
4. Resolve target topic as devices/p2p/{sender_client_id}.
5. Publish via existing gateway.mqttPublish(...).

Verification:
1. Valid secret publishes MQTT payload to expected topic.
2. Invalid or missing secret returns 401.

### 1.3 File: D:\cheeko-backend\main\mqtt-gateway\app.js

Tasks:
1. Start internal command server during gateway startup.
2. Pass gateway instance dependency to command server.

Verification:
1. Startup logs show internal command server active.

### 1.4 File: D:\cheeko-backend\main\mqtt-gateway\README.md

Tasks:
1. Document internal command endpoints.
2. Document required env vars for manager-api integration.

Verification:
1. Fresh developer can run and hit internal endpoints locally.

## 2) manager-api-node changes

### 2.1 File: D:\cheeko-backend\main\manager-api-node\prisma\schema.prisma

Tasks:
1. Add model device_settings (MAC-primary):
   - mac_address (unique, indexed)
   - settings_version (int)
   - settings (json)
   - sync_status
   - last_ack_status
   - last_ack_reason
   - last_sent_version
   - last_applied_version
   - device_id (optional metadata)
   - timestamps
2. Add model device_runtime_state (MAC-primary):
   - mac_address (unique, indexed)
   - online
   - last_seen_at
   - firmware
   - build_label
   - mode
   - network
   - battery
   - charging
   - discharging
   - settings_version
   - raw_state (json)
   - device_id (optional metadata)
   - timestamps
3. Add model device_sync_event:
   - mac_address (indexed)
   - event_type (settings_get/settings_update/settings_ack/device_state/settings_ping)
   - version
   - status
   - reason
   - payload (json)
   - device_id (optional metadata)
   - created_at

Verification:
1. prisma generate succeeds.
2. migration applies cleanly.

### 2.2 File: D:\cheeko-backend\main\manager-api-node\prisma\migrations\<new_migration>\migration.sql (new)

Tasks:
1. Create SQL migration for new MAC-keyed tables and indexes.

Verification:
1. npm run prisma:migrate succeeds.

### 2.3 File: D:\cheeko-backend\main\manager-api-node\src\services\deviceSettings.service.js (new)

Tasks:
1. Implement findOrCreateSettingsByMac(mac_address).
2. Implement validation for supported settings fields and ranges.
3. Implement patchSettingsByMac(mac_address, patch):
   - Apply patch to current settings
   - Increment settings_version only on effective change
   - Mark sync_status as syncing (or pending_offline if offline decision logic says so)
4. Implement onSettingsGet(...):
   - Compare device current_version with backend settings_version
   - Return publish decision + payload when backend newer
5. Implement onSettingsAck(...):
   - Update sync status mapping:
     - applied -> synced
     - ignored -> stale
     - rejected -> rejected
6. Implement onDeviceState(...):
   - Upsert runtime state
   - Update online + last_seen_at
7. Implement listSyncEventsByMac(...).

Verification:
1. Unit tests cover version bump rules and ack status mapping.

### 2.4 File: D:\cheeko-backend\main\manager-api-node\src\routes\deviceSync.routes.js (new)

Tasks:
1. Add service-key protected gateway ingest routes:
   - POST /device-sync/settings-get
   - POST /device-sync/settings-ack
   - POST /device-sync/device-state
2. Require mac_address in request body.
3. Return deterministic response envelope for gateway action decisions.

Verification:
1. Unauthorized requests fail.
2. Valid requests update DB and return expected action.

### 2.5 File: D:\cheeko-backend\main\manager-api-node\src\routes\mobile.routes.js

Tasks:
1. Add parent app endpoints:
   - GET /api/mobile/devices/:deviceId/settings
   - PATCH /api/mobile/devices/:deviceId/settings
   - GET /api/mobile/devices/:deviceId/state
   - GET /api/mobile/devices/:deviceId/sync-events
2. Resolve :deviceId -> ai_device -> mac_address.
3. Perform all settings/state operations by mac_address internally.
4. On PATCH success, call mqtt-gateway internal publish endpoint for immediate settings_update.

Verification:
1. PATCH returns new settings_version and sync_status.
2. GET endpoints return persisted settings/state/events.

### 2.6 File: D:\cheeko-backend\main\manager-api-node\src\routes\index.js

Tasks:
1. Mount router.use('/device-sync', deviceSyncRoutes).
2. Keep route ordering safe and avoid conflicts with catch-all routes.

Verification:
1. Route resolution works for all existing and new endpoints.

## 3) Tests

### 3.1 New tests
1. D:\cheeko-backend\main\manager-api-node\tests\integration\device-sync.test.js
2. D:\cheeko-backend\main\manager-api-node\tests\integration\mobile-device-settings.test.js

Coverage goals:
1. MAC normalization and find-or-create behavior.
2. settings_version monotonic increment.
3. settings_get decision logic.
4. settings_ack status transitions.
5. device_state persistence and last_seen updates.

### 3.2 Existing test impact
1. Keep existing device and mobile tests passing.
2. Update fixtures only if response envelope changes.

## 4) Execution order

1. Prisma schema + migration.
2. deviceSettings service.
3. device-sync internal routes.
4. mobile routes (settings/state/sync-events).
5. mqtt-gateway ingest handlers.
6. mqtt-gateway internal command server.
7. integration verification with EMQX republish flow.

## 5) Done criteria

1. Parent app PATCH updates backend settings and increments settings_version.
2. Gateway publishes settings_update to devices/p2p/{sender_client_id} when required.
3. Device settings_ack updates sync state correctly.
4. Device device_state updates runtime status (online, battery, firmware, mode, last_seen).
5. Offline changes are preserved and sync on next settings_get.
6. Tests for new settings sync flows pass.
