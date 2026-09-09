'use strict';
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (req, _s, n) => { req.user = { id: 1 }; n(); },
}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const K = crypto.randomBytes(16);
const mockContentKeys = {
  isEnabled: () => true, getPackKey: jest.fn(async (c) => (c === 'STORY01' ? K : null)),
};
jest.mock('../../src/services/contentKeys.service', () => mockContentKeys);

const cc = require('../../src/utils/contentCrypto');
const MP3 = crypto.randomBytes(5000);
const SEALED = cc.seal(MP3, K);
const CDN = 'https://dsmzc13oafp54.cloudfront.net';

global.fetch = jest.fn(async (url) => {
  const body = url.endsWith('plain.mp3') ? MP3 : SEALED;
  return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => body, body: require('stream').Readable.toWeb(require('stream').Readable.from([body])) };
});

const app = express();
app.use('/admin/rfid', require('../../src/routes/rfid.routes'));

test('streams the decrypted file for a sealed object', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' }).buffer().parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  expect(res.body).toEqual(MP3);
});

test('redirects to CloudFront for a legacy plaintext object', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/plain.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(`${CDN}/rfidcontent/audio/plain.mp3`);
});

test('refuses a URL off the CloudFront domain', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: 'https://evil.example/x.mp3', packCode: 'STORY01' });
  expect(res.status).toBe(400);
});

test('404 when the pack has no key', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'NOKEY' });
  expect(res.status).toBe(404);
});
