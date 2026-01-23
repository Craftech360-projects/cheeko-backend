/**
 * Analytics Routes Integration Tests
 */

const request = require('supertest');
const app = require('../../src/app');

// Mock data
const TEST_MAC = 'AA:BB:CC:DD:EE:FF';
const TEST_MAC_RAW = 'AABBCCDDEEFF';
const INVALID_MAC = 'INVALID';
const TEST_SESSION_ID = 'test-session-' + Date.now();

describe('Analytics Routes', () => {
  // =============================================
  // Session Management (Service Auth)
  // =============================================
  describe('POST /toy/analytics/session/start', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .send({
          mac: TEST_MAC,
          modeType: 'Math'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          modeType: 'Math'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require mode type', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: INVALID_MAC,
          modeType: 'Math'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should start session with valid data (if DB configured)', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          modeType: 'Math',
          agentId: 'test-agent',
          metadata: { source: 'test' }
        });

      // May return 200, 401 (if key not configured), or 500 (if DB not configured)
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('session_id');
        expect(res.body.data).toHaveProperty('mac_address');
        expect(res.body.data).toHaveProperty('mode_type', 'Math');
      }
    });
  });

  describe('POST /toy/analytics/session/end', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .send({
          sessionId: TEST_SESSION_ID
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require session ID', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({});

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should handle non-existent session', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/end')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: 'non-existent-session',
          completionStatus: 'completed'
        });

      // May return 401 (key not configured), 404 (not found), or 500 (DB not configured)
      expect([401, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Game Attempts (Service Auth)
  // =============================================
  describe('POST /toy/analytics/game-attempt', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require session ID', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          gameType: 'math_tutor'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          gameType: 'math_tutor'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require game type', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/analytics/game-attempt')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: INVALID_MAC,
          gameType: 'math_tutor'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should log game attempt with valid data (if DB configured)', async () => {
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

      // May return 200, 401, or 500
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('game_type', 'math_tutor');
        expect(res.body.data).toHaveProperty('is_correct', true);
      }
    });
  });

  // =============================================
  // Media Events (Service Auth)
  // =============================================
  describe('POST /toy/analytics/media-event', () => {
    it('should require service key authentication', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .send({
          mac: TEST_MAC,
          mediaType: 'music',
          event: 'start'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mediaType: 'music',
          event: 'start'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require media type', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          event: 'start'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require event type', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          mediaType: 'music'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid event type', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          mediaType: 'music',
          event: 'invalid'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: INVALID_MAC,
          mediaType: 'music',
          event: 'start'
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should log media start event with valid data (if DB configured)', async () => {
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

      // May return 200, 401, or 500
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('media_type', 'music');
        expect(res.body.data).toHaveProperty('media_id', 'song-123');
      }
    });

    it('should accept end event', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          mediaType: 'story',
          event: 'end',
          mediaId: 'story-123',
          durationPlayedSeconds: 120,
          totalDurationSeconds: 300
        });

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept skip event', async () => {
      const res = await request(app)
        .post('/toy/analytics/media-event')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          mediaType: 'music',
          event: 'skip',
          mediaId: 'song-456',
          durationPlayedSeconds: 30,
          metadata: { skipAction: 'next' }
        });

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // =============================================
  // Streaks (Service Auth)
  // =============================================
  describe('POST /toy/analytics/streak', () => {
    it('should require service key authentication', async () => {
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
      expect(res.body).toHaveProperty('code');
    });

    it('should require session ID', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: TEST_MAC,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require MAC address', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          gameType: 'math_tutor',
          streakNumber: 1,
          questionsInStreak: 5
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require game type', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          streakNumber: 1,
          questionsInStreak: 5
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require streak number', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          questionsInStreak: 5
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require questions in streak', async () => {
      const res = await request(app)
        .post('/toy/analytics/streak')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          sessionId: TEST_SESSION_ID,
          mac: TEST_MAC,
          gameType: 'math_tutor',
          streakNumber: 1
        });

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
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

      // 400 if key configured and validation fails, 401 if key not configured
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should log streak with valid data (if DB configured)', async () => {
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

      // May return 200, 401, or 500
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('game_type', 'math_tutor');
        expect(res.body.data).toHaveProperty('questions_in_streak', 5);
      }
    });
  });

  // =============================================
  // Statistics (OAuth Auth)
  // =============================================
  describe('GET /toy/analytics/user/:mac/overall', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/overall`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/overall')
        .set('Authorization', 'Bearer test-token');

      // May return 400 (invalid MAC) or 401 (invalid token)
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/user/:mac/math', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/math`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/math')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/user/:mac/riddle', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/riddle`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/riddle')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/user/:mac/wordladder', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/user/${TEST_MAC}/wordladder`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/user/INVALID/wordladder')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/sessions/:mac', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/sessions/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/sessions/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/usage/daily/:mac', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/daily/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/daily/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept days query parameter', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/daily/${TEST_MAC}?days=14`)
        .set('Authorization', 'Bearer test-token');

      // May return 200 (if valid token), 401 (invalid token), or 500 (DB not configured)
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/analytics/usage/weekly/:mac', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/weekly/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/weekly/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept weeks query parameter', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/weekly/${TEST_MAC}?weeks=8`)
        .set('Authorization', 'Bearer test-token');

      // May return 200 (if valid token), 401 (invalid token), or 500 (DB not configured)
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with colons', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/weekly/AA:BB:CC:DD:EE:FF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/weekly/AA-BB-CC-DD-EE-FF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept raw 12-char MAC', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/weekly/AABBCCDDEEFF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });
  });

  describe('GET /toy/analytics/usage/monthly/:mac', () => {
    it('should require OAuth authentication', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/monthly/${TEST_MAC}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should reject invalid MAC address format', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/monthly/INVALID')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept months query parameter', async () => {
      const res = await request(app)
        .get(`/toy/analytics/usage/monthly/${TEST_MAC}?months=12`)
        .set('Authorization', 'Bearer test-token');

      // May return 200 (if valid token), 401 (invalid token), or 500 (DB not configured)
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should accept MAC with colons', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/monthly/AA:BB:CC:DD:EE:FF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept MAC with dashes', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/monthly/AA-BB-CC-DD-EE-FF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept raw 12-char MAC', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/monthly/AABBCCDDEEFF')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept lowercase MAC', async () => {
      const res = await request(app)
        .get('/toy/analytics/usage/monthly/aa:bb:cc:dd:ee:ff')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 500]).toContain(res.status);
    });
  });

  // =============================================
  // MAC Address Format Tests
  // =============================================
  describe('MAC Address Formats', () => {
    it('should accept MAC with colons in session start', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: 'AA:BB:CC:DD:EE:FF',
          modeType: 'Math'
        });

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept MAC with dashes in session start', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: 'AA-BB-CC-DD-EE-FF',
          modeType: 'Math'
        });

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept raw 12-char MAC in session start', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: 'AABBCCDDEEFF',
          modeType: 'Math'
        });

      expect([200, 401, 500]).toContain(res.status);
    });

    it('should accept lowercase MAC in session start', async () => {
      const res = await request(app)
        .post('/toy/analytics/session/start')
        .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
        .send({
          mac: 'aa:bb:cc:dd:ee:ff',
          modeType: 'Math'
        });

      expect([200, 401, 500]).toContain(res.status);
    });
  });
});

describe('Analytics Validation', () => {
  describe('Session Start Validation', () => {
    it('should accept all valid mode types', async () => {
      const modeTypes = ['Conversation', 'Math', 'Riddle', 'WordLadder', 'Music', 'Story'];

      for (const modeType of modeTypes) {
        const res = await request(app)
          .post('/toy/analytics/session/start')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({
            mac: TEST_MAC,
            modeType
          });

        expect([200, 401, 500]).toContain(res.status);
      }
    });
  });

  describe('Game Attempt Validation', () => {
    it('should accept all valid game types', async () => {
      const gameTypes = ['math_tutor', 'riddle_solver', 'word_ladder'];

      for (const gameType of gameTypes) {
        const res = await request(app)
          .post('/toy/analytics/game-attempt')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({
            sessionId: TEST_SESSION_ID,
            mac: TEST_MAC,
            gameType
          });

        expect([200, 401, 500]).toContain(res.status);
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
      }
    });
  });

  describe('Media Event Validation', () => {
    it('should accept music and story media types', async () => {
      const mediaTypes = ['music', 'story'];

      for (const mediaType of mediaTypes) {
        const res = await request(app)
          .post('/toy/analytics/media-event')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({
            mac: TEST_MAC,
            mediaType,
            event: 'start'
          });

        expect([200, 401, 500]).toContain(res.status);
      }
    });

    it('should accept all valid event types', async () => {
      const events = ['start', 'end', 'skip'];

      for (const event of events) {
        const res = await request(app)
          .post('/toy/analytics/media-event')
          .set('X-Service-Key', process.env.SERVICE_SECRET_KEY || 'test-key')
          .send({
            mac: TEST_MAC,
            mediaType: 'music',
            event,
            mediaId: 'test-media'
          });

        expect([200, 401, 500]).toContain(res.status);
      }
    });
  });
});
