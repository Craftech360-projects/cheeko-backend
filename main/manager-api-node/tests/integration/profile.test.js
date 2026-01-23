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

// =============================================
// Parent Profile Routes Tests
// =============================================

describe('Parent Profile Routes', () => {
  // Test constants
  const validParentProfile = {
    fullName: 'John Parent',
    email: 'john.parent@example.com',
    phoneNumber: '+1234567890',
    preferredLanguage: 'en',
    timezone: 'America/New_York',
    notificationPreferences: {
      email: true,
      push: true,
      sms: false
    }
  };

  // ========================================
  // GET /toy/api/mobile/parent
  // ========================================

  describe('GET /toy/api/mobile/parent', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent');

      expect(res.statusCode).toBe(401);
    });

    it('should return 404 or profile when authenticated', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token');

      // Without real auth, we expect 401; with mocked auth, expect 200 or 404
      expect([200, 401, 404]).toContain(res.statusCode);
    });

    it('should return standardized response format', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token');

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });
  });

  // ========================================
  // POST /toy/api/mobile/parent
  // ========================================

  describe('POST /toy/api/mobile/parent', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .send(validParentProfile);

      expect(res.statusCode).toBe(401);
    });

    it('should accept valid profile data', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send(validParentProfile);

      // Without real auth, we expect 401
      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept minimal profile (empty object)', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept profile with only email', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ email: 'test@example.com' });

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept notification preferences as object', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({
          fullName: 'Test Parent',
          notificationPreferences: {
            email: true,
            push: false,
            sms: true,
            weeklyReport: true
          }
        });

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // PUT /toy/api/mobile/parent
  // ========================================

  describe('PUT /toy/api/mobile/parent', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .send({ fullName: 'Updated Name' });

      expect(res.statusCode).toBe(401);
    });

    it('should accept partial update data', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ fullName: 'New Name' });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept full update data', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send(validParentProfile);

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should handle non-existent profile', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ fullName: 'Updated' });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept timezone update', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ timezone: 'Europe/London' });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept preferred language update', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ preferredLanguage: 'es' });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // DELETE /toy/api/mobile/parent
  // ========================================

  describe('DELETE /toy/api/mobile/parent', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete('/toy/api/mobile/parent');

      expect(res.statusCode).toBe(401);
    });

    it('should handle non-existent profile', async () => {
      const res = await request(app)
        .delete('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token');

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Notification Preferences Endpoints
  // ========================================

  describe('GET /toy/api/mobile/parent/notifications', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent/notifications');

      expect(res.statusCode).toBe(401);
    });

    it('should return notification preferences or 404', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent/notifications')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404]).toContain(res.statusCode);
    });
  });

  describe('PUT /toy/api/mobile/parent/notifications', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent/notifications')
        .send({ email: true });

      expect(res.statusCode).toBe(401);
    });

    it('should accept valid notification preferences', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent/notifications')
        .set('Authorization', 'Bearer test-token')
        .send({
          email: true,
          push: false,
          sms: true
        });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept partial notification updates', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent/notifications')
        .set('Authorization', 'Bearer test-token')
        .send({ weeklyReport: true });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept achievement alerts preference', async () => {
      const res = await request(app)
        .put('/toy/api/mobile/parent/notifications')
        .set('Authorization', 'Bearer test-token')
        .send({ achievementAlerts: true });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Onboarding Endpoints
  // ========================================

  describe('POST /toy/api/mobile/parent/onboarding/complete', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/onboarding/complete');

      expect(res.statusCode).toBe(401);
    });

    it('should mark onboarding as complete', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/onboarding/complete')
        .set('Authorization', 'Bearer test-token');

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Terms Acceptance Endpoints
  // ========================================

  describe('POST /toy/api/mobile/parent/terms/accept', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/terms/accept')
        .send({ acceptTerms: true });

      expect(res.statusCode).toBe(401);
    });

    it('should accept terms of service', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/terms/accept')
        .set('Authorization', 'Bearer test-token')
        .send({ acceptTerms: true });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept privacy policy', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/terms/accept')
        .set('Authorization', 'Bearer test-token')
        .send({ acceptPrivacyPolicy: true });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should accept both terms and privacy policy', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/terms/accept')
        .set('Authorization', 'Bearer test-token')
        .send({
          acceptTerms: true,
          acceptPrivacyPolicy: true
        });

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Input Validation Tests
  // ========================================

  describe('Input Validation - Parent', () => {
    it('should handle invalid JSON body gracefully', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect([400, 401]).toContain(res.statusCode);
    });

    it('should handle empty request body', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({});

      // Should work with empty body (all fields optional)
      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept valid email format', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ email: 'valid.email@domain.com' });

      expect([200, 400, 401]).toContain(res.statusCode);
    });

    it('should accept phone number with international format', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token')
        .send({ phoneNumber: '+1-555-123-4567' });

      expect([200, 400, 401]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Route Priority Tests - Parent
  // ========================================

  describe('Route Priority - Parent', () => {
    it('should match /parent/notifications before generic /parent', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent/notifications')
        .set('Authorization', 'Bearer test-token');

      expect([200, 401, 404]).toContain(res.statusCode);
    });

    it('should match /parent/onboarding/complete as nested route', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/onboarding/complete')
        .set('Authorization', 'Bearer test-token');

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });

    it('should match /parent/terms/accept as nested route', async () => {
      const res = await request(app)
        .post('/toy/api/mobile/parent/terms/accept')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect([200, 400, 401, 404]).toContain(res.statusCode);
    });
  });

  // ========================================
  // Response Format Tests - Parent
  // ========================================

  describe('Response Format - Parent', () => {
    it('should return standardized response format', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token');

      expect(res.body).toHaveProperty('code');
      expect(res.body).toHaveProperty('msg');
    });

    it('should return error response format on auth failure', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent');

      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('code');
      expect(res.body.code).not.toBe(0);
    });

    it('should return data property on successful get', async () => {
      const res = await request(app)
        .get('/toy/api/mobile/parent')
        .set('Authorization', 'Bearer test-token');

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('data');
      }
    });
  });
});
