'use strict';
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

const mockRequireAdmin = jest.fn((req, _s, n) => { req.user = { id: 1 }; n(); });
jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (req, res, n) => mockRequireAdmin(req, res, n),
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
  if (url.endsWith('big.mp3')) {
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-length', String(51 * 1024 * 1024)]]),
      arrayBuffer: jest.fn(async () => SEALED),
    };
  }
  const body = url.endsWith('plain.mp3') ? MP3 : SEALED;
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-length', String(body.length)]]),
    arrayBuffer: async () => body,
    body: require('stream').Readable.toWeb(require('stream').Readable.from([body])),
  };
});

const app = express();
app.use('/admin/rfid', require('../../src/routes/rfid.routes'));

beforeEach(() => {
  global.fetch.mockClear();
  mockRequireAdmin.mockClear();
  mockContentKeys.getPackKey.mockClear();
});

test('streams the decrypted file for a sealed object', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' }).buffer().parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  expect(res.body).toEqual(MP3);
});

test('runs requireAdmin for a successful preview request', async () => {
  await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' }).buffer().parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
});

test('calls fetch with redirect: manual', async () => {
  await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' }).buffer().parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(global.fetch).toHaveBeenCalledWith(`${CDN}/rfidcontent/audio/x.mp3`, expect.objectContaining({ redirect: 'manual' }));
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

test('refuses a lookalike hostname that merely has the CDN host as a prefix', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: 'https://dsmzc13oafp54.cloudfront.net.evil.com/x.mp3', packCode: 'STORY01' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refuses a URL with the CDN host stuffed into userinfo', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: 'https://dsmzc13oafp54.cloudfront.net@evil.com/x.mp3', packCode: 'STORY01' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refuses plain http even to the real CDN host', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `http://dsmzc13oafp54.cloudfront.net/x.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refuses a non-default port on the CDN host', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}:22/x.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refuses an array-form url instead of string-coercing it', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ 'url[]': `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('refuses an array-form packCode before it reaches Prisma/the key lookup', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, 'packCode[]': 'STORY01' });
  expect(res.status).toBe(400);
  expect(mockContentKeys.getPackKey).not.toHaveBeenCalled();
});

test('rejects an object over the size cap without buffering it', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/big.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
  const call = global.fetch.mock.results[0].value;
  const upstream = await call;
  expect(upstream.arrayBuffer).not.toHaveBeenCalled();
});

test('rejects when the upstream omits Content-Length', async () => {
  global.fetch.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    arrayBuffer: jest.fn(async () => SEALED),
  }));
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
});

test('404 when the pack has no key', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'NOKEY' });
  expect(res.status).toBe(404);
});

test('rejects a sealed object whose header version is not 2', async () => {
  const oldVersionSealed = cc.seal(MP3, K, 1);
  global.fetch.mockImplementationOnce(async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-length', String(oldVersionSealed.length)]]),
    arrayBuffer: async () => oldVersionSealed,
  }));
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(400);
});
