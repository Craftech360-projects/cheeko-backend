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
const KID_ID = 42;
const USER_ID = 7;
const PACK = { id: BigInt(7), pack_code: 'CK000042', name: 'Custom Card', version: '1' };

jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, res, next) => {
    req.firebaseUser = { uid: 'custom-card-image-test' };
    req.mobileUser = { id: 7 };   // USER_ID — inlined: a jest.mock factory may not close over it
    next();
  },
  ensureFirebaseInit: () => true,
}));

// Only the ffmpeg conversion is stubbed. toDeviceFrame is pure and is what
// decides whether an upload is a pre-packed panel frame, so it stays real.
jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12)),
}));

let rows = [];

const mockUpload = {
  uploadCustomCardAudio: jest.fn(async () => ({ s3Key: 'a', url: 'https://cdn.test/customcard_kid42/a.mp3' })),
  uploadCustomCardImage: jest.fn(async () => ({ s3Key: 'i', url: 'https://cdn.test/customcard_kid42/i.bin' })),
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
  // mockUpload's jest.fn()s live outside the spies restoreAllMocks resets, so
  // their call counts would otherwise carry from one test into the next.
  jest.clearAllMocks();
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
  jest.spyOn(prisma.kid_profile, 'findFirst').mockImplementation(async ({ where }) => (
    // Scoped by owner in the service, so a kid belonging to another parent
    // simply does not come back — the same 404 as one that does not exist.
    String(where.id) === String(KID_ID) && String(where.user_id) === String(USER_ID)
      ? { id: BigInt(KID_ID), name: 'Aarav' }
      : null
  ));
  jest.spyOn(prisma.ai_device, 'findFirst').mockResolvedValue({ mac_address: MAC });
  jest.spyOn(prisma.rfid_content_pack, 'findFirst').mockResolvedValue(PACK);
  jest.spyOn(prisma.rfid_content_pack, 'upsert').mockResolvedValue(PACK);
  jest.spyOn(prisma.content_item, 'findMany').mockImplementation(async () => rows.map((row) => ({ ...row })));
});

afterEach(() => jest.restoreAllMocks());

describe('POST /kids/:kidId/custom-card/content with pictures', () => {
  it('gives each recording the picture its field name names', async () => {
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('files', MP3, 'a.mp3')
      .attach('files', MP3, 'b.mp3')
      // Sent before the recordings it belongs to, and numbered for the second:
      // pairing must follow the name, not the arrival order.
      .attach('image_2', PNG, 'drawing.png');

    expect(res.status).toBe(201);
    expect(res.body.data.contentPack.items).toEqual([
      expect.objectContaining({ itemNumber: 1, imageUrl: null }),
      expect.objectContaining({ itemNumber: 2, imageUrl: 'https://cdn.test/customcard_kid42/i.bin' }),
    ]);
  });

  it('refuses a picture numbered past the last recording', async () => {
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('files', MP3, 'a.mp3')
      .attach('image_3', PNG, 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Each picture must go with a recording.');
  });

  it('turns a rejected content type into a readable 400, not a 500', async () => {
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('file', MP3, { filename: 'a.mp3', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Only MP3 or WAV recordings and PNG or JPEG pictures can be uploaded.');
  });

  it('refuses a file that is not a picture', async () => {
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('file', MP3, 'a.mp3')
      .attach('image', Buffer.from('definitely not a png'), 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Only PNG and JPEG pictures are supported.');
  });
});

describe('the per-item picture routes', () => {
  const addOne = () => request(app)
    .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
    .attach('file', MP3, 'a.mp3');

  it('sets and then clears one item artwork, leaving the recording alone', async () => {
    await addOne();

    const set = await request(app)
      .put(`${BASE}/kids/${KID_ID}/custom-card/content/1/image`)
      .attach('image', PNG, 'drawing.png');

    expect(set.status).toBe(200);
    expect(set.body.data.contentPack.items[0]).toEqual(expect.objectContaining({
      itemNumber: 1,
      fileUrl: 'https://cdn.test/customcard_kid42/a.mp3',
      imageUrl: 'https://cdn.test/customcard_kid42/i.bin',
    }));

    const cleared = await request(app)
      .delete(`${BASE}/kids/${KID_ID}/custom-card/content/1/image`);

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.contentPack.items[0]).toEqual(expect.objectContaining({
      itemNumber: 1,
      fileUrl: 'https://cdn.test/customcard_kid42/a.mp3',
      imageUrl: null,
    }));
  });

  it('404s for an item the card does not have', async () => {
    await addOne();

    const res = await request(app)
      .put(`${BASE}/kids/${KID_ID}/custom-card/content/9/image`)
      .attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That recording could not be found on this card.');
  });

  it('sends a picture-only PUT of a recording to the picture route', async () => {
    await addOne();

    const res = await request(app)
      .put(`${BASE}/kids/${KID_ID}/custom-card/content/1`)
      .attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('To change only the picture, use the picture endpoint for this recording.');
  });
});

describe('another parent\'s child', () => {
  // Not-found rather than forbidden, so the endpoint cannot be used to probe
  // which kid ids exist. Every route has to answer the same way.
  const OTHER_KID = KID_ID + 1;

  it('404s on GET', async () => {
    const res = await request(app).get(`${BASE}/kids/${OTHER_KID}/custom-card`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
  });

  it('404s on upload, without putting anything in storage', async () => {
    const res = await request(app)
      .post(`${BASE}/kids/${OTHER_KID}/custom-card/content`)
      .attach('file', MP3, 'a.mp3');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
    expect(mockUpload.uploadCustomCardAudio).not.toHaveBeenCalled();
  });

  it('404s on delete', async () => {
    const res = await request(app).delete(`${BASE}/kids/${OTHER_KID}/custom-card/content/1`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
  });
});

/**
 * The 404 vocabulary, over the wire.
 *
 * The parent app branches on these three sentences: two of them mean "your list
 * is stale, re-read the card and carry on quietly", and the third means the
 * kidId itself is wrong and has to surface. There is no machine-readable
 * discriminator — `code` is the HTTP status on all three — so the message IS
 * the contract, and rewording one silently changes client behaviour.
 *
 * That is what these assertions are for. If you are here because one of them
 * failed, the app needs changing too.
 */
describe('the three 404s a client has to tell apart', () => {
  const addOne = () => request(app)
    .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
    .attach('file', MP3, 'a.mp3');

  it('names a kid that is not this parent\'s — the app must surface this, not retry', async () => {
    const res = await request(app).delete(`${BASE}/kids/${KID_ID + 1}/custom-card/content/1`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
  });

  it('names a kid with no pack at all — stale, and a re-read will succeed', async () => {
    prisma.rfid_content_pack.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(`${BASE}/kids/${KID_ID}/custom-card/content/1`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('This child has no custom card content.');
  });

  it('names an itemNumber that is not on the card — stale, and a re-read will succeed', async () => {
    await addOne();

    const res = await request(app).delete(`${BASE}/kids/${KID_ID}/custom-card/content/9`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That recording could not be found on this card.');
  });

  it('answers 200 with a null pack on GET, so the stale-list re-read never 404s', async () => {
    // The two stale cases above tell the app to re-read. That re-read has to
    // land somewhere sane: GET never 404s for having no content, it reports the
    // empty state, which is the screen the app should end up showing.
    prisma.rfid_content_pack.findFirst.mockResolvedValue(null);

    const res = await request(app).get(`${BASE}/kids/${KID_ID}/custom-card`);

    expect(res.status).toBe(200);
    expect(res.body.data.contentPack).toBeNull();
  });

  it('treats a kidId that is not a number as not-found, not a 500', async () => {
    const res = await request(app).get(`${BASE}/kids/not-a-number/custom-card`);

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
  });
});

/**
 * `deviceMac` drives the app's "not paired yet" banner, which now matters more
 * than it did: an unpaired toy plays nothing on a custom card, so a parent who
 * records before pairing has to be told why the card is silent. The banner keys
 * on null, so the field has to be *present and null* — an absent key reads as
 * "unknown" and the banner never shows.
 */
describe('deviceMac for a child with no toy', () => {
  beforeEach(() => {
    prisma.ai_device.findFirst.mockResolvedValue(null);
  });

  const hasNullDeviceMac = (body) => {
    expect(Object.prototype.hasOwnProperty.call(body.data, 'deviceMac')).toBe(true);
    expect(body.data.deviceMac).toBeNull();
  };

  it('is present and null on GET and on every write', async () => {
    hasNullDeviceMac((await request(app).get(`${BASE}/kids/${KID_ID}/custom-card`)).body);

    const created = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('file', MP3, 'a.mp3');
    expect(created.status).toBe(201);
    hasNullDeviceMac(created.body);

    hasNullDeviceMac((await request(app)
      .put(`${BASE}/kids/${KID_ID}/custom-card/content/1`)
      .attach('file', MP3, 'b.mp3')).body);
    hasNullDeviceMac((await request(app)
      .put(`${BASE}/kids/${KID_ID}/custom-card/content/1/image`)
      .attach('image', PNG, 'p.png')).body);
    hasNullDeviceMac((await request(app)
      .delete(`${BASE}/kids/${KID_ID}/custom-card/content/1/image`)).body);
    hasNullDeviceMac((await request(app)
      .delete(`${BASE}/kids/${KID_ID}/custom-card/content/1`)).body);
  });
});

describe('the body-vs-path guard', () => {
  it('accepts a write with no kid field in the body at all', async () => {
    // The path segment is authoritative and the body copy is optional — the app
    // sends none. Requiring it would 400 every upload.
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .attach('file', MP3, 'a.mp3');

    expect(res.status).toBe(201);
  });

  it('refuses a kid in the body that disagrees with the path', async () => {
    // The path segment is authoritative: a mismatched body must not be able to
    // write to another child's card.
    const res = await request(app)
      .post(`${BASE}/kids/${KID_ID}/custom-card/content`)
      .field('kidId', String(KID_ID + 1))
      .attach('file', MP3, 'a.mp3');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('The child in the request does not match the one being updated.');
  });
});
