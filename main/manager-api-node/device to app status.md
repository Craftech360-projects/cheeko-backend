# Cheeko Parent App MQTT Settings Flow

## Ownership model

The phone app is the user-facing control surface. The server is the source of truth. Cheeko firmware never accepts direct phone commands.

Flow:

1. Parent changes a setting in the phone app.
2. Phone app writes the new settings document to the backend.
3. Backend increments the settings `version` for that device.
4. Cheeko connects to MQTT and publishes `settings_get` with its current version.
5. Backend sends `settings_update` only when the server version is newer.
6. Cheeko validates, persists to NVS, applies runtime-safe settings, and publishes `settings_ack`.
7. Cheeko publishes `device_state` after connect, after settings apply, and after major state changes.

Do not build app logic that assumes direct Bluetooth/Wi-Fi phone-to-device settings writes. That creates split-brain state. Bad engineering. Avoid it.

## MQTT topics

Firmware uses the MQTT config received from OTA/server config:

- `publish_topic`: device → server
- `subscribe_topic`: server → device

If `subscribe_topic` is absent, firmware derives:

```text
devices/p2p/{client_id}
```

The backend must route all device settings commands to the device subscribe topic.

## Device identity

Every firmware-originated parent-app message includes:

```json
{
  "device_id": "firmware-generated-device-uuid",
  "mac_address": "aa:bb:cc:dd:ee:ff",
  "board": "board-name",
  "firmware": "FW x.y.z",
  "build_label": "CHEEKO OS R2"
}
```

Use `device_id` as the stable device key unless backend provisioning already maps MQTT client ID to an account/device.

## Boot/reconnect: settings pull

Cheeko publishes this after MQTT connects:

```json
{
  "type": "settings_get",
  "device_id": "...",
  "mac_address": "...",
  "board": "...",
  "firmware": "FW x.y.z",
  "build_label": "CHEEKO OS R2",
  "current_version": 12,
  "uptime_ms": 10234
}
```

Backend behavior:

- If server version is newer: send `settings_update`.
- If versions match: no update required.
- If backend wants a fresh snapshot: send `settings_ping`.

## Server → device: settings update

```json
{
  "type": "settings_update",
  "version": 13,
  "settings": {
    "volume": 70,
    "brightness": 80,
    "auto_listen": false,
    "system_sound": true,
    "system_prompt": true,
    "vibration": true,
    "sleep_enabled": true,
    "quiet_hours": {
      "enabled": true,
      "start": "21:00",
      "end": "07:00"
    }
  }
}
```

Version rules:

- `version` is required and numeric.
- Firmware ignores updates where `version <= current_version`.
- Firmware persists the accepted version in NVS namespace `parent_app`, key `settings_ver`.
- Backend must increment version for every settings document change.

Currently supported keys:

- `volume`: integer `0..100`, applied to codec output volume.
- `brightness`: integer `10..100`, applied to display backlight.
- `auto_listen`: boolean, controls wake-word/auto listening.
- `system_sound`: boolean, controls button/system sounds.
- `system_prompt`: boolean, controls prompt audio.
- `vibration`: boolean, controls vibration setting.
- `sleep_enabled`: boolean, maps to existing sleep mode flag.
- `quiet_hours`: object stored locally for policy enforcement. Runtime quiet-hours enforcement is a follow-up item unless already handled by app/backend policy.

Unknown keys are ignored for now. Backend should not depend on unknown keys being applied.

## Device → server: acknowledgement

Success:

```json
{
  "type": "settings_ack",
  "device_id": "...",
  "mac_address": "...",
  "board": "...",
  "firmware": "FW x.y.z",
  "build_label": "CHEEKO OS R2",
  "version": 13,
  "status": "applied",
  "applied_version": 13
}
```

Ignored stale version:

```json
{
  "type": "settings_ack",
  "version": 12,
  "status": "ignored",
  "applied_version": 13,
  "reason": "stale version"
}
```

Rejected malformed payload:

```json
{
  "type": "settings_ack",
  "version": 13,
  "status": "rejected",
  "applied_version": 12,
  "reason": "missing settings object"
}
```

Backend should surface rejected updates to the app/admin logs.

## Device → server: local settings change

When a setting is changed directly on the Cheeko device, firmware publishes a
full settings snapshot:

```json
{
  "type": "settings_changed",
  "source": "device",
  "device_id": "...",
  "mac_address": "...",
  "board": "...",
  "firmware": "FW x.y.z",
  "build_label": "CHEEKO OS R2",
  "reason": "device_system_sound",
  "base_version": 13,
  "settings_version": 13,
  "uptime_ms": 123456,
  "settings": {
    "volume": 70,
    "brightness": 80,
    "autoplay": true,
    "auto_listen": false,
    "system_sound": true,
    "system_prompt": true,
    "vibration": true,
    "sleep_enabled": true,
    "quiet_hours": {
      "enabled": false,
      "start": "21:00",
      "end": "07:00"
    }
  }
}
```

Backend behavior:

- Treat this as a device-originated patch/snapshot.
- Store the received settings as the latest server-side settings for that
  device.
- Increment the backend settings version.
- Optionally publish a normal `settings_update` back to the device with the new
  version. The values will already match on-device, but this lets firmware store
  the new version and keeps reconnect behavior clean.
- De-duplicate rapid repeated messages by `device_id`, `reason`, and latest
  received settings if needed.

Device-side settings that currently publish this message:

- Volume buttons.
- Brightness save from Settings.
- Autoplay.
- System Sound.
- System Prompt.
- Vibration.
- Auto Listen.

## Device state snapshot

Cheeko publishes this after MQTT connect, after accepted settings, and after major runtime state changes:

```json
{
  "type": "device_state",
  "device_id": "...",
  "mac_address": "...",
  "board": "...",
  "firmware": "FW x.y.z",
  "build_label": "CHEEKO OS R2",
  "reason": "settings_applied",
  "uptime_ms": 123456,
  "settings_version": 13,
  "device_state": "idle",
  "network": "connected",
  "mode": "Home",
  "content_state": "NoCard",
  "volume": 70,
  "brightness": 80,
  "auto_listen": false,
  "system_sound": true,
  "system_prompt": true,
  "vibration": true,
  "battery": 82,
  "charging": false,
  "discharging": true
}
```

`battery`, `charging`, and `discharging` are present only when the board implementation exposes battery data.

`reason` values currently emitted:

- `protocol_connected`
- `settings_applied`
- `settings_ping`
- `state_changed`

## Backend requirements for app team

Minimum backend responsibilities:

1. Maintain per-device settings document.
2. Increment per-device settings version monotonically.
3. Publish `settings_update` to the device subscribe topic after app changes.
4. Respond to `settings_get` after device boot/reconnect.
5. Record `settings_ack` status.
6. Record latest `device_state` for app display.
7. Do not send direct phone-originated commands to Cheeko without server-side authorization.

## App-team MVP screen mapping

Phone app can safely build these screens against this flow:

- Device connection/status screen from `device_state`.
- Settings screen backed by server settings document.
- Volume/brightness/toggles with pending state until `settings_ack`.
- Device health card: firmware, board, battery, network, last seen.
- Parent controls: quiet hours and auto listen.

Recommended UX:

- On app change, show `Syncing...`.
- Mark setting as applied only after matching `settings_ack.version`.
- If no ack before timeout, show `Will sync when Cheeko is online`.
- If rejected, show backend/app error and keep previous confirmed value.

## Firmware notes

Firmware module:

```text
main/cheeko_parent_app_sync.{h,cc}
```

Protocol hook:

```text
Protocol::SendJsonMessage(...)
```

MQTT handling is wired through `Application::InitializeProtocol()` incoming JSON handler.

Offline behavior:

- Cheeko boots with cached local NVS settings.
- Cheeko remains usable without server.
- On reconnect, Cheeko asks server for newer settings.

Follow-up firmware item:

- Enforce quiet hours locally if product wants device-side blocking. Right now quiet-hours values are persisted for policy use, but hard blocking should be designed carefully so we do not accidentally brick play mode during demos.
