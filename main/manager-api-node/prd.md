# Cheeko Manager API (Node.js) - Missing APIs PRD

## Overview

This document lists the APIs missing from the Node.js port of the Spring Boot manager-api. The Node.js version currently has ~209 endpoints while the Spring Boot version has ~270+ endpoints.

## Target Audience

Backend developers completing the migration from Spring Boot/MySQL to Node.js/Express/Supabase.

## Missing APIs by Module

---

## 1. Agent Templates (`/agent/template`)

**Priority: HIGH** - Used for agent character management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/agent/template` | Get agent templates list |
| POST | `/toy/agent/template` | Create agent template |
| PUT | `/toy/agent/template/{id}` | Update agent template |

**Service Methods Needed:**
- `getTemplates()` - List all visible templates
- `createTemplate(data)` - Create new template
- `updateTemplate(id, data)` - Update template

---

## 2. Agent Memory & Mode (`/agent`)

**Priority: HIGH** - Used by LiveKit workers

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/toy/agent/saveMemory/{macAddress}` | Update agent summary memory by device MAC |
| PUT | `/toy/agent/update-mode` | Update agent mode from template |
| GET | `/toy/agent/device/{macAddress}/agent-name` | Get agent name for game mode detection |

---

## 3. Agent Chat History (`/agent/chat-history`)

**Priority: HIGH** - Used by LiveKit workers for session logging

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/toy/agent/chat-history/report` | Single message report (cheeko service) |
| POST | `/toy/agent/chat-history/session` | Batch upload all session messages (LiveKit) |
| GET | `/toy/agent/{id}/chat-history/user` | Get recent 50 chat messages (mobile app) |
| GET | `/toy/agent/{id}/chat-history/audio` | Get audio content by audio ID |

---

## 4. Agent MCP Access Points (`/agent/mcp`)

**Priority: MEDIUM** - For MCP tool integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/agent/mcp/address/{agentId}` | Get agent MCP access point URL |
| GET | `/toy/agent/mcp/tools/{agentId}` | Get agent MCP tools list |

**Database Table:** `ai_agent_mcp_access_point` (already in Prisma schema)

---

## 5. Configuration Endpoints (`/config`)

**Priority: HIGH** - Used by LiveKit workers for device configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/toy/config/server-base` | Get server-side configuration |
| POST | `/toy/config/agent-models` | Get agent models for device |
| POST | `/toy/config/agent-prompt` | Get agent prompt by MAC address |
| POST | `/toy/config/child-profile-by-mac` | Get child profile by device MAC |
| POST | `/toy/config/agent-template-id` | Get agent template ID by MAC |
| GET | `/toy/config/template/{templateId}` | Get template content (personality) |
| POST | `/toy/config/device-location` | Get device location info |
| POST | `/toy/config/weather` | Get weather forecast by location |

**Note:** Some of these may overlap with existing `/agent/config/:mac` - consolidate as needed.

---

## 6. Model Providers (`/models/provider`)

**Priority: MEDIUM** - Admin management of AI providers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/models/provider` | Get provider list with pagination |
| POST | `/toy/models/provider` | Add model provider |
| PUT | `/toy/models/provider` | Edit model provider |
| POST | `/toy/models/provider/delete` | Delete model provider |
| GET | `/toy/models/provider/plugin/names` | Get plugin name list |

**Database Table:** `ai_model_provider` (already in Prisma schema)

---

## 7. Model Voices (`/models`)

**Priority: MEDIUM** - TTS voice management by model

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/models/{modelId}/voices` | Get voices for specific TTS model |

---

## 8. Extended Analytics (`/analytics`)

**Priority: HIGH** - Dashboard and reporting

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/analytics/user/{macAddress}/media` | Get music/story playback stats |
| POST | `/toy/analytics/user-progress/update` | Update aggregated user progress |
| GET | `/toy/analytics/session-by-id/{id}` | Get session by ID |
| GET | `/toy/analytics/sessions` | Get sessions with filters and pagination |
| GET | `/toy/analytics/attempts/{id}` | Get game attempt by ID |
| GET | `/toy/analytics/attempts` | Get attempts list with pagination |
| GET | `/toy/analytics/media-playback/{id}` | Get media playback by ID |
| GET | `/toy/analytics/media-playback` | Get media playback list with pagination |
| GET | `/toy/analytics/streaks/{id}` | Get streak by ID |
| GET | `/toy/analytics/streaks` | Get streaks list with pagination |
| GET | `/toy/analytics/user-progress/{macAddress}/{modeType}` | Get user progress by mode |
| GET | `/toy/analytics/user-progress/{macAddress}` | Get all user progress for MAC |
| GET | `/toy/analytics/attempts/stats/{macAddress}` | Get attempt statistics by question type |
| GET | `/toy/analytics/today/device-count` | Count devices interacted today |
| GET | `/toy/analytics/month/device-count` | Count devices interacted this month |
| GET | `/toy/analytics/today/active-devices` | List active devices today |
| GET | `/toy/analytics/month/active-devices` | List active devices this month |

---

## 9. Token Usage Analytics (`/usage`)

**Priority: MEDIUM** - Currently under `/device/token-usage`, need to add analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/usage/tokens/{macAddress}/session/{sessionId}` | Get usage for specific session |
| GET | `/toy/usage/analytics/daily-summary` | Get daily usage summary across devices |
| GET | `/toy/usage/analytics/per-device` | Get per-device daily usage |
| GET | `/toy/usage/analytics/totals` | Get overall totals across all devices |

**Note:** Consider keeping current paths or adding aliases for backwards compatibility.

---

## 10. OTA Activation (`/ota`)

**Priority: HIGH** - Device activation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/toy/ota/` | OTA version and activation check |
| POST | `/toy/ota/activate` | Device quick activation check |
| GET | `/toy/ota/` | Get OTA status |

**Note:** Current Node.js has `/device/ota/*` - add `/ota/` aliases for Spring Boot compatibility.

---

## 11. OTA Management (`/otaMag`)

**Priority: MEDIUM** - Admin firmware management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/otaMag` | Paginated OTA firmware query |
| GET | `/toy/otaMag/{id}` | Get OTA firmware info |
| POST | `/toy/otaMag` | Save OTA firmware info |
| DELETE | `/toy/otaMag/{id}` | Delete OTA firmware |
| PUT | `/toy/otaMag/{id}` | Update OTA firmware info |
| PUT | `/toy/otaMag/forceUpdate/{id}` | Set firmware force update |
| GET | `/toy/otaMag/getDownloadUrl/{id}` | Get OTA firmware download link |
| GET | `/toy/otaMag/download/{uuid}` | Download firmware file |
| POST | `/toy/otaMag/upload` | Upload firmware file |

---

## 12. Server Management (`/admin/server`)

**Priority: LOW** - Admin server management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/admin/server/server-list` | Get WebSocket server list |
| POST | `/toy/admin/server/emit-action` | Notify Python server to update config |

---

## 13. Password Recovery (`/user`)

**Priority: MEDIUM** - User account recovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/toy/user/retrieve-password` | Retrieve/reset forgotten password |

---

## 14. Extended RFID Series (`/admin/rfid/series`)

**Priority: MEDIUM** - RFID range management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/admin/rfid/series/active` | List all active series |
| GET | `/toy/admin/rfid/series/find/{uid}` | Find all series containing UID |
| GET | `/toy/admin/rfid/series/pack/{packId}` | Get series by pack ID |
| GET | `/toy/admin/rfid/series/question/{questionId}` | Get series by question ID |

---

## 15. RFID Questions (`/admin/rfid/question`)

**Priority: HIGH** - RFID question management (MISSING ENTIRELY)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/admin/rfid/question/page` | Paginated question query |
| GET | `/toy/admin/rfid/question/list` | List all questions |
| GET | `/toy/admin/rfid/question/{id}` | Get question by ID |
| GET | `/toy/admin/rfid/question/code/{code}` | Get question by code |
| GET | `/toy/admin/rfid/question/category/{category}` | Get questions by category |
| GET | `/toy/admin/rfid/question/language/{language}` | Get questions by language |
| POST | `/toy/admin/rfid/question` | Create question |
| PUT | `/toy/admin/rfid/question` | Update question |
| DELETE | `/toy/admin/rfid/question` | Delete questions |

**Database Table:** `rfid_question` (already in Prisma schema)

---

## 16. Content Items (`/content/items`)

**Priority: MEDIUM** - Generic content CRUD (more complete than current)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/toy/content/items` | Create single content item |
| POST | `/toy/content/items/batch` | Batch create content items |
| GET | `/toy/content/items` | Get all content items with pagination |
| GET | `/toy/content/items/{id}` | Get content item by ID |
| GET | `/toy/content/items/type/{contentType}` | Get items by type |
| GET | `/toy/content/items/category/{category}` | Get items by category |
| GET | `/toy/content/items/search` | Full-text search content items |
| GET | `/toy/content/items/categories` | Get categories by type |
| GET | `/toy/content/items/statistics` | Get content statistics |
| PUT | `/toy/content/items/{id}` | Update content item |
| PATCH | `/toy/content/items/{id}` | Partial update content item |
| PUT | `/toy/content/items/batch` | Batch update content items |
| DELETE | `/toy/content/items/{id}` | Delete content item |
| DELETE | `/toy/content/items/batch` | Batch delete content items |

---

## 17. Device Playlists (Spring Boot Path Compatibility)

**Priority: HIGH** - ESP32 devices expect this path format

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/toy/device/{macAddress}/playlist/music` | Get music playlist |
| POST | `/toy/device/{macAddress}/playlist/music` | Add songs to playlist |
| PUT | `/toy/device/{macAddress}/playlist/music` | Replace entire playlist |
| PATCH | `/toy/device/{macAddress}/playlist/music/reorder` | Reorder playlist |
| DELETE | `/toy/device/{macAddress}/playlist/music/{contentId}` | Remove song |
| DELETE | `/toy/device/{macAddress}/playlist/music` | Clear playlist |
| GET | `/toy/device/{macAddress}/playlist/story` | Get story playlist |
| POST | `/toy/device/{macAddress}/playlist/story` | Add stories to playlist |
| PUT | `/toy/device/{macAddress}/playlist/story` | Replace entire playlist |
| PATCH | `/toy/device/{macAddress}/playlist/story/reorder` | Reorder playlist |
| DELETE | `/toy/device/{macAddress}/playlist/story/{contentId}` | Remove story |
| DELETE | `/toy/device/{macAddress}/playlist/story` | Clear playlist |

**Note:** Current Node.js has `/content/playlist/*` - add device path aliases.

---

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL) via Prisma ORM
- **Authentication:** Supabase Auth + Service Key for backend calls

---

## Database Migrations Required

All tables already exist in `prisma/schema.prisma`. No new migrations needed.

---

## Success Criteria

1. All endpoints from Spring Boot have Node.js equivalents
2. Request/response formats match Spring Boot API
3. All endpoints pass integration tests
4. LiveKit workers can use Node.js API as drop-in replacement

---

## Task List

```json
[
  {
    "category": "feature",
    "description": "Add Agent Template CRUD endpoints (/agent/template)",
    "steps": [
      "Create template routes in agent.routes.js",
      "Add getTemplates, createTemplate, updateTemplate to agent.service.js",
      "Test with Swagger"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Agent Memory and Mode endpoints",
    "steps": [
      "Add PUT /agent/saveMemory/:mac endpoint",
      "Add PUT /agent/update-mode endpoint",
      "Add GET /agent/device/:mac/agent-name endpoint"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Agent Chat History batch endpoints",
    "steps": [
      "Add POST /agent/chat-history/report for single message",
      "Add POST /agent/chat-history/session for batch upload",
      "Add GET /agent/:id/chat-history/user for recent messages",
      "Add GET /agent/:id/chat-history/audio for audio content"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Agent MCP Access Point endpoints (/agent/mcp)",
    "steps": [
      "Create mcp routes in agent.routes.js",
      "Add getMcpAddress, getMcpTools to agent.service.js",
      "Test MCP integration"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Configuration endpoints (/config)",
    "steps": [
      "Create config.routes.js",
      "Create config.service.js",
      "Add all /config/* endpoints",
      "Test with LiveKit worker"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Model Provider CRUD endpoints (/models/provider)",
    "steps": [
      "Add provider routes to model.routes.js",
      "Add provider CRUD methods to model.service.js",
      "Test with Swagger"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Extended Analytics endpoints",
    "steps": [
      "Add media stats endpoint",
      "Add user-progress endpoints",
      "Add session/attempt/streak individual getters",
      "Add today/month device count endpoints"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Token Usage Analytics endpoints",
    "steps": [
      "Add session-specific usage endpoint",
      "Add daily-summary, per-device, totals analytics",
      "Consider adding /usage/* aliases for compatibility"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add OTA root endpoints (/ota/)",
    "steps": [
      "Create ota.routes.js for root /ota/ endpoints",
      "Add POST /ota/ for version check",
      "Add POST /ota/activate for activation",
      "Add GET /ota/ for status"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add OTA Management endpoints (/otaMag)",
    "steps": [
      "Create otaMag routes",
      "Add firmware CRUD with upload/download",
      "Add forceUpdate endpoint",
      "Test file upload"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add RFID Question CRUD endpoints (/admin/rfid/question)",
    "steps": [
      "Create question routes in rfid.routes.js",
      "Add question CRUD methods to rfid.service.js",
      "Add pagination and filtering"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add Extended RFID Series endpoints",
    "steps": [
      "Add /series/active endpoint",
      "Add /series/find/:uid endpoint",
      "Add /series/pack/:packId endpoint",
      "Add /series/question/:questionId endpoint"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Add Content Items CRUD endpoints (/content/items)",
    "steps": [
      "Create content-items routes",
      "Add full CRUD with batch operations",
      "Add search and filter endpoints"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Add Device Playlist path aliases",
    "steps": [
      "Add /device/:mac/playlist/music routes",
      "Add /device/:mac/playlist/story routes",
      "Reuse existing playlist service methods"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Add Password Recovery endpoint",
    "steps": [
      "Add PUT /user/retrieve-password endpoint",
      "Implement password reset logic"
    ],
    "passes": false
  },
  {
    "category": "feature",
    "description": "Add Server Management endpoints (/admin/server)",
    "steps": [
      "Create server.routes.js",
      "Add server-list and emit-action endpoints"
    ],
    "passes": false
  },
  {
    "category": "testing",
    "description": "Integration test all new endpoints",
    "steps": [
      "Test each endpoint with sample data",
      "Verify response format matches Spring Boot",
      "Test with LiveKit worker"
    ],
    "passes": false
  }
]
```

---

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. Complete all steps for that task
4. Verify endpoint works via Swagger at http://127.0.0.1:8002/toy/doc.html
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria

All tasks marked with `"passes": true`
