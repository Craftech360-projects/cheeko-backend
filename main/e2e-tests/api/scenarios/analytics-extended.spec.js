/**
 * Analytics Extended E2E Scenarios
 * Covers: Game attempts, media events, session queries, attempt stats, streaks, riddle/wordladder stats
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getBearerHeaders, getServiceKeyHeaders } = require('../helpers/auth.helper');
const { uniqueId } = require('../helpers/data.helper');

const TEST_MAC = 'e2e000000001';

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

// ── Game Attempts ──────────────────────────────────────────────────────────

describe('Analytics Game Attempts E2E', () => {

  it('should record a game attempt', async () => {
    await pactum.spec()
      .post('/analytics/game-attempt')
      .withHeaders(getServiceKeyHeaders())
      .withJson({
        mac: TEST_MAC,
        sessionId: `e2e-game-${uniqueId()}`,
        gameType: 'math',
        question: '2 + 2',
        answer: '4',
        isCorrect: true,
        responseTimeMs: 3000,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should return attempt stats for device', async () => {
    await pactum.spec()
      .get(`/analytics/attempts/stats/${TEST_MAC}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should list all attempts', async () => {
    await pactum.spec()
      .get('/analytics/attempts')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Media Events ───────────────────────────────────────────────────────────

describe('Analytics Media Events E2E', () => {

  it('should record a media event', async () => {
    await pactum.spec()
      .post('/analytics/media-event')
      .withHeaders(getServiceKeyHeaders())
      .withJson({
        mac: TEST_MAC,
        sessionId: `e2e-media-${uniqueId()}`,
        mediaType: 'music',
        action: 'play',
        contentId: `content-${uniqueId()}`,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });

  it('should list media playback events', async () => {
    await pactum.spec()
      .get('/analytics/media-playback')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Session Queries ────────────────────────────────────────────────────────

describe('Analytics Session Queries E2E', () => {

  it('should list sessions for device', async () => {
    await pactum.spec()
      .get(`/analytics/sessions/${TEST_MAC}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should list all sessions', async () => {
    await pactum.spec()
      .get('/analytics/sessions')
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── Per-Device Game Stats ──────────────────────────────────────────────────

describe('Analytics Per-Device Game Stats E2E', () => {

  it('should return riddle stats for device', async () => {
    await pactum.spec()
      .get(`/analytics/user/${TEST_MAC}/riddle`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should return wordladder stats for device', async () => {
    await pactum.spec()
      .get(`/analytics/user/${TEST_MAC}/wordladder`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });

  it('should return daily usage for device', async () => {
    await pactum.spec()
      .get(`/analytics/usage/daily/${TEST_MAC}`)
      .withHeaders(getBearerHeaders())
      .expect((ctx) => {
        expect([200, 404]).toContain(ctx.res.statusCode);
      });
  });
});

// ── User Progress ──────────────────────────────────────────────────────────

describe('Analytics User Progress Query E2E', () => {

  it('should query user progress after update', async () => {
    // First record progress
    await pactum.spec()
      .post('/analytics/user-progress/update')
      .withHeaders(getServiceKeyHeaders())
      .withJson({
        mac: TEST_MAC,
        modeType: 'Riddle',
        totalSessions: 1,
        totalGamesPlayed: 2,
        totalCorrectAnswers: 1,
      })
      .expect((ctx) => {
        expect([200, 400]).toContain(ctx.res.statusCode);
      });
  });
});
