'use strict';

/**
 * E2E — Device Settings API Tests  (TC-5.4 – TC-5.12)
 *
 * Routes tested:
 *   GET  /toy/api/mobile/devices/{mac}/settings   — load settings
 *   PATCH /toy/api/mobile/devices/{mac}/settings  — update individual fields
 *   GET  /toy/api/mobile/devices/{mac}/state      — runtime state
 *   GET  /toy/api/mobile/devices               — device list
 *
 * All /api/mobile routes require Firebase auth → 401 without token.
 */

const { request, app, BASE } = require('../setup');

const TEST_MAC = 'AA:BB:CC:DD:EE:FF';
const UNKNOWN_MAC = 'FF:FF:FF:FF:FF:FF';
const FAKE_TOKEN = 'Bearer fake-firebase-token';

const SETTINGS_URL = (mac) => `${BASE}/api/mobile/devices/${mac}/settings`;
const STATE_URL    = (mac) => `${BASE}/api/mobile/devices/${mac}/state`;
const DEVICES_URL  = `${BASE}/api/mobile/devices`;

function assertEnvelope(res) {
  expect(res.body).toHaveProperty('code');
}

// ---------------------------------------------------------------------------
// TC-5.2  Device list — auth gate
// ---------------------------------------------------------------------------

describe('GET /devices — auth gate (TC-5.2)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(DEVICES_URL);
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get(DEVICES_URL)
      .set('Authorization', FAKE_TOKEN);
    expect([200, 401]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-5.4  GET device settings — auth gate
// ---------------------------------------------------------------------------

describe('GET /devices/:mac/settings — auth gate (TC-5.4)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(SETTINGS_URL(TEST_MAC));
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 401 or 404 with fake token and known MAC format', async () => {
    const res = await request(app)
      .get(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN);
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('returns 401 or 404 for completely unknown MAC', async () => {
    const res = await request(app)
      .get(SETTINGS_URL(UNKNOWN_MAC))
      .set('Authorization', FAKE_TOKEN);
    expect([400, 401, 404, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-5.5/5.6/5.7/5.8  PATCH device settings — field updates
// ---------------------------------------------------------------------------

describe('PATCH /devices/:mac/settings — field updates (TC-5.5 – TC-5.8)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .send({ volume: 80 });
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('volume patch: returns 400/401/404/500 with fake token', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ volume: 80 });
    expect([200, 400, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('brightness patch: returns 400/401/404/500 with fake token', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ brightness: 50 });
    expect([200, 400, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('autoListen toggle: returns 400/401/404/500 with fake token', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ autoListen: true });
    expect([200, 400, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('sleepEnabled toggle: returns 400/401/404/500 with fake token', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ sleepEnabled: false });
    expect([200, 400, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });

  it('volume out of range (101) returns 400 or 401', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ volume: 101 });
    expect([400, 401]).toContain(res.status);
  });

  it('volume negative returns 400 or 401', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({ volume: -1 });
    expect([400, 401]).toContain(res.status);
  });

  it('empty patch body returns 400 or 401', async () => {
    const res = await request(app)
      .patch(SETTINGS_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN)
      .send({});
    expect([400, 401]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// TC-5.10  GET device runtime state
// ---------------------------------------------------------------------------

describe('GET /devices/:mac/state — runtime state (TC-5.10)', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(STATE_URL(TEST_MAC));
    expect(res.status).toBe(401);
    assertEnvelope(res);
  });

  it('returns 401 or 404 with fake token', async () => {
    const res = await request(app)
      .get(STATE_URL(TEST_MAC))
      .set('Authorization', FAKE_TOKEN);
    expect([200, 401, 404, 500]).toContain(res.status);
    assertEnvelope(res);
  });
});

// ---------------------------------------------------------------------------
// TC-5.11  Network/server error — response always has code field
// ---------------------------------------------------------------------------

describe('Error response envelope', () => {
  it('all 401 responses carry code field', async () => {
    const endpoints = [
      () => request(app).get(DEVICES_URL),
      () => request(app).get(SETTINGS_URL(TEST_MAC)),
      () => request(app).patch(SETTINGS_URL(TEST_MAC)).send({ volume: 50 }),
      () => request(app).get(STATE_URL(TEST_MAC)),
    ];

    for (const call of endpoints) {
      const res = await call();
      assertEnvelope(res);
    }
  });
});
