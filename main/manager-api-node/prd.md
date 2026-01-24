# Manager API Node.js - API Compatibility Testing PRD

## Overview
Systematic testing and fixing of the Node.js manager-api-node to ensure full compatibility with the Vue.js manager-web frontend. Compare API responses with the Spring Boot manager-api (reference) and fix any differences.

## Target Audience
- The manager-web Vue.js frontend application
- Developers maintaining the Cheeko backend
- ESP32 devices connecting via OTA endpoints

## Reference Setup
- **Node.js API**: http://localhost:8002/toy (being tested/fixed)
- **Spring Boot API**: http://localhost:8003/toy (reference for expected behavior)
- **Frontend**: main/manager-web Vue.js application

## Tech Stack
- **Backend**: Node.js/Express.js
- **Database**: Supabase (PostgreSQL) with Prisma ORM
- **Authentication**: JWT tokens via custom auth middleware
- **API Documentation**: Swagger/OpenAPI at /toy/doc.html

## Success Criteria
All manager-web frontend features work correctly with the Node.js API, matching Spring Boot behavior exactly.

---

## Task List

```json
[
  {
    "id": 1,
    "category": "setup",
    "description": "Start manager-web frontend and verify connection to Node.js API",
    "steps": [
      "Navigate to main/manager-web directory",
      "Run npm install if needed",
      "Check .env.development or vue.config.js for API URL configuration",
      "Update to point to http://localhost:8002/toy if needed",
      "Run npm run serve to start the frontend",
      "Verify frontend loads at http://localhost:8080 without errors"
    ],
    "passes": true
  },
  {
    "id": 2,
    "category": "auth",
    "description": "Test and fix POST /user/login endpoint",
    "endpoints": ["POST /user/login"],
    "steps": [
      "Test login on Spring Boot: curl -X POST http://localhost:8003/toy/user/login -d '{...}'",
      "Test login on Node.js: curl -X POST http://localhost:8002/toy/user/login -d '{...}'",
      "Compare response structures (fields, format, status codes)",
      "Fix any differences in auth.service.js or auth.routes.js",
      "Verify login works in frontend"
    ],
    "passes": true
  },
  {
    "id": 3,
    "category": "auth",
    "description": "Test and fix GET /user/info endpoint",
    "endpoints": ["GET /user/info"],
    "steps": [
      "Test on both APIs with auth token",
      "Compare response fields and format",
      "Fix any differences",
      "Verify user info displays correctly in frontend header"
    ],
    "passes": true
  },
  {
    "id": 4,
    "category": "auth",
    "description": "Test and fix GET /user/pub-config endpoint",
    "endpoints": ["GET /user/pub-config"],
    "steps": [
      "Test on both APIs",
      "Compare response structure",
      "This endpoint provides public system configuration",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 5,
    "category": "admin",
    "description": "Test and fix GET /admin/users pagination endpoint",
    "endpoints": ["GET /admin/users?page=1&limit=10"],
    "steps": [
      "Test user listing on both APIs",
      "Compare pagination format (page, limit, total, list)",
      "Compare user object fields",
      "Fix any differences",
      "Verify user management page works in frontend"
    ],
    "passes": true
  },
  {
    "id": 6,
    "category": "admin",
    "description": "Test and fix admin user CRUD operations",
    "endpoints": [
      "DELETE /admin/users/{id}",
      "PUT /admin/users/{id}",
      "PUT /admin/users/changeStatus/{status}"
    ],
    "steps": [
      "Test delete user on both APIs",
      "Test reset password on both APIs",
      "Test change status on both APIs",
      "Fix any response format differences"
    ],
    "passes": true
  },
  {
    "id": 7,
    "category": "admin",
    "description": "Test and fix GET /admin/params/page endpoint",
    "endpoints": ["GET /admin/params/page?page=1&limit=10"],
    "steps": [
      "Test params listing on both APIs",
      "Compare pagination and field formats",
      "Fix any differences",
      "Verify system parameters page works"
    ],
    "passes": true
  },
  {
    "id": 8,
    "category": "admin",
    "description": "Test and fix params CRUD operations",
    "endpoints": [
      "POST /admin/params",
      "PUT /admin/params",
      "POST /admin/params/delete"
    ],
    "steps": [
      "Test create param on both APIs",
      "Test update param on both APIs",
      "Test delete param on both APIs",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 9,
    "category": "admin",
    "description": "Test and fix dictionary type endpoints",
    "endpoints": [
      "GET /admin/dict/type/page",
      "GET /admin/dict/type/{id}",
      "POST /admin/dict/type/save",
      "PUT /admin/dict/type/update",
      "POST /admin/dict/type/delete"
    ],
    "steps": [
      "Test dict type listing and CRUD on both APIs",
      "Compare response formats",
      "Fix any differences",
      "Verify dictionary management page works"
    ],
    "passes": true
  },
  {
    "id": 10,
    "category": "admin",
    "description": "Test and fix dictionary data endpoints",
    "endpoints": [
      "GET /admin/dict/data/page",
      "GET /admin/dict/data/{id}",
      "GET /admin/dict/data/type/{dictType}",
      "POST /admin/dict/data/save",
      "PUT /admin/dict/data/update",
      "POST /admin/dict/data/delete"
    ],
    "steps": [
      "Test dict data listing and CRUD on both APIs",
      "Test getting data by dict type",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 11,
    "category": "device",
    "description": "Test and fix GET /device/bind/{agentId} endpoint",
    "endpoints": ["GET /device/bind/{agentId}"],
    "steps": [
      "Test getting devices bound to agent on both APIs",
      "Compare response format (list of devices)",
      "Fix any differences",
      "Verify device list displays correctly in frontend"
    ],
    "passes": true
  },
  {
    "id": 12,
    "category": "device",
    "description": "Test and fix device bind/unbind operations",
    "endpoints": [
      "POST /device/bind/{agentId}/{deviceCode}",
      "POST /device/unbind"
    ],
    "steps": [
      "Test binding device with activation code on both APIs",
      "Test unbinding device on both APIs",
      "Compare response formats",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 13,
    "category": "device",
    "description": "Test and fix device update and manual add",
    "endpoints": [
      "PUT /device/update/{id}",
      "POST /device/manual-add"
    ],
    "steps": [
      "Test device update on both APIs",
      "Test manual device addition on both APIs",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 14,
    "category": "device",
    "description": "Test and fix GET /admin/device/all endpoint",
    "endpoints": ["GET /admin/device/all?page=1&limit=10"],
    "steps": [
      "Test admin device listing on both APIs",
      "Compare pagination and device object format",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 15,
    "category": "agent",
    "description": "Test and fix agent listing endpoints",
    "endpoints": [
      "GET /agent/all",
      "GET /agent/list"
    ],
    "steps": [
      "Test /agent/all (admin view) on both APIs",
      "Test /agent/list (user's agents) on both APIs",
      "Compare response formats",
      "Fix any differences",
      "Verify agent list displays correctly in frontend"
    ],
    "passes": true
  },
  {
    "id": 16,
    "category": "agent",
    "description": "Test and fix agent CRUD operations",
    "endpoints": [
      "GET /agent/{agentId}",
      "POST /agent",
      "PUT /agent/{agentId}",
      "DELETE /agent/{agentId}"
    ],
    "steps": [
      "Test getting single agent on both APIs",
      "Test create, update, delete on both APIs",
      "Compare response formats for each",
      "Fix any differences",
      "Verify agent config page works in frontend"
    ],
    "passes": true
  },
  {
    "id": 17,
    "category": "agent",
    "description": "Test and fix agent template endpoints",
    "endpoints": [
      "GET /agent/template",
      "POST /agent/template",
      "PUT /agent/template/{templateId}"
    ],
    "steps": [
      "Test template listing on both APIs",
      "Test template CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 18,
    "category": "agent",
    "description": "Test and fix agent chat history endpoints",
    "endpoints": [
      "GET /agent/{agentId}/sessions",
      "GET /agent/{agentId}/chat-history/{sessionId}",
      "GET /agent/{agentId}/chat-history/user"
    ],
    "steps": [
      "Test session listing on both APIs",
      "Test chat history retrieval on both APIs",
      "Test recent user messages on both APIs",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 19,
    "category": "agent",
    "description": "Test and fix agent MCP endpoints",
    "endpoints": [
      "GET /agent/mcp/address/{agentId}",
      "GET /agent/mcp/tools/{agentId}"
    ],
    "steps": [
      "Test MCP address endpoint on both APIs",
      "Test MCP tools endpoint on both APIs",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 20,
    "category": "analytics",
    "description": "Test and fix device analytics endpoints",
    "endpoints": [
      "GET /analytics/today/device-count",
      "GET /analytics/month/device-count",
      "GET /analytics/today/active-devices",
      "GET /analytics/month/active-devices"
    ],
    "steps": [
      "Test all analytics endpoints on both APIs",
      "Compare response formats",
      "Fix any differences",
      "Verify dashboard analytics display correctly"
    ],
    "passes": true
  },
  {
    "id": 21,
    "category": "analytics",
    "description": "Test and fix usage/token analytics endpoints",
    "endpoints": [
      "GET /usage/analytics/daily-summary",
      "GET /usage/analytics/per-device",
      "GET /usage/analytics/totals"
    ],
    "steps": [
      "Test all usage analytics endpoints on both APIs",
      "Compare response formats",
      "Fix any differences"
    ],
    "passes": true
  },
  {
    "id": 22,
    "category": "model",
    "description": "Test and fix model listing endpoints",
    "endpoints": [
      "GET /models/list?page=1&limit=10",
      "GET /models/{id}",
      "GET /models/names",
      "GET /models/llm/names"
    ],
    "steps": [
      "Test model listing on both APIs",
      "Test getting single model on both APIs",
      "Test model names endpoints on both APIs",
      "Fix any differences",
      "Verify model config page works"
    ],
    "passes": true,
    "notes": "Fixed: 1) Changed table from ai_model to ai_model_config, 2) Added camelCase transformation for response fields, 3) Fixed requireAdmin middleware to check user.super_admin, 4) Fixed route ordering for /enable and /default endpoints"
  },
  {
    "id": 23,
    "category": "model",
    "description": "Test and fix model CRUD operations",
    "endpoints": [
      "POST /models/{modelType}/{provideCode}",
      "PUT /models/{modelType}/{provideCode}/{id}",
      "DELETE /models/{id}",
      "PUT /models/enable/{id}/{status}",
      "PUT /models/default/{id}"
    ],
    "steps": [
      "Test model create, update, delete on both APIs",
      "Test enable/disable on both APIs",
      "Test set default on both APIs",
      "Fix any differences"
    ],
    "passes": true,
    "notes": "Fixed: 1) Added referential integrity checks to DELETE (default model check, agent references, intent config references), 2) Added intent LLM validation to UPDATE (validates LLM exists and is openai/ollama type)"
  },
  {
    "id": 24,
    "category": "model",
    "description": "Test and fix model provider endpoints",
    "endpoints": [
      "GET /models/provider",
      "POST /models/provider",
      "PUT /models/provider",
      "POST /models/provider/delete"
    ],
    "steps": [
      "Test provider listing on both APIs",
      "Test provider CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": true,
    "notes": "Fixed: 1) Changed auth from requireAuth to requireAdmin, 2) Added camelCase transformation for responses, 3) Added name filter support (LIKE on name OR provider_code), 4) Added batch delete support (accepts ids array)"
  },
  {
    "id": 25,
    "category": "ota",
    "description": "Test and fix OTA management endpoints",
    "endpoints": [
      "GET /otaMag",
      "GET /otaMag/{id}",
      "POST /otaMag",
      "PUT /otaMag/{id}",
      "DELETE /otaMag/{id}",
      "PUT /otaMag/forceUpdate/{id}"
    ],
    "steps": [
      "Test firmware listing on both APIs",
      "Test firmware CRUD on both APIs",
      "Test force update flag on both APIs",
      "Fix any differences",
      "Verify OTA management page works"
    ],
    "passes": false
  },
  {
    "id": 26,
    "category": "rfid",
    "description": "Test and fix RFID question endpoints",
    "endpoints": [
      "GET /admin/rfid/question/page",
      "GET /admin/rfid/question/list",
      "GET /admin/rfid/question/{id}",
      "POST /admin/rfid/question",
      "PUT /admin/rfid/question",
      "POST /admin/rfid/question/delete"
    ],
    "steps": [
      "Test question listing on both APIs",
      "Test question CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": false
  },
  {
    "id": 27,
    "category": "rfid",
    "description": "Test and fix RFID pack endpoints",
    "endpoints": [
      "GET /admin/rfid/pack/page",
      "GET /admin/rfid/pack/list",
      "POST /admin/rfid/pack",
      "PUT /admin/rfid/pack",
      "POST /admin/rfid/pack/delete"
    ],
    "steps": [
      "Test pack listing on both APIs",
      "Test pack CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": false
  },
  {
    "id": 28,
    "category": "rfid",
    "description": "Test and fix RFID card endpoints",
    "endpoints": [
      "GET /admin/rfid/card/page",
      "GET /admin/rfid/card/uid/{rfidUid}",
      "POST /admin/rfid/card",
      "PUT /admin/rfid/card",
      "POST /admin/rfid/card/delete"
    ],
    "steps": [
      "Test card listing on both APIs",
      "Test get card by UID on both APIs",
      "Test card CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": false
  },
  {
    "id": 29,
    "category": "rfid",
    "description": "Test and fix RFID series endpoints",
    "endpoints": [
      "GET /admin/rfid/series/page",
      "GET /admin/rfid/series/list",
      "POST /admin/rfid/series",
      "PUT /admin/rfid/series",
      "POST /admin/rfid/series/delete"
    ],
    "steps": [
      "Test series listing on both APIs",
      "Test series CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": false
  },
  {
    "id": 30,
    "category": "voice",
    "description": "Test and fix TTS voice endpoints",
    "endpoints": [
      "GET /ttsVoice",
      "POST /ttsVoice",
      "PUT /ttsVoice/{id}",
      "POST /ttsVoice/delete"
    ],
    "steps": [
      "Test voice listing on both APIs",
      "Test voice CRUD on both APIs",
      "Fix any differences"
    ],
    "passes": false
  },
  {
    "id": 31,
    "category": "integration",
    "description": "Full frontend test - Login and Dashboard",
    "steps": [
      "Open manager-web in browser",
      "Login with test credentials",
      "Verify dashboard loads with analytics data",
      "Check browser console for any API errors"
    ],
    "passes": false
  },
  {
    "id": 32,
    "category": "integration",
    "description": "Full frontend test - Device Management",
    "steps": [
      "Navigate to device management page",
      "Verify device list loads",
      "Test device binding with activation code",
      "Test device unbinding",
      "Test device update"
    ],
    "passes": false
  },
  {
    "id": 33,
    "category": "integration",
    "description": "Full frontend test - Agent Configuration",
    "steps": [
      "Navigate to agent/role config page",
      "Verify agent list loads",
      "Test creating new agent",
      "Test editing agent configuration",
      "Test viewing chat history"
    ],
    "passes": false
  },
  {
    "id": 34,
    "category": "integration",
    "description": "Full frontend test - Model Configuration",
    "steps": [
      "Navigate to model config page",
      "Verify model list loads",
      "Test model CRUD operations",
      "Test enabling/disabling models",
      "Test setting default model"
    ],
    "passes": false
  },
  {
    "id": 35,
    "category": "integration",
    "description": "Full frontend test - RFID Management",
    "steps": [
      "Navigate to RFID management page",
      "Test questions tab - list and CRUD",
      "Test packs tab - list and CRUD",
      "Test cards tab - list and CRUD",
      "Test series tab - list and CRUD"
    ],
    "passes": false
  },
  {
    "id": 36,
    "category": "integration",
    "description": "Full frontend test - Admin Settings",
    "steps": [
      "Navigate to user management",
      "Navigate to system parameters",
      "Navigate to dictionary management",
      "Verify all admin pages work correctly"
    ],
    "passes": false
  }
]
```

---

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. For each task:
   - Test endpoints against Spring Boot API (port 8003) to get expected behavior
   - Test same endpoints against Node.js API (port 8002)
   - Compare responses using curl
   - Fix any differences in Node.js API code
   - Verify fix works
4. Update task to `"passes": true`
5. Log completion in `activity.md`
6. Repeat until all tasks pass

**Testing Pattern:**
```bash
# Get auth token first
TOKEN=$(curl -s -X POST http://localhost:8003/toy/user/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

# Compare responses
echo "=== Spring Boot ===" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8003/toy/endpoint | jq
echo "=== Node.js ===" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8002/toy/endpoint | jq
```

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria
All 36 tasks marked with `"passes": true`
