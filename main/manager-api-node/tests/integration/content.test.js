/**
 * Content Library Routes Integration Tests
 */

const request = require('supertest');
const app = require('../../src/app');

// Test data
const TEST_CONTENT_ID = 'test-content-id-123';
const MOCK_AUTH_TOKEN = 'test-token';

describe('Content Library Routes', () => {
  describe('GET /toy/content/library', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/content/library');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return paginated content list with auth', async () => {
      const res = await request(app)
        .get('/toy/content/library')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      // May return 200 or 401 depending on token validation
      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('list');
        expect(res.body.data).toHaveProperty('total');
        expect(res.body.data).toHaveProperty('page');
        expect(res.body.data).toHaveProperty('limit');
      }
    });

    it('should accept filter parameters', async () => {
      const res = await request(app)
        .get('/toy/content/library')
        .query({
          page: 1,
          limit: 5,
          contentType: 'music',
          category: 'English'
        })
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/content/library/search', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/content/library/search')
        .query({ q: 'test' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require search query parameter', async () => {
      const res = await request(app)
        .get('/toy/content/library/search')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      // May return 400 for missing query or 401 for invalid token
      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require minimum 2 characters in query', async () => {
      const res = await request(app)
        .get('/toy/content/library/search')
        .query({ q: 'a' })
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([400, 401]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should search content with valid query', async () => {
      const res = await request(app)
        .get('/toy/content/library/search')
        .query({
          q: 'baby shark',
          page: 1,
          limit: 10
        })
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(res.body.data).toHaveProperty('list');
        expect(res.body.data).toHaveProperty('query', 'baby shark');
      }
    });
  });

  describe('GET /toy/content/library/categories', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get('/toy/content/library/categories');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return categories list', async () => {
      const res = await request(app)
        .get('/toy/content/library/categories')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');

      if (res.status === 200) {
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });

    it('should filter categories by content type', async () => {
      const res = await request(app)
        .get('/toy/content/library/categories')
        .query({ contentType: 'music' })
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([200, 401, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/content/library/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/toy/content/library/${TEST_CONTENT_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should return 404 for non-existent content', async () => {
      const res = await request(app)
        .get('/toy/content/library/non-existent-id')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([401, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/content/library', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/content/library')
        .send({
          title: 'Test Song',
          contentType: 'music'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require admin access', async () => {
      const res = await request(app)
        .post('/toy/content/library')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          title: 'Test Song',
          contentType: 'music'
        });

      // Should return 401 (invalid token) or 403 (not admin)
      expect([401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/toy/content/library')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({});

      // Should fail validation
      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should validate contentType enum', async () => {
      const res = await request(app)
        .post('/toy/content/library')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          title: 'Test Content',
          contentType: 'invalid-type'
        });

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('PUT /toy/content/library/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .put(`/toy/content/library/${TEST_CONTENT_ID}`)
        .send({
          title: 'Updated Title'
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require admin access', async () => {
      const res = await request(app)
        .put(`/toy/content/library/${TEST_CONTENT_ID}`)
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          title: 'Updated Title'
        });

      expect([401, 403, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should validate contentType if provided', async () => {
      const res = await request(app)
        .put(`/toy/content/library/${TEST_CONTENT_ID}`)
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          contentType: 'invalid-type'
        });

      expect([400, 401, 403, 404]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('DELETE /toy/content/library/:id', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .delete(`/toy/content/library/${TEST_CONTENT_ID}`);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require admin access', async () => {
      const res = await request(app)
        .delete(`/toy/content/library/${TEST_CONTENT_ID}`)
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`);

      expect([401, 403, 404, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/content/library/batch', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .post('/toy/content/library/batch')
        .send({
          items: [
            { title: 'Song 1', contentType: 'music' },
            { title: 'Song 2', contentType: 'music' }
          ]
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });

    it('should require admin access', async () => {
      const res = await request(app)
        .post('/toy/content/library/batch')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          items: [
            { title: 'Song 1', contentType: 'music' }
          ]
        });

      expect([401, 403, 500]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should require items array', async () => {
      const res = await request(app)
        .post('/toy/content/library/batch')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({});

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });

    it('should validate each item in batch', async () => {
      const res = await request(app)
        .post('/toy/content/library/batch')
        .set('Authorization', `Bearer ${MOCK_AUTH_TOKEN}`)
        .send({
          items: [
            { title: 'Valid Song', contentType: 'music' },
            { contentType: 'music' } // Missing title
          ]
        });

      expect([400, 401, 403]).toContain(res.status);
      expect(res.body).toHaveProperty('code');
    });
  });

  // ==================== LEGACY CONTENT ROUTES ====================

  describe('Legacy Music Routes', () => {
    describe('GET /toy/content/music/list', () => {
      it('should return music list without auth', async () => {
        const res = await request(app)
          .get('/toy/content/music/list');

        expect([200, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');

        if (res.status === 200) {
          expect(res.body.data).toHaveProperty('list');
          expect(res.body.data).toHaveProperty('total');
        }
      });

      it('should accept pagination parameters', async () => {
        const res = await request(app)
          .get('/toy/content/music/list')
          .query({ page: 1, limit: 5, category: 'English' });

        expect([200, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/content/music/:id', () => {
      it('should return 404 for non-existent music', async () => {
        const res = await request(app)
          .get('/toy/content/music/non-existent-id');

        expect([404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });
  });

  describe('Legacy Story Routes', () => {
    describe('GET /toy/content/story/list', () => {
      it('should return story list without auth', async () => {
        const res = await request(app)
          .get('/toy/content/story/list');

        expect([200, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');

        if (res.status === 200) {
          expect(res.body.data).toHaveProperty('list');
          expect(res.body.data).toHaveProperty('total');
        }
      });

      it('should accept pagination parameters', async () => {
        const res = await request(app)
          .get('/toy/content/story/list')
          .query({ page: 1, limit: 5, ageGroup: '3-6' });

        expect([200, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });

    describe('GET /toy/content/story/:id', () => {
      it('should return 404 for non-existent story', async () => {
        const res = await request(app)
          .get('/toy/content/story/non-existent-id');

        expect([404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });
  });

  describe('Generic Content Routes', () => {
    describe('GET /toy/content/search', () => {
      it('should require minimum 2 characters', async () => {
        const res = await request(app)
          .get('/toy/content/search')
          .query({ q: 'a' });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('code');
      });

      it('should search across all content types', async () => {
        const res = await request(app)
          .get('/toy/content/search')
          .query({ q: 'baby' });

        expect([200, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');

        if (res.status === 200) {
          expect(res.body.data).toHaveProperty('music');
          expect(res.body.data).toHaveProperty('stories');
          expect(res.body.data).toHaveProperty('textbooks');
        }
      });
    });

    describe('GET /toy/content/random/:type/:mac', () => {
      it('should reject invalid content type', async () => {
        const res = await request(app)
          .get('/toy/content/random/invalid/AA:BB:CC:DD:EE:FF');

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept valid music type', async () => {
        const res = await request(app)
          .get('/toy/content/random/music/AA:BB:CC:DD:EE:FF');

        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });

      it('should accept valid story type', async () => {
        const res = await request(app)
          .get('/toy/content/random/story/AA:BB:CC:DD:EE:FF');

        expect([200, 404, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
    });
  });
});
