# RFID Card Usage and Content Sync Implementation Plan

## 1. Objective

Implement a complete tap-to-analytics and content-update handshake across firmware, MQTT gateway, manager API, manager web, and database so that:

- Every card tap is recorded with toy/device identity.
- Content version updates are detected on tap.
- Devices remain local-first and offline-capable.
- Admins can view daily usage, top cards, top toys, and version mismatch/update-needed signals.

## 2. Current Gaps

- If content is updated on server, device may continue playing stale SD content without knowing update exists.
- Device does not publish a usage event for every tap when card is already in SD cache.
- Missing reliable daily analytics for:
  - who used which card
  - how many times each card was used
  - which toys/devices used cards
- No explicit version handshake on each tap.

## 3. Target Behavior (Final Flow)

1. Card tapped on device.
2. Device checks local SD cache for fast playback.
3. Device always sends tap telemetry to gateway (online path), even when local cache is valid.
4. Gateway calls manager API to:
   - record usage
   - resolve latest content version/hash
   - determine if update is needed
5. Gateway sends handshake ACK back to firmware.
6. Firmware:
   - continues immediate local playback
   - starts safe background update if `update_required = true`.

## 4. Message and Protocol Design

### 4.1 Device to Gateway (`card_tap_event`)

Publish on every tap:

```json
{
  "type": "card_tap_event",
  "event_id": "uuid-or-unique-id",
  "session_id": "optional-session",
  "mac_address": "A1:B2:C3:D4:E5:F6",
  "rfid_uid": "04A1B2C3D4",
  "local_skill_id": "skill_abc123",
  "local_version": "1",
  "local_content_hash": "optional-hash",
  "tap_ts": "2026-04-04T10:00:00Z"
}
```

### 4.2 Gateway to Device (`card_tap_ack`)

```json
{
  "type": "card_tap_ack",
  "event_id": "same-event-id",
  "recognized": true,
  "card_type": "content|ai|unknown",
  "skill_id": "skill_abc123",
  "latest_version": "2",
  "latest_content_hash": "hash",
  "update_required": true,
  "download_manifest_url": "https://...",
  "server_ts": "2026-04-04T10:00:01Z"
}
```

### 4.3 Compatibility

- Keep existing `card_lookup` responses for legacy flow.
- New tap event flow runs for all taps.
- Use idempotency key (`event_id`) to avoid duplicate analytics rows on retries.

## 5. Database Plan

## 5.1 Reuse Existing Version Source

- Keep `rfid_content_pack.version` as server-side truth.

## 5.2 Add Dedicated Tap Log Table

Create `rfid_card_tap_log` with fields:

- `id` (PK)
- `event_id` (unique or indexed for idempotency)
- `session_id`
- `mac_address`
- `device_id` / `toy_id` (resolved via `mac_address`)
- `rfid_uid`
- `card_mapping_id`
- `content_pack_id`
- `card_type`
- `client_version`
- `latest_version`
- `update_required` (boolean)
- `source` (`gateway`, etc.)
- `metadata` (jsonb)
- `created_at`

Indexes:

- `(created_at)`
- `(mac_address, created_at)`
- `(rfid_uid, created_at)`
- `(card_type, created_at)`
- `(update_required, created_at)`
- `(event_id)` unique or strong index

Optional for high volume:

- daily aggregate/materialized view for dashboard speed.

## 6. Manager API Plan (`manager-api-node`)

## 6.1 New Endpoints

- `POST /admin/rfid/card/tap`
  - validate payload
  - normalize MAC/UID
  - resolve device by MAC
  - resolve card mapping/content pack
  - compute update status by comparing client vs latest version/hash
  - insert tap analytics row (idempotent by `event_id`)
  - return handshake response payload

- `GET /admin/rfid/card/tap-logs`
  - paginated logs
  - filters: date range, uid, mac, card type, update required

- `GET /admin/rfid/card/tap-analytics/summary`
  - totals
  - unique cards
  - unique toys/devices
  - unknown taps
  - update-required count
  - daily trend
  - top cards
  - top toys

## 6.2 Legacy

- Keep existing `/scan` and `/scan-logs` during migration.
- Mark them as legacy in docs.

## 7. Gateway Plan (`mqtt-gateway`)

## 7.1 Tap Processing

- Subscribe for `card_tap_event`.
- Call manager API `POST /card/tap`.
- Publish `card_tap_ack` back to device.

## 7.2 Failure Handling

- If API unavailable:
  - queue tap events locally
  - retry with exponential backoff
  - preserve event order per device where possible
- Send fallback ACK (non-blocking UX) when strict response unavailable.

## 7.3 Observability

Track:

- API latency
- queue depth
- retry attempts
- failed/dropped events
- ACK success rate

## 8. Firmware Plan (`cheekov2-hardware`)

## 8.1 Local-First Playback

- Keep current SD-first behavior for instant response and offline reliability.

## 8.2 Always Send Tap Telemetry

- Publish `card_tap_event` for every tap in async path.
- Do not block audio start on network.

## 8.3 Handshake-Driven Update

On `card_tap_ack`:

- if `update_required = false`: continue normal flow.
- if `update_required = true`: start background content refresh.

## 8.4 Safe Update Strategy

1. Download into staging directory.
2. Write all audio and images.
3. Write `manifest.jsn` last (completion marker).
4. Atomic swap staging to active.
5. Update `cardmap.jsn` with version/hash + last checked time.
6. Remove old content only after successful swap.

## 8.5 Resilience

- Retry/resume incomplete downloads.
- Handle power loss without corrupting active content.
- Debounce repeated update triggers for same card/version.

## 9. Manager Web Plan (`manager-web`)

## 9.1 New Tab: Card Analytics

Add a tab in RFID management for analytics.

## 9.2 KPI Cards

- total taps
- unique cards
- unique toys/devices
- unknown taps
- update-required taps

## 9.3 Logs Table

Columns:

- timestamp
- card UID
- toy/device MAC
- toy alias (if available)
- card type
- content pack
- client version
- latest version
- update required

Filters:

- date range
- uid
- mac
- card type
- update required

## 9.4 Charts

- daily taps trend
- top cards by tap count
- top toys by tap count

## 10. Rollout Strategy

## Phase 1: Backend and DB

- add migration + API endpoints behind feature flag.

## Phase 2: Gateway

- implement tap event ingestion and ACK publishing.

## Phase 3: Firmware

- publish every tap + process handshake update.

## Phase 4: Manager Web

- analytics UI with filters and summary charts.

## Phase 5: Gradual Production Enablement

- 10% toys -> 50% -> 100%.

## 11. Testing Plan

## 11.1 Unit Tests

- version compare logic
- idempotency handling
- payload validation

## 11.2 Integration Tests

- firmware tap -> gateway -> API -> ACK roundtrip
- known and unknown cards
- AI and content cards

## 11.3 Failure Scenarios

- gateway offline
- API timeout
- duplicate event replay
- interrupted download
- power loss during update

## 11.4 Performance Targets

- tap ACK p95 < 500 ms (network path)
- ingestion success >= 99.9%

## 12. Acceptance Criteria

- 100% of taps are eventually recorded (including SD cache hits).
- Each tap is attributable to toy/device (MAC-bound).
- Device detects server content updates via handshake.
- Safe background refresh replaces stale content without breaking playback.
- Manager web displays daily card analytics and update-needed insights.
- Legacy flows continue to function during migration.
