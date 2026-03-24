---
id: ota
sidebar_position: 2
---

# OTA Endpoints

Over-the-Air (OTA) firmware update endpoints for ESP32 devices. These endpoints live at `/toy/ota/`.

There is a second set of OTA endpoints at `/toy/device/ota/` (documented in [Device Endpoints](./device.md)) that are used by the admin dashboard.

## Endpoint Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/toy/ota/` | None | Firmware version check and device registration (called on boot) |
| `POST` | `/toy/ota/activate` | None | Quick device activation check |
| `GET` | `/toy/ota/` | None | OTA system status and latest firmware versions |

---

## POST `/toy/ota/`

Called by the ESP32 on every boot. Registers or updates the device record and returns available firmware if an update is pending.

### Request

MAC address is read from the `Device-Id` header first, falling back to `mac` or `mac_address` in the body.

**Headers:**

| Header | Required | Description |
|---|---|---|
| `Device-Id` | Preferred | Device MAC address (e.g. `AA:BB:CC:DD:EE:FF`) |
| `Client-Id` | Optional | Client identifier; defaults to `Device-Id` |
| `Content-Type` | Yes | `application/json` |

**Body (all fields optional except MAC resolution):**

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "version": "1.0.5",
  "board": "esp32s3",
  "flash_size": 8388608,
  "chip_model_name": "ESP32-S3",
  "chip_info": "rev3",
  "application": "cheeko",
  "ota": {}
}
```

| Field | Type | Description |
|---|---|---|
| `mac` / `mac_address` | string | MAC address fallback if `Device-Id` header absent |
| `version` | string | Current firmware version running on device |
| `board` | string | Board type: `esp32`, `esp32s3`, `esp32c3` |
| `flash_size` | integer | Flash size in bytes |
| `chip_model_name` | string | Chip model string |
| `chip_info` | string | Chip revision info |
| `application` | string | Application name |
| `ota` | object | OTA-specific metadata |

### Response

Note: this endpoint returns the raw payload without the standard `{ code, msg, data }` envelope.

```json
{
  "device": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "currentVersion": "1.0.5",
    "board": "esp32s3",
    "autoUpdate": true
  },
  "firmware": {
    "version": "1.1.0",
    "url": "https://cdn.example.com/firmware/cheeko-1.1.0.bin",
    "size": 1234567,
    "force": 0,
    "name": "cheeko-1.1.0",
    "remark": "Bug fixes and stability improvements"
  },
  "serverTime": {
    "timestamp": 1711123456789,
    "timezone": "UTC",
    "offset": 0
  }
}
```

`firmware` is `null` when no update is available or when the device already runs the latest version.

| Field | Type | Description |
|---|---|---|
| `device.mac` | string | Normalized MAC address |
| `device.currentVersion` | string | Version reported by device |
| `device.board` | string | Board type |
| `device.autoUpdate` | boolean | Whether auto-update is enabled for this device |
| `firmware` | object or null | Available firmware; null if up to date |
| `firmware.version` | string | Target firmware version |
| `firmware.url` | string | Download URL |
| `firmware.size` | integer | File size in bytes |
| `firmware.force` | integer | `0` = optional, `1` = forced update |
| `firmware.name` | string | Firmware release name |
| `firmware.remark` | string | Release notes |
| `serverTime.timestamp` | integer | Server Unix time in milliseconds |
| `serverTime.timezone` | string | Timezone identifier |
| `serverTime.offset` | integer | UTC offset in minutes |

### Error responses

| Condition | Response |
|---|---|
| Missing MAC | `400` with `{ "code": 400, "msg": "Device ID is required..." }` |
| Invalid MAC format | `400` with `{ "code": 400, "msg": "Invalid device ID format" }` |
| Internal error | `200` with `{ "error": "<message>" }` |

---

## POST `/toy/ota/activate`

Quick activation check. Returns HTTP `200` with body `success` for registered devices; returns HTTP `202` (empty body) for unregistered devices or when the MAC is missing.

### Request

MAC address read from `Device-Id` header or `mac` body field.

```json
{ "mac": "AA:BB:CC:DD:EE:FF" }
```

### Response

| Scenario | Status | Body |
|---|---|---|
| Device registered and active | `200` | `success` (plain text) |
| Device not found | `202` | _(empty)_ |
| Missing MAC | `202` | _(empty)_ |
| Internal error | `202` | _(empty)_ |

---

## GET `/toy/ota/`

Returns current OTA system status and the latest available firmware version for each board type.

### Request

| Query param | Type | Description |
|---|---|---|
| `type` | string | Optional. Filter by board type (`esp32`, `esp32s3`, `esp32c3`). If omitted, returns all three. |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "status": "online",
    "latestVersions": {
      "esp32": {
        "version": "1.1.0",
        "forceUpdate": false
      },
      "esp32s3": {
        "version": "1.1.0",
        "forceUpdate": false
      },
      "esp32c3": {
        "version": "1.0.8",
        "forceUpdate": true
      }
    },
    "serverTime": 1711123456789
  }
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"online"` when the API is reachable |
| `latestVersions` | object | Map of board type → `{ version, forceUpdate }` |
| `latestVersions.<type>.version` | string | Latest firmware version for that board |
| `latestVersions.<type>.forceUpdate` | boolean | Whether this version is a forced update |
| `serverTime` | integer | Server Unix time in milliseconds |

A board type key is omitted from `latestVersions` if no firmware record exists for it.
