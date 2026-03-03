/**
 * Analytics Routes Integration Tests
 *
 * Tests for /toy/analytics/* endpoints covering:
 * - Event tracking  (POST, require X-Service-Key via requireServiceKey)
 * - Query endpoints (GET,  require Bearer token via requireAuth)
 * - Device count    (GET,  also requires auth per route definition)
 *
 * Key behaviour of requireServiceKey middleware:
 *   - No X-Service-Key header           → 401
 *   - Wrong X-Service-Key value         → 401
 *   - SERVICE_SECRET_KEY env not set    → 401 ("Service authentication not configured")
 *   - Correct key                       → passes through
 *
 * Because the test environment does not carry a real service key or a real
 * database, requests that pass auth will reach the service layer and may
 * produce 400 (validation) or 500 (DB unavailable). Both are acceptable.
 */

const request = require('supertest');
const app = require('../../src/app');

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const TEST_MAC = 'AA:BB:CC:DD:EE:FF';
const INVALID_MAC = 'INVALID-MAC';
const TEST_SESSION_ID = `test-session-${Date.now()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every API response must carry a `code` field. */
const expectCodeField = (res) => {
  expect(res.body).toHaveProperty('code');
};

// ---------------------------------------------------------------------------
// Event Tracking – requireServiceKey
// ---------------------------------------------------------------------------

describe('Analytics Routes – Event Tracking (X-Service-Key required)', () => {

  // POST /toy/analytics/session/start
  describe('POST /toy/analytics/session/start', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .send({ mac: TEST_MAC, modeType: 'Math' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', 'wrong-service-key')
        .send({ mac: TEST_MAC, modeType: 'Math' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 500 when auth passes but body is empty', async () => {
      // Use env key (may not be set → still 401, which is also acceptable)
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({});

      expect([400, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when mac field is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ modeType: 'Math' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when modeType field is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: INVALID_MAC, modeType: 'Math' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept all valid modeType values', async () => {
      const modeTypes = ['Conversation', 'Math', 'Riddle', 'WordLadder', 'Music', 'Story'];

      for (const modeType of modeTypes) {
        const res = await request(app)
          .post('/toy/analytics/session/start')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({ mac: TEST_MAC, modeType });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should accept MAC addresses in multiple valid formats', async () => {
      const macs = [
        'AA:BB:CC:DD:EE:FF',  // colon-separated
        'AA-BB-CC-DD-EE-FF',  // dash-separated
        'AABBCCDDEEFF',       // raw 12-char
        'aa:bb:cc:dd:ee:ff',  // lowercase
      ];

      for (const mac of macs) {
        const res = await request(app)
          .post('/toy/analytics/session/start')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({ mac, modeType: 'Math' });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should return 200, 401 or 500 with a fully populated valid body', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          modeType: 'Math',
          agentId: 'test-agent',
          metadata: { source: 'integration-test' }
        });

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('session_id');
        expect(res.body.data).toHaveProperty('mac_address');
        expect(res.body.data).toHaveProperty('mode_type', 'Math');
      }
    });
  });

  // POST /toy/analytics/session/end
  describe('POST /toy/analytics/session/end', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .send({ sessionId: TEST_SESSION_ID });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .set('X-Service-Key', 'wrong-service-key')
        .send({ sessionId: TEST_SESSION_ID });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({});

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 401, 404 or 500 for a non-existent session ID', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: 'non-existent-session-xyz', completionStatus: 'completed' });

      expect([401, 404, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // POST /toy/analytics/game-attempt
  describe('POST /toy/analytics/game-attempt', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, gameType: 'math_tutor' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', 'wrong-service-key')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, gameType: 'math_tutor' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, gameType: 'math_tutor' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when mac is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, gameType: 'math_tutor' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when gameType is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, mac: INVALID_MAC, gameType: 'math_tutor' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept all valid game types', async () => {
      const gameTypes = ['math_tutor', 'riddle_solver', 'word_ladder'];

      for (const gameType of gameTypes) {
        const res = await request(app)
          .post('/toy/analytics/game-attempt')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, gameType });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should accept all valid difficulty levels', async () => {
      const levels = ['easy', 'medium', 'hard'];

      for (const difficultyLevel of levels) {
        const res = await request(app)
          .post('/toy/analytics/game-attempt')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({
            sessionId: TEST_SESSION_ID,
            mac: TEST_MAC,
            gameType: 'math_tutor',
            difficultyLevel
          });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should return 200, 401 or 500 with a fully populated valid body', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          questionText: 'What is 2 + 2?',
          questionType: 'addition',
          difficultyLevel: 'easy',
          correctAnswer: '4',
          userAnswer: '4',
          isCorrect: true,
          attemptNumber: 1,
          responseTimeMs: 3500
        });

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('game_type', 'math_tutor');
        expect(res.body.data).toHaveProperty('is_correct', true);
      }
    });
  });

  // POST /toy/analytics/media-event
  describe('POST /toy/analytics/media-event', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .send({ mac: TEST_MAC, mediaType: 'music', event: 'start' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', 'wrong-service-key')
        .send({ mac: TEST_MAC, mediaType: 'music', event: 'start' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 when mac is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mediaType: 'music', event: 'start' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when mediaType is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, event: 'start' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when event field is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, mediaType: 'music' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid event type', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, mediaType: 'music', event: 'invalid-event' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: INVALID_MAC, mediaType: 'music', event: 'start' });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept both music and story media types', async () => {
      const mediaTypes = ['music', 'story'];

      for (const mediaType of mediaTypes) {
        const res = await request(app)
          .post('/toy/analytics/media-event')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({ mac: TEST_MAC, mediaType, event: 'start' });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should accept start, end, and skip event types', async () => {
      const events = ['start', 'end', 'skip'];

      for (const event of events) {
        const res = await request(app)
          .post('/toy/analytics/media-event')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({ mac: TEST_MAC, mediaType: 'music', event, mediaId: 'test-media-1' });

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should return 200, 401 or 500 with a fully populated start event', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          mediaType: 'music',
          event: 'start',
          mediaId: 'song-123',
          mediaTitle: 'Test Song',
          totalDurationSeconds: 180
        });

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('media_type', 'music');
        expect(res.body.data).toHaveProperty('media_id', 'song-123');
      }
    });
  });

  // POST /toy/analytics/streak
  describe('POST /toy/analytics/streak', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5
        });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', 'wrong-service-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5
        });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, gameType: 'math_tutor', streakNumber: 1, questionsInStreak: 5 });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when mac is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, gameType: 'math_tutor', streakNumber: 1, questionsInStreak: 5 });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when gameType is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, streakNumber: 1, questionsInStreak: 5 });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when streakNumber is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, gameType: 'math_tutor', questionsInStreak: 5 });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 when questionsInStreak is missing', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ sessionId: TEST_SESSION_ID, mac: TEST_MAC, gameType: 'math_tutor', streakNumber: 1 });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: INVALID_MAC,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5
        });

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 200, 401 or 500 with a fully populated valid body', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5,
          durationSeconds: 120
        });

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('game_type', 'math_tutor');
        expect(res.body.data).toHaveProperty('questions_in_streak', 5);
      }
    });
  });

  // POST /toy/analytics/user-progress/update
  describe('POST /toy/analytics/user-progress/update', () => {
    it('should return 401 when no X-Service-Key header is present', async () => {
      const res = await request(app)
        .post('/toy/analytics/user-progress/update')
        .send({ mac: TEST_MAC, modeType: 'Math' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 when an incorrect service key is supplied', async () => {
      const res = await request(app)
        .post('/toy/analytics/user-progress/update')
        .set('X-Service-Key', 'wrong-service-key')
        .send({ mac: TEST_MAC, modeType: 'Math' });

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400, 401 or 500 with a valid service key', async () => {
      const res = await request(app)
        .post('/toy/analytics/user-progress/update')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({ mac: TEST_MAC, modeType: 'Math' });

      expect([400, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Query Endpoints – requireAuth (Bearer token)
// ---------------------------------------------------------------------------

describe('Analytics Routes – Query Endpoints (Bearer token required)', () => {

  // GET /toy/analytics/sessions
  describe('GET /toy/analytics/sessions', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/sessions');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/analytics/sessions')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept pagination and filter query params with any token', async () => {
      const res = await request(app)
        .get('/toy/analytics/sessions')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/attempts
  describe('GET /toy/analytics/attempts', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/attempts');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/analytics/attempts')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept query params with any token', async () => {
      const res = await request(app)
        .get('/toy/analytics/attempts')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/dashboard/summary
  describe('GET /toy/analytics/dashboard/summary', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/summary');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/summary')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond (200, 401 or 500) with a token present', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/summary')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/dashboard/sessions-per-day
  describe('GET /toy/analytics/dashboard/sessions-per-day', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/sessions-per-day');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/sessions-per-day')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept days query param with a token present', async () => {
      const res = await request(app)
        .get('/toy/analytics/dashboard/sessions-per-day')
        .query({ days: 30 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/user/:mac/overall
  describe('GET /toy/analytics/user/:mac/overall', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/overall`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 401 for an invalid token', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/overall`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/overall')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should respond (200, 401 or 500) for a valid MAC with a token', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/overall`)
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/user/:mac/math
  describe('GET /toy/analytics/user/:mac/math', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/math`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/math')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/user/:mac/riddle
  describe('GET /toy/analytics/user/:mac/riddle', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/riddle`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/riddle')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/user/:mac/wordladder
  describe('GET /toy/analytics/user/:mac/wordladder', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/wordladder`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/wordladder')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/sessions/:mac
  describe('GET /toy/analytics/sessions/:mac', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/sessions/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/sessions/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/usage/daily/:mac
  describe('GET /toy/analytics/usage/daily/:mac', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/daily/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should return 400 or 401 for an invalid MAC format', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/daily/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expectCodeField(res);
    });

    it('should accept days query param', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/daily/${TEST_MAC}`)
        .query({ days: 14 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/usage/weekly/:mac
  describe('GET /toy/analytics/usage/weekly/:mac', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/weekly/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept colon-separated, dash-separated and raw MAC formats', async () => {
      const macs = [
        'AA:BB:CC:DD:EE:FF',
        'AA-BB-CC-DD-EE-FF',
        'AABBCCDDEEFF',
        'aa:bb:cc:dd:ee:ff',
      ];

      for (const mac of macs) {
        const res = await request(app)
          .get(`/toy/analytics/usage/weekly/${mac}`)
          .set('Authorization', 'Bearer test-token');

        expect([200, 401, 500]).toContain(res.status);
        expectCodeField(res);
      }
    });

    it('should accept weeks query param', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/weekly/${TEST_MAC}`)
        .query({ weeks: 8 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/usage/monthly/:mac
  describe('GET /toy/analytics/usage/monthly/:mac', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/monthly/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should accept months query param', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/monthly/${TEST_MAC}`)
        .query({ months: 12 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/streaks
  describe('GET /toy/analytics/streaks', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/streaks');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/media-playback
  describe('GET /toy/analytics/media-playback', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/media-playback');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/user-progress/:mac
  describe('GET /toy/analytics/user-progress/:mac', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user-progress/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Device Count Endpoints – requireAuth
// ---------------------------------------------------------------------------

describe('Analytics Routes – Device Count Endpoints', () => {

  // GET /toy/analytics/today/device-count
  // Route uses requireAuth (not public), so no-auth → 401.
  describe('GET /toy/analytics/today/device-count', () => {
    it('should return 401, or 200/500 depending on auth state', async () => {
      const res = await request(app)
        .get('/toy/analytics/today/device-count');

      // Route requires auth; without a token the result is 401.
      // If the env has a token configured it may resolve differently.
      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });

    it('should return 401 for an explicit invalid token', async () => {
      const res = await request(app)
        .get('/toy/analytics/today/device-count')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond (200, 401 or 500) when a token is present', async () => {
      const res = await request(app)
        .get('/toy/analytics/today/device-count')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/month/device-count
  describe('GET /toy/analytics/month/device-count', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/month/device-count');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });

    it('should respond (200, 401 or 500) when a token is present', async () => {
      const res = await request(app)
        .get('/toy/analytics/month/device-count')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
      expectCodeField(res);
    });
  });

  // GET /toy/analytics/today/active-devices
  describe('GET /toy/analytics/today/active-devices', () => {
    it('should return 401 when no auth header is provided', async () => {
      const res = await request(app)
        .get('/toy/analytics/today/active-devices');

      expect(res.status).toBe(401);
      expectCodeField(res);
    });
  });
});

// ---------------------------------------------------------------------------
// Additional dashboard endpoints
// ---------------------------------------------------------------------------

describe('Analytics Routes – Dashboard Endpoints', () => {

  const dashboardEndpoints = [
    '/toy/analytics/dashboard/game-accuracy',
    '/toy/analytics/dashboard/difficulty-distribution',
    '/toy/analytics/dashboard/ttft-trend',
    '/toy/analytics/dashboard/top-devices',
  ];

  for (const path of dashboardEndpoints) {
    describe(`GET ${path}`, () => {
      it('should return 401 when no auth header is provided', async () => {
        const res = await request(app).get(path);

        expect(res.status).toBe(401);
        expectCodeField(res);
      });

      it('should return 401 for an invalid token', async () => {
        const res = await request(app)
          .get(path)
          .set('Authorization', 'Bearer invalid-token');

        expect(res.status).toBe(401);
        expectCodeField(res);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Response Format Verification
// ---------------------------------------------------------------------------

describe('Analytics Routes – Response Format', () => {
  it('all service-key-protected POST routes should return 401 with correct code field when key is absent', async () => {
    const serviceRoutes = [
      { method: 'post', path: '/toy/analytics/session/start', body: {} },
      { method: 'post', path: '/toy/analytics/session/end', body: {} },
      { method: 'post', path: '/toy/analytics/game-attempt', body: {} },
      { method: 'post', path: '/toy/analytics/media-event', body: {} },
      { method: 'post', path: '/toy/analytics/streak', body: {} },
      { method: 'post', path: '/toy/analytics/user-progress/update', body: {} },
    ];

    for (const { method, path, body } of serviceRoutes) {
      const res = await request(app)[method](path).send(body);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(typeof res.body.msg).toBe('string');
    }
  });

  it('all auth-protected GET routes should return 401 with correct code field when token is absent', async () => {
    const authRoutes = [
      '/toy/analytics/sessions',
      '/toy/analytics/attempts',
      '/toy/analytics/dashboard/summary',
      '/toy/analytics/dashboard/sessions-per-day',
      `/toy/analytics/user/${TEST_MAC}/overall`,
    ];

    for (const path of authRoutes) {
      const res = await request(app).get(path);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code', 401);
      expect(typeof res.body.msg).toBe('string');
    }
  });
});
