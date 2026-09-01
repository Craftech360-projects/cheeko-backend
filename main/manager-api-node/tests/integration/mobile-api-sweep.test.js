/**
 * Mobile app API sweep.
 *
 * Exercises every /toy/api/mobile/* endpoint the Flutter parent app calls, plus
 * the rest of the Firebase-backed mobile surface, against the configured
 * database. Firebase token verification is mocked — the middleware's own job is
 * covered by mobile-device-settings.test.js (the 401 cases); everything behind
 * it (route → service → DB) is what runs here for real.
 *
 * The fixture parent is an existing sys_user that owns devices and kids. Its
 * firebase_uid is stamped for the duration of the run and restored afterwards,
 * because the mobile services resolve the parent by firebase_uid and no dev row
 * carries one.
 */

// Jest does not load .env, and this suite talks to the real database.
require('dotenv').config();

const SWEEP_UID = 'mobile-api-sweep-uid';

// Injected by beforeAll once the fixture user is resolved.
const mockCtx = { user: null };

jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, res, next) => {
    if (!mockCtx.user) return res.status(500).json({ msg: 'fixture user not loaded' });
    req.firebaseUser = { uid: SWEEP_UID, email: mockCtx.user.email };
    req.mobileUser = mockCtx.user;
    next();
  },
  ensureFirebaseInit: () => true,
}));

const request = require('supertest');
const app = require('../../src/app');
const { prisma } = require('../../src/config/database');

const BASE = '/toy/api/mobile';

// Fixture: the parent that owns the child-owned-state verification data.
const FIXTURE_USER_ID = 3n;
const MAC = '3C:0F:02:D4:89:54'; // owned by user 3, paired to kid 4
const UNPAIRED_MAC = 'FC:01:2C:CF:EB:54'; // owned by user 3, kid_id null — kid 4 was released from it
const KID_ID = 4;

let previousUid;
let hadParentProfile;
let agentId;
const results = [];

/** Run one endpoint, record the outcome, and assert it is not a server error. */
async function probe(name, run, { allow = [200, 201], soft = false } = {}) {
  const res = await run();
  const ok = allow.includes(res.statusCode);
  results.push({ name, status: res.statusCode, ok });
  if (!soft && !ok) {
    throw new Error(`${name} → ${res.statusCode} ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res;
}

beforeAll(async () => {
  const user = await prisma.sys_user.findUnique({ where: { id: FIXTURE_USER_ID } })
    .catch((e) => { throw new Error(`prisma ${e.code}: ${e.message.split('\n').pop()}`); });
  if (!user) throw new Error(`fixture sys_user ${FIXTURE_USER_ID} missing`);
  previousUid = user.firebase_uid;
  // The profile write probes upsert one. Remember whether it is ours to remove.
  hadParentProfile = Boolean(await prisma.parent_profile.findFirst({
    where: { user_id: FIXTURE_USER_ID }, select: { id: true },
  }));
  mockCtx.user = await prisma.sys_user.update({
    where: { id: FIXTURE_USER_ID },
    data: { firebase_uid: SWEEP_UID },
  });
}, 30000);

afterAll(async () => {
  if (mockCtx.user) {
    await prisma.sys_user.update({
      where: { id: FIXTURE_USER_ID },
      data: { firebase_uid: previousUid },
    });
    if (!hadParentProfile) {
      await prisma.parent_profile.deleteMany({ where: { user_id: FIXTURE_USER_ID } });
    }
  }
  // eslint-disable-next-line no-console
  console.log('\n─── mobile API sweep ───');
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${String(r.status).padEnd(4)} ${r.name}`);
  }
  await prisma.$disconnect();
}, 30000);

describe('mobile API sweep — parent profile', () => {
  it('GET /parent-profile', async () => {
    await probe('GET /parent-profile', () => request(app).get(`${BASE}/parent-profile`), {
      allow: [200, 404],
    });
  });

  it('PUT /parent-profile', async () => {
    await probe('PUT /parent-profile', () =>
      request(app).put(`${BASE}/parent-profile`).send({ name: 'Sweep Parent' }), { allow: [200] });
  });

  it('PUT + DELETE /parent-profile/fcm-token', async () => {
    await probe('PUT /parent-profile/fcm-token', () =>
      request(app).put(`${BASE}/parent-profile/fcm-token`).send({ fcmToken: 'sweep-fcm-token' }));
    await probe('DELETE /parent-profile/fcm-token', () =>
      request(app).delete(`${BASE}/parent-profile/fcm-token`));
  });
});

describe('mobile API sweep — user state', () => {
  it('GET /user-state', async () => {
    await probe('GET /user-state', () => request(app).get(`${BASE}/user-state`), {
      allow: [200, 404],
    });
  });

  it('POST /user-state', async () => {
    await probe('POST /user-state', () => request(app).post(`${BASE}/user-state`).send({}));
  });

  it('PUT /user-state', async () => {
    await probe('PUT /user-state', () => request(app).put(`${BASE}/user-state`).send({}));
  });

  it('PUT /user-state/onboarding-completed', async () => {
    await probe('PUT /user-state/onboarding-completed', () =>
      request(app).put(`${BASE}/user-state/onboarding-completed`).send({}));
  });
});

describe('mobile API sweep — home + progress', () => {
  const cases = [
    ['GET /homepage-activity', '/homepage-activity?period=week'],
    ['GET /homepage-activity/details', '/homepage-activity/details?metric=games&period=week'],
    ['GET /progress/summary', '/progress/summary?period=today'],
    ['GET /progress/details', '/progress/details?metric=games&period=week'],
    ['GET /progress/quiz', '/progress/quiz?period=today'],
    ['GET /progress/trend', '/progress/trend?period=week'],
    ['GET /recommendations/homepage', `/recommendations/homepage?kidId=${KID_ID}`],
    ['GET /homepage-recommendations', `/homepage-recommendations?kidId=${KID_ID}`],
  ];

  it.each(cases)('%s', async (name, path) => {
    await probe(name, () => request(app).get(`${BASE}${path}`));
  });

  // The path the shipped app calls (java_api_service.dart), and the shape its
  // QuizProgress model parses. A 404 here, or a body without `characters`, is
  // invisible in the app — it renders the empty card either way.
  it('GET /quiz/progress returns the shape the app parses', async () => {
    const res = await probe('GET /quiz/progress (app path)', () =>
      request(app).get(`${BASE}/quiz/progress?period=today&mac=${MAC}`));

    const data = res.body.data;
    expect(Array.isArray(data.characters)).toBe(true);
    expect(data.characters.map((c) => c.character_id)).toEqual(['quizy', 'riddler']);
    for (const character of data.characters) {
      expect(character).toEqual(expect.objectContaining({
        character_id: expect.any(String),
        character_name: expect.any(String),
        level: expect.any(Number),
        questions_answered: expect.any(Number),
        total_questions: expect.any(Number),
        status: expect.stringMatching(/^(not_started|in_progress|completed)$/),
      }));
      expect(character.questions_answered).toBeLessThanOrEqual(character.total_questions);
    }
    expect(data.total_questions_answered).toBe(
      data.characters.reduce((sum, c) => sum + c.questions_answered, 0));
    // eslint-disable-next-line no-console
    console.log('QUIZ CARD PAYLOAD', JSON.stringify(data));
  });

  // UNPAIRED_MAC held kid 4 before they moved to MAC (device_kid_assignment
  // records the release). Reading it must show a fresh start, not the level the
  // previous child reached — the sibling leak this branch exists to close.
  it('GET /quiz/progress on a handed-on toy shows no previous child level', async () => {
    const res = await probe('GET /quiz/progress (handed-on toy)', () =>
      request(app).get(`${BASE}/quiz/progress?period=today&mac=${UNPAIRED_MAC}`));

    const paired = await request(app).get(`${BASE}/quiz/progress?period=today&mac=${MAC}`);
    expect(paired.body.data.total_questions_answered).toBeGreaterThan(0);
    expect(res.body.data.total_questions_answered).toBe(0);
    for (const character of res.body.data.characters) {
      expect(character.status).toBe('not_started');
      expect(character.level).toBe(1);
    }
  });
});

describe('mobile API sweep — kids', () => {
  let createdKidId;

  it('GET /kids', async () => {
    const res = await probe('GET /kids', () => request(app).get(`${BASE}/kids`));
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /kids then PUT then DELETE', async () => {
    const created = await probe('POST /kids', () =>
      request(app).post(`${BASE}/kids`).send({
        name: 'Sweep Kid',
        birth_date: '2020-01-01',
        gender: 'other',
        language: 'en',
      }), { allow: [200, 201] });
    createdKidId = created.body?.id ?? created.body?.data?.id;
    expect(createdKidId).toBeDefined();

    await probe('PUT /kids/:id', () =>
      request(app).put(`${BASE}/kids/${createdKidId}`).send({ name: 'Sweep Kid Renamed' }));

    await probe('DELETE /kids/:id', () =>
      request(app).delete(`${BASE}/kids/${createdKidId}`));
  });

  it('GET /kids/:kidId/imagine', async () => {
    await probe('GET /kids/:kidId/imagine', () =>
      request(app).get(`${BASE}/kids/${KID_ID}/imagine?limit=10`));
  });

  // The custom card belongs to the child, not the toy: 200 with a null
  // contentPack before anything is recorded is the normal answer here.
  it('GET /kids/:kidId/custom-card', async () => {
    await probe('GET /kids/:kidId/custom-card', () =>
      request(app).get(`${BASE}/kids/${KID_ID}/custom-card`));
  });
});

describe('mobile API sweep — agents', () => {
  it('GET /agents', async () => {
    const res = await probe('GET /agents', () => request(app).get(`${BASE}/agents?page=1&limit=10`));
    const list = res.body?.data?.list || res.body?.data || [];
    agentId = Array.isArray(list) && list.length ? (list[0].id || list[0].agentId) : null;
    expect(res.body).toHaveProperty('data');
  });

  it('GET /agents/:agentId', async () => {
    if (!agentId) return;
    await probe('GET /agents/:agentId', () => request(app).get(`${BASE}/agents/${agentId}`));
  });

  it('GET /agents/:agentId/devices', async () => {
    if (!agentId) return;
    await probe('GET /agents/:agentId/devices', () =>
      request(app).get(`${BASE}/agents/${agentId}/devices`));
  });

  it('GET /agents/:agentId/sessions', async () => {
    if (!agentId) return;
    await probe('GET /agents/:agentId/sessions', () =>
      request(app).get(`${BASE}/agents/${agentId}/sessions?page=1&limit=10`));
  });

  it('GET /agents/device/:mac/agent-id', async () => {
    await probe('GET /agents/device/:mac/agent-id', () =>
      request(app).get(`${BASE}/agents/device/${MAC}/agent-id`));
  });
});

describe('mobile API sweep — devices', () => {
  it('GET /devices', async () => {
    const res = await probe('GET /devices', () => request(app).get(`${BASE}/devices`));
    expect(res.body?.data).toHaveProperty('list');
  });

  it('GET /user-devices', async () => {
    await probe('GET /user-devices', () => request(app).get(`${BASE}/user-devices`));
  });

  const deviceCases = [
    ['GET /devices/:mac/settings', '/settings'],
    ['GET /devices/:mac/state', '/state'],
    ['GET /devices/:mac/sync-events', '/sync-events?limit=10'],
    ['GET /devices/:mac/analytics/overview', '/analytics/overview'],
    ['GET /devices/:mac/analytics/timeseries', '/analytics/timeseries'],
    ['GET /devices/:mac/analytics/events', '/analytics/events?limit=10'],
    ['GET /devices/:mac/analytics/battery', '/analytics/battery'],
    ['GET /devices/:mac/games-played', '/games-played?period=week'],
    ['GET /devices/:mac/radio-played', '/radio-played?period=week'],
    ['GET /devices/:mac/imagine', '/imagine?limit=10'],
  ];

  it.each(deviceCases)('%s', async (name, suffix) => {
    await probe(name, () => request(app).get(`${BASE}/devices/${MAC}${suffix}`));
  });

  // No-op patch: sends back the volume the device already has, so nothing changes
  // and no gateway publish is attempted against an offline dev toy.
  it('PATCH /devices/:mac/settings (no-op)', async () => {
    const current = await request(app).get(`${BASE}/devices/${MAC}/settings`);
    const volume = current.body?.data?.settings?.volume ?? 50;
    await probe('PATCH /devices/:mac/settings', () =>
      request(app).patch(`${BASE}/devices/${MAC}/settings`).send({ settings: { volume } }));
  });

  it('GET /devices/:mac/settings for a device this parent does not own → 404', async () => {
    await probe('GET /devices/<foreign mac>/settings', () =>
      request(app).get(`${BASE}/devices/00:16:3E:AC:B5:38/settings`), { allow: [404] });
  });
});

describe('mobile API sweep — misc', () => {
  it('GET /check-email', async () => {
    await probe('GET /check-email', () =>
      request(app).get(`${BASE}/check-email?email=nobody@example.com`));
  });

  it('GET /activation/check-code', async () => {
    await probe('GET /activation/check-code', () =>
      request(app).get(`${BASE}/activation/check-code?code=000000`));
  });
});
