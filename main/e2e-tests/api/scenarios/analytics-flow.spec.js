/**
 * Analytics Flow E2E Scenarios
 * Covers: 4.4 Game session, 5.8 Playback analytics, 10.1-10.3 Usage stats
 */

const pactum = require('pactum');
const config = require('../../test.config');
const { getServiceKeyHeaders, getBearerHeaders } = require('../helpers/auth.helper');
const { uniqueId } = require('../helpers/data.helper');

beforeAll(() => {
  pactum.request.setBaseUrl(config.managerApi.baseUrl);
  pactum.request.setDefaultTimeout(config.settings.timeoutMs);
});

const TEST_MAC = 'e2e000000001';

describe('Analytics Flow E2E', () => {

  let sessionId = null;

  describe('4.4 - Record game session', () => {
    it('should start a session', async () => {
      const res = await pactum.spec()
        .post('/analytics/session/start')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          mac: TEST_MAC,
          modeType: 'Math',
        })
        .expectStatus(200)
        .returns('data.id');

      sessionId = res;
    });

    it('should record a game attempt', async () => {
      await pactum.spec()
        .post('/analytics/game-attempt')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          sessionId: sessionId || `e2e-session-${uniqueId()}`,
          mac: TEST_MAC,
          gameType: 'math',
          questionText: '2 + 2',
          correctAnswer: '4',
          userAnswer: '4',
          isCorrect: true,
          difficultyLevel: 'easy',
        })
        .expectStatus(200);
    });
  });

  describe('5.8 - Record media playback', () => {
    it('should record a media event', async () => {
      await pactum.spec()
        .post('/analytics/media-event')
        .withHeaders(getServiceKeyHeaders())
        .withJson({
          mac: TEST_MAC,
          mediaType: 'music',
          mediaId: 99999,
          mediaTitle: 'E2E Test Song',
          event: 'start',
          durationPlayedSeconds: 180,
        })
        .expectStatus(200);
    });
  });

  describe('10.1 - Query sessions', () => {
    it('should return session list', async () => {
      await pactum.spec()
        .get('/analytics/sessions')
        .withHeaders(getBearerHeaders())
        .expectStatus(200)
        .expectJsonLike({ code: 0 });
    });
  });

  describe('10.3 - Query usage stats', () => {
    it('should return daily usage for a device', async () => {
      await pactum.spec()
        .get(`/analytics/usage/daily/${TEST_MAC}`)
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

  describe('Dashboard summary', () => {
    it('should return dashboard summary', async () => {
      await pactum.spec()
        .get('/analytics/dashboard/summary')
        .withHeaders(getBearerHeaders())
        .expectStatus(200);
    });
  });

});
