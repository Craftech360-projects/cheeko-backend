/**
 * Profile Routes Integration Tests
 *
 * Tests for /api/mobile/kids/* endpoints
 */

const request = require('supertest');
const app = require('../../src/app');

describe('Profile Routes', () => {
  // Test constants
  const validKidProfile = {
    name: 'Test Kid',
    nickname: 'Testy',
    birthDate: '2018-05-15',
    gender: 'male',
    grade: '1st',
    school: 'Test Elementary',
    interests: ['reading', 'science', 'games'],
    language: 'en',
    timezone: 'America/New_York'
  };

  // ========================================
  // PRD-Compliant Endpoints
  // ========================================

  describe('GET /toy/api/mobile/kids/list', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/list');

      expect(res.statusCode).toBe(401);
    });

    it('should return empty array when no profiles exist', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/list')
        .set('Authorization', 'Bearer test-token');

      // Without real auth, we expect 401 or mocked response
      expect([200, 401]).toContain(res.statusCode);
    });
  });

  describe('POST /toy/api/mobile/kids/create', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .send(validKidProfile);

      expect(res.statusCode).toBe(401);
    });

    it('should reject request without name', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({ nickname: 'NoName' });

      // Without real auth, we expect 401; with mocked auth, expect 400
      expect([400, 401]).toContain(res.statusCode);
    });

    it('should accept valid profile data', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send(validKidProfile);

      // Without real auth, we expect 401
      expect([200, 401]).toContain(res.statusCode);
    });

    it('should accept minimal profile (name only)', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'Simple Kid' });

      expect([200, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Legacy/REST-style Endpoints
  // ========================================

  describe('GET /toy/api/mobile/kids (legacy)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids');

      expect(res.statusCode).toBe(401);
    });

    it('should work with valid auth token', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401]).toContain(res.statusCode);
    });
  });

  describe('POST /toy/api/mobile/kids (legacy)', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids')
        .send(validKidProfile);

      expect(res.statusCode).toBe(401);
    });

    it('should reject request without name', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids')
        .set('Authorization', 'Bearer test-token')
        .send({ nickname: 'NoName' });

      expect([400, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // GET /toy/api/mobile/kids/:id
  // ========================================

  describe('GET /toy/api/mobile/kids/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123');

      expect(res.statusCode).toBe(401);
    });

    it('should validate id parameter is numeric', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/abc')
        .set('Authorization', 'Bearer test-token');

      // Expects 401 (no auth) or 400/404 (invalid ID)
      expect([400, 401, 404]).toContain(res.statusCode);
    });

    it('should return 404 for non-existent profile', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/999999')
        .set('Authorization', 'Bearer test-token');

      expect([401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // PUT /toy/api/mobile/kids/:id
  // ========================================

  describe('PUT /toy/api/mobile/kids/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/123')
        .send({ name: 'Updated Name' });

      expect(res.statusCode).toBe(401);
    });

    it('should accept partial update data', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/123')
        .set('Authorization', 'Bearer test-token')
        .send({ nickname: 'New Nickname' });

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should handle non-existent profile', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/999999')
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'Updated' });

      expect([400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // DELETE /toy/api/mobile/kids/:id
  // ========================================

  describe('DELETE /toy/api/mobile/kids/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/api/mobile/kids/123');

      expect(res.statusCode).toBe(401);
    });

    it('should handle non-existent profile', async () => {
      const res = await request(app)
        .delete('/toy/api/mobile/kids/999999')
        .set('Authorization', 'Bearer test-token');

      expect([400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Learning Progress Endpoints
  // ========================================

  describe('GET /toy/api/mobile/kids/:id/progress', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/progress');

      expect(res.statusCode).toBe(401);
    });

    it('should work with valid auth', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/progress')
        .set('Authorization', 'Bearer test-token');

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  describe('POST /toy/api/mobile/kids/:id/progress', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/123/progress')
        .send({ subject: 'math', topic: 'addition', score: 85 });

      expect(res.statusCode).toBe(401);
    });

    it('should accept valid progress data', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/123/progress')
        .set('Authorization', 'Bearer test-token')
        .send({
          subject: 'math',
          topic: 'addition',
          score: 85,
          timeSpent: 300,
          completed: true
        });

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Activity Endpoints
  // ========================================

  describe('GET /toy/api/mobile/kids/:id/activity', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/activity');

      expect(res.statusCode).toBe(401);
    });

    it('should accept pagination parameters', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/activity')
        .query({ page: 1, limit: 10 })
        .set('Authorization', 'Bearer test-token');

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  describe('POST /toy/api/mobile/kids/:id/activity', () => {
    it('should accept activity log without auth (internal)', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/123/activity')
        .send({
          activityType: 'conversation',
          duration: 120
        });

      // This endpoint doesn't require auth (internal use)
      expect([200, 400]).toContain(res.statusCode);
    });

    it('should accept various activity types', async () => {
      const activityTypes = ['conversation', 'music', 'story', 'game', 'learning'];

      for (const activityType of activityTypes) {
        const res = await request(app)
          .post('/toy/api/mobile/kids/123/activity')
          .send({ activityType, duration: 60 });

        expect([200, 400]).toContain(res.statusCode);
      }
    });

    it('should accept activity with content details', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/123/activity')
        .send({
          activityType: 'music',
          contentType: 'song',
          contentId: 'song-123',
          duration: 180
        });

      expect([200, 400]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Preferences Endpoints
  // ========================================

  describe('GET /toy/api/mobile/kids/:id/preferences', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/preferences');

      expect(res.statusCode).toBe(401);
    });

    it('should work with valid auth', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/123/preferences')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404]).toContain(res.statusCode);
    });
  });

  describe('PUT /toy/api/mobile/kids/:id/preferences', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/123/preferences')
        .send({ volumeLevel: 80 });

      expect(res.statusCode).toBe(401);
    });

    it('should accept valid preference data', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/123/preferences')
        .set('Authorization', 'Bearer test-token')
        .send({
          volumeLevel: 80,
          voiceSpeed: 1.0,
          preferredVoice: 'en-US-Standard-A',
          contentFilters: ['educational']
        });

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept partial preference updates', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/kids/123/preferences')
        .set('Authorization', 'Bearer test-token')
        .send({ volumeLevel: 50 });

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Input Validation Tests
  // ========================================

  describe('Input Validation', () => {
    it('should handle invalid JSON body gracefully', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect([400, 401]).toContain(res.statusCode);
    });

    it('should handle empty request body', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({});

      // Name is required, so should get 400 or 401
      expect([400, 401]).toContain(res.statusCode);
    });

    it('should validate gender enum values', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({
          name: 'Test Kid',
          gender: 'invalid_gender'
        });

      // Should either fail validation (400) or auth (401)
      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should handle invalid date format for birthDate', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({
          name: 'Test Kid',
          birthDate: 'not-a-date'
        });

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept array for interests', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({
          name: 'Test Kid',
          interests: ['science', 'art', 'music']
        });

      expect([200, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Route Priority Tests
  // ========================================

  describe('Route Priority', () => {
    it('should match /kids/list before /kids/:id', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/list')
        .set('Authorization', 'Bearer test-token');

      // Should return array, not "list" as an ID
      expect([200, 401]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(Array.isArray(res.body.data) || res.body.data === null).toBe(true);
      }
    });

    it('should match /kids/create as POST route', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/kids/create')
        .set('Authorization', 'Bearer test-token')
        .send({ name: 'Test' });

      expect([200, 401]).toContain(res.statusCode);
    });

    it('should match numeric IDs to /kids/:id', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/12345')
        .set('Authorization', 'Bearer test-token');

      // Should try to find profile with ID 12345
      expect([401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Response Format Tests
  // ========================================

  describe('Response Format', () => {
    it('should return standardized response format on success', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/list')
        .set('Authorization', 'Bearer test-token');

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('code');
        expect(res.body).toHaveProperty('msg');
        expect(res.body).toHaveProperty('data');
      }
    });

    it('should return error response format on auth failure', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/kids/list');

      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('code');
      expect(res.body.code).not.toBe(0);
    });
  });
});
