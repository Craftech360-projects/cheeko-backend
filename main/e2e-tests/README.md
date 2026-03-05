# Cheeko E2E Testing Framework

Scenario-based end-to-end tests that simulate real user journeys across all Cheeko services.

> **This is separate from `api-tests/`** which does per-endpoint validation (auth, status codes, envelope).
> E2E tests chain multiple actions into complete business flows.

---

## Architecture

```
main/
├── api-tests/                  <-- EXISTING (per-endpoint, auto-discovery)
│   ├── scanners/                   "Does each endpoint work?"
│   ├── generators/
│   └── suites/
│
├── e2e-tests/                  <-- THIS PROJECT (scenario flows)
│   ├── playwright.config.js        Playwright configuration
│   ├── pactum.config.js            PactumJS configuration
│   ├── .env                        Environment variables (gitignored)
│   ├── .env.example                Template for .env
│   │
│   ├── ui/                         PLAYWRIGHT — Browser UI tests
│   │   ├── fixtures/
│   │   │   ├── auth.fixture.js         Login state reuse (storageState)
│   │   │   └── test.fixture.js         Extended test with API helpers
│   │   ├── pages/                      Page Object Models
│   │   │   ├── login.page.js
│   │   │   ├── device-management.page.js
│   │   │   ├── content-library.page.js
│   │   │   ├── rfid-management.page.js
│   │   │   ├── kid-profiles.page.js
│   │   │   ├── user-management.page.js
│   │   │   ├── game-analytics.page.js
│   │   │   └── home.page.js
│   │   └── scenarios/                  Test files (one per feature area)
│   │       ├── auth.spec.js                Login, logout, role-based access
│   │       ├── device-management.spec.js   CRUD devices, activation
│   │       ├── content-library.spec.js     Upload, edit, delete content
│   │       ├── rfid-management.spec.js     RFID CRUD, link to content
│   │       ├── kid-profiles.spec.js        Profile CRUD, assign to device
│   │       ├── analytics.spec.js           View game/usage analytics
│   │       └── settings.spec.js            System config, dictionaries
│   │
│   ├── api/                        PACTUMJS — Multi-step API flows
│   │   ├── helpers/
│   │   │   ├── auth.helper.js          Token acquisition (reuses api-tests pattern)
│   │   │   ├── cleanup.helper.js       Test data teardown
│   │   │   └── data.helper.js          Test data factories
│   │   └── scenarios/
│   │       ├── auth-flow.spec.js           Login, refresh, role checks
│   │       ├── device-lifecycle.spec.js    Register -> config -> update -> deactivate
│   │       ├── content-pipeline.spec.js    Upload -> playlist -> assign -> verify
│   │       ├── rfid-flow.spec.js           Create tag -> link content -> verify lookup
│   │       ├── profile-flow.spec.js        Create profile -> assign device -> verify config
│   │       ├── analytics-flow.spec.js      Record session -> query stats -> verify
│   │       ├── error-handling.spec.js      XSS, SQL injection, invalid input, rate limit
│   │       └── cross-service.spec.js       Full content delivery pipeline (scenario 12.2, 12.3)
│   │
│   ├── mqtt/                       MQTT.JS + JEST — Device simulation
│   │   ├── helpers/
│   │   │   ├── mqtt-client.helper.js   MQTT connection wrapper
│   │   │   └── device-simulator.js     Simulates ESP32 behavior
│   │   └── scenarios/
│   │       ├── device-connect.spec.js      Hello, goodbye, reconnection
│   │       ├── mode-change.spec.js         Mode/character change messages
│   │       ├── playback-control.spec.js    Next, previous, start_agent
│   │       ├── rfid-scan.spec.js           card_lookup, greeting triggers
│   │       ├── content-request.spec.js     play_music, play_story function calls
│   │       ├── resilience.spec.js          Malformed messages, broker recovery
│   │       └── multi-device.spec.js        Concurrent devices, isolation
│   │
│   └── reports/                    Generated (gitignored)
│       ├── playwright/                 Playwright HTML report
│       └── api/                        PactumJS JSON reports
│
└── livekit-server/tests/       <-- EXISTING (pytest — agent/memory)
```

---

## Tech Stack

| Tool | Version | Purpose | Scope |
|------|---------|---------|-------|
| **Playwright** | ^1.50 | Browser automation + API assertions | `ui/` scenarios |
| **PactumJS** | ^3.7 | API E2E flow chaining | `api/` scenarios |
| **Jest** | ^29.7 | Test runner for API + MQTT | `api/` + `mqtt/` scenarios |
| **MQTT.js** | ^5.10 | MQTT client for device simulation | `mqtt/` scenarios |
| **dotenv** | ^16.4 | Environment config | All |

---

## How Each Tool Is Used

### Playwright (ui/)

Tests the Vue.js admin dashboard through a real browser.

**Example: Device Activation Flow**

```js
test('admin activates device with activation code', async ({ page, apiClient }) => {
  // 1. Navigate to device management
  await page.goto('/device-management');

  // 2. Click "Add Device"
  await page.click('button:has-text("Add")');

  // 3. Enter activation code
  await page.fill('[placeholder="Activation Code"]', 'ABC-123-XYZ');

  // 4. Submit
  await page.click('button:has-text("Activate")');

  // 5. Assert UI shows success
  await expect(page.locator('.el-message--success')).toBeVisible();

  // 6. Verify via API that device is actually active
  const device = await apiClient.get('/toy/device/info?code=ABC-123-XYZ');
  expect(device.data.status).toBe(1); // active
});
```

**Key patterns:**
- **Page Object Model** — each Vue page gets a POM class for reusable selectors
- **Auth fixture** — login once, reuse `storageState` across all tests (no re-login per test)
- **API verification** — after UI action, call API to confirm backend state
- **Auto-wait** — Playwright waits for elements automatically, no manual sleeps

### PactumJS (api/)

Tests multi-step API scenarios by chaining requests and passing data between steps.

**Example: Content Delivery Pipeline (Scenario 12.2)**

```js
const { e2e } = require('pactum');

describe('Content Delivery Pipeline', () => {
  let flow;

  beforeAll(() => { flow = e2e('Content Pipeline'); });
  afterAll(async () => { await flow.cleanup(); });

  it('Step 1: Admin uploads music', async () => {
    await flow.step('Upload Music')
      .spec()
      .post('/toy/content/music/save')
      .withHeaders('X-Service-Key', '$S{serviceKey}')
      .withJson({ name: 'Space Song', type: 'music', url: 'https://cdn/space.mp3' })
      .expectStatus(200)
      .stores('musicId', 'data.id');
  });

  it('Step 2: Create playlist with music', async () => {
    await flow.step('Create Playlist')
      .spec()
      .post('/toy/content/playlist/save')
      .withHeaders('X-Service-Key', '$S{serviceKey}')
      .withJson({ name: 'Test Playlist', items: ['$S{musicId}'] })
      .expectStatus(200)
      .stores('playlistId', 'data.id');
  });

  it('Step 3: Assign playlist to device', async () => {
    await flow.step('Assign to Device')
      .spec()
      .put('/toy/device/update')
      .withHeaders('X-Service-Key', '$S{serviceKey}')
      .withJson({ id: '$S{deviceId}', playlistId: '$S{playlistId}' })
      .expectStatus(200);
  });

  it('Step 4: Verify device config has playlist', async () => {
    await flow.step('Verify Config')
      .spec()
      .get('/toy/agent/config/{mac}')
      .withPathParams('mac', '$S{testMac}')
      .withHeaders('X-Service-Key', '$S{serviceKey}')
      .expectStatus(200)
      .expectJsonLike({ data: { playlistId: '$S{playlistId}' } });
  });

  // Cleanup: delete test content and playlist
  flow.cleanup()
    .spec()
    .delete('/toy/content/music/{id}')
    .withPathParams('id', '$S{musicId}')
    .withHeaders('X-Service-Key', '$S{serviceKey}');
});
```

**Key patterns:**
- **`e2e.step()`** — ordered steps with named checkpoints
- **`stores()` / `$S{}`** — pass data between steps (IDs, tokens) without manual variables
- **`.cleanup()`** — auto-delete test data after flow completes
- **`expectJsonLike()`** — partial JSON matching for flexible assertions

### MQTT.js + Jest (mqtt/)

Simulates ESP32 device behavior by publishing MQTT messages and verifying responses.

**Example: Device Connect + Mode Change**

```js
const { DeviceSimulator } = require('../helpers/device-simulator');

describe('Device Lifecycle via MQTT', () => {
  let device;

  beforeAll(async () => {
    device = new DeviceSimulator({ mac: 'AA:BB:CC:DD:EE:01' });
    await device.connect();
  });

  afterAll(async () => {
    await device.disconnect();
  });

  it('should send hello and receive acknowledgement', async () => {
    const response = await device.sendHello();
    expect(response.type).toBe('hello_ack');
  });

  it('should change mode to music', async () => {
    const response = await device.sendModeChange('music');
    expect(response.type).toBe('mode_changed');
  });

  it('should handle RFID scan', async () => {
    const response = await device.sendCardLookup('RFID-TAG-001');
    expect(response.type).toBe('card_response');
    expect(response.content).toBeDefined();
  });

  it('gateway health should still be OK after all messages', async () => {
    const health = await axios.get(`${gatewayUrl}/health`);
    expect(health.status).toBe(200);
  });
});
```

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
| 1.5 | Firebase auth on content | `api/scenarios/auth-flow.spec.js` | PactumJS |
| 1.6 | Unauthorized blocked | `api/scenarios/auth-flow.spec.js` | PactumJS |
| 1.7 | Role-based access | `ui/scenarios/auth.spec.js` + `api/scenarios/auth-flow.spec.js` | Both |
| 2.1 | Register device | `ui/scenarios/device-management.spec.js` | Playwright |
| 2.2 | Device config retrieval | `api/scenarios/device-lifecycle.spec.js` | PactumJS |
| 2.3 | Update device settings | `ui/scenarios/device-management.spec.js` | Playwright |
| 12.2 | Content delivery pipeline | `api/scenarios/cross-service.spec.js` | PactumJS |
| 12.3 | RFID to playback | `api/scenarios/cross-service.spec.js` + `mqtt/scenarios/rfid-scan.spec.js` | Both |

### P1 - High

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 2.4 | Assign device to profile | `api/scenarios/device-lifecycle.spec.js` | PactumJS |
| 2.6 | Duplicate MAC | `api/scenarios/device-lifecycle.spec.js` | PactumJS |
| 2.7 | Device list pagination | `ui/scenarios/device-management.spec.js` | Playwright |
| 4.4 | Game analytics recorded | `api/scenarios/analytics-flow.spec.js` | PactumJS |
| 5.1-5.3 | Upload content | `ui/scenarios/content-library.spec.js` | Playwright |
| 5.4 | Assign to playlist | `api/scenarios/content-pipeline.spec.js` | PactumJS |
| 5.5 | Assign playlist to device | `api/scenarios/content-pipeline.spec.js` | PactumJS |
| 5.8 | Playback analytics | `api/scenarios/analytics-flow.spec.js` | PactumJS |
| 5.9 | Delete content | `ui/scenarios/content-library.spec.js` | Playwright |
| 6.1 | Register RFID tag | `ui/scenarios/rfid-management.spec.js` | Playwright |
| 6.2 | RFID scan triggers content | `mqtt/scenarios/rfid-scan.spec.js` | MQTT.js |
| 6.5 | Reassign RFID content | `api/scenarios/rfid-flow.spec.js` | PactumJS |

### P2 - Medium

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 7.1 | Create child profile | `ui/scenarios/kid-profiles.spec.js` | Playwright |
| 7.2 | Update child age | `api/scenarios/profile-flow.spec.js` | PactumJS |
| 8.1 | MQTT connection | `mqtt/scenarios/device-connect.spec.js` | MQTT.js |
| 8.2 | UDP audio stream | `mqtt/scenarios/device-connect.spec.js` | MQTT.js |
| 8.4 | Multi-device concurrent | `mqtt/scenarios/multi-device.spec.js` | MQTT.js |
| 9.1-9.9 | Dashboard CRUD | `ui/scenarios/*.spec.js` | Playwright |
| 10.1-10.3 | Analytics queries | `api/scenarios/analytics-flow.spec.js` | PactumJS |

### P3 - Low

| Scenario | Description | Test File | Tool |
|----------|-------------|-----------|------|
| 8.5 | Malformed MQTT message | `mqtt/scenarios/resilience.spec.js` | MQTT.js |
| 8.6 | Broker recovery | `mqtt/scenarios/resilience.spec.js` | MQTT.js |
| 11.1-11.4 | Provider failures | Out of scope (needs mock infra) | - |
| 11.5 | Concurrent updates | `api/scenarios/error-handling.spec.js` | PactumJS |
| 11.7 | XSS attempt | `api/scenarios/error-handling.spec.js` | PactumJS |
| 11.8 | SQL injection | `api/scenarios/error-handling.spec.js` | PactumJS |
| 11.9 | Rate limiting | `api/scenarios/error-handling.spec.js` | PactumJS |
| 11.10 | Invalid MAC format | `api/scenarios/error-handling.spec.js` | PactumJS |
| 12.4 | Profile-aware conversation | Out of scope (needs live agent) | pytest |
| 12.5 | Multi-device household | `mqtt/scenarios/multi-device.spec.js` | MQTT.js |

### Not Automatable in E2E (Agent-level — use pytest)

| Scenario | Reason |
|----------|--------|
| 3.1-3.7 | Voice session — requires real audio I/O |
| 4.1-4.3, 4.5-4.6 | Game modes — requires voice trigger to agent |
| 5.6-5.7, 5.10 | Content via voice/semantic search — agent internal |
| 7.3-7.6 | Memory system — tested via existing pytest suite |

---

## Configuration

### .env.example

```bash
# Target environment
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
SLOW_MO=0
```

### Shared Config

Both PactumJS and Playwright read from the same `.env` and share the same server targets as `api-tests/test.config.js`. No duplication.

---

## Page Object Models (Playwright)

Each Vue page gets a POM class that encapsulates selectors and actions:

```js
// pages/device-management.page.js
class DeviceManagementPage {
  constructor(page) {
    this.page = page;
    this.addButton = page.locator('button:has-text("Add")');
    this.deviceTable = page.locator('.el-table');
    this.searchInput = page.locator('[placeholder="Search"]');
    this.activationCodeInput = page.locator('[placeholder="Activation Code"]');
  }

  async goto() {
    await this.page.goto('/device-management');
  }

  async addDevice(activationCode) {
    await this.addButton.click();
    await this.activationCodeInput.fill(activationCode);
    await this.page.click('button:has-text("Confirm")');
  }

  async searchDevice(query) {
    await this.searchInput.fill(query);
    await this.page.keyboard.press('Enter');
  }

  async getDeviceCount() {
    return await this.deviceTable.locator('tr').count() - 1; // minus header
  }
}
```

### Pages to create (matches Vue views):

| POM File | Vue View | Dashboard Route |
|----------|----------|-----------------|
| `login.page.js` | `login.vue` | `/login` |
| `home.page.js` | `home.vue` | `/home` |
| `device-management.page.js` | `DeviceManagement.vue` | `/device-management` |
| `content-library.page.js` | `ContentLibrary.vue` | `/content-library` |
| `rfid-management.page.js` | `RfidManagement.vue` | `/rfid-management` |
| `kid-profiles.page.js` | `KidProfiles.vue` | `/kid-profiles` |
| `user-management.page.js` | `UserManagement.vue` | `/user-management` |
| `game-analytics.page.js` | `GameAnalytics.vue` | `/game-analytics` |

---

## Test Data Strategy

| Concern | Approach |
|---------|----------|
| **Creation** | Each test creates its own data via API before UI interaction |
| **Isolation** | Test data uses unique prefixes (`e2e-test-{uuid}`) to avoid conflicts |
| **Cleanup** | PactumJS `.cleanup()` + Jest `afterAll` delete test data |
| **No shared state** | Tests don't depend on pre-existing data in the database |
| **Idempotent** | Tests can run repeatedly without manual DB cleanup |

---

## CLI Commands

```bash
cd main/e2e-tests
npm install

# --- Run all E2E tests ---
npm test                              # Everything

# --- Run by layer ---
npm run test:ui                       # Playwright UI tests only
npm run test:api                      # PactumJS API flows only
npm run test:mqtt                     # MQTT device simulation only

# --- Run by scenario category ---
npm run test:ui -- --grep "device"    # Only device management UI tests
npm run test:api -- --grep "content"  # Only content pipeline API tests

# --- Playwright specific ---
npx playwright test --headed          # Watch browser (non-headless)
npx playwright test --ui              # Interactive Playwright UI mode
npx playwright show-report            # Open HTML report

# --- Debug ---
npx playwright test --debug           # Step-through debugger
npm run test:api -- --verbose         # Verbose PactumJS output
```

---

## Implementation Phases

### Phase 1: Foundation (scaffold + auth)
| File | Purpose |
|------|---------|
| `package.json` | Dependencies: playwright, pactum, jest, mqtt, dotenv |
| `playwright.config.js` | Playwright setup: base URL, auth state, reporters |
| `pactum.config.js` | PactumJS setup: base URL, default headers, stores |
| `jest.config.js` | Jest config for api/ and mqtt/ folders |
| `.env.example` | Environment template |
| `ui/fixtures/auth.fixture.js` | Playwright login + storageState reuse |
| `ui/pages/login.page.js` | Login page POM |
| `api/helpers/auth.helper.js` | Token acquisition for PactumJS |

### Phase 2: UI Scenarios (Playwright)
| File | Scenarios Covered |
|------|-------------------|
| `ui/pages/*.page.js` | All 8 page object models |
| `ui/scenarios/auth.spec.js` | 1.1, 1.7 |
| `ui/scenarios/device-management.spec.js` | 2.1, 2.3, 2.5, 2.7 |
| `ui/scenarios/content-library.spec.js` | 5.1-5.3, 5.9 |
| `ui/scenarios/rfid-management.spec.js` | 6.1, 6.5 |
| `ui/scenarios/kid-profiles.spec.js` | 7.1, 9.4 |
| `ui/scenarios/analytics.spec.js` | 10.5 |
| `ui/scenarios/settings.spec.js` | 9.8 |

### Phase 3: API Scenarios (PactumJS)
| File | Scenarios Covered |
|------|-------------------|
| `api/helpers/data.helper.js` | Test data factories |
| `api/helpers/cleanup.helper.js` | Teardown utilities |
| `api/scenarios/auth-flow.spec.js` | 1.2-1.6 |
| `api/scenarios/device-lifecycle.spec.js` | 2.2, 2.4, 2.6 |
| `api/scenarios/content-pipeline.spec.js` | 5.4, 5.5, 12.2 |
| `api/scenarios/rfid-flow.spec.js` | 6.5, 12.3 (API parts) |
| `api/scenarios/profile-flow.spec.js` | 7.2 |
| `api/scenarios/analytics-flow.spec.js` | 4.4, 5.8, 10.1-10.3 |
| `api/scenarios/error-handling.spec.js` | 11.5, 11.7-11.10 |
| `api/scenarios/cross-service.spec.js` | 12.2, 12.3 |

### Phase 4: MQTT Scenarios
| File | Scenarios Covered |
|------|-------------------|
| `mqtt/helpers/mqtt-client.helper.js` | MQTT connection wrapper |
| `mqtt/helpers/device-simulator.js` | ESP32 simulator |
| `mqtt/scenarios/device-connect.spec.js` | 8.1, 8.2 |
| `mqtt/scenarios/mode-change.spec.js` | 8.3 |
| `mqtt/scenarios/playback-control.spec.js` | Playback next/prev/start |
| `mqtt/scenarios/rfid-scan.spec.js` | 6.2-6.4, 6.6 |
| `mqtt/scenarios/content-request.spec.js` | play_music, play_story |
| `mqtt/scenarios/resilience.spec.js` | 8.5, 8.6 |
| `mqtt/scenarios/multi-device.spec.js` | 8.4, 12.5 |

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

---

## Relationship to Existing Test Layers

```
                    Scope
                      |
  Unit tests          |   pytest (memory, agent)
  (single function)   |   Jest (api-tests per-endpoint)
                      |
  Integration tests   |   PactumJS (multi-step API flows)
                      |   MQTT.js (device simulation)
                      |
  E2E tests           |   Playwright (full user journeys through browser)
                      |
                      +-----------------------------------------> Confidence
```

| Layer | Tool | Location | What it answers |
|-------|------|----------|-----------------|
| Per-endpoint | Jest + Axios | `api-tests/` | "Does this endpoint return correct status?" |
| API flows | PactumJS | `e2e-tests/api/` | "Does this multi-step scenario work?" |
| MQTT flows | MQTT.js + Jest | `e2e-tests/mqtt/` | "Does the device-to-cloud path work?" |
| UI flows | Playwright | `e2e-tests/ui/` | "Can the admin complete this task in the dashboard?" |
| Agent/Memory | pytest | `livekit-server/tests/` | "Does the AI agent behave correctly?" |

---

## Total File Count

| Phase | Files | Tests Created |
|-------|-------|---------------|
| Phase 1: Foundation | 8 | 0 (infrastructure only) |
| Phase 2: UI Scenarios | 16 | ~45 test cases |
| Phase 3: API Scenarios | 10 | ~35 test cases |
| Phase 4: MQTT Scenarios | 9 | ~25 test cases |
| **Total** | **~43 files** | **~105 test cases** |

Covering **~75 scenarios** from `E2E-TEST-SCENARIOS.md` (the remaining ~15 are voice/agent-level, handled by pytest).
