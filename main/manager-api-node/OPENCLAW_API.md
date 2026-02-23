# OpenClaw API Reference

All OpenClaw-related endpoints for connecting Cheeko devices to an OpenClaw voice engine.

**Base path:** `/toy`
**Server:** `manager-api-node` (Express.js, port 8002)

---

## Authenticated Endpoints

These endpoints require a valid JWT Bearer token in the `Authorization` header.

### 1. Get OpenClaw Config

Retrieve the current user's OpenClaw URL and token from their `parent_profile`.

```
GET /toy/user/openclaw-config
```

**Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer <jwt_token>` |

**Response (200):**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "openclaw_url": "ws://192.168.1.10:8765/",
    "openclaw_token": null
  }
}
```

If no profile exists, returns `{ "openclaw_url": null, "openclaw_token": null }`.

---

### 2. Set OpenClaw Config

Save or clear the OpenClaw URL/token. Propagates to **all** of the user's devices in `ai_device`.

```
PUT /toy/user/openclaw-config
```

**Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer <jwt_token>` |
| Content-Type | `application/json` |

**Request Body:**
```json
{
  "openclaw_url": "ws://192.168.1.10:8765/",
  "openclaw_token": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `openclaw_url` | string | No | WebSocket URL. Must start with `ws://` or `wss://`. Set to `null` to disconnect. |
| `openclaw_token` | string | No | Optional auth token for the WebSocket connection. |

**Response (200):**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "openclaw_url": "ws://192.168.1.10:8765/",
    "openclaw_token": null
  }
}
```

**Behavior:**
- Creates `parent_profile` row if it doesn't exist (upsert).
- Propagates `openclaw_url` and `openclaw_token` to all `ai_device` rows for this user.
- Setting `openclaw_url` to `null` clears it from profile AND all devices (disconnect).

---

### 3. Test OpenClaw Connection

Test connectivity to an OpenClaw WebSocket URL. Opens a WebSocket, measures latency, and closes.

```
POST /toy/user/openclaw-config/test
```

**Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer <jwt_token>` |
| Content-Type | `application/json` |

**Request Body:**
```json
{
  "url": "ws://192.168.1.10:8765/"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | WebSocket URL to test. Must start with `ws://` or `wss://`. |

**Response (200) - Success:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ok": true,
    "latencyMs": 42
  }
}
```

**Response (200) - Failure:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ok": false,
    "error": "Connection timed out"
  }
}
```

**Notes:**
- 5-second timeout for both handshake and overall connection.
- Does not save the URL; use `PUT /user/openclaw-config` to save after testing.

---

### 4. Generate Pairing Token

Create a one-time pairing token (e.g. `XK9-2M4`) that the OpenClaw plugin uses to auto-configure the URL.

```
POST /toy/user/openclaw-pair/generate
```

**Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer <jwt_token>` |

**Response (200):**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "token": "XK9-2M4",
    "expiresIn": 600
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | 6-character pairing code (format: `XXX-XXX`). |
| `expiresIn` | number | Token lifetime in seconds (600 = 10 minutes). |

**Behavior:**
- Deletes any existing unpaired tokens for this user before generating a new one.
- Token is stored in `openclaw_pair_tokens` table.
- Characters exclude `I`, `O`, `0`, `1` to avoid visual ambiguity.

---

### 5. Check Pairing Status

Poll this endpoint to check if the OpenClaw plugin has completed pairing. Frontend polls every 3 seconds.

```
GET /toy/user/openclaw-pair/status?token=XK9-2M4
```

**Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer <jwt_token>` |

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | The pairing token to check. |

**Response (200) - Not yet paired:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "paired": false,
    "expired": false
  }
}
```

**Response (200) - Paired:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "paired": true,
    "url": "ws://192.168.1.10:8765/"
  }
}
```

**Response (200) - Expired:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "paired": false,
    "expired": true
  }
}
```

---

## Public Endpoint

This endpoint does **not** require authentication. It is called by the OpenClaw plugin.

### 6. Complete Pairing

Called by the OpenClaw plugin when `CHEEKO_PAIR` environment variable is set. Validates the token and saves the plugin's WebSocket URL to the user's profile.

```
POST /toy/api/openclaw/pair
```

**Headers:**
| Header | Value |
|--------|-------|
| Content-Type | `application/json` |

**Request Body:**
```json
{
  "token": "XK9-2M4",
  "url": "ws://192.168.1.10:8765/",
  "localIp": "192.168.1.10"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Pairing token from the dashboard. |
| `url` | string | Yes | WebSocket URL of the OpenClaw plugin. Must start with `ws://` or `wss://`. |
| `localIp` | string | No | Local IP address of the machine running the plugin. |

**Response (200):**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "ok": true
  }
}
```

**Error Responses (400):**
```json
{ "code": 400, "msg": "Invalid pairing token" }
{ "code": 400, "msg": "Pairing token has expired" }
{ "code": 400, "msg": "Pairing token has already been used" }
{ "code": 400, "msg": "Invalid OpenClaw URL format" }
```

**Behavior:**
- Marks the token as `paired = true` in `openclaw_pair_tokens`.
- Saves `openclaw_url` to user's `parent_profile`.
- Propagates `openclaw_url` to all user's devices in `ai_device`.

---

## Database Tables

### `parent_profile`
Stores user-level OpenClaw configuration.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | BIGINT | FK to `sys_user.id` |
| `openclaw_url` | TEXT | WebSocket URL |
| `openclaw_token` | TEXT | Optional auth token |

### `ai_device`
Each device also stores the OpenClaw URL (propagated from parent_profile).

| Column | Type | Description |
|--------|------|-------------|
| `openclaw_url` | TEXT | WebSocket URL (copied from parent_profile) |
| `openclaw_token` | TEXT | Optional auth token (copied from parent_profile) |

### `openclaw_pair_tokens`
Temporary pairing tokens for the plugin handshake.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | BIGINT | FK to `sys_user.id` |
| `token` | VARCHAR(20) | Pairing code (e.g. `XK9-2M4`) |
| `openclaw_url` | TEXT | URL set when pairing completes |
| `paired` | BOOLEAN | Whether pairing is complete |
| `expires_at` | TIMESTAMPTZ | Expiration time (10 min from creation) |

---

## Pairing Flow

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Dashboard  │         │   Cheeko API  │         │ OpenClaw CLI │
│  (Frontend)  │         │  (Backend)    │         │  (Plugin)    │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  POST /pair/generate   │                        │
       │───────────────────────>│                        │
       │   { token: "XK9-2M4"} │                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  Show token to user    │                        │
       │  (user enters in CLI)  │                        │
       │                        │                        │
       │                        │  POST /api/openclaw/pair
       │                        │<───────────────────────│
       │                        │  { token, url }        │
       │                        │───────────────────────>│
       │                        │  { ok: true }          │
       │                        │                        │
       │  GET /pair/status      │                        │
       │───────────────────────>│                        │
       │  { paired: true, url } │                        │
       │<───────────────────────│                        │
       │                        │                        │
       │  URL saved to profile  │                        │
       │  + all devices         │                        │
       └────────────────────────┴────────────────────────┘
```

---

## Frontend API Module

The Vue.js frontend uses these methods from `src/apis/module/openclaw.js`:

| Method | Backend Endpoint |
|--------|------------------|
| `Api.openclaw.getConfig(cb, failCb)` | `GET /user/openclaw-config` |
| `Api.openclaw.setConfig(data, cb, failCb)` | `PUT /user/openclaw-config` |
| `Api.openclaw.testConnection(url, cb, failCb)` | `POST /user/openclaw-config/test` |
| `Api.openclaw.generatePairToken(cb, failCb)` | `POST /user/openclaw-pair/generate` |
| `Api.openclaw.getPairStatus(token, cb, failCb)` | `GET /user/openclaw-pair/status?token=` |

---

## Frontend Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/openclaw-setup` | `OpenClawSetup.vue` | First-time onboarding wizard (3 steps) |
| `/openclaw-settings` | `OpenClawSettings.vue` | Settings page for existing users |
