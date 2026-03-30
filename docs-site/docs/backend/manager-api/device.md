---
id: device
sidebar_position: 3
---

# Device Endpoints

Device management for ESP32 hardware. Base path: `/toy/device`.

Devices are identified by their MAC address (normalized internally to `AA:BB:CC:DD:EE:FF` format). Most endpoints require a user Bearer token; the low-level ESP32 polling endpoints (`mode`, `device-mode`, `cycle-mode`) are public.

## Endpoint Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/toy/device/register` | None | ESP32 self-registration |
| `POST` | `/toy/device/bind/:agentId/:deviceCode` | User | Bind device to agent |
| `GET` | `/toy/device/bind/:agentId` | User | List devices bound to an agent |
| `POST` | `/toy/device/unbind` | User | Unbind device from user |
| `PUT` | `/toy/device/update/:id` | User | Update device metadata |
| `POST` | `/toy/device/manual-add` | User | Manually add a device |
| `PUT` | `/toy/device/assign-kid/:deviceId` | User | Assign kid profile to device |
| `PUT` | `/toy/device/assign-kid-by-mac` | User | Assign kid profile to device by MAC |
| `POST` | `/toy/device/:mac/cycle-mode` | None | Cycle device mode (ESP32 button press) |
| `GET` | `/toy/device/:mac/mode` | None | Get current device mode |
| `GET` | `/toy/device/:mac/device-mode` | None | Get PTT mode (auto/manual) |
| `GET` | `/toy/device/list` | User | List user's devices (paginated) |
| `GET` | `/toy/device/:mac` | Optional | Get device by MAC address |
| `POST` | `/toy/device/ota/check` | None | Check for OTA firmware update |

---

## POST `/toy/device/register`

Called by ESP32 firmware to register itself. Creates a device record if one does not exist for the MAC.

### Request

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "board": "esp32s3",
  "appVersion": "1.0.5"
}
```

| Field | Required | Description |
|---|---|---|
| `mac` | Yes | MAC address (`AA:BB:CC:DD:EE:FF` or `AABBCCDDEEFF`) |
| `board` | No | Hardware board type |
| `appVersion` | No | Firmware version string |

### Response

```json
{
  "code": 0,
  "msg": "Device registered successfully",
  "data": { ... }
}
```

---

## POST `/toy/device/bind/:agentId/:deviceCode`

Binds an existing device to the authenticated user and the specified agent. `deviceCode` is the device MAC address or validation code.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "id": "uuid",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "agentId": "agent-uuid",
    "alias": "My Cheeko",
    "board": "esp32s3",
    "kidId": 42,
    "appVersion": "1.0.5"
  }
}
```

---

## GET `/toy/device/bind/:agentId`

Returns all devices bound to a specific agent. Regular users see only their own devices; super admins see all devices for the agent.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": [
    {
      "id": "uuid",
      "userId": 1,
      "macAddress": "AA:BB:CC:DD:EE:FF",
      "lastConnectedAt": "2024-03-01T10:00:00.000Z",
      "autoUpdate": true,
      "board": "esp32s3",
      "alias": "My Cheeko",
      "agentId": "agent-uuid",
      "kidId": 42,
      "mode": "conversation",
      "deviceMode": "auto",
      "appVersion": "1.0.5",
      "sort": 0,
      "updater": null,
      "updateDate": "2024-03-01T10:00:00.000Z",
      "creator": 1,
      "createDate": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## POST `/toy/device/unbind`

Removes the association between a device and the authenticated user.

### Request

```json
{ "deviceId": "device-uuid" }
```

### Response

`{ "code": 0, "msg": "success", "data": null }` on success.

Error response uses `code: 500` in the body (HTTP status remains 200).

---

## PUT `/toy/device/update/:id`

Updates mutable device fields.

### Request

```json
{
  "alias": "Kids Room Cheeko",
  "autoUpdate": true,
  "agentId": "new-agent-uuid"
}
```

Returns `{ "code": 0, "data": null }` on success.

---

## POST `/toy/device/manual-add`

Admin/user workflow to add a device without going through the ESP32 registration flow.

### Request

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "board": "esp32s3",
  "appVersion": "1.0.5",
  "agentId": "agent-uuid",
  "alias": "My Cheeko"
}
```

Either `mac` or `macAddress` is accepted. Returns `{ "code": 0, "data": null }`.

---

## PUT `/toy/device/assign-kid/:deviceId`

Links a kid profile to a device.

### Request

```json
{ "kidId": 42 }
```

---

## PUT `/toy/device/assign-kid-by-mac`

Links a kid profile to a device identified by MAC address.

### Request

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "kidId": 42
}
```

---

## POST `/toy/device/:mac/cycle-mode`

Cycles the device's content mode in sequence: `conversation` → `music` → `story` → `conversation`. Called by the ESP32 when the user presses the mode button.

### Response

```json
{
  "code": 0,
  "msg": "Mode changed to music",
  "data": { "mode": "music" }
}
```

---

## GET `/toy/device/:mac/mode`

Returns the current content mode for the device. Used by the MQTT gateway at session start.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": "conversation"
}
```

`data` is a plain string: `"conversation"`, `"music"`, or `"story"`.

---

## GET `/toy/device/:mac/device-mode`

Returns the PTT (push-to-talk) mode. Used by the MQTT gateway to determine whether to use auto-VAD or manual PTT.

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": "auto"
}
```

`data` is a plain string: `"auto"` or `"manual"`.

---

## GET `/toy/device/list`

Returns a paginated list of devices belonging to the authenticated user.

### Query Parameters

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `limit` | `10` | Items per page |

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [ ... ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

---

## GET `/toy/device/:mac`

Returns a single device record by MAC address. Authentication is optional; unauthenticated callers receive device data without user-specific fields.

Returns `404` if device does not exist.

---

## POST `/toy/device/ota/check`

Alternative OTA check endpoint (wrapped in standard response envelope, unlike `/toy/ota/` which returns raw data).

### Request

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "version": "1.0.5",
  "board": "esp32s3"
}
```

### Response

```json
{
  "code": 0,
  "msg": "success",
  "data": {
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
      "remark": "Release notes"
    },
    "serverTime": {
      "timestamp": 1711123456789,
      "timezone": "UTC",
      "offset": 0
    }
  }
}
```

`firmware` is `null` when the device is already on the latest version.
