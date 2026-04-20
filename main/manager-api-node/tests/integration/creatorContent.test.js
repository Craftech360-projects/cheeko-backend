'use strict';

const request = require('supertest');
const app = require('../../src/app');

describe('Creator Content Routes', () => {
  describe('POST /toy/creator/content', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/toy/creator/content')
        .send({ title: 'New Draft', contentType: 'music' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('GET /toy/creator/content/my', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/toy/creator/content/my');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });

  describe('POST /toy/creator/review/content/:id/upload', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/toy/creator/review/content/1/upload');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    });
  });
});
