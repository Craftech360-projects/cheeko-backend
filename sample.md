# Cheeko Backend — OpenClaw Integration Guide

> This document covers:
> 1. What the cheeko-backend currently does (for context)
> 2. What needs to change to integrate OpenClaw instead of the previous LiveKit/MQTT gateway
> 3. Exact file-by-file changes required

---

## 1. Current Architecture (What Exists Today)

```
ESP32 Device
  │
  ├── POST /ota/          → cheeko-backend (manager-api-node)
  │                           Returns: firmware info + activation code + MQTT creds + WebSocket URL
  │
  ├── MQTT               → mqtt-gateway (separate Node.js service)
  │                           Bridges MQTT/UDP ↔ WebSocket
  │
  └── WebSocket          → livekit-server (Python, separate service)
                              Real-time voice: STT → LLM → TTS via LiveKit
```

**Key tables used:**
- `ai_device` — device registry, one row per ESP32
- `sys_params` — stores `server.websocket` (LiveKit URL), `mqtt.*` credentials
- `ai_agent` — LLM/TTS/ASR model config per user
- `sys_user` / `sys_user_token` — user auth

**What `/ota/` currently returns to the ESP32:**
```json
{
  "server_time": { "timestamp": 1234567890, "timezone_offset": 0 },
  "firmware": { "version": "1.0.6", "url": "...", "force": 0 },
  "activation": { "code": "123456", "message": "...\n123456" },
  "mqtt": { "broker": "...", "port": 1883, "client_id": "...", "username": "...", "password": "..." },
  "websocket": { "url": "ws://192.168.1.99:8000/cheeko/v1/" }
}
```

The ESP32 uses `websocket.url` to connect to LiveKit for voice.

---

## 2. New Architecture (With OpenClaw)

```
ESP32 Device
  │
  ├── POST /ota/          → cheeko-backend (no change to this service)
  │                           Returns: firmware info + activation code + websocket URL
  │                           websocket.url now points to OpenClaw esp32-voice plugin
  │
  └── WebSocket           → OpenClaw esp32-voice plugin (port 8765, on user's machine)
        │                       Opus audio → Deepgram STT → OpenClaw Gateway → ElevenLabs TTS → Opus
        └── Gateway WS    → OpenClaw Gateway (port 18789, same machine)
                                LLM: Gemini / Claude / GPT
```

**What changes in `/ota/` response:**
- `websocket.url` → points to user's OpenClaw esp32-voice plugin (`ws://<user-ip>:8765/`)
- `mqtt` block → **removed** (OpenClaw doesn't use MQTT)
- Everything else stays the same

**What the dashboard needs to store per device (new fields):**
- `openclaw_url` — the user's OpenClaw voice WebSocket URL (e.g. `ws://192.168.1.10:8765/`)

---

## 3. New User Registration Flow

```
1. User registers on dashboard  →  creates sys_user record (no change)

2. User adds their OpenClaw URL  →  new field in parent_profile or sys_user
   "My OpenClaw is running at: ws://192.168.1.10:8765/"

3. User adds device:
   a. Device boots → hits POST /ota/ → gets activation code (6 digits) → speaks it
   b. User enters 6-digit code on dashboard → POST /device/bind/:agentId/:code
   c. Device record created with: user_id, agent_id, openclaw_url (from user profile)

4. Next device boot → POST /ota/
   → device is now registered (user_id not null)
   → /ota/ returns websocket.url = user's openclaw_url
   → device connects directly to their OpenClaw instance
```

---

## 4. Exact File Changes Required

### 4.1 Database — Add `openclaw_url` to `ai_device`

**File:** `manager-api-node/prisma/schema.prisma` (if using Prisma)
OR run directly in Supabase dashboard SQL editor.

```sql
-- Add to ai_device table
ALTER TABLE ai_device ADD COLUMN openclaw_url TEXT;
ALTER TABLE ai_device ADD COLUMN openclaw_token TEXT;
```

**Why:** Each device needs to know which OpenClaw instance to connect to. Since each user runs their own OpenClaw, this is per-device (inherited from user's profile at bind time).

---

### 4.2 Database — Add `openclaw_url` to `parent_profile`

```sql
-- User enters their OpenClaw URL once, all their devices inherit it
ALTER TABLE parent_profile ADD COLUMN openclaw_url TEXT;
ALTER TABLE parent_profile ADD COLUMN openclaw_token TEXT;
```

**Why:** User enters their OpenClaw URL once when setting up their account. All devices they add inherit this URL. They can override per-device if needed.

---

### 4.3 OTA Controller — Change What `websocket.url` Returns

**File:** `manager-api-node/src/controllers/otaController.js` (or equivalent)

Find the section that builds the OTA response. Currently it reads `server.websocket` from `sys_params`. Change it to:

```javascript
// BEFORE: read from sys_params (shared LiveKit URL for everyone)
const wsParam = await getSystemParam('server.websocket');
const wsUrl = wsParam?.param_value || '';

// AFTER: read from ai_device → openclaw_url (per-user OpenClaw URL)
// device is the ai_device record looked up by MAC earlier in this function
const wsUrl = device?.openclaw_url || '';
```

**Also remove the `mqtt` block from the response** — OpenClaw doesn't use MQTT:

```javascript
// BEFORE response object:
{
  server_time: { ... },
  firmware: { ... },
  activation: { ... },
  mqtt: { broker, port, client_id, username, password },  // ← REMOVE THIS
  websocket: { url: wsUrl }
}

// AFTER response object:
{
  server_time: { ... },
  firmware: { ... },
  activation: { ... },
  websocket: { url: wsUrl }  // now points to user's openclaw plugin
}
```

**For unregistered devices** (user_id is null), `openclaw_url` will be empty — that's fine, the device just speaks the OTP and waits.

---

### 4.4 Device Bind Controller — Copy `openclaw_url` from User Profile at Bind Time

**File:** `manager-api-node/src/controllers/deviceController.js` (bind endpoint)

When a device is bound to a user (POST `/device/bind/:agentId/:code`), copy the user's `openclaw_url` into the device record:

```javascript
// After verifying user token and finding the device to bind:

// Get user's openclaw_url from their profile
const { data: profile } = await supabase
  .from('parent_profile')
  .select('openclaw_url, openclaw_token')
  .eq('user_id', userId)
  .single();

// Update or insert device with openclaw_url
if (deviceExists) {
  await supabase
    .from('ai_device')
    .update({
      user_id: userId,
      agent_id: agentId,
      openclaw_url: profile?.openclaw_url || null,
      openclaw_token: profile?.openclaw_token || null,
      update_date: new Date()
    })
    .eq('mac_address', macAddress);
} else {
  await supabase
    .from('ai_device')
    .insert({
      mac_address: macAddress,
      user_id: userId,
      agent_id: agentId,
      openclaw_url: profile?.openclaw_url || null,
      openclaw_token: profile?.openclaw_token || null,
      // ... other fields
    });
}
```

---

### 4.5 New API Endpoints — User Sets Their OpenClaw URL

**File:** `manager-api-node/src/routes/userRoutes.js` or `profileRoutes.js`

Add two new endpoints:

```
GET  /user/openclaw-config       → get current openclaw_url + openclaw_token
PUT  /user/openclaw-config       → set openclaw_url + openclaw_token
```

**Controller logic:**

```javascript
// GET /user/openclaw-config
async function getOpenClawConfig(req, res) {
  const userId = req.user.id;
  const { data } = await supabase
    .from('parent_profile')
    .select('openclaw_url, openclaw_token')
    .eq('user_id', userId)
    .single();
  return res.json({ ok: true, data });
}

// PUT /user/openclaw-config
async function setOpenClawConfig(req, res) {
  const userId = req.user.id;
  const { openclaw_url, openclaw_token } = req.body;

  // Basic validation
  if (openclaw_url && !openclaw_url.startsWith('ws://') && !openclaw_url.startsWith('wss://')) {
    return res.status(400).json({ ok: false, error: 'openclaw_url must start with ws:// or wss://' });
  }

  await supabase
    .from('parent_profile')
    .update({ openclaw_url, openclaw_token })
    .eq('user_id', userId);

  // Also update all existing devices for this user
  if (openclaw_url) {
    await supabase
      .from('ai_device')
      .update({ openclaw_url, openclaw_token })
      .eq('user_id', userId);
  }

  return res.json({ ok: true });
}
```

---

### 4.6 Device Update Endpoint — Allow Per-Device Override

**File:** `manager-api-node/src/controllers/deviceController.js` (PUT `/device/update/:id`)

Add `openclaw_url` and `openclaw_token` to the fields that can be updated per-device:

```javascript
// In the update handler, add to allowed update fields:
const updateData = {};
if (body.alias !== undefined)        updateData.alias = body.alias;
if (body.autoUpdate !== undefined)   updateData.auto_update = body.autoUpdate;
if (body.agentId !== undefined)      updateData.agent_id = body.agentId;
if (body.openclaw_url !== undefined) updateData.openclaw_url = body.openclaw_url;   // ADD
if (body.openclaw_token !== undefined) updateData.openclaw_token = body.openclaw_token; // ADD
```

---

### 4.7 Device List/Detail Response — Include `openclaw_url`

**File:** `manager-api-node/src/controllers/deviceController.js` (GET `/device/list`, GET `/device/:mac`)

When returning device info to the frontend, include the openclaw fields so the dashboard can show connection status:

```javascript
// In device serialization / response mapping, include:
{
  id: device.id,
  mac: device.mac_address,
  alias: device.alias,
  // ... existing fields ...
  openclaw_url: device.openclaw_url,     // ADD
  openclaw_configured: !!device.openclaw_url  // ADD - boolean for UI
}
```

---

## 5. What Does NOT Need to Change

| Component | Status | Reason |
|---|---|---|
| User registration/login | ✅ No change | Standard auth, nothing voice-specific |
| OTP generation (6-digit code) | ✅ No change | Same flow, device still speaks the code |
| Device bind flow | ✅ Minor change | Just copy openclaw_url at bind time (4.4 above) |
| Firmware OTA updates | ✅ No change | Completely independent of voice gateway |
| Agent config (`ai_agent`) | ✅ No change | Will be used by OpenClaw in future if needed |
| Kid profiles | ✅ No change | Unrelated to voice connection |
| Content library / playlists | ✅ No change | Unrelated to voice connection |
| Token usage tracking | ✅ No change | Can be adapted later |
| RFID system | ✅ No change | Unrelated |
| Analytics | ✅ No change | Unrelated |
| `sys_params` `server.websocket` | ⚠️ Can be removed | No longer used (each device has its own url) |
| `mqtt.*` sys_params | ⚠️ Can be removed | OpenClaw doesn't use MQTT |
| `mqtt-gateway` service | 🗑️ Not needed | OpenClaw replaces this entirely |
| `livekit-server` service | 🗑️ Not needed | OpenClaw replaces this entirely |

---

## 6. New User Onboarding Flow (Dashboard UI Changes Needed)

This is what the dashboard needs to show the user during setup:

```
Step 1 — Register account (same as now)

Step 2 — Connect your OpenClaw  [NEW SCREEN]
  "Enter your OpenClaw Gateway URL"
  ┌─────────────────────────────────────────────┐
  │ ws://192.168.1.10:8765/                     │  ← user types this
  └─────────────────────────────────────────────┘
  "How to find your URL: run `openclaw gateway` on your
   machine — the URL is printed at startup"

  [Optional] Gateway Token: ___________________

  [Test Connection]  [Save & Continue]

Step 3 — Add your device (same as now, just OTP entry)
  Device speaks 6-digit code → user types it here → device bound
```

The "Test Connection" button on Step 2 could hit a new endpoint on your backend:

```
POST /user/openclaw-config/test
Body: { openclaw_url, openclaw_token }
→ backend tries to open a WebSocket to openclaw_url, sends a ping
→ returns { ok: true } or { ok: false, error: "..." }
```

---

## 7. Summary of All Changes

| # | File | Change Type | Description |
|---|---|---|---|
| 1 | Supabase / Prisma schema | DB migration | Add `openclaw_url`, `openclaw_token` to `ai_device` |
| 2 | Supabase / Prisma schema | DB migration | Add `openclaw_url`, `openclaw_token` to `parent_profile` |
| 3 | `otaController.js` | Logic change | Return `device.openclaw_url` instead of `sys_params.server.websocket` |
| 4 | `otaController.js` | Remove | Remove `mqtt` block from OTA response |
| 5 | `deviceController.js` | Logic addition | Copy `openclaw_url` from user profile when binding device |
| 6 | `userRoutes.js` | New endpoints | `GET/PUT /user/openclaw-config` |
| 7 | `deviceController.js` | Minor addition | Allow `openclaw_url` in device update |
| 8 | `deviceController.js` | Minor addition | Include `openclaw_url` in device list/detail response |
| 9 | Dashboard UI | New screen | Step 2 in onboarding: enter OpenClaw URL |
| 10 | Dashboard UI | Optional | "Test Connection" button |

| 11 | `esp32-voice` plugin | New feature | ✅ CHEEKO_PAIR startup registration — already in `voice-endpoint.ts` |
| 12 | `manager-api-node` | New endpoints | Add `/user/openclaw-pair/generate`, `/api/openclaw/pair`, `/user/openclaw-pair/status` |

**Total backend changes: ~8 files, mostly additive. Nothing destructive to existing flows.**
**Plugin side: ✅ already done — `CHEEKO_PAIR` + `CHEEKO_DASHBOARD_URL` env vars are live.**

---

## 8. What the ESP32 Sees (Before vs After)

### Before (LiveKit)
```json
POST /ota/ response:
{
  "websocket": { "url": "ws://192.168.1.99:8000/cheeko/v1/" },
  "mqtt": { "broker": "192.168.1.236", "port": 1883, "client_id": "...", "username": "...", "password": "..." }
}
```
ESP32 connects via MQTT + LiveKit WebSocket.

### After (OpenClaw)
```json
POST /ota/ response:
{
  "websocket": { "url": "ws://192.168.1.10:8765/" }
}
```
ESP32 connects directly to user's OpenClaw esp32-voice plugin via WebSocket.
Same XiaoZhi firmware WebSocket protocol — no firmware changes needed.

---

## 9. Website Onboarding — Full UX Design

### The Core Problem

OpenClaw runs on the **user's own machine** (localhost/LAN).
Your dashboard is **hosted online**.
These two cannot directly talk — your server cannot reach `ws://192.168.1.10:8765/` because it is behind the user's router/firewall.

So the onboarding must work **without your server ever initiating a connection to their machine**.

---

### Recommended Approach — Plugin Calls Home (Option B)

Instead of asking the user to manually type their URL, the OpenClaw plugin registers itself with your dashboard automatically when it starts. The user just approves it.

```
How it works:
  1. Dashboard generates a one-time pairing token (e.g. "XK9-2M4") for this user
  2. User copies a single command shown on screen and runs it on their machine
  3. Plugin starts → reads CHEEKO_PAIR token → calls your dashboard API with its URL
  4. Dashboard receives the registration → marks user as connected
  5. Dashboard screen auto-advances to Step 3 (add device)
```

This is how most IoT platforms work (Tuya, Home Assistant Cloud, etc.) — the device/service calls home, never the other way.

---

### Full 3-Step Onboarding Flow

#### Step 1 — Create Account
```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   🦀  Welcome to Cheeko                              │
│                                                      │
│   Full Name    [_______________________________]     │
│   Email        [_______________________________]     │
│   Password     [_______________________________]     │
│                                                      │
│                    [ Create Account → ]              │
│                                                      │
│   Already have an account? Sign in                   │
└──────────────────────────────────────────────────────┘
```
**Backend:** `POST /user/register` — no change needed.

---

#### Step 2 — Connect Your OpenClaw (NEW SCREEN)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   Step 2 of 3 — Connect Your AI Engine              │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                      │
│   Cheeko uses OpenClaw to power conversations.       │
│   Run this on your Mac or Linux machine:             │
│                                                      │
│   ┌──────────────────────────────────────────────┐  │
│   │  npm install -g openclaw                     │  │
│   │  openclaw plugins install @openclaw/esp32-voice│ │
│   │  CHEEKO_PAIR=XK9-2M4 openclaw gateway        │  │ ← token generated per user session
│   └──────────────────────────────────────────────┘  │
│   [ Copy Command ]                                   │
│                                                      │
│   ⏳  Waiting for your OpenClaw to connect...        │ ← polls GET /user/openclaw-pair/status
│       (this page updates automatically)              │
│                                                      │
│   ──────────────────────────────────────────────    │
│   Already set up? Enter your URL manually:           │
│   ws:// [_____________________________] [ Connect ]  │
│                                                      │
└──────────────────────────────────────────────────────┘

                        ↓ (auto-advances when plugin connects)

┌──────────────────────────────────────────────────────┐
│                                                      │
│   ✅  OpenClaw Connected!                            │
│       ws://192.168.1.10:8765/  ● Online              │
│                                                      │
│                    [ Continue → ]                    │
└──────────────────────────────────────────────────────┘
```

**What happens technically:**
1. Dashboard calls `POST /user/openclaw-pair/generate` → generates `{ token: "XK9-2M4", expiresIn: 600 }`, stores in DB
2. User runs the command → plugin starts with `CHEEKO_PAIR=XK9-2M4`
3. Plugin calls `POST https://your-dashboard.com/api/openclaw/pair` with `{ token: "XK9-2M4", url: "ws://192.168.1.10:8765/" }`
4. Dashboard saves `openclaw_url` to `parent_profile`, marks pairing complete
5. Frontend polling `GET /user/openclaw-pair/status?token=XK9-2M4` sees `{ paired: true, url: "ws://..." }`
6. Screen auto-advances

---

#### Step 3 — Add Your Device (minor wording change only)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   Step 3 of 3 — Add Your Cheeko Device              │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                  │
│                                                      │
│   1. Power on your Cheeko device                    │
│   2. Wait for it to connect to WiFi                 │
│   3. It will speak a 6-digit code                   │
│                                                      │
│   Enter the code your device spoke:                  │
│                                                      │
│   [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ] [ 6 ]              │
│                                                      │
│                    [ Add Device → ]                  │
│                                                      │
│   Device didn't speak a code?  →  Troubleshoot      │
│                                                      │
└──────────────────────────────────────────────────────┘
```
**Backend:** `POST /device/bind/:agentId/:code` — minor change: copy `openclaw_url` from `parent_profile` at bind time (Section 4.4 above).

---

#### Step 4 — Done

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   🎉  Your Cheeko is ready!                          │
│                                                      │
│   Device       Cheeko-A3F2                           │
│   AI Engine    ws://192.168.1.10:8765/  ● Online     │
│   Language     English                               │
│                                                      │
│   Say "Hey Cheeko" to start talking!                 │
│                                                      │
│                 [ Go to Dashboard → ]                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### New Backend Endpoints for Onboarding

#### `POST /user/openclaw-pair/generate`
Generates a one-time pairing token for the logged-in user.

```javascript
// Response:
{
  "ok": true,
  "token": "XK9-2M4",        // shown to user, passed as CHEEKO_PAIR env var
  "expiresIn": 600            // seconds (10 minutes)
}
// Store in DB: openclaw_pair_tokens table or sys_user_token with type='pair'
```

#### `POST /api/openclaw/pair` (called by plugin, no user auth)
Called by the OpenClaw plugin on startup when `CHEEKO_PAIR` is set.

```javascript
// Request (from plugin):
{
  "token": "XK9-2M4",
  "url": "ws://192.168.1.10:8765/",
  "localIp": "192.168.1.10"
}

// Backend logic:
// 1. Look up token in pair_tokens table
// 2. If valid and not expired: save openclaw_url to parent_profile for that user_id
// 3. Mark token as used
// 4. Return { ok: true }
```

#### `GET /user/openclaw-pair/status?token=XK9-2M4`
Polled by frontend every 3 seconds.

```javascript
// Response (waiting):
{ "paired": false }

// Response (connected):
{ "paired": true, "url": "ws://192.168.1.10:8765/" }
```

#### `POST /user/openclaw-config/test` (optional, for manual URL entry)
Backend tries to open a WebSocket to the URL and sends a ping.

```javascript
// Request:
{ "url": "ws://192.168.1.10:8765/" }

// Response (success):
{ "ok": true, "latencyMs": 42 }

// Response (failure):
{ "ok": false, "error": "Connection refused" }
```

---

### Plugin Side — Already Implemented in esp32-voice

`extensions/esp32-voice/src/voice/voice-endpoint.ts` already contains the startup registration. When `CHEEKO_PAIR` is set, the plugin:
1. Detects its LAN IP (prefers en0/en1/eth0/wlan0 — same logic as ota-server.js)
2. POSTs `{ token, url, localIp }` to `POST {CHEEKO_DASHBOARD_URL}/api/openclaw/pair` with a 10-second timeout
3. Logs `✅ Registered with Cheeko dashboard` on success, or a warning with fallback instructions on failure
4. Is non-blocking — the voice server starts normally regardless of dashboard reachability

New env vars needed:
- `CHEEKO_PAIR` — one-time pairing token shown on dashboard Step 2
- `CHEEKO_DASHBOARD_URL` — your dashboard base URL (defaults to `https://cheeko.app`)

---

### What Changes vs What Does Not

| Component | Change needed |
|---|---|
| `manager-api-node` | Add 3 new endpoints (generate, pair, status) |
| `manager-api-node` | Add `openclaw_pair_tokens` table or reuse token table |
| `manager-api-node` | `deviceController.js` — copy openclaw_url at bind time |
| `manager-api-node` | `otaController.js` — return device.openclaw_url in websocket.url |
| `manager-web` (Vue) | Replace Step 2 screen with OpenClaw connect screen |
| `manager-web` (Vue) | Add polling logic on Step 2 |
| `esp32-voice` plugin | ✅ CHEEKO_PAIR startup registration — already implemented in `voice-endpoint.ts` |
| Existing OTP flow | No change |
| Existing user auth | No change |
| Existing device bind | Minor: copy openclaw_url |
| Firmware/ESP32 | No change |

---

### Network Change Consideration

**The user's IP changes when they switch networks** (home → office → hotspot).

The ESP32 fetches `/ota/` on **every boot** — so it always gets the latest `openclaw_url`. If the user's IP changes:
- Plugin re-registers with dashboard on next `openclaw gateway` start (with `CHEEKO_PAIR`)
- Or user manually clicks "Reconnect" in dashboard which regenerates the pairing token
- Device picks up new URL on next boot

This is fine for home/office users. Only an issue if the device needs to reconnect mid-session after a network change — which the XiaoZhi firmware handles by reconnecting via OTA anyway.
