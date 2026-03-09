# Manager API Node - API Reference

**Base URL:** `/toy`
**Port:** 8002
**Total Endpoints:** ~200+

---

## Table of Contents

- [Authentication Methods](#authentication-methods)
- [1. Web Dashboard APIs](#1-web-dashboard-apis)
- [2. Mobile App APIs (Firebase)](#2-mobile-app-apis-firebase)
- [3. Mobile App APIs (Legacy Bearer)](#3-mobile-app-apis-legacy-bearer)
- [4. RFID Card APIs](#4-rfid-card-apis)
- [5. Agent / Service APIs (LiveKit Workers)](#5-agent--service-apis-livekit-workers)
- [6. ESP32 Device APIs (Public)](#6-esp32-device-apis-public)
- [7. Admin APIs](#7-admin-apis)
- [8. Super Admin APIs](#8-super-admin-apis)
- [Endpoint Count Summary](#endpoint-count-summary)
- [Response Format](#response-format)

---

## Authentication Methods

| Auth Type | Header | Used By |
|-----------|--------|---------|
| **Bearer Token** | `Authorization: Bearer <token>` | Web dashboard (login session) |
| **Firebase ID Token** | `Authorization: Bearer <firebase_token>` | Mobile app (Firebase Auth) |
| **Service Key** | `X-Service-Key: <key>` | LiveKit agents, media API (backend-to-backend) |
| **Flex Auth** | Bearer OR Service Key | Endpoints shared between web & agents |
| **No Auth** | None | Device registration, OTA, RFID lookups |

---

## 1. Web Dashboard APIs

These endpoints are consumed by the **manager-web** Vue.js admin dashboard. All require `requireAuth` (Bearer token).

### 1.1 User Auth (`/toy/user`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/user/register` | Register new user (public) |
| POST | `/user/login` | Login with captcha (public) |
| POST | `/user/logout` | Logout |
| GET | `/user/captcha` | Get CAPTCHA image (public) |
| PUT | `/user/change-password` | Change password |
| GET | `/user/info` | Get current user info |

### 1.2 Device Management (`/toy/device`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/device/list` | List devices (paginated) |
| GET | `/device/:mac` | Get device by MAC |
| POST | `/device/bind/:agentId/:deviceCode` | Bind device to agent |
| GET | `/device/bind/:agentId` | Get devices by agent |
| POST | `/device/unbind` | Unbind device |
| PUT | `/device/update/:id` | Update device info |
| POST | `/device/manual-add` | Manually add device |
| PUT | `/device/assign-kid/:deviceId` | Assign kid to device |
| PUT | `/device/assign-kid-by-mac` | Assign kid by MAC |

### 1.3 Agent Configuration (`/toy/agent`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/list` | Get all agents |
| GET | `/agent/all` | Get all agents (admin) |
| POST | `/agent` | Create new agent |
| PUT | `/agent/:id` | Update agent |
| DELETE | `/agent/:id` | Delete agent |
| GET | `/agent/:id/devices` | Get devices bound to agent |
| GET | `/agent/mcp/address/:agentId` | Get MCP access point |
| GET | `/agent/mcp/tools/:agentId` | Get MCP tools list |

### 1.4 Agent Templates (`/toy/agent`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/template` | List agent templates |
| POST | `/agent/template` | Create template |
| GET | `/agent/template/:id` | Get template by ID |
| PUT | `/agent/template/:id` | Update template |
| DELETE | `/agent/template/:id` | Delete template |
| POST | `/agent/template/:id/apply-to-agents` | Apply template to agents |

### 1.5 Content Management (`/toy/content`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/content/library` | List content library (paginated) |
| GET | `/content/library/search` | Search content |
| GET | `/content/library/categories` | Get content categories |
| GET | `/content/library/statistics` | Get library statistics |
| GET | `/content/library/:id` | Get content by ID |
| POST | `/content/music/create` | Create music entry |
| PUT | `/content/music/update/:id` | Update music |
| DELETE | `/content/music/delete/:id` | Delete music |
| POST | `/content/story/create` | Create story entry |
| PUT | `/content/story/update/:id` | Update story |
| DELETE | `/content/story/delete/:id` | Delete story |
| POST | `/content/textbook/create` | Create textbook |
| GET | `/content/playlist/music/:deviceId` | Get music playlist for device |
| POST | `/content/playlist/music/:deviceId` | Add music to playlist |
| DELETE | `/content/playlist/music/:deviceId/:contentId` | Remove from playlist |

### 1.6 Model Configuration (`/toy/models`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models/names` | Get all model names |
| GET | `/models/llm/names` | Get LLM model names |
| GET | `/models/:type/provideTypes` | Get provider types for model type |
| GET | `/models/list` | List all models |

### 1.7 System Settings (`/toy/system`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/params/page` | List params (paginated) |
| GET | `/system/params/list` | List all params |
| GET | `/system/params/:id` | Get param by ID |
| GET | `/system/params/code/:code` | Get param by code |
| GET | `/system/dict/type/page` | List dict types (paginated) |
| GET | `/system/dict/type/list` | List all dict types |
| GET | `/system/dict/type/:id` | Get dict type by ID |
| GET | `/system/dict/data/page` | List dict data (paginated) |
| GET | `/system/dict/data/:id` | Get dict data by ID |
| GET | `/system/dict/data/type/:dictType` | Get data by dict type code (public) |

### 1.8 Usage Analytics (`/toy/usage`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/usage/tokens/:macAddress/session/:sessionId` | Get token usage for session |
| GET | `/usage/analytics/daily-summary` | Daily usage summary |
| GET | `/usage/analytics/per-device` | Per-device daily usage |
| GET | `/usage/analytics/totals` | Overall usage totals |

### 1.9 OTA Firmware (`/toy/device/ota`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/device/ota/firmware` | List firmware (paginated) |
| GET | `/device/ota/firmware/all` | List all firmware |
| GET | `/device/ota/firmware/:id` | Get firmware by ID |
| POST | `/device/ota/firmware` | Create firmware record |
| PUT | `/device/ota/firmware/:id` | Update firmware |
| DELETE | `/device/ota/firmware/:id` | Delete firmware |
| PUT | `/device/ota/firmware/:id/force-update` | Set force update flag |

**Count: ~70 endpoints**

---

## 2. Mobile App APIs (Firebase)

These endpoints are consumed by the **Cheeko mobile app**. All require `requireFirebaseAuth` (Firebase ID token).

### 2.1 Parent Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/parent-profile` | Get parent profile |
| POST | `/api/mobile/parent-profile` | Create parent profile |
| PUT | `/api/mobile/parent-profile` | Update parent profile |
| PUT | `/api/mobile/parent-profile/fcm-token` | Update FCM push token |
| DELETE | `/api/mobile/parent-profile/fcm-token` | Remove FCM token |

### 2.2 User State & Onboarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/user-state` | Get user state |
| POST | `/api/mobile/user-state` | Create user state |
| PUT | `/api/mobile/user-state` | Update user state |
| PUT | `/api/mobile/user-state/onboarding-completed` | Mark onboarding complete |

### 2.3 Kids Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/kids` | Get kids list |
| POST | `/api/mobile/kids` | Create kid |
| PUT | `/api/mobile/kids/:id` | Update kid |

### 2.4 Agent Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/agents` | Get agents (paginated) |
| POST | `/api/mobile/agents` | Create agent |
| GET | `/api/mobile/agents/:agentId` | Get agent details |
| PUT | `/api/mobile/agents/:agentId` | Update agent |
| DELETE | `/api/mobile/agents/:agentId` | Delete agent |
| GET | `/api/mobile/agents/:agentId/devices` | Get agent's devices |
| POST | `/api/mobile/agents/:agentId/bind/:deviceCode` | Bind device to agent |

### 2.5 Sessions & Chat History

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/agents/:agentId/sessions` | Get agent sessions |
| GET | `/api/mobile/agents/:agentId/chat-history/:sessionId` | Get chat history |
| GET | `/api/mobile/agents/device/:mac/agent-id` | Get agent ID by device MAC |

### 2.6 Device & Activation

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/mobile/devices/assign-kid-by-mac` | Assign kid to device by MAC |
| GET | `/api/mobile/activation/check-code` | Check activation code |

### 2.7 Account

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/check-email` | Check if email exists |
| DELETE | `/api/mobile/account` | Delete account |

**Count: 26 endpoints**

---

## 3. Mobile App APIs (Legacy Bearer)

Legacy mobile endpoints using Bearer token auth (before Firebase migration). Mounted at `/toy/api/mobile`.

### 3.1 Kid Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/kids/list` | List kid profiles |
| POST | `/api/mobile/kids/create` | Create kid profile |
| GET | `/api/mobile/kids/:id` | Get kid by ID |
| PUT | `/api/mobile/kids/:id` | Update kid |
| DELETE | `/api/mobile/kids/:id` | Delete kid |
| GET | `/api/mobile/kids/:id/progress` | Get learning progress |
| POST | `/api/mobile/kids/:id/progress` | Update learning progress |
| GET | `/api/mobile/kids/:id/activity` | Get activity history |
| POST | `/api/mobile/kids/:id/activity` | Log kid activity (public) |
| GET | `/api/mobile/kids/:id/preferences` | Get kid preferences |
| PUT | `/api/mobile/kids/:id/preferences` | Update kid preferences |

### 3.2 Parent Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mobile/parent` | Get parent profile |
| POST | `/api/mobile/parent` | Create parent profile |
| PUT | `/api/mobile/parent` | Update parent profile |
| DELETE | `/api/mobile/parent` | Delete parent profile |
| GET | `/api/mobile/parent/notifications` | Get notification settings |
| PUT | `/api/mobile/parent/notifications` | Update notification settings |
| POST | `/api/mobile/parent/onboarding/complete` | Mark onboarding complete |
| POST | `/api/mobile/parent/terms/accept` | Accept terms |

**Count: 20 endpoints**

---

## 4. RFID Card APIs

RFID card management for physical card-to-content mappings. These endpoints handle card lookup (used by ESP32 devices via gateway), content association, pack/series management, and RAG-powered semantic search.

### 4.1 Public RFID Lookups (No Auth)

Used by **ESP32 devices** (via mqtt-gateway) and direct lookups.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rfid/card/lookup/:rfidUid` | Lookup card content by RFID UID |
| POST | `/admin/rfid/card/rag-lookup/:rfidUid` | RAG-powered card lookup (semantic search) |
| GET | `/admin/rfid/series/lookup/:uid` | Lookup series by UID |
| GET | `/admin/rfid/pack/active` | Get active packs |
| GET | `/admin/rfid/pack/age/:age` | Get packs by age group |

### 4.2 RFID Card CRUD (requireAdmin)

Used by **admin dashboard** for managing card mappings.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rfid/card/page` | List card mappings (paginated) |
| GET | `/admin/rfid/card/list` | List all card mappings |
| GET | `/admin/rfid/mapping/options` | Get available mapping options |
| GET | `/admin/rfid/card/uid/:rfidUid` | Get card by RFID UID (admin detail) |
| GET | `/admin/rfid/card/pack/:packCode` | Get cards by pack code |
| GET | `/admin/rfid/card/question/:questionId` | Get cards by question ID |
| GET | `/admin/rfid/card/:id` | Get card by ID |
| POST | `/admin/rfid/card` | Create card mapping |
| PUT | `/admin/rfid/card` | Update card mapping |
| DELETE | `/admin/rfid/card` | Delete card mappings |
| POST | `/admin/rfid/card/delete` | Delete card mappings (POST) |

### 4.3 RFID Pack Management (requireAdmin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rfid/pack/page` | List packs (paginated) |
| GET | `/admin/rfid/pack/list` | List all packs |
| GET | `/admin/rfid/pack/code/:packCode` | Get pack by code |
| GET | `/admin/rfid/pack/:id` | Get pack by ID |
| POST | `/admin/rfid/pack` | Create pack |
| PUT | `/admin/rfid/pack` | Update pack |
| DELETE | `/admin/rfid/pack` | Delete packs |
| POST | `/admin/rfid/pack/delete` | Delete packs (POST) |

### 4.4 RFID Series Management (requireAdmin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/rfid/series/page` | List series (paginated) |

### 4.5 RFID RAG Search (requireAuth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/rfid/rag/search` | RAG semantic search across RFID content |

**Count: 26 endpoints**

---

## 5. Agent / Service APIs (LiveKit Workers)

These endpoints are consumed by **LiveKit agents**, **mqtt-gateway**, and **media API** for backend-to-backend communication.

### 5.1 Config Endpoints (`/toy/config`) — No Auth (internal network)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/config/server-base` | Get server-side base config |
| POST | `/config/agent-models` | Get agent models for device |
| POST | `/config/agent-prompt` | Get agent prompt by MAC |
| POST | `/config/child-profile-by-mac` | Get child profile by device MAC |
| POST | `/config/agent-template-id` | Get agent template ID by MAC |
| GET | `/config/template/:templateId` | Get template content (personality) |
| POST | `/config/device-location` | Get device location info |
| POST | `/config/weather` | Get weather forecast |
| POST | `/config/assign-child-profile` | Create & assign child profile (requires secret header) |

### 5.2 Agent Endpoints — No Auth (called by gateway/workers)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agent/prompt/:mac` | Get agent prompt by MAC |
| GET | `/agent/config/:mac` | Get full agent config by MAC |
| GET | `/agent/agent-id/:mac` | Get agent ID by MAC |
| GET | `/agent/device/:mac/agent-id` | Get agent ID (gateway alias) |
| GET | `/agent/current-character/:mac` | Get current character |
| GET | `/agent/device/:mac/current-character` | Get current character (gateway alias) |
| POST | `/agent/device/:mac/set-character` | Set character (gateway) |
| POST | `/agent/device/:mac/cycle-character` | Cycle character (gateway) |
| POST | `/agent/chat-message` | Add chat message |
| POST | `/agent/chat-history/report` | Report chat message |
| POST | `/agent/chat-history/session` | Batch upload session |
| PUT | `/agent/saveMemory/:mac` | Save agent memory |
| PUT | `/agent/update-mode` | Update agent mode |
| GET | `/agent/device/:mac/agent-name` | Get agent name |
| POST | `/agent/cycle-character/:mac` | Cycle character (legacy) |
| POST | `/agent/set-character/:mac/:agentId` | Set character (legacy) |

### 5.3 Analytics — requireServiceKey

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analytics/session/start` | Start game session |
| POST | `/analytics/session/end` | End game session |
| POST | `/analytics/game-attempt` | Log game attempt |
| POST | `/analytics/media-event` | Log media playback event |
| POST | `/analytics/streak` | Log streak |

### 5.4 Analytics — requireFlexAuth (Bearer or ServiceKey)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics/user/:mac/overall` | Get overall stats for device |
| GET | `/analytics/user/:mac/math` | Get math game stats |
| GET | `/analytics/user/:mac/riddle` | Get riddle game stats |
| GET | `/analytics/user/:mac/wordladder` | Get word ladder stats |
| GET | `/analytics/sessions/:mac` | Get sessions for device |
| GET | `/analytics/usage/daily/:mac` | Get daily usage |
| GET | `/analytics/usage/weekly/:mac` | Get weekly usage |
| GET | `/analytics/usage/monthly/:mac` | Get monthly usage |

**Count: ~34 endpoints**

---

## 6. ESP32 Device APIs (Public)

These endpoints require **no authentication**. Used by ESP32 devices directly.

### 6.1 Health Checks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/health/db` | Database health check |
| GET | `/pub-config` | Public configuration |

### 6.2 Device Registration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/device/register` | Register device (ESP32 first boot) |
| POST | `/device/:mac/cycle-mode` | Cycle device mode (conversation/music/story) |
| GET | `/device/:mac/mode` | Get device mode |
| GET | `/device/:mac/device-mode` | Get device PTT mode (manual/vad) |

### 6.3 OTA Firmware Updates

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/device/ota/check` | Check OTA firmware version |
| GET | `/device/ota/firmware/latest/:type` | Get latest firmware by type |
| POST | `/ota/` | OTA version & activation check |
| POST | `/ota/activate` | Device quick activation |
| GET | `/ota/` | Get OTA status |
| GET | `/otaMag/download/:uuid` | Download firmware file |

### 6.4 Content (Public Read)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/content/music/list` | Get music list |
| GET | `/content/music/:id` | Get music by ID |
| GET | `/content/story/list` | Get story list |
| GET | `/content/story/:id` | Get story by ID |
| GET | `/content/textbook/list` | Get textbook list |
| GET | `/content/textbook/:id` | Get textbook by ID |

### 6.5 Password Recovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/user/update-password` | Reset password (recovery) |
| PUT | `/user/retrieve-password` | Alias for password reset |
| DELETE | `/user/delete-account` | Delete user account |
| POST | `/user/smsVerification` | Send SMS verification |
| GET | `/user/pub-config` | Get public config |

### 6.6 Other Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/dict/data/type/:dictType` | Get dict data by type code |

**Count: ~25 endpoints**

---

## 7. Admin APIs

These endpoints require `requireAuth` + `requireAdmin`. Used by admin users in the web dashboard.

### 7.1 Content Upload (`/toy/content`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/content/library` | Create content item |
| POST | `/content/library/upload` | Upload content file |
| POST | `/content/library/batch` | Batch create content |
| PUT | `/content/library/:id` | Update content item |
| DELETE | `/content/library/:id` | Delete content item |

### 7.2 Model Management (`/toy/models`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/models/:type/:provider` | Create model |
| PUT | `/models/:type/:provider/:id` | Update model |
| DELETE | `/models/:id` | Delete model |

### 7.3 System Settings (`/toy/system`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/system/params` | Create param |
| PUT | `/system/params/:id` | Update param |
| DELETE | `/system/params/:id` | Delete param |
| DELETE | `/system/params` | Batch delete params |
| POST | `/system/dict/type` | Create dict type |
| PUT | `/system/dict/type/:id` | Update dict type |
| DELETE | `/system/dict/type/:id` | Delete dict type |
| DELETE | `/system/dict/type` | Batch delete dict types |
| POST | `/system/dict/data` | Create dict data |
| PUT | `/system/dict/data/:id` | Update dict data |
| DELETE | `/system/dict/data/:id` | Delete dict data |
| DELETE | `/system/dict/data` | Batch delete dict data |

### 7.4 OTA Firmware Management (`/toy/otaMag`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/otaMag/` | List firmware (paginated) |
| POST | `/otaMag/` | Create firmware entry |
| GET | `/otaMag/:id` | Get firmware by ID |
| PUT | `/otaMag/:id` | Update firmware |
| DELETE | `/otaMag/:id` | Delete firmware |
| PUT | `/otaMag/forceUpdate/:id` | Set force update flag |
| GET | `/otaMag/getDownloadUrl/:id` | Get download link |
| POST | `/otaMag/upload` | Upload firmware file |

### 7.5 Server Management (`/toy/admin/server`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/server/server-list` | Get WebSocket server list |
| POST | `/admin/server/emit-action` | Notify workers to update config |
| GET | `/admin/server/health` | Server health status |

### 7.6 Dictionary Management (`/toy/admin/dict`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/dict/type/page` | List dict types (paginated) |
| GET | `/admin/dict/type/:id` | Get dict type by ID |
| POST | `/admin/dict/type/save` | Create dict type |
| PUT | `/admin/dict/type/update` | Update dict type |
| POST | `/admin/dict/type/delete` | Delete dict type(s) |
| GET | `/admin/dict/data/page` | List dict data (paginated) |
| GET | `/admin/dict/data/:id` | Get dict data by ID |
| GET | `/admin/dict/data/type/:dictType` | Get data by type code |
| POST | `/admin/dict/data/save` | Create dict data |
| PUT | `/admin/dict/data/update` | Update dict data |
| POST | `/admin/dict/data/delete` | Delete dict data |

### 7.7 TTS Voice Management (`/toy/ttsVoice`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ttsVoice/` | List TTS voices (paginated) |
| POST | `/ttsVoice/` | Create voice/timbre |
| PUT | `/ttsVoice/:id` | Update voice/timbre |
| POST | `/ttsVoice/delete` | Delete voice(s) |

**Count: ~42 endpoints**

---

## 8. Super Admin APIs

These endpoints require `requireAuth` + `requireSuperAdmin`. Restricted to super admin users.

### 8.1 User Management (`/toy/admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/users/page` | List users (paginated) |
| GET | `/admin/users/list` | List all users |
| GET | `/admin/users/:id` | Get user by ID |
| POST | `/admin/users` | Create user |
| PUT | `/admin/users/:id` | Update user |
| DELETE | `/admin/users/:id` | Delete user |
| DELETE | `/admin/users` | Batch delete users |
| PUT | `/admin/users/:id/status` | Update user status |
| PUT | `/admin/users/:id/password` | Reset user password |
| PUT | `/admin/users/:id/super-admin` | Set super admin flag |

### 8.2 Statistics (`/toy/admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/stats/overview` | System overview stats |
| GET | `/admin/stats/users` | User registration stats |
| GET | `/admin/stats/devices` | Device registration stats |
| GET | `/admin/stats/content` | Content stats |
| GET | `/admin/stats/sessions` | Session stats |
| GET | `/admin/stats/tokens` | Token usage stats |
| GET | `/admin/stats/active` | Active sessions |

### 8.3 Parameters (`/toy/admin/params`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/params/page` | List params (paginated) |
| GET | `/admin/params/:id` | Get param by ID |
| POST | `/admin/params` | Create param |
| PUT | `/admin/params` | Update param |
| POST | `/admin/params/delete` | Delete param(s) |

### 8.4 Email Reports (`/toy/admin/email-reports`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/email-reports/config` | Get email report config |
| PUT | `/admin/email-reports/config` | Update email report config |
| POST | `/admin/email-reports/test` | Send test email |
| GET | `/admin/email-reports/history` | Get email send history |
| GET | `/admin/email-reports/preview` | Preview report HTML |
| POST | `/admin/email-reports/generate` | Manually generate & send report |

**Count: ~28 endpoints**

---

## Endpoint Count Summary

| Category | Auth | Count |
|----------|------|-------|
| Web Dashboard | Bearer Token | ~70 |
| Mobile App (Firebase) | Firebase ID Token | 26 |
| Mobile App (Legacy) | Bearer Token | 20 |
| RFID Card APIs | Mixed (public + admin) | 26 |
| Agent / Service (LiveKit) | Service Key / No Auth | ~34 |
| ESP32 Device (Public) | No Auth | ~25 |
| Admin | Bearer + Admin | ~42 |
| Super Admin | Bearer + Super Admin | ~28 |
| **Total** | | **~270+** |

---

## Response Format

All responses follow this standard format:

**Success:**
```json
{
  "code": 0,
  "msg": "success",
  "data": { }
}
```

**Paginated:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

**Error:**
```json
{
  "code": 400,
  "msg": "Error message",
  "data": null
}
```
