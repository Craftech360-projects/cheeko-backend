/**
 * Kid Roster Integration Tests — GET /toy/admin/kids
 *
 * Covers the system-wide kid roster that backs the dashboard's Kid Profiles
 * page, plus the two endpoints that page hands off to (Family 360 list and the
 * per-kid profile it drills into).
 *
 * Two layers:
 *
 *   1. Auth gates and route wiring. These need no database, so they run
 *      everywhere including CI.
 *   2. Live contract checks against real data. These assert that every field
 *      the Vue components bind is present and correctly *shaped* — a 200 with
 *      a subtly wrong type still renders a broken screen. They only run when
 *      SERVICE_SECRET_KEY is set and the database answers; otherwise the suite
 *      reports them as skipped rather than passing on nothing.
 *
 * Everything here is read-only. The dev database is a shared Supabase project,
 * not a disposable fixture, so no test in this file writes.
 */

require('dotenv').config();

const supertest = require('supertest');

const BASE = '/toy';
const SERVICE_KEY = process.env.SERVICE_SECRET_KEY;

/**
 * Target. By default the tests import the Express app, matching the rest of
 * this suite: that needs no database and covers routing and auth gates.
 *
 * Set TEST_API_URL (e.g. http://localhost:8002) to run them against a server
 * that can actually reach the database. Only then do the live contract checks
 * below have real rows to assert on.
 *
 *   TEST_API_URL=http://localhost:8002 npx jest tests/integration/kidRoster.test.js
 */
const TARGET = process.env.TEST_API_URL || require('../../src/app');
const request = () => supertest(TARGET);

// Loaded once in beforeAll and shared by the live assertions.
let roster = null;

/** Auth header for the service key ("god mode" path through requireAdmin). */
const asService = (req) => req.set('x-service-key', SERVICE_KEY || 'absent');

/**
 * The founder/* routes are gated by requireAuth, which only accepts a real
 * session token — the service key does not open them. Supply one to cover them:
 *
 *   TEST_API_URL=http://localhost:8002 TEST_ADMIN_TOKEN=<token> npx jest ...
 */
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN;
const asAdmin = (req) => req.set('Authorization', `Bearer ${ADMIN_TOKEN || 'absent'}`);

/**
 * Gating. Both flags are known before collection, so blocks that cannot run
 * report as *skipped* rather than passing without asserting anything.
 *
 *   describeLive  — needs a server that can reach the database
 *   describeAdmin — additionally needs a real session token for founder/*
 */
const LIVE = Boolean(process.env.TEST_API_URL && SERVICE_KEY);
const describeLive = LIVE ? describe : describe.skip;
const describeAdmin = LIVE && ADMIN_TOKEN ? describe : describe.skip;

// The roster every live assertion below reads. A failure here fails the suite
// loudly rather than quietly skipping — an unreachable server is a real result.
beforeAll(async () => {
  if (!LIVE) return;
  const res = await asService(request().get(`${BASE}/admin/kids`).query({ page: 1, limit: 200 }));
  expect(res.status).toBe(200);
  expect(res.body.code).toBe(0);
  roster = res.body.data;
}, 30000);

// ---------------------------------------------------------------------------
// 1. Auth gates — no database required
// ---------------------------------------------------------------------------

describe('GET /toy/admin/kids — auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await request().get(`${BASE}/admin/kids`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('code', 401);
  });

  it('rejects a bearer token that is not a real session', async () => {
    const res = await request()
      .get(`${BASE}/admin/kids`)
      .set('Authorization', 'Bearer not-a-real-token');

    expect([401, 403]).toContain(res.status);
    expect(res.body).toHaveProperty('code');
  });

  it('rejects a wrong service key', async () => {
    const res = await request()
      .get(`${BASE}/admin/kids`)
      .set('x-service-key', 'wrong-key');

    expect([401, 403]).toContain(res.status);
    expect(res.body).toHaveProperty('code');
  });

  // The route exists at all: an unknown sibling path must 404, so a 401 above
  // proves registration rather than a catch-all.
  it('is a registered route, not a catch-all', async () => {
    const res = await request().get(`${BASE}/admin/kids-does-not-exist`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 2. Pagination envelope
// ---------------------------------------------------------------------------

describeLive('GET /toy/admin/kids — pagination', () => {
  it('returns the standard envelope with total/page/limit/items', async () => {

    expect(roster).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
      limit: expect.any(Number),
      items: expect.any(Array),
    });
    expect(roster.items.length).toBeLessThanOrEqual(roster.limit);
    expect(roster.items.length).toBeLessThanOrEqual(roster.total);
  });

  it('honours an explicit page size', async () => {

    const res = await asService(request().get(`${BASE}/admin/kids`).query({ page: 1, limit: 1 }));

    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(1);
    expect(res.body.data.items.length).toBeLessThanOrEqual(1);
    // Total counts the whole table, not the page.
    expect(res.body.data.total).toBe(roster.total);
  });

  it('caps an oversized limit at 200 rather than dumping the table', async () => {

    const res = await asService(request().get(`${BASE}/admin/kids`).query({ limit: 99999 }));

    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(200);
  });

  it('coerces a nonsense page/limit to the first page', async () => {

    const res = await asService(request().get(`${BASE}/admin/kids`).query({ page: -5, limit: 'abc' }));

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.limit).toBe(50);
  });

  it('returns an empty page past the end without erroring', async () => {

    const res = await asService(request().get(`${BASE}/admin/kids`).query({ page: 9999, limit: 50 }));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(roster.total);
  });

  it('does not repeat a kid across consecutive pages', async () => {
    if (roster.total < 2) return;

    const [p1, p2] = await Promise.all([
      asService(request().get(`${BASE}/admin/kids`).query({ page: 1, limit: 1 })),
      asService(request().get(`${BASE}/admin/kids`).query({ page: 2, limit: 1 })),
    ]);

    const a = p1.body.data.items[0];
    const b = p2.body.data.items[0];
    expect(String(a.id)).not.toBe(String(b.id));
  });
});

// ---------------------------------------------------------------------------
// 3. The contract the dashboard binds to
//
// Each assertion below mirrors an expression in KidProfiles.vue. If one fails,
// a specific cell on the page renders wrong.
// ---------------------------------------------------------------------------

describeLive('GET /toy/admin/kids — dashboard field contract', () => {
  it('every row carries the keys the page reads', async () => {

    const required = [
      'id', 'user_id', 'name', 'nickname', 'birth_date', 'gender',
      'language', 'interests', 'parent_rule', 'parent_name',
      'devices', 'device_count', 'household_device_count',
    ];

    for (const row of roster.items) {
      for (const key of required) {
        expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(true);
      }
    }
  });

  it('never leaks the joined parent record or their contact details', async () => {

    for (const row of roster.items) {
      // Family 360 deliberately exposes a display name only.
      expect(row).not.toHaveProperty('sys_user');
      expect(row).not.toHaveProperty('email');
      expect(row).not.toHaveProperty('phone');
    }
  });

  it('gives every row a usable id and name for the row key and initials', async () => {

    const seen = new Set();
    for (const row of roster.items) {
      expect(row.id === null || row.id === undefined).toBe(false);
      expect(seen.has(String(row.id))).toBe(false); // :key must be unique
      seen.add(String(row.id));
      expect(typeof row.name).toBe('string');
      expect(row.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns interests as an array whenever it is set', async () => {

    for (const row of roster.items) {
      if (row.interests !== null && row.interests !== undefined) {
        expect(Array.isArray(row.interests)).toBe(true);
      }
    }
  });

  /**
   * birth_date is a Postgres date column, so it serialises as UTC-midnight ISO
   * ("2018-06-15T00:00:00.000Z") — the same shape every other kid endpoint
   * returns. KidProfiles.vue slices the day off it in `birthDateValue()`,
   * because the column prints the value and the edit dialog's date-picker
   * declares value-format="yyyy-MM-dd".
   *
   * What the page depends on, and therefore what this asserts: the value starts
   * with a yyyy-MM-dd day, and that day is the stored one at UTC midnight so
   * slicing cannot shift it across a timezone.
   */
  it('returns birth_date as a UTC-midnight date the page can slice to yyyy-MM-dd', async () => {

    for (const row of roster.items) {
      if (!row.birth_date) continue;
      expect(typeof row.birth_date).toBe('string');
      expect(row.birth_date.slice(0, 10)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const parsed = new Date(row.birth_date);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
      expect(parsed.toISOString().slice(0, 10)).toBe(row.birth_date.slice(0, 10));
      expect(parsed.getUTCHours()).toBe(0);
    }
  });

  it('always returns devices as an array with a numeric paired count', async () => {

    for (const row of roster.items) {
      expect(Array.isArray(row.devices)).toBe(true);
      expect(typeof row.device_count).toBe('number');
      expect(typeof row.household_device_count).toBe('number');
      expect(row.device_count).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives every listed device the fields the Toys label reads', async () => {

    for (const row of roster.items) {
      for (const device of row.devices) {
        expect(typeof device.mac_address).toBe('string');
        expect(device.mac_address.length).toBeGreaterThan(0);
        // deviceLabel() falls back to mac_address, so alias may be null but the
        // key must exist for the fallback to be meaningful.
        expect(Object.prototype.hasOwnProperty.call(device, 'alias')).toBe(true);
      }
    }
  });

  /**
   * device_count counts toys paired to this child; `devices` falls back to the
   * household's toys when nothing is paired. So a non-zero count means the
   * listed devices are the paired ones, and the count can never exceed them.
   */
  it('keeps paired count and the device list consistent', async () => {

    for (const row of roster.items) {
      if (row.device_count > 0) {
        expect(row.devices.length).toBe(row.device_count);
      } else if (row.household_device_count > 0) {
        expect(row.devices.length).toBe(row.household_device_count);
      } else {
        expect(row.devices).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The drill-down target: tapping a kid opens Family 360
// ---------------------------------------------------------------------------

describeAdmin('Kid roster drill-down', () => {
  it('resolves every rostered kid id to a family profile', async () => {

    // A sample keeps the suite fast while still covering paired and unpaired.
    const sample = roster.items.slice(0, 5);
    expect(sample.length).toBeGreaterThan(0);

    for (const row of sample) {
      const res = await asAdmin(
        request().get(`${BASE}/admin/founder/families/${encodeURIComponent(row.id)}/profile`)
      );

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toHaveProperty('kid');
      expect(res.body.data).toHaveProperty('devices');
      expect(Array.isArray(res.body.data.devices)).toBe(true);
      expect(String(res.body.data.kid.id)).toBe(String(row.id));
    }
  }, 30000);

  it('gives FamilyProfile.vue the device fields it renders', async () => {

    const withToys = roster.items.find((row) => row.devices.length > 0);
    if (!withToys) return;

    const res = await asAdmin(
      request().get(`${BASE}/admin/founder/families/${encodeURIComponent(withToys.id)}/profile`)
    );

    expect(res.status).toBe(200);
    for (const device of res.body.data.devices) {
      expect(device).toHaveProperty('macAddress');
      expect(device).toHaveProperty('alias');
      expect(device).toHaveProperty('online');
      expect(typeof device.online).toBe('boolean');
    }
  }, 30000);
});

// ---------------------------------------------------------------------------
// 5. Family 360 list — the other page that now defaults to card view
// ---------------------------------------------------------------------------

describe('GET /toy/admin/founder/families/list — auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await request().get(`${BASE}/admin/founder/families/list`);

    expect(res.status).toBe(401);
  });
});

describeAdmin('GET /toy/admin/founder/families/list', () => {
  it('returns the fields Families.vue binds', async () => {

    const res = await asAdmin(request().get(`${BASE}/admin/founder/families/list`).query({ limit: 200 }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      total: expect.any(Number),
      items: expect.any(Array),
    });

    const seen = new Set();
    for (const row of res.body.data.items) {
      for (const key of ['kidId', 'kidName', 'nickname', 'grade', 'parentName',
        'pairedDeviceCount', 'deviceCount']) {
        expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(true);
      }
      // :key="row.kidId" — duplicates would silently drop cards.
      expect(seen.has(String(row.kidId))).toBe(false);
      seen.add(String(row.kidId));
      expect(typeof row.deviceCount).toBe('number');
      expect(typeof row.pairedDeviceCount).toBe('number');
      // deviceCount is the household's toys; a child cannot be paired to more
      // toys than the household owns.
      expect(row.pairedDeviceCount).toBeLessThanOrEqual(row.deviceCount);
    }
  }, 30000);

  /**
   * Every sibling shares one deviceCount. Before pairedDeviceCount existed the
   * card printed that shared number as the child's own, so a parent with nine
   * children read as owning forty-five toys.
   */
  it('does not attribute the household toy count to each sibling', async () => {
    const res = await asAdmin(request().get(`${BASE}/admin/founder/families/list`).query({ limit: 200 }));
    expect(res.status).toBe(200);

    const byParent = new Map();
    for (const row of res.body.data.items) {
      if (!row.parentName) continue;
      if (!byParent.has(row.parentName)) byParent.set(row.parentName, []);
      byParent.get(row.parentName).push(row);
    }

    for (const [, siblings] of byParent) {
      if (siblings.length < 2) continue;
      // The shared household figure stays identical across siblings...
      const households = new Set(siblings.map((row) => row.deviceCount));
      expect(households.size).toBe(1);
      // ...while the per-child figure never exceeds it in total.
      const pairedTotal = siblings.reduce((sum, row) => sum + row.pairedDeviceCount, 0);
      expect(pairedTotal).toBeLessThanOrEqual(siblings[0].deviceCount);
    }
  }, 30000);

  it('counts the same children as the kid roster', async () => {

    const res = await asAdmin(request().get(`${BASE}/admin/founder/families/list`).query({ limit: 1 }));

    expect(res.body.data.total).toBe(roster.total);
  });
});
