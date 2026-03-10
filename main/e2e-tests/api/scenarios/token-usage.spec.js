/**
 * Token Usage & Analytics E2E Scenarios
 * Covers: Token recording, per-device stats, daily summaries, dashboard analytics
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders } = require('../helpers/auth.helper');
const { uniqueId } = require('../helpers/data.helper');

const TEST_MAC = 'e2e000000002';

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

describe('Token Usage E2E', () => {

  describe('Step 1: Record token usage', () => {
    it('should record token usage for a device session', async () => {
      await pactum.spec()
        .post('/device/token-usage')
        .withJson({
          mac: TEST_MAC,
          sessionId: `e2e-token-${uniqueId()}`,
          inputTokens: 150,
          outputTokens: 200,
          messageCount: 5,
          sessionDurationSeconds: 120,
        })
        .expectStatus(200);
    });
  });

  describe('Step 2: Query token usage by MAC', () => {
    it('should return token usage for device', async () => {
      await pactum.spec()
        .get(`/device/token-usage/${TEST_MAC}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 3: Token usage stats', () => {
    it('should return token usage stats for device', async () => {
      await pactum.spec()
        .get(`/device/token-usage/${TEST_MAC}/stats`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('Step 4: Token usage summary', () => {
    it('should return overall token usage summary', async () => {
      await pactum.spec()
        .get('/device/token-usage/summary')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });
});

// ── Extended Analytics ──────────────────────────────────────────────────────

describe('Extended Analytics E2E', () => {

  const TEST_ANALYTICS_MAC = 'e2e000000001';

  describe('Session end', () => {
    it('should end a session', async () => {
      // Start a session first
      const res = await pactum.spec()
        .post('/analytics/session/start')
        .withHeaders(getServiceKeyHeaders())
        .withJson({ mac: TEST_ANALYTICS_MAC, modeType: 'Riddle' })
        .expectStatus(200)
        .returns('res.body');

      // session_id is in data.session_id (Prisma column name)
      const sessionId = res?.data?.session_id || res?.data?.id;
      if (!sessionId) return;

      await pactum.spec()
        .post('/analytics/session/end')
        .withHeaders(getServiceKeyHeaders())
        .withJson({ sessionId })
        .expectStatus(200);
    });
  });

  describe('Streak recording', () => {
    it('should record a streak', async () => {
      await pactum.spec()
        .post('/analytics/streak')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          sessionId: `e2e-streak-${uniqueId()}`,
          mac: TEST_ANALYTICS_MAC,
          gameType: 'math',
          streakNumber: 1,
          questionsInStreak: 3,
        })
        .expectStatus(200);
    });
  });

  describe('User progress update', () => {
    it('should update user progress', async () => {
      await pactum.spec()
        .post('/analytics/user-progress/update')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          mac: TEST_ANALYTICS_MAC,
          modeType: 'Math',
          totalSessions: 1,
          totalGamesPlayed: 1,
          totalCorrectAnswers: 1,
        })
        .expectStatus(200);
    });
  });

  describe('Per-device analytics queries', () => {
    it('should return overall stats for device', async () => {
      await pactum.spec()
        .get(`/analytics/user/${TEST_ANALYTICS_MAC}/overall`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return math stats for device', async () => {
      await pactum.spec()
        .get(`/analytics/user/${TEST_ANALYTICS_MAC}/math`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return weekly usage', async () => {
      await pactum.spec()
        .get(`/analytics/usage/weekly/${TEST_ANALYTICS_MAC}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return monthly usage', async () => {
      await pactum.spec()
        .get(`/analytics/usage/monthly/${TEST_ANALYTICS_MAC}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

  describe('Dashboard analytics', () => {
    it('should return sessions per day', async () => {
      await pactum.spec()
        .get('/analytics/dashboard/sessions-per-day')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return game accuracy', async () => {
      await pactum.spec()
        .get('/analytics/dashboard/game-accuracy')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return top devices', async () => {
      await pactum.spec()
        .get('/analytics/dashboard/top-devices')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return today active device count', async () => {
      await pactum.spec()
        .get('/analytics/today/device-count')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });

    it('should return today active devices list', async () => {
      await pactum.spec()
        .get('/analytics/today/active-devices')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

  describe('Usage analytics (token-level)', () => {
    it('should return daily summary', async () => {
      await pactum.spec()
        .get('/usage/analytics/daily-summary')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should return per-device analytics', async () => {
      await pactum.spec()
        .get('/usage/analytics/per-device')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });

    it('should return totals', async () => {
      await pactum.spec()
        .get('/usage/analytics/totals')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });
});
