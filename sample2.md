# Cheeko Dashboard — Pages Required for OpenClaw Integration

> This document lists every page/screen that needs to be created or modified
> in `manager-web` (Vue) to support the OpenClaw onboarding flow.

---

## Overview of Pages

| # | Page | Type | Route | Priority |
|---|---|---|---|---|
| 1 | Register | Modify existing | `/register` | P0 |
| 2 | Login | Modify existing | `/login` | P0 |
| 3 | Onboarding — Step 1: Account Created | Modify existing | `/onboarding/step1` | P0 |
| 4 | Onboarding — Step 2: Connect OpenClaw | **NEW** | `/onboarding/step2` | P0 |
| 5 | Onboarding — Step 3: Add Device | Modify existing | `/onboarding/step3` | P0 |
| 6 | Onboarding — Done | Modify existing | `/onboarding/done` | P0 |
| 7 | Dashboard Home | Modify existing | `/dashboard` | P1 |
| 8 | Settings — OpenClaw | **NEW** | `/settings/openclaw` | P1 |
| 9 | Device Detail | Modify existing | `/devices/:id` | P2 |

---

## Page 1 — Register (`/register`) — Minor Modify

**What changes:** Nothing visual. After successful register, redirect to `/onboarding/step2` instead of going straight to device add.

```
[ Existing register form ]
        ↓ on success
/onboarding/step2   ← NEW redirect target
```

**Backend:** `POST /user/register` — no change.

---

## Page 2 — Login (`/login`) — Minor Modify

**What changes:** After login, check if user has `openclaw_url` set in their profile.
- If **yes** → redirect to `/dashboard`
- If **no** → redirect to `/onboarding/step2` (they haven't connected OpenClaw yet)

```javascript
// After login success:
const profile = await getProfile();
if (!profile.openclaw_url) {
  router.push('/onboarding/step2');
} else {
  router.push('/dashboard');
}
```

**Backend:** `GET /user/profile` — add `openclaw_url` to response.

---

## Page 3 — Onboarding Step 1: Account Created (`/onboarding/step1`) — Minor Modify

**What changes:** Progress bar now shows 3 steps instead of 2. Step 2 label changes to "Connect AI Engine".

```
┌──────────────────────────────────────────────┐
│  ① Account ──── ② Connect AI ──── ③ Device  │  ← updated progress bar
│                                              │
│  ✅ Account created successfully!            │
│                                              │
│              [ Next → ]                      │
└──────────────────────────────────────────────┘
```

---

## Page 4 — Onboarding Step 2: Connect OpenClaw (`/onboarding/step2`) — NEW ⭐

This is the most important new page.

### State 1 — Waiting for connection (default)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ① Account ──── ② Connect AI ──── ③ Device         │
│                                                      │
│   Step 2 of 3 — Connect Your AI Engine              │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │
│                                                      │
│   Cheeko uses OpenClaw to power voice conversations. │
│   Run these commands on your Mac or Linux machine:   │
│                                                      │
│   ┌────────────────────────────────────────────────┐ │
│   │  npm install -g openclaw                       │ │
│   │  openclaw channels configure esp32voice        │ │
│   └────────────────────────────────────────────────┘ │
│   [ 📋 Copy ]                                        │
│                                                      │
│   When prompted, paste this pairing token:           │
│   ┌────────────────────────────────────────────────┐ │
│   │  XK9-2M4                          [ 📋 Copy ]  │ │  ← generated per user
│   └────────────────────────────────────────────────┘ │
│                                                      │
│   ⏳  Waiting for your OpenClaw to connect...        │
│      This page updates automatically.                │
│                                                      │
│   ─────────────────────────────────────────────────  │
│   Already set up on another machine?                 │
│   [ Regenerate token ]    [ Skip for now ]           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### State 2 — Connected (auto-advances after polling)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ① Account ──── ② Connect AI ──── ③ Device         │
│                                                      │
│   ✅  OpenClaw Connected!                            │
│                                                      │
│   Voice URL:  ws://192.168.1.10:8765/   ● Online     │
│   Registered: just now                               │
│                                                      │
│                    [ Continue → ]                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### What this page does (frontend logic)

```javascript
// On page load:
// 1. Call backend to generate pairing token
const { token } = await POST('/user/openclaw-pair/generate');
// Shows token + command to user

// 2. Start polling every 3 seconds
const poll = setInterval(async () => {
  const { paired, url } = await GET(`/user/openclaw-pair/status?token=${token}`);
  if (paired) {
    clearInterval(poll);
    showConnectedState(url);    // show ✅ state
    // auto-advance after 2 seconds
    setTimeout(() => router.push('/onboarding/step3'), 2000);
  }
}, 3000);

// 3. Stop polling after 10 minutes (token expires)
setTimeout(() => clearInterval(poll), 600_000);
```

### Backend APIs needed

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/user/openclaw-pair/generate` | Generates pairing token for logged-in user |
| `GET` | `/user/openclaw-pair/status?token=XK9-2M4` | Returns `{ paired: bool, url: string }` |
| `POST` | `/api/openclaw/pair` | Called BY the plugin (no user auth), saves openclaw_url |

---

## Page 5 — Onboarding Step 3: Add Device (`/onboarding/step3`) — Minor Modify

**What changes:** Wording only. Add note that device will auto-connect to their OpenClaw.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ① Account ──── ② Connect AI ──── ③ Device         │
│                                                      │
│   Step 3 of 3 — Add Your Cheeko Device              │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━             │
│                                                      │
│   1. Power on your Cheeko device                    │
│   2. Wait for it to connect to WiFi (~30 sec)       │
│   3. The device will speak a 6-digit code           │
│                                                      │
│   Enter the code your device spoke:                  │
│                                                      │
│   [ _ ] [ _ ] [ _ ] [ _ ] [ _ ] [ _ ]               │
│                                                      │
│                    [ Add Device → ]                  │
│                                                      │
│   Device didn't speak a code?  →  Troubleshoot      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Backend:** `POST /device/bind/:agentId/:code` — minor change: copy `openclaw_url` from user profile at bind time (already documented in OPENCLAW_INTEGRATION.md section 4.4).

---

## Page 6 — Onboarding Done (`/onboarding/done`) — Minor Modify

**What changes:** Show OpenClaw connection status in the summary.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   🎉  Your Cheeko is ready!                          │
│                                                      │
│   Device       Cheeko-A3F2          ● Active         │
│   AI Engine    ws://192.168.1.10    ● Connected      │
│   Language     English                               │
│                                                      │
│   Say "Hey Cheeko" to start talking!                 │
│                                                      │
│                 [ Go to Dashboard → ]                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Page 7 — Dashboard Home (`/dashboard`) — Minor Modify

**What changes:** Add an OpenClaw connection status card/banner.

### If connected:
```
┌─────────────────────────────────────────────────────┐
│  🤖 AI Engine    ws://192.168.1.10:8765/   ● Online  │
│                              [ Settings ]            │
└─────────────────────────────────────────────────────┘
```

### If NOT connected (user skipped Step 2):
```
┌─────────────────────────────────────────────────────┐
│  ⚠️  OpenClaw not connected — your devices won't    │
│     respond to voice commands.                      │
│                    [ Connect Now → ]                 │
└─────────────────────────────────────────────────────┘
```

**Backend:** `GET /user/openclaw-config` — returns `{ openclaw_url, openclaw_token }`.

---

## Page 8 — Settings: OpenClaw (`/settings/openclaw`) — NEW ⭐

Allows the user to reconnect, update, or disconnect their OpenClaw after initial setup.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   OpenClaw Settings                                  │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━                         │
│                                                      │
│   Current Status                                     │
│   Voice URL:  ws://192.168.1.10:8765/   ● Online     │
│   Last seen:  2 minutes ago                          │
│                                                      │
│   ─────────────────────────────────────────────────  │
│                                                      │
│   Reconnect (if your IP changed)                     │
│                                                      │
│   Run this on your machine:                          │
│   ┌────────────────────────────────────────────────┐ │
│   │  openclaw channels configure esp32voice        │ │
│   └────────────────────────────────────────────────┘ │
│   Pairing token: XK9-2M4    [ 📋 Copy ]  [ Refresh ] │
│                                                      │
│   ⏳  Waiting for reconnect...                       │
│                                                      │
│   ─────────────────────────────────────────────────  │
│                                                      │
│   [ Disconnect OpenClaw ]   ← clears openclaw_url   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Backend APIs used:**
- `POST /user/openclaw-pair/generate` — generate new token for reconnect
- `GET /user/openclaw-pair/status` — poll for reconnect
- `PUT /user/openclaw-config` with `{ openclaw_url: null }` — disconnect

---

## Page 9 — Device Detail (`/devices/:id`) — Minor Modify

**What changes:** Show which OpenClaw URL the device is using (inherited from user profile).

```
┌──────────────────────────────────────────────────────┐
│  Device: Cheeko-A3F2                                 │
│                                                      │
│  MAC Address    AA:BB:CC:DD:EE:FF                    │
│  Status         ● Online                             │
│  AI Engine      ws://192.168.1.10:8765/   ← ADD THIS │
│  Last seen      5 minutes ago                        │
│                                                      │
│  [ Update AI Engine URL ]  ← optional, advanced      │
└──────────────────────────────────────────────────────┘
```

**Backend:** `GET /device/:mac` — add `openclaw_url` to response (already in OPENCLAW_INTEGRATION.md section 4.7).

---

## Summary — New vs Modified

| Page | Status | Effort |
|---|---|---|
| `/onboarding/step2` — Connect OpenClaw | 🆕 New | Large |
| `/settings/openclaw` — OpenClaw Settings | 🆕 New | Medium |
| `/register` | ✏️ Modify | Tiny (redirect change) |
| `/login` | ✏️ Modify | Tiny (redirect logic) |
| `/onboarding/step1` | ✏️ Modify | Tiny (progress bar) |
| `/onboarding/step3` | ✏️ Modify | Tiny (wording) |
| `/onboarding/done` | ✏️ Modify | Small (add status row) |
| `/dashboard` | ✏️ Modify | Small (add status card) |
| `/devices/:id` | ✏️ Modify | Tiny (add openclaw_url row) |

---

## Frontend State to Track (Vuex/Pinia store)

```javascript
// Add to user store:
{
  openclaw: {
    url: null,           // ws://192.168.1.10:8765/ or null
    connected: false,    // derived from url being set
    lastSeen: null,      // optional, for display
    pairToken: null,     // current pairing token (ephemeral, in-memory only)
    pairing: false,      // true while polling for pair status
  }
}
```

---

## API Calls Summary for Frontend

| API | Used on page | Purpose |
|---|---|---|
| `POST /user/openclaw-pair/generate` | Step 2, Settings | Get pairing token to show user |
| `GET /user/openclaw-pair/status?token=` | Step 2, Settings | Poll for plugin connection |
| `GET /user/openclaw-config` | Dashboard, Settings | Show current URL |
| `PUT /user/openclaw-config` | Settings | Disconnect (set url to null) |
| `GET /device/:mac` | Device detail | Show per-device openclaw_url |
