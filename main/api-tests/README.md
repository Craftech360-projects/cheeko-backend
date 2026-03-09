# Cheeko API Testing Framework

**Zero-maintenance automated testing** for all Cheeko backend services. Tests are **auto-generated from your source code** — when you add, change, or remove an API, the tests update themselves. No manual test writing needed.

---

## The Key Idea: Auto-Discovery

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR SOURCE CODE                          │
│                                                              │
│  manager-api-node/src/routes/content.routes.js               │
│    router.get('/library', requireFlexAuth, handler)          │
│    router.post('/library', requireAdmin, handler)            │
│                                                              │
│  mqtt-gateway/gateway/mqtt-gateway.js                        │
│    if (type === "hello") → handleDeviceHello()               │
│    if (type === "mode-change") → handleModeChange()          │
│                                                              │
│  livekit-server/media_api.py                                 │
│    @app.post("/start-music-bot")                             │
│    @app.get("/health")                                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                    ROUTE SCANNER
                    (parses source files
                     at runtime using regex)
                         │
                         ▼
              ┌──────────────────────┐
              │  Discovered Routes   │
              │                      │
              │  GET  /toy/content/  │
              │    → auth: FlexAuth  │
              │  POST /toy/content/  │
              │    → auth: Admin     │
              │  MQTT hello          │
              │    → no auth         │
              │  POST /start-music-  │
              │    → no auth         │
              └──────────┬───────────┘
                         │
                    TEST GENERATOR
                    (creates test cases
                     per discovered route)
                         │
                         ▼
              ┌──────────────────────┐
              │  Auto-Generated      │
              │  Test Cases          │
              │                      │
              │  ✓ 401 without auth  │
              │  ✓ 401 invalid token │
              │  ✓ 200 happy path    │
              │  ✓ response envelope │
              │  ✓ response time     │
              └──────────┬───────────┘
                         │
                    TEST RUNNER (Jest)
                         │
                         ▼
              ┌──────────────────────┐
              │  JSON Report         │
              │  + HTML Dashboard    │
              └──────────────────────┘
```

### What happens when you change code:

| You do this... | Tests automatically... |
|---------------|----------------------|
| Add a new route `router.get('/new-endpoint', requireAuth, handler)` | Scanner finds it → new test cases appear |
| Change `requireAuth` → `requireFlexAuth` on a route | Scanner reads new middleware → test uses correct auth |
| Delete a route | Scanner no longer finds it → test cases disappear |
| Add a new route file + mount it in `index.js` | Scanner finds new file + mount path → full coverage |
| Add a new MQTT message type in mqtt-gateway | Scanner finds new `type === "xxx"` → MQTT test appears |
| Add a new FastAPI endpoint in media_api.py | Scanner finds new `@app.post()` → HTTP test appears |

**You never touch the test code. Ever.**

---

## What Gets Tested

### 3 Services, ~450+ Endpoints

| Service | Port | Endpoints | Protocol | Auto-Discovered From |
|---------|------|-----------|----------|---------------------|
| **manager-api-node** | 8002 | ~426 REST | HTTP | `src/routes/*.routes.js` |
| **mqtt-gateway** | 8000/1883 | 2 HTTP + 13 MQTT types | HTTP + MQTT | `gateway/mqtt-gateway.js`, `gateway/udp-forwarder.js` |
| **livekit-server** | 8003 | 11 REST | HTTP | `media_api.py` (FastAPI) |

### Manager API — 20 Route Modules (~426 endpoints)

| Category | Route File | ~Count | Auth Type |
|----------|-----------|--------|-----------|
| RFID Management | `rfid.routes.js` | 79 | Public + Admin |
| Content (Music/Stories) | `content.routes.js` | 52 | FlexAuth + Admin |
| Device Management | `device.routes.js` | 37 | Bearer + Public |
| Analytics & Usage | `analytics.routes.js` | 36 | ServiceKey + FlexAuth |
| Agent Configuration | `agent.routes.js` | 34 | Bearer |
| Mobile App | `mobile.routes.js` | 27 | Firebase (router-wide) |
| AI Models | `model.routes.js` | 26 | Bearer + Admin |
| Admin Functions | `admin.routes.js` | 25 | Admin / SuperAdmin |
| System Settings | `system.routes.js` | 22 | Bearer + Admin |
| User Profiles | `profile.routes.js` | 21 | Bearer |
| Dictionary | `dict.routes.js` | 11 | Admin |
| Authentication | `auth.routes.js` | 11 | None / Bearer |
| OTA Magazines | `otaMag.routes.js` | 10 | Admin |
| Configuration | `config.routes.js` | 9 | None (internal) |
| Email Reports | `emailReport.routes.js` | 6 | SuperAdmin |
| Parameters | `params.routes.js` | 5 | SuperAdmin |
| Usage Analytics | `usage.routes.js` | 4 | ServiceKey |
| TTS Voices | `ttsVoice.routes.js` | 4 | Admin |
| OTA Updates | `ota.routes.js` | 3 | None (ESP32) |
| Server Info | `server.routes.js` | 3 | Admin |
| Health (inline) | `index.js` | 3 | None |

### MQTT Gateway — 13 Message Types + 2 HTTP

| Type | Message `type` value | Handler | Protocol |
|------|---------------------|---------|----------|
| Device Hello | `hello` | `handleDeviceHello()` | MQTT |
| Device Goodbye | `goodbye` | connection cleanup | MQTT |
| Mode Change | `mode-change` | `handleModeChange()` | MQTT |
| Character Change | `character-change` | `handleDeviceCharacterChange()` | MQTT |
| Playback Next | `playback_control` + `action: next` | `handleNextControl()` | MQTT |
| Playback Previous | `playback_control` + `action: previous` | `handlePreviousControl()` | MQTT |
| Start Agent | `playback_control` + `action: start_agent` | `handleStartAgentControl()` | MQTT |
| Content Download | `download_request` | `handleContentDownloadRequest()` | MQTT |
| Play Music | `function_call` + `name: play_music` | `handleSpecificMusicRequest()` | MQTT |
| Play Story | `function_call` + `name: play_story` | `handleSpecificStoryRequest()` | MQTT |
| RFID Scan | `card_lookup` / `start_greeting_text` | RFID lookup handler | MQTT |
| Abort | `abort` | connection publish | MQTT |
| MCP Response | `mcp` | MCP resolve/reject | MQTT |
| Health Check | — | `GET /health` | HTTP |
| UDP Forward | — | `POST /udp/forward` | HTTP |

### LiveKit Media API — 11 FastAPI Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/start-music-bot` | Start music bot in LiveKit room |
| POST | `/start-story-bot` | Start story bot in LiveKit room |
| POST | `/stop-bot` | Stop a running bot |
| POST | `/music-bot/{room_name}/next` | Skip to next song |
| POST | `/music-bot/{room_name}/previous` | Skip to previous song |
| POST | `/music-bot/{room_name}/start` | Start music playback |
| POST | `/story-bot/{room_name}/start` | Start story playback |
| POST | `/story-bot/{room_name}/next` | Skip to next story |
| POST | `/story-bot/{room_name}/previous` | Skip to previous story |
| GET | `/bot/{room_name}/status` | Get bot playback status |
| GET | `/health` | Health check |

---

## Tech Stack

| Concern | Library | Why |
|---------|---------|-----|
| **Test Runner** | Jest 29 | Already used in project, parallel execution |
| **HTTP Client** | Axios | Hit remote dev/prod servers by IP |
| **MQTT Client** | mqtt.js 5 | Same library mqtt-gateway uses |
| **Route Scanner** | Custom (regex-based) | Parses Express `router.get()`, FastAPI `@app.post()`, MQTT `type ===` |
| **Dashboard** | Playwright HTML Reporter | Built-in, professional, zero custom code |
| **UUID** | uuid | Generate unique test data |

### Why Auto-Discovery + Jest (not Playwright)?

| Concern | Decision |
|---------|----------|
| **Why not hand-written tests?** | 426+ endpoints = unmaintainable. Your latest commit changed 15 routes from `requireAuth` → `requireFlexAuth` — hand-written tests wouldn't catch this. |
| **Why not Playwright?** | Playwright is for browser/UI testing. Our tests hit HTTP + MQTT — Jest is purpose-built for this. |
| **Why Playwright reporter?** | We use **only** Playwright's HTML reporter (via `jest-playwright-reporter` adapter or custom JSON → Playwright format). Best-in-class dashboard with zero custom UI code. |
| **Why Axios instead of Supertest?** | Supertest requires the local Express app in-process. Axios lets us test any remote server (dev/prod) by IP. |

---

## How Auto-Discovery Works (Technical)

### Scanner 1: Express Routes (`manager-api-node`)

Reads `routes/index.js` to get mount paths, then scans each `*.routes.js` file:

```
Input:  router.get('/library', requireFlexAuth, asyncHandler(...))
        ↑ method    ↑ path     ↑ middleware

Output: {
          method: 'GET',
          path: '/toy/content/library',    ← prefix from index.js + route path
          auth: 'requireFlexAuth',          ← extracted middleware
          file: 'content.routes.js',
          category: 'content'
        }
```

Special cases handled:
- **Router-wide middleware**: `router.use(requireFirebaseAuth)` in `mobile.routes.js` → applies to all routes in file
- **Chained middleware**: `requireAuth, requireAdmin` → picks the strongest (admin)
- **Validation middleware**: `validate(schemas.xxx)` → knows request body is required
- **Parameterized paths**: `/library/:id` → generates test with placeholder ID

### Scanner 2: MQTT Handlers (`mqtt-gateway`)

Reads `mqtt-gateway.js` and extracts message type dispatching:

```
Input:  if (originalPayload.type === "mode-change")
            → this.handleModeChange(...)

Output: {
          type: 'mode-change',
          handler: 'handleModeChange',
          protocol: 'mqtt',
          topic: 'internal/server-ingest'
        }
```

Also scans for:
- `originalPayload.action === "next"` → sub-action
- `functionName === "play_music"` → function_call sub-type
- HTTP routes in `udp-forwarder.js` → `req.method === 'GET' && req.url === '/health'`

### Scanner 3: FastAPI Endpoints (`livekit-server`)

Reads `media_api.py` and extracts Python decorators:

```
Input:  @app.post("/start-music-bot")
        async def start_music_bot(request: StartMusicBotRequest):

Output: {
          method: 'POST',
          path: '/start-music-bot',
          requestModel: 'StartMusicBotRequest',
          protocol: 'http',
          service: 'livekit-server'
        }
```

---

## Test Generation Rules

For each discovered endpoint, the generator creates test cases based on auth type:

### HTTP Endpoints (Protected)

```
describe('GET /toy/content/library (requireFlexAuth)')
  ✓ should return 401 without any auth header
  ✓ should return 401 with invalid/expired token
  ✓ should return 200 with valid Bearer token
  ✓ should return 200 with valid Firebase token (FlexAuth)
  ✓ should return response matching { code, msg, data } envelope
  ✓ should respond within 5000ms
```

### HTTP Endpoints (Public)

```
describe('POST /toy/device/register (no auth)')
  ✓ should return 200 without auth header
  ✓ should return response matching { code, msg, data } envelope
  ✓ should respond within 5000ms
```

### HTTP Endpoints (Admin)

```
describe('DELETE /toy/admin/dict/:id (requireAdmin)')
  ✓ should return 401 without auth
  ✓ should return 401 with regular user token
  ✓ should return 200 with admin token
  ✓ should respond within 5000ms
```

### MQTT Message Types

```
describe('MQTT: mode-change')
  ✓ should connect to broker
  ✓ should publish mode-change message to internal/server-ingest
  ✓ should not crash the gateway (health check after)
  ✓ should disconnect cleanly
```

### FastAPI Endpoints

```
describe('POST /start-music-bot (livekit media API)')
  ✓ should return 422 without required fields
  ✓ should return 200 with valid request body
  ✓ should return response with expected fields
  ✓ should respond within 5000ms
```

---

## Project Structure

```
main/api-tests/
├── package.json                    ← Dependencies + npm scripts
├── jest.config.js                  ← Jest config
├── test.config.js                  ← Dev/Prod server IPs (EDIT THIS)
├── README.md                       ← This file
├── .gitignore                      ← Ignore reports/, node_modules/
│
├── scanners/                       ← AUTO-DISCOVERY ENGINE
│   ├── express-scanner.js          ← Scans manager-api-node route files
│   ├── mqtt-scanner.js             ← Scans mqtt-gateway message handlers
│   ├── fastapi-scanner.js          ← Scans livekit-server media_api.py
│   └── index.js                    ← Runs all scanners, merges results
│
├── generators/                     ← TEST CASE GENERATORS
│   ├── http-test-generator.js      ← Creates Jest tests for HTTP endpoints
│   ├── mqtt-test-generator.js      ← Creates Jest tests for MQTT handlers
│   └── index.js                    ← Orchestrates generation
│
├── lib/                            ← SHARED INFRASTRUCTURE
│   ├── http-client.js              ← Axios wrapper (configurable base URL)
│   ├── auth-helper.js              ← Token acquisition for 6 auth types
│   ├── mqtt-client.js              ← mqtt.js wrapper (publish/subscribe)
│   ├── custom-reporter.js          ← Jest reporter → JSON output
│   └── report-aggregator.js        ← Merge results, compute stats
│
├── scripts/                        ← CLI
│   └── run-tests.js                ← --env=dev|prod, --service, --category
│
├── suites/                         ← GENERATED AT RUNTIME (not committed)
│   ├── manager-api/                ← One .test.js per route file
│   ├── mqtt-gateway/               ← One .test.js per message type
│   └── livekit-server/             ← One .test.js per FastAPI endpoint group
│
├── overrides/                      ← OPTIONAL: Hand-written test additions
│   ├── content.override.js         ← Extra tests for content endpoints
│   └── README.md                   ← How to write overrides
│
└── reports/                        ← Generated (gitignored)
    ├── test-history.json
    └── runs/
        └── 2026-03-04T15-30-00_dev.json
```

### Key difference from old plan:

| Old Plan (47 files) | New Plan |
|---------------------|----------|
| 27 hand-written test files | 0 hand-written test files |
| Tests go stale when code changes | Tests auto-update from source |
| Must manually track auth changes | Auth auto-detected from middleware |
| Fixed endpoint list | Dynamic — scans source every run |
| Custom dashboard (8 files) | Playwright HTML reporter (0 files) |
| ~47 files to create | ~15 files to create |

---

## CLI Commands

```bash
cd main/api-tests
npm install

# ── Run tests ──────────────────────────────────
npm test                          # All services, dev server
npm run test:prod                 # All services, prod server

npm run test:api                  # Only manager-api-node
npm run test:mqtt                 # Only mqtt-gateway
npm run test:media                # Only livekit-server media API

npm run test:category -- rfid     # Only RFID endpoints
npm run test:category -- mobile   # Only mobile endpoints
npm run test:category -- content  # Only content endpoints

# ── Reports ────────────────────────────────────
npm run report                    # Open HTML report in browser

# ── Debug ──────────────────────────────────────
npm run scan                      # Show all discovered routes (dry run)
npm run scan:diff                 # Show routes added/removed since last run
```

---

## Dev/Prod Server Switching

Edit `test.config.js` — one file, one place:

```js
module.exports = {
  environments: {
    dev: {
      managerApi:    { baseUrl: 'http://DEV_IP:8002/toy' },
      mqttGateway:   { brokerUrl: 'mqtt://DEV_IP:1883', httpUrl: 'http://DEV_IP:8000' },
      mediaApi:      { baseUrl: 'http://DEV_IP:8003' },
      auth: {
        adminUser: 'admin',
        adminPass: 'admin123',
        serviceKey: 'your-service-key',
        firebaseToken: process.env.FIREBASE_TEST_TOKEN
      }
    },
    prod: {
      managerApi:    { baseUrl: 'http://PROD_IP:8002/toy' },
      mqttGateway:   { brokerUrl: 'mqtt://PROD_IP:1883', httpUrl: 'http://PROD_IP:8000' },
      mediaApi:      { baseUrl: 'http://PROD_IP:8003' },
      auth: {
        adminUser: process.env.PROD_ADMIN_USER,
        adminPass: process.env.PROD_ADMIN_PASS,
        serviceKey: process.env.PROD_SERVICE_KEY,
        firebaseToken: process.env.FIREBASE_TEST_TOKEN
      }
    }
  },
  defaultEnv: 'dev',

  // Source code paths (for scanners)
  sources: {
    managerApi:  '../manager-api-node/src/routes',
    mqttGateway: '../mqtt-gateway/gateway',
    mediaApi:    '../livekit-server/media_api.py'
  }
};
```

---

## Authentication — 6 Types Auto-Detected

The scanner reads your middleware and the test generator picks the right auth:

| Middleware in Code | Auth Used in Test | Header Sent |
|-------------------|------------------|-------------|
| `requireAuth` | Admin Bearer login | `Authorization: Bearer <jwt>` |
| `requireAdmin` | Admin Bearer login | `Authorization: Bearer <jwt>` (admin role) |
| `requireSuperAdmin` | SuperAdmin Bearer login | `Authorization: Bearer <jwt>` (super_admin) |
| `requireServiceKey` | Service Key | `X-Service-Key: <key>` |
| `requireFlexAuth` | Bearer + Firebase (tests both) | `Authorization: Bearer <jwt or firebase>` |
| `requireFirebaseAuth` | Firebase token | `Authorization: Bearer <firebase>` |
| `requireDualAuth` | Bearer or Service Key | Both tested |
| `optionalAuth` | Tested with and without auth | Both tested |
| *(none)* | No auth header | *(none)* |

---

## Override System (Optional)

Auto-generated tests cover auth + status code + envelope + response time. For **custom business logic** tests (e.g., "creating a device returns correct MAC format"), add an override:

```js
// overrides/device.override.js
module.exports = {
  'POST /toy/device/register': {
    happyPath: {
      body: { macAddress: 'AA:BB:CC:DD:EE:FF', deviceType: 'esp32' },
      expect: (response) => {
        expect(response.data.macAddress).toMatch(/^[A-F0-9:]+$/);
      }
    }
  }
};
```

Overrides are **merged** with auto-generated tests — they don't replace them.

---

## Report JSON Schema

```json
{
  "meta": {
    "runId": "2026-03-04T15-30-00_dev",
    "timestamp": "2026-03-04T15:30:00.000Z",
    "environment": "dev",
    "branch": "firebase-migration",
    "discoveredRoutes": 450,
    "testsGenerated": 1350,
    "durationMs": 45230
  },
  "summary": {
    "total": 1350,
    "passed": 1320,
    "failed": 25,
    "skipped": 5,
    "successRate": 97.8,
    "avgResponseTimeMs": 145,
    "p95ResponseTimeMs": 520
  },
  "services": [
    {
      "name": "manager-api-node",
      "categories": [
        {
          "name": "Content APIs",
          "file": "content.routes.js",
          "routes": [
            {
              "method": "GET",
              "path": "/toy/content/library",
              "auth": "requireFlexAuth",
              "tests": [
                { "name": "401 without auth", "status": "passed", "durationMs": 42 },
                { "name": "200 with Bearer", "status": "passed", "durationMs": 135 },
                { "name": "200 with Firebase", "status": "passed", "durationMs": 148 }
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "mqtt-gateway",
      "categories": [...]
    },
    {
      "name": "livekit-server",
      "categories": [...]
    }
  ]
}
```

---

## How a Test Run Works (End to End)

```
$ npm test

Step 1: SCAN (2 seconds)
  ├── express-scanner reads 20 route files     → 426 routes found
  ├── mqtt-scanner reads mqtt-gateway.js       → 13 message types found
  ├── fastapi-scanner reads media_api.py       → 11 endpoints found
  └── Total: 450 routes discovered

Step 2: GENERATE (1 second)
  ├── For each route, create 3-6 test cases based on auth type
  ├── Merge any overrides from overrides/ folder
  ├── Write .test.js files to suites/ folder
  └── Total: ~1350 test cases generated

Step 3: RUN (30-60 seconds)
  ├── Jest runs all generated .test.js files
  ├── Each test hits the real server (dev or prod)
  ├── Auth tokens acquired and cached per auth type
  └── Results collected by custom reporter

Step 4: REPORT (1 second)
  ├── JSON report written to reports/runs/
  ├── test-history.json updated
  ├── HTML report generated (Playwright format)
  └── Console summary printed

  ╔══════════════════════════════════════╗
  ║  CHEEKO API TEST RESULTS             ║
  ║  Environment: dev                    ║
  ║  Routes: 450  Tests: 1350            ║
  ║  Passed: 1320  Failed: 25  Skip: 5   ║
  ║  Pass Rate: 97.8%                    ║
  ║  Duration: 42.3s                     ║
  ║                                      ║
  ║  Report: reports/runs/2026-03-04..   ║
  ╚══════════════════════════════════════╝
```

---

## Comparison: Old Plan vs New Plan

| | Old Plan (Static Tests) | New Plan (Auto-Discovery) |
|-|------------------------|--------------------------|
| **Files to create** | 47 | ~15 |
| **Files to maintain** | 27 test files (manual) | 0 test files (auto-generated) |
| **Add new API** | Write new test manually | Automatic — scanner finds it |
| **Change auth middleware** | Find + update test manually | Automatic — scanner reads new middleware |
| **Remove API** | Delete test manually | Automatic — scanner stops finding it |
| **New service** | Write new test suite | Add new scanner (one file) |
| **Services covered** | 2 (API + MQTT) | 3 (API + MQTT + Media) |
| **Dashboard** | Custom (8 files) | Playwright reporter (0 files) |
| **Test count** | ~312 fixed | ~1350 dynamic |
| **Maintenance effort** | Ongoing | Near-zero |

---

## Implementation Phases

| Phase | What | Files |
|-------|------|-------|
| **1** | Scanners (Express + MQTT + FastAPI) | 4 |
| **2** | Test generators (HTTP + MQTT) | 3 |
| **3** | Infrastructure (HTTP client, auth, MQTT, reporter) | 5 |
| **4** | CLI + scripts | 1 |
| **5** | Config + docs | 3 |
| | **Total** | **~16** |

---

## Dependencies

```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "axios": "^1.7.0",
    "mqtt": "^5.10.0",
    "uuid": "^9.0.0"
  }
}
```

4 dependencies. No Docker. No build step. No CI changes.

`npm install && npm test` — that's it.
