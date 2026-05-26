# Firmware MQTT Analytics Event README

This document is for firmware developers to implement analytics event publishing that is compatible with the current backend ingest pipeline.

## Goal

Send `analytics_event` messages from firmware so backend can:

- store events reliably (with deduplication)
- compute usage analytics
- show game analytics context (game id/name/level/difficulty)

## End-to-End Flow

1. Firmware publishes MQTT message with `type: "analytics_event"`.
2. MQTT Gateway receives and forwards it to Manager API (`/toy/device-sync/analytics-event`).
3. Manager API validates and stores the event in `device_analytics_event`.
4. Parent/Admin APIs read these stored events for analytics dashboards.

## MQTT Publishing Notes

- Keep using the normal firmware publish topic from OTA config.
- No special reply/ack is required for analytics events.
- Do not block runtime behavior waiting for analytics response.

## Required Top-Level Payload Fields

These fields are required. Missing fields will cause ingest rejection.

```json
{
  "type": "analytics_event",
  "device_id": "AA:BB:CC:DD:EE:FF",
  "event_id": "evt_1747590000000_42",
  "event": "game_end",
  "timestamp": 1747590000,
  "seq": 42,
  "uptime_ms": 915230,
  "battery_percentage": 76,
  "charging": false,
  "discharging": true,
  "firmware": "v2.3.1",
  "build_label": "release-2026-05-18",
  "data": {}
}
```

### Field Details

- `type`: must be exactly `analytics_event`
- `device_id`: stable unique device identifier (use MAC format used by backend)
- `event_id`: unique per device event (dedupe key with `device_id`)
- `event`: event name (`game_start`, `game_end`, etc.)
- `timestamp`: unix time in seconds or milliseconds
- `data`: event-specific object (see next section)

## Recommended `data` Fields for Game Events

To support game analytics quality, include these fields in `data`:

- `game_id` (string): stable game key (example: `math_tutor_v2`)
- `game_type` (string): high-level type (example: `math_tutor`, `riddle_solver`, `word_ladder`)
- `game_name` (string): human-readable name (example: `Math Tutor`)
- `level` (number): current game level
- `difficulty_level` (string): `easy|medium|hard` (or your enum, but keep consistent)
- `score` (number): score at end/update event
- `duration_ms` (number): elapsed duration in ms for end events
- `reason` (string): end reason (example: `completed`, `switched`, `timeout`)
- `question_type` (string): optional question category
- `is_correct` (boolean): optional per-attempt correctness

Even if some fields are not yet shown in all dashboards, backend stores raw `data`, so include them now for forward compatibility.

## Event Types to Emit

Minimum recommended:

- `game_start`
- `game_end`
- `ai_talk_start`
- `ai_talk_end`
- `radio_end`
- `card_session_start`
- `card_session_end`

## Example Payloads

### 1) `game_start`

```json
{
  "type": "analytics_event",
  "device_id": "AA:BB:CC:DD:EE:FF",
  "event_id": "evt_1747590200000_1201",
  "event": "game_start",
  "timestamp": 1747590200,
  "seq": 1201,
  "uptime_ms": 1300450,
  "battery_percentage": 73,
  "charging": false,
  "discharging": true,
  "firmware": "v2.3.1",
  "build_label": "release-2026-05-18",
  "data": {
    "game_id": "math_tutor_v2",
    "game_type": "math_tutor",
    "game_name": "Math Tutor",
    "level": 7,
    "difficulty_level": "medium"
  }
}
```

### 2) `game_end`

```json
{
  "type": "analytics_event",
  "device_id": "AA:BB:CC:DD:EE:FF",
  "event_id": "evt_1747590295000_1202",
  "event": "game_end",
  "timestamp": 1747590295,
  "seq": 1202,
  "uptime_ms": 1395000,
  "battery_percentage": 72,
  "charging": false,
  "discharging": true,
  "firmware": "v2.3.1",
  "build_label": "release-2026-05-18",
  "data": {
    "game_id": "math_tutor_v2",
    "game_type": "math_tutor",
    "game_name": "Math Tutor",
    "level": 7,
    "difficulty_level": "medium",
    "score": 8,
    "duration_ms": 95000,
    "reason": "completed"
  }
}
```

## `event_id` Generation Rule

`event_id` must be unique for each emitted event per `device_id`.

Recommended format:

- `evt_<event_timestamp_ms>_<seq>`

Example:

- `evt_1747590295000_1202`

If an MQTT retry resends the same logical event, reuse the same `event_id` to avoid duplicates.

## Reliability Guidelines

- Queue analytics when offline and retry on reconnect.
- Preserve original `event_id` during retries.
- Send events in chronological order where possible.
- Do not drop `game_end` events; these are critical for duration and score.

## Firmware Implementation Checklist

1. Add `analytics_event` serializer with required top-level fields.
2. Ensure every event has stable `device_id`.
3. Implement unique `event_id` generation.
4. Emit `game_start` and `game_end` with full game context fields.
5. Include `level` and `difficulty_level` in `data`.
6. Include `score` and `duration_ms` on end events.
7. Add retry queue that preserves `event_id`.
8. Verify payload JSON key names exactly match this README.

## Validation Checklist (QA)

- Event is accepted by backend (not 400).
- Duplicate resend with same `event_id` is deduplicated.
- `game_end` rows include `game_id`, `game_name`, `level`, `difficulty_level`, `score`.
- Events appear in admin/mobile firmware analytics events APIs.

## Known Constraints (Current Backend)

- Backend currently indexes `game_id` and `score` directly.
- Additional game fields (like `game_name`, `level`, `difficulty_level`) should still be sent in `data` now.
- This allows immediate raw-data availability and smooth backend/dashboard expansion.

