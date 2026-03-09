# Cheeko E2E Test Suite

Scenario-based end-to-end tests for the Cheeko system, covering all four backend modules with a unified reporting dashboard.

> **This is separate from `api-tests/`** which does per-endpoint validation (auth, status codes, envelope).
> E2E tests chain multiple actions into complete business flows.

---

## Modules Tested

| Module | Framework | Service Under Test | Default Port |
|--------|-----------|-------------------|------|
| **API** | Jest + PactumJS | manager-api-node (Express) | 8002 |
| **MQTT** | Jest + mqtt.js | mqtt-gateway (EMQX broker) | 1883 / 8000 |
| **LiveKit** | Jest + Axios | livekit-server media_api.py | 8003 |
| **UI** | Playwright | manager-web (Vue.js) | 8080 |

---

## Quick Start

```bash
cd main/e2e-tests
npm install
```

### Run all tests

```bash
npm run test:all
```

### Run a single module

```bash
npm run test:api        # API tests only
npm run test:mqtt       # MQTT tests only
npm run test:livekit    # LiveKit tests only
npm run test:ui         # UI tests only (Playwright)
```

### Run with report dashboard

```bash
npm run test:all:report   # Run all + open dashboard at http://localhost:3000
npm run report            # Just open dashboard for existing reports
```

---

## Project Structure

```
e2e-tests/
├── api/                          # API tests (manager-api-node)
│   ├── helpers/
│   │   ├── auth.helper.js        # Token management & auth headers
│   │   ├── data.helper.js        # Test data factories (devices, content, etc.)
│   │   ├── cleanup.helper.js     # Post-test cleanup utilities
│   │   ├── global-setup.js       # Login + cache auth token before tests
│   │   └── global-teardown.js    # Cleanup after all tests
│   └── scenarios/
│       ├── auth-flow.spec.js         # Login, token refresh, invalid credentials
│       ├── device-lifecycle.spec.js  # Register, update, delete devices
│       ├── content-pipeline.spec.js  # CRUD music/stories, playlists
│       ├── profile-flow.spec.js      # Kid profiles CRUD
│       ├── rfid-flow.spec.js         # RFID cards and series management
│       ├── analytics-flow.spec.js    # Game sessions, media playback stats
│       ├── cross-service.spec.js     # Multi-module integration flows
│       └── error-handling.spec.js    # Invalid requests, edge cases
│
├── mqtt/                         # MQTT tests (mqtt-gateway)
│   ├── helpers/
│   │   ├── mqtt-client.helper.js # MQTT client wrapper for tests
│   │   ├── device-simulator.js   # Simulates ESP32 device MQTT messages
│   │   ├── global-setup.js       # Verify broker connectivity
│   │   └── global-teardown.js    # Disconnect clients
│   └── scenarios/
│       ├── device-connect.spec.js    # Device connect/disconnect, LWT
│       ├── mode-change.spec.js       # Mode switching (conversation, game, music)
│       ├── playback-control.spec.js  # Play, pause, next, volume commands
│       ├── content-request.spec.js   # Content delivery via MQTT
│       ├── rfid-scan.spec.js         # RFID scan event flow
│       ├── multi-device.spec.js      # Multiple devices simultaneously
│       └── resilience.spec.js        # Reconnect, malformed messages, QoS
│
├── livekit/                      # LiveKit tests (media_api.py)
│   ├── helpers/
│   │   └── media-api.helper.js   # Axios wrapper for media API calls
│   └── scenarios/
│       ├── health-check.spec.js      # /health endpoint, active_bots, service init
│       ├── music-bot.spec.js         # Start, playlist, status, controls, stop
│       ├── story-bot.spec.js         # Start, playlist, controls, status, stop
│       ├── error-handling.spec.js    # Missing fields, wrong types, concurrent limits
│       └── bot-lifecycle.spec.js     # Full start-to-stop lifecycle flows
│
├── ui/                           # UI tests (manager-web)
│   ├── fixtures/
│   │   ├── auth.setup.js         # Playwright login + save storage state
│   │   └── test.fixture.js       # Custom test fixture with auth
│   ├── pages/                    # Page Object Models
│   │   ├── login.page.js
│   │   ├── home.page.js
│   │   ├── device-management.page.js
│   │   ├── content-library.page.js
│   │   ├── kid-profiles.page.js
│   │   ├── rfid-management.page.js
│   │   ├── game-analytics.page.js
│   │   └── user-management.page.js
│   └── scenarios/
│       ├── auth.spec.js              # Login, logout, session persistence
│       ├── device-management.spec.js # Device list, add, edit, delete
│       ├── content-library.spec.js   # Content browsing, upload, playlists
│       ├── kid-profiles.spec.js      # Profile CRUD via UI
│       ├── rfid-management.spec.js   # RFID card/series management UI
│       ├── analytics.spec.js         # Analytics dashboard rendering
│       └── settings.spec.js          # System settings pages
│
├── scripts/
│   ├── jest-json-reporter.js     # Custom Jest reporter -> reports/jest/{module}/{timestamp}/
│   ├── update-report-index.js    # Scans all reports -> reports/reports.json
│   ├── report-server.js          # Dashboard server at http://localhost:3000
│   ├── playwright-teardown.js    # Playwright post-run cleanup
│   └── run-all-tests.sh          # Bash runner (Linux/macOS only)
│
├── reports/                      # Generated reports (git-ignored)
│   ├── jest/
│   │   ├── api/{timestamp}/results.json
│   │   ├── mqtt/{timestamp}/results.json
│   │   └── livekit/{timestamp}/results.json
│   ├── playwright/{timestamp}/
│   │   ├── index.html            # Playwright HTML report
│   │   └── results.json
│   └── reports.json              # Unified index for dashboard
│
├── test.config.js                # Shared config (URLs, ports, auth)
├── jest.config.js                # Jest config (API + MQTT + LiveKit)
├── jest.mqtt.config.js           # Jest config (MQTT only)
├── jest.livekit.config.js        # Jest config (LiveKit only)
├── playwright.config.js          # Playwright config (UI)
├── package.json
└── .env                          # Environment overrides (not committed)
```

---

## Configuration

All test configuration lives in `test.config.js`. Override any value via `.env`:

```bash
# .env (create this file in e2e-tests/)
TEST_ENV=dev

# Manager API
DEV_HOST=localhost
DEV_API_PORT=8002

# MQTT Gateway
DEV_MQTT_PORT=1883
DEV_GATEWAY_PORT=8000

# LiveKit Media API
DEV_MEDIA_PORT=8003

# Auth credentials
ADMIN_USER=admin
ADMIN_PASS=admin123
SERVICE_SECRET_KEY=your-service-key
FIREBASE_TEST_TOKEN=

# Manager Web (for Playwright)
DASHBOARD_URL=http://localhost:8080

# Playwright
HEADLESS=true
```

### Default Service URLs

| Service | URL |
|---------|-----|
| Manager API | `http://localhost:8002/toy` |
| MQTT Broker | `mqtt://localhost:1883` |
| Gateway HTTP | `http://localhost:8000` |
| Media API | `http://localhost:8003` |
| Dashboard (Vue) | `http://localhost:8080` |

---

## Prerequisites

Before running tests, ensure the relevant services are running:

| Tests | Services Required |
|-------|-------------------|
| `test:api` | manager-api-node |
| `test:mqtt` | mqtt-gateway + EMQX broker |
| `test:livekit` | livekit-server (`python media_api.py`) |
| `test:ui` | manager-web + manager-api-node |

```bash
# Start services (in separate terminals)
cd main/manager-api-node && npm run dev       # API
cd main/mqtt-gateway && node app.js           # MQTT Gateway
cd main/livekit-server && python media_api.py # Media API
cd main/manager-web && npm run serve          # Vue Dashboard
```

Tests gracefully degrade when services are unavailable -- they'll skip assertions rather than crash.

---

## Writing New Test Scenarios

### Adding a new API scenario

1. Create `api/scenarios/your-feature.spec.js`:

```js
const pactum = require('pactum');
const { getBearerHeaders } = require('../helpers/auth.helper');
const { testDevice } = require('../helpers/data.helper');
const config = require('../../test.config');

const BASE = config.managerApi.baseUrl;

describe('Your Feature Flow', () => {
  beforeAll(() => {
    pactum.request.setDefaultTimeout(config.settings.timeoutMs);
  });

  it('should create a resource', async () => {
    await pactum.spec()
      .post(`${BASE}/your/endpoint`)
      .withHeaders(getBearerHeaders())
      .withJson({ name: 'test-resource' })
      .expectStatus(200)
      .expectJsonLike({ success: true });
  });

  it('should verify the resource exists', async () => {
    await pactum.spec()
      .get(`${BASE}/your/endpoint/list`)
      .withHeaders(getBearerHeaders())
      .expectStatus(200);
  });
});
```

2. The file will be auto-discovered -- `jest.config.js` matches `**/api/scenarios/**/*.spec.js`.

### Adding a new MQTT scenario

1. Create `mqtt/scenarios/your-feature.spec.js`:

```js
const { createTestClient } = require('../helpers/mqtt-client.helper');
const config = require('../../test.config');

describe('Your MQTT Feature', () => {
  let client;

  beforeAll(async () => {
    client = createTestClient('test-your-feature');
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('should handle a message', async () => {
    await client.subscribe('response/topic');
    await client.publish('internal/server-ingest', JSON.stringify({
      sender_client_id: 'test-device',
      orginal_payload: { type: 'your_type', data: 'test' }
    }));
    // Assert on received messages
  });
});
```

2. To run standalone: `npm run test:mqtt`

### Adding a new LiveKit scenario

1. Create `livekit/scenarios/your-feature.spec.js`:

```js
const { isMediaApiAvailable, mediaGet, mediaPost } = require('../helpers/media-api.helper');

describe('Your LiveKit Feature', () => {
  let available;

  beforeAll(async () => {
    available = await isMediaApiAvailable();
  });

  it('should call media API endpoint', async () => {
    if (!available) return; // Skip if service is down
    const res = await mediaPost('/your/endpoint', { key: 'value' });
    expect(res.status).toBe(200);
  });
});
```

### Adding a new UI scenario

1. Create a Page Object in `ui/pages/your-page.page.js`:

```js
class YourPage {
  constructor(page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.submitBtn = page.locator('button:has-text("Submit")');
  }

  async goto() {
    await this.page.goto('/#/your-page'); // Hash-mode routing!
  }
}

module.exports = YourPage;
```

2. Create `ui/scenarios/your-page.spec.js`:

```js
const { test, expect } = require('../fixtures/test.fixture');
const YourPage = require('../pages/your-page.page');

test.describe('Your Page', () => {
  test('should load correctly', async ({ page }) => {
    const yourPage = new YourPage(page);
    await yourPage.goto();
    await expect(yourPage.heading).toBeVisible();
  });
});
```

> **Important:** The Vue app uses hash-mode routing. All paths must start with `/#/`.

---

## Test Data Conventions

| Convention | Detail |
|------------|--------|
| **Prefix** | All test data uses `e2e-test-` prefix for easy identification |
| **Factories** | `api/helpers/data.helper.js` provides generators |
| **Unique IDs** | Each factory call generates a UUID-based unique ID |
| **Cleanup** | Tests clean up their own data in `afterAll` blocks |
| **Idempotent** | Tests can run repeatedly without manual DB cleanup |

### Available test data factories

```js
const {
  testDevice,      // { macAddress, model, remark }
  testContent,     // { title, contentType, url, category, description }
  testPlaylist,    // { name, description }
  testKidProfile,  // { name, nickname, birthDate, gender, language, interests }
  testRfidCard,    // { rfidUid, name }
  testRfidSeries,  // { name, startUid, endUid }
} = require('../helpers/data.helper');
```

---

## Report Dashboard

The built-in dashboard aggregates results from all 4 modules into a single view.

### Start the dashboard

```bash
npm run report                        # Update index + start server
node scripts/report-server.js         # Start server only (port 3000)
node scripts/report-server.js 4000    # Custom port
```

### Features

- Filter reports by module (API, MQTT, LiveKit, UI)
- Stat cards with pass rate progress bar
- Collapsible test suites with per-suite pass/fail counts
- Failed tests highlighted with error details in dark code blocks
- Screenshot viewer for Playwright failures
- Timestamps in IST (dd/mm/yyyy 12-hour format)

### How reports are generated

```
Jest tests run
  └─> jest-json-reporter.js writes results.json
        └─> reports/jest/{api|mqtt|livekit}/{timestamp}/results.json

Playwright tests run
  └─> playwright built-in reporters write HTML + JSON
        └─> reports/playwright/{timestamp}/results.json

update-report-index.js
  └─> Scans all report directories
        └─> reports/reports.json (unified index)

report-server.js
  └─> Reads reports.json + serves dashboard at http://localhost:3000
```

### Adding a new module to the dashboard

If you add a new test module (e.g., `websocket/`):

1. **`scripts/jest-json-reporter.js`** -- Add path detection:
   ```js
   else if (relPath.startsWith('websocket/')) moduleName = 'websocket';
   ```

2. **`scripts/update-report-index.js`** -- Add to MODULE_LABELS and scan list:
   ```js
   const MODULE_LABELS = {
     // ...existing...
     websocket: 'websocket-server (WS)',
   };
   // In the loop:
   for (const moduleName of ['api', 'mqtt', 'livekit', 'websocket']) {
   ```

3. **`scripts/report-server.js`** -- Add tab in the `modules` array inside `buildTabs()` and a color in `MODULE_COLORS`.

---

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm test` | Run API + MQTT + LiveKit + UI tests |
| `npm run test:all` | Run all tests + update report index |
| `npm run test:all:report` | Run all + update index + start dashboard |
| `npm run test:api` | API tests only (Jest + PactumJS) |
| `npm run test:api:verbose` | API tests with verbose output |
| `npm run test:mqtt` | MQTT tests only (Jest) |
| `npm run test:mqtt:verbose` | MQTT tests with verbose output |
| `npm run test:livekit` | LiveKit tests only (Jest) |
| `npm run test:ui` | UI tests (Playwright, headless) |
| `npm run test:ui:headed` | UI tests with browser visible |
| `npm run test:ui:debug` | UI tests in debug mode |
| `npm run test:ui:report` | Open Playwright's built-in HTML report |
| `npm run report` | Update report index + start dashboard |
| `npm run report:update` | Update report index only |

---

## Test Count Summary

| Module | Spec Files | Approx. Test Cases |
|--------|-----------|-------------------|
| API | 8 | ~65 |
| MQTT | 7 | ~50 |
| LiveKit | 5 | ~50 |
| UI | 7 | ~50 |
| **Total** | **27** | **~215** |

---

## Scenario Coverage Map

Maps each scenario from `E2E-TEST-SCENARIOS.md` to a test file and tool.

### P0 - Critical

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 1.1 | Admin login | `ui/scenarios/auth.spec.js` | Playwright |
| 1.2 | Invalid credentials | `api/scenarios/auth-flow.spec.js` | PactumJS |
| 1.3 | Token refresh | `api/scenarios/auth-flow.spec.js` | PactumJS |
| 1.4 | Service-to-service auth | `api/scenarios/auth-flow.spec.js` | PactumJS |
| 2.1 | Register device | `ui/scenarios/device-management.spec.js` | Playwright |
| 2.2 | Device config retrieval | `api/scenarios/device-lifecycle.spec.js` | PactumJS |
| 12.2 | Content delivery pipeline | `api/scenarios/cross-service.spec.js` | PactumJS |

### P1 - High

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 5.1-5.3 | Upload content | `ui/scenarios/content-library.spec.js` | Playwright |
| 6.1 | Register RFID tag | `ui/scenarios/rfid-management.spec.js` | Playwright |
| 6.2 | RFID scan triggers content | `mqtt/scenarios/rfid-scan.spec.js` | MQTT.js |
| Media | Music/story bot lifecycle | `livekit/scenarios/bot-lifecycle.spec.js` | Jest |

### P2 - Medium

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 7.1 | Create child profile | `ui/scenarios/kid-profiles.spec.js` | Playwright |
| 8.1 | MQTT device connection | `mqtt/scenarios/device-connect.spec.js` | MQTT.js |
| 8.4 | Multi-device concurrent | `mqtt/scenarios/multi-device.spec.js` | MQTT.js |
| Media | Health check + bot status | `livekit/scenarios/health-check.spec.js` | Jest |

### P3 - Low

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 8.5 | Malformed MQTT message | `mqtt/scenarios/resilience.spec.js` | MQTT.js |
| 11.7 | XSS attempt | `api/scenarios/error-handling.spec.js` | PactumJS |
| 11.8 | SQL injection | `api/scenarios/error-handling.spec.js` | PactumJS |
| Media | Invalid bot requests | `livekit/scenarios/error-handling.spec.js` | Jest |

### Not automatable in E2E (Agent-level -- use pytest)

| Scenario | Reason |
|----------|--------|
| 3.1-3.7 | Voice session -- requires real audio I/O |
| 4.1-4.3 | Game modes -- requires voice trigger to agent |
| 7.3-7.6 | Memory system -- tested via existing pytest suite |

---

## Troubleshooting

### Tests skip or show "service unavailable"

Tests gracefully handle unavailable services. Make sure the required service is running before the test module. See [Prerequisites](#prerequisites).

### Port 3000 already in use (dashboard)

The dashboard server handles this gracefully and shows a message. Kill the existing process or use a different port:

```bash
node scripts/report-server.js 4000
```

### Playwright tests fail on first run

Install Playwright browsers:

```bash
npx playwright install chromium
```

### `npm run test:all` fails with WSL errors on Windows

The npm scripts use chained `npm run` commands (not bash), so this should work on Windows with Git Bash. If you see WSL errors, run modules individually:

```bash
npm run test:api
npm run test:mqtt
npm run test:livekit
npm run test:ui
```

---

## Dependencies

```json
{
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "pactum": "^3.7.0",
    "jest": "^29.7.0",
    "mqtt": "^5.10.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "uuid": "^9.0.0"
  }
}
```

7 dependencies. No Docker required. Tests run against your existing dev/prod servers.
