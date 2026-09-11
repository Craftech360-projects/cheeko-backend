'use strict';

/**
 * Game-pack icons are PNGs the quiz renderer loads directly, and game packs
 * are never sealed. Without `purpose=game_asset` the route would convert the
 * icon to an LVGL .bin the game cannot show and seal the sound under a key the
 * game never receives.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (req, _s, n) => { req.user = { id: 1 }; n(); },
}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
const mockKeys = { isEnabled: () => true, getOrCreatePackKey: jest.fn(async () => Buffer.alloc(16, 1)), getPackKey: jest.fn() };
jest.mock('../../src/services/contentKeys.service', () => mockKeys);
jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.from('BIN'))
}));
const mockUpload = { uploadContentFile: jest.fn(async (_b, filename) => ({ success: true, url: `https://cdn.test/${filename}` })) };
jest.mock('../../src/services/upload.service', () => mockUpload);
// rfid.service is loaded for real, as rfid.preview-route.test.js does: the
// routes module destructures it at require time, so an empty mock breaks load.

const app = express();
app.use('/admin/rfid', require('../../src/routes/rfid.routes'));

// A PNG signature plus padding is enough for the route's byte sniff.
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)]);

beforeEach(() => jest.clearAllMocks());

test('game_asset keeps a PNG as a PNG and does not seal it', async () => {
  const res = await request(app)
    .post('/admin/rfid/content-pack/upload')
    .field('purpose', 'game_asset')
    .field('packCode', 'hometown')
    .field('category', 'apps/hometown')
    .attach('file', PNG, { filename: 'doorbell.png', contentType: 'image/png' });

  expect(res.status).toBe(200);
  expect(res.body.code).toBe(0);
  const [buffer, filename, contentType, category, mimeType, opts] = mockUpload.uploadContentFile.mock.calls[0];
  expect(buffer.equals(PNG)).toBe(true);
  expect(filename).toBe('doorbell.png');
  expect(contentType).toBe('rfidcontent');
  expect(category).toBe('apps/hometown');
  expect(mimeType).toBe('image/png');
  expect(opts).toEqual({ sealKey: null });
  expect(mockKeys.getOrCreatePackKey).not.toHaveBeenCalled();
});

test('without the purpose an item PNG is still converted and sealed', async () => {
  const res = await request(app)
    .post('/admin/rfid/content-pack/upload')
    .field('packCode', 'STORY01')
    .attach('file', PNG, { filename: 'cover.png', contentType: 'image/png' });

  expect(res.status).toBe(200);
  const [buffer, filename, , , mimeType, opts] = mockUpload.uploadContentFile.mock.calls[0];
  expect(filename).toBe('cover.bin');
  expect(mimeType).toBe('application/octet-stream');
  expect(buffer.toString()).toBe('BIN');
  expect(opts.sealKey).toBeInstanceOf(Buffer);
});
