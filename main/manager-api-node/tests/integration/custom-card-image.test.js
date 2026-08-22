/**
 * Custom-card artwork over the wire.
 *
 * The service is unit-tested elsewhere; what this covers is the part only an
 * HTTP request exercises — multipart field names, which part becomes which
 * item's picture, and the sentences a parent is shown when a request is wrong.
 *
 * Storage, the database and the ffmpeg conversion are all stubbed: the point is
 * the route contract, and a test that put objects in a real bucket could not be
 * run twice.
 */

'use strict';

const MAC = 'AA:BB:CC:DD:EE:FF';
const PACK = { id: BigInt(7), pack_code: 'CUSTOM_AABBCCDDEEFF', name: 'Custom Card', version: '1' };

jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, res, next) => {
    req.firebaseUser = { uid: 'custom-card-image-test' };
    req.mobileUser = { id: 42 };
    next();
  },
  ensureFirebaseInit: () => true,
}));

jest.mock('../../src/utils/lvglImage', () => ({
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12)),
}));

let rows = [];

const mockUpload = {
  uploadCustomCardAudio: jest.fn(async () => ({ s3Key: 'a', url: 'https://cdn.test/customcard_aabbccddeeff/a.mp3' })),
  uploadCustomCardImage: jest.fn(async () => ({ s3Key: 'i', url: 'https://cdn.test/customcard_aabbccddeeff/i.bin' })),
  deleteCustomCardObject: jest.fn(async () => {}),
};

// Only the custom-card helpers are stubbed; src/app.js pulls in routes that use
// the rest of the module, so the real ones stay in place.
jest.mock('../../src/services/upload.service', () => ({
  ...jest.requireActual('../../src/services/upload.service'),
  ...mockUpload,
}));

const request = require('supertest');
const app = require('../../src/app');
const { prisma } = require('../../src/config/database');
const rfidService = require('../../src/services/rfid.service');

const BASE = '/toy/api/mobile';
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);

beforeEach(() => {
  rows = [];
  // Stands in for the pack writer, keeping the item set the routes read back.
  jest.spyOn(rfidService, 'updateContentPack').mockImplementation(async (data) => {
    rows = data.items.map((item, index) => ({
      id: BigInt(index + 1),
      item_number: item.itemNumber,
      title: item.title,
      audio_url: item.audioUrl,
      audio_size_bytes: item.audioSizeBytes,
      image_url: item.imageUrl == null ? null : item.imageUrl,
    }));
  });
  jest.spyOn(prisma.ai_device, 'findFirst').mockResolvedValue({
    id: BigInt(1), mac_address: MAC, alias: 'Nursery', kid_id: null,
  });
  jest.spyOn(prisma.rfid_content_pack, 'findFirst').mockResolvedValue(PACK);
  jest.spyOn(prisma.rfid_content_pack, 'upsert').mockResolvedValue(PACK);
  jest.spyOn(prisma.content_item, 'findMany').mockImplementation(async () => rows.map((row) => ({ ...row })));
});

afterEach(() => jest.restoreAllMocks());

describe('POST /devices/:mac/custom-card/content with pictures', () => {
  it('gives each recording the picture its field name names', async () => {
    const res = await request(app)
      .post(`${BASE}/devices/${MAC}/custom-card/content`)
      .attach('files', MP3, 'a.mp3')
      .attach('files', MP3, 'b.mp3')
      // Sent before the recordings it belongs to, and numbered for the second:
      // pairing must follow the name, not the arrival order.
      .attach('image_2', PNG, 'drawing.png');

    expect(res.status).toBe(201);
    expect(res.body.data.contentPack.items).toEqual([
      expect.objectContaining({ itemNumber: 1, imageUrl: null }),
      expect.objectContaining({ itemNumber: 2, imageUrl: 'https://cdn.test/customcard_aabbccddeeff/i.bin' }),
    ]);
  });

  it('refuses a picture numbered past the last recording', async () => {
    const res = await request(app)
      .post(`${BASE}/devices/${MAC}/custom-card/content`)
      .attach('files', MP3, 'a.mp3')
      .attach('image_3', PNG, 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Each picture must go with a recording.');
  });

  it('turns a rejected content type into a readable 400, not a 500', async () => {
    const res = await request(app)
      .post(`${BASE}/devices/${MAC}/custom-card/content`)
      .attach('file', MP3, { filename: 'a.mp3', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Only MP3 or WAV recordings and PNG or JPEG pictures can be uploaded.');
  });

  it('refuses a file that is not a picture', async () => {
    const res = await request(app)
      .post(`${BASE}/devices/${MAC}/custom-card/content`)
      .attach('file', MP3, 'a.mp3')
      .attach('image', Buffer.from('definitely not a png'), 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Only PNG and JPEG pictures are supported.');
  });
});

describe('the per-item picture routes', () => {
  const addOne = () => request(app)
    .post(`${BASE}/devices/${MAC}/custom-card/content`)
    .attach('file', MP3, 'a.mp3');

  it('sets and then clears one item artwork, leaving the recording alone', async () => {
    await addOne();

    const set = await request(app)
      .put(`${BASE}/devices/${MAC}/custom-card/content/1/image`)
      .attach('image', PNG, 'drawing.png');

    expect(set.status).toBe(200);
    expect(set.body.data.contentPack.items[0]).toEqual(expect.objectContaining({
      itemNumber: 1,
      fileUrl: 'https://cdn.test/customcard_aabbccddeeff/a.mp3',
      imageUrl: 'https://cdn.test/customcard_aabbccddeeff/i.bin',
    }));

    const cleared = await request(app)
      .delete(`${BASE}/devices/${MAC}/custom-card/content/1/image`);

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.contentPack.items[0]).toEqual(expect.objectContaining({
      itemNumber: 1,
      fileUrl: 'https://cdn.test/customcard_aabbccddeeff/a.mp3',
      imageUrl: null,
    }));
  });

  it('404s for an item the card does not have', async () => {
    await addOne();

    const res = await request(app)
      .put(`${BASE}/devices/${MAC}/custom-card/content/9/image`)
      .attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That recording could not be found on this card.');
  });

  it('sends a picture-only PUT of a recording to the picture route', async () => {
    await addOne();

    const res = await request(app)
      .put(`${BASE}/devices/${MAC}/custom-card/content/1`)
      .attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('To change only the picture, use the picture endpoint for this recording.');
  });
});
