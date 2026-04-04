# RFID Card Usage and Content Sync Implementation Plan

## 1. Objective

Implement and operate a single RFID tap protocol (`card_lookup`) across device, gateway, API, DB, and web so that:

- Every tap is recorded with card + toy identity.
- Content update checks happen on each tap.
- First-time scans on a toy still get content.
- Local-first playback remains fast and offline-capable.
- Admins can view daily analytics and update-needed insights.

## 2. Final Protocol Decision

- Legacy `card_tap_event` and `card_tap_ack` are not used.
- Firmware sends only `card_lookup` on every tap (including SD cache hits).
- Gateway performs tap analytics + version handshake through Manager API:
  - `POST /admin/rfid/card/tap`
- Gateway then responds to firmware with one of:
  - `card_unknown`
  - `card_ai`
  - `card_content`
  - `card_up_to_date`

## 3. Final End-to-End Flow

1. Card tapped on device.
2. Device may start local SD playback immediately (local-first path).
3. Device still publishes `card_lookup` to gateway for analytics + update check.
4. Gateway calls `POST /admin/rfid/card/tap` (with retry).
5. Gateway routes response:
   - Unknown mapping -> `card_unknown`
   - AI card -> `card_ai`
   - Content card + same version/hash -> `card_up_to_date`
   - Content card + new/changed version/hash -> `card_content`
6. Firmware:
   - keeps/starts playback safely
   - runs background refresh when update is needed
   - atomically switches only after download completion

## 4. MQTT Message Contracts

### 4.1 Device -> Gateway (`card_lookup`)

Minimum payload:

```json
{
  "type": "card_lookup",
  "rfid_uid": "04A1B2C3D4"
}
```

Recommended payload (production):

```json
{
  "type": "card_lookup",
  "rfid_uid": "04A1B2C3D4",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "session_id": "sess_123",
  "event_id": "lookup_8f3c2f4e",
  "tap_ts": "2026-04-04T12:34:56.789Z",
  "local_skill_id": "skill_abc123",
  "local_version": "3",
  "local_content_hash": "sha256:abcd1234",
  "sequence": 1
}
```

Notes:

- On first scan for a card on a toy, firmware may not know local fields. That is valid.
- `local_skill_id`, `local_version`, `local_content_hash`, `sequence` are optional.
- For best update accuracy, include local fields after first successful download.

### 4.2 Gateway -> Device (`card_unknown`)

```json
{
  "type": "card_unknown",
  "rfid_uid": "04A1B2C3D4"
}
```

### 4.3 Gateway -> Device (`card_ai`)

```json
{
  "type": "card_ai",
  "rfid_uid": "04A1B2C3D4",
  "agent_name": "cheeko-agent"
}
```

### 4.4 Gateway -> Device (`card_content`)

```json
{
  "type": "card_content",
  "rfid_uid": "04A1B2C3D4",
  "skill_id": "skill_abc123",
  "skill_name": "The Hungry Fox Story",
  "version": 4,
  "audio": [
    { "index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/audio/track1.mp3" }
  ],
  "images": [
    { "index": 1, "url": "https://cdn.cheeko.ai/skills/abc123/images/page1.jpg" }
  ],
  "update_required": true,
  "latest_version": "4",
  "latest_content_hash": "sha256:newhash",
  "download_manifest_path": "/admin/rfid/card/content/download/04A1B2C3D4",
  "replace_mode": "safe_background_refresh"
}
```

### 4.5 Gateway -> Device (`card_up_to_date`)

```json
{
  "type": "card_up_to_date",
  "rfid_uid": "04A1B2C3D4",
  "skill_id": "skill_abc123",
  "latest_version": "4",
  "latest_content_hash": "sha256:newhash",
  "update_required": false,
  "download_manifest_path": "/admin/rfid/card/content/download/04A1B2C3D4",
  "server_ts": "2026-04-04T12:35:01.000Z"
}
```

## 5. Database and API Model

### 5.1 Source of Truth

- `rfid_content_pack.version`
- `rfid_content_pack.content_hash` (when available)

### 5.2 Tap Analytics Table

`rfid_card_tap_log` persists:

- event id (idempotency)
- mac + resolved device
- rfid uid + mapping/card type
- content pack refs
- client version/hash metadata
- latest version/hash metadata
- update required boolean
- source and timestamps

### 5.3 API Endpoints

- `POST /admin/rfid/card/tap`
  - validates and records tap
  - computes version handshake
  - returns recognized/cardType/updateRequired/skill/version/hash fields
- `GET /admin/rfid/card/tap-logs`
  - paginated filterable logs
- `GET /admin/rfid/card/tap-analytics/summary`
  - totals + daily trend + top cards/devices + update-needed insights

## 6. Implementation Status

### 6.1 Completed in Backend/Gateway/Web

- Gateway uses `card_lookup` path only.
- Tap analytics are logged via `POST /admin/rfid/card/tap` from `card_lookup`.
- Gateway performs handshake before response routing.
- `card_up_to_date` is sent for content cards that are already current.
- `card_content` includes update metadata (`update_required`, `latest_version`, `latest_content_hash`, `download_manifest_path`, `replace_mode`).
- Manager API summary includes:
  - `dailyTrend`
  - `topUpdateRequiredCards`
  - `topUpdateRequiredDevices`
- Manager Web analytics tab shows:
  - KPI totals
  - daily trend list
  - top cards needing update
  - top toys needing update

### 6.2 Firmware Pending Responsibilities

- Always emit `card_lookup` on every tap, including SD cache hit.
- Include `mac_address`, unique `event_id`, and `tap_ts` on every tap.
- Include local cache metadata when known (`local_version`, `local_content_hash`, `local_skill_id`).
- On `card_content` with update required:
  - download in background staging
  - write `manifest.jsn` last
  - atomic swap to active content
  - do not break current playback

## 7. Acceptance Criteria

- 100% of taps are eventually recorded, including SD-cache taps.
- Every tap row is MAC/device attributable.
- Server content changes are detected through per-tap handshake.
- First-time scan on a toy still gets content.
- Safe background refresh updates stale content without playback break.
- Manager Web shows daily usage and update-needed insights.

## 8. Rollout Notes

1. Deploy Manager API + DB migration first.
2. Deploy MQTT gateway updates.
3. Roll out firmware that always publishes `card_lookup`.
4. Monitor:
   - tap ingestion rate
   - unknown tap rate
   - update-needed rate
   - gateway handshake failures/retries

Critical dependency:

- If firmware does not emit `card_lookup` on every tap, SD-only taps cannot be logged server-side.
