/**
 * The edit endpoint over the wire.
 *
 * The service is unit-tested in tests/unit/customCard.patch.test.js; what only
 * an HTTP request exercises is here — the multipart part names, the response
 * envelope the app parses, the `ETag`/`If-Match`/`If-None-Match` headers, and
 * the `Idempotency-Key` replay that stops a dropped response from bumping the
 * pack version twice.
 *
 * Storage, the database and the ffmpeg conversion are stubbed. The point is the
 * wire contract, and a test that put objects in a real bucket could not be run
 * twice.
 */

'use strict';

const MAC = 'AA:BB:CC:DD:EE:FF';
const KID_ID = 42;
const USER_ID = 7;

jest.mock('../../src/middleware/firebaseAuth', () => ({
  requireFirebaseAuth: (req, res, next) => {
    req.firebaseUser = { uid: 'custom-card-patch-test' };
    req.mobileUser = { id: 7 };   // USER_ID — inlined: a jest.mock factory may not close over it
    next();
  },
  ensureFirebaseInit: () => true,
}));

// Only the ffmpeg conversion is stubbed; toDeviceFrame decides whether an upload
// is a pre-packed panel frame and is pure, so it stays real.
jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12)),
}));

const mockUpload = {
  uploadCustomCardAudio: jest.fn(async (buffer, kidId, filename, mimeType, { reuseKey } = {}) => {
    const key = reuseKey || `customcard_kid42/audio-new.mp3`;
    return { s3Key: key, url: `https://cdn.test/${key}` };
  }),
  uploadCustomCardImage: jest.fn(async (buffer, kidId, { reuseKey } = {}) => {
    const key = reuseKey || `customcard_kid42/image-new.bin`;
    return { s3Key: key, url: `https://cdn.test/${key}` };
  }),
  deleteCustomCardObject: jest.fn(async () => {}),
};

jest.mock('../../src/services/upload.service', () => ({
  ...jest.requireActual('../../src/services/upload.service'),
  ...mockUpload,
}));

const request = require('supertest');
const app = require('../../src/app');
const { prisma } = require('../../src/config/database');
const rfidService = require('../../src/services/rfid.service');
const { RAW_FRAME_BYTES, toDeviceFrame } = require('../../src/utils/lvglImage');

const BASE = '/toy/api/mobile';
const CARD = `${BASE}/kids/${KID_ID}/custom-card`;

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
const RAW_FRAME = Buffer.alloc(RAW_FRAME_BYTES, 0x7e);
const LVGL_FRAME = toDeviceFrame(Buffer.alloc(RAW_FRAME_BYTES, 0x3c));

const AUDIO_URL = 'https://cdn.test/customcard_kid42/audio-1.mp3';
const IMAGE_URL = 'https://cdn.test/customcard_kid42/image-1.bin';

let pack;
let rows;
let idempotency;

const item = () => rows[0];

beforeEach(() => {
  jest.clearAllMocks();

  pack = {
    id: BigInt(7),
    pack_code: 'CUSTOM_KID_42',
    name: 'Custom Card',
    version: '4',
    content_hash: 'hash-before',
    total_items: 1,
    create_date: new Date('2026-01-01T00:00:00.000Z'),
    update_date: new Date('2026-01-01T00:00:00.000Z'),
  };
  rows = [{
    id: BigInt(101),
    item_number: 1,
    title: 'Bedtime story',
    audio_url: AUDIO_URL,
    audio_size_bytes: BigInt(2048),
    image_url: IMAGE_URL,
  }];
  idempotency = new Map();

  jest.spyOn(prisma.kid_profile, 'findFirst').mockImplementation(async ({ where }) => (
    String(where.id) === String(KID_ID) && String(where.user_id) === String(USER_ID)
      ? { id: BigInt(KID_ID), name: 'Aarav' }
      : null
  ));
  jest.spyOn(prisma.ai_device, 'findFirst').mockResolvedValue({ mac_address: MAC });
  jest.spyOn(prisma.rfid_content_pack, 'findFirst').mockImplementation(async () => ({ ...pack }));
  jest.spyOn(prisma.rfid_content_pack, 'findUnique').mockImplementation(async () => ({ ...pack }));
  jest.spyOn(prisma.rfid_content_pack, 'upsert').mockImplementation(async () => ({ ...pack }));
  jest.spyOn(prisma.rfid_content_pack, 'update').mockImplementation(async ({ data }) => {
    pack = { ...pack, ...data };
    return { ...pack };
  });
  jest.spyOn(prisma.content_item, 'findMany').mockImplementation(async () => rows.map((row) => ({ ...row })));
  jest.spyOn(prisma.content_item, 'update').mockImplementation(async ({ where, data }) => {
    const row = rows.find((candidate) => String(candidate.id) === String(where.id));
    Object.assign(row, data);
    return { ...row };
  });
  jest.spyOn(prisma, '$transaction').mockImplementation(async (fn) => fn(prisma));

  // The legacy routes write through the shared pack editor; PATCH does not.
  jest.spyOn(rfidService, 'updateContentPack').mockImplementation(async (data) => {
    rows = data.items.map((entry, index) => ({
      id: BigInt(index + 101),
      item_number: entry.itemNumber,
      title: entry.title,
      audio_url: entry.audioUrl,
      audio_size_bytes: entry.audioSizeBytes,
      image_url: entry.imageUrl == null ? null : entry.imageUrl,
    }));
    pack = { ...pack, version: data.version, content_hash: data.contentHash };
  });

  // An in-memory stand-in for idempotency_record, with the unique index on
  // (scope, idem_key) that the replay path depends on firing.
  const keyOf = (scope, idemKey) => `${scope}::${idemKey}`;
  jest.spyOn(prisma.idempotency_record, 'deleteMany').mockResolvedValue({ count: 0 });
  jest.spyOn(prisma.idempotency_record, 'create').mockImplementation(async ({ data }) => {
    const key = keyOf(data.scope, data.idem_key);
    if (idempotency.has(key)) {
      const conflict = new Error('Unique constraint failed');
      conflict.code = 'P2002';
      throw conflict;
    }
    idempotency.set(key, { ...data, status: 'in_progress' });
    return idempotency.get(key);
  });
  jest.spyOn(prisma.idempotency_record, 'findUnique').mockImplementation(async ({ where }) =>
    idempotency.get(keyOf(where.scope_idem_key.scope, where.scope_idem_key.idem_key)) || null);
  jest.spyOn(prisma.idempotency_record, 'update').mockImplementation(async ({ where, data }) => {
    const key = keyOf(where.scope_idem_key.scope, where.scope_idem_key.idem_key);
    idempotency.set(key, { ...idempotency.get(key), ...data });
    return idempotency.get(key);
  });
  jest.spyOn(prisma.idempotency_record, 'delete').mockImplementation(async ({ where }) => {
    idempotency.delete(keyOf(where.scope_idem_key.scope, where.scope_idem_key.idem_key));
    return {};
  });
});

afterEach(() => jest.restoreAllMocks());

// ── the envelope ────────────────────────────────────────────────────────────

describe('the response shape', () => {
  it('answers with the whole card in the {code, msg, data} envelope', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).field('title', 'Goodnight moon');

    expect(res.status).toBe(200);
    // The client reads json['data']; a bare card object parses as empty and the
    // screen goes blank.
    expect(res.body).toEqual(expect.objectContaining({ code: 0, msg: 'success' }));
    expect(res.body.data).toEqual(expect.objectContaining({
      kidId: String(KID_ID),
      kidName: 'Aarav',
      deviceMac: MAC,
      maxItems: 10,
    }));
    expect(res.body.data.contentPack.items).toEqual([
      expect.objectContaining({
        itemNumber: 1,
        title: 'Goodnight moon',
        fileUrl: AUDIO_URL,
        imageUrl: IMAGE_URL,
      }),
    ]);
  });

  it('carries the new version as the ETag', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).field('title', 'Renamed');

    expect(res.body.data.contentPack.version).toBe('5');
    expect(res.headers.etag).toBe('"5"');
  });
});

// ── the parts ───────────────────────────────────────────────────────────────

describe('the multipart parts', () => {
  it('takes title, audio and image in one atomic request', async () => {
    const res = await request(app)
      .patch(`${CARD}/content/1`)
      .field('title', 'All three')
      .attach('audio', MP3, 'new.mp3')
      .attach('image', RAW_FRAME, { filename: 'card_picture.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(item()).toEqual(expect.objectContaining({
      title: 'All three',
      audio_url: AUDIO_URL,   // overwritten in place
      image_url: IMAGE_URL,
    }));
    // One request, one bump.
    expect(res.body.data.contentPack.version).toBe('5');
  });

  it('leaves an omitted part alone', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).attach('audio', MP3, 'new.mp3');

    expect(res.status).toBe(200);
    expect(item().title).toBe('Bedtime story');
    expect(item().image_url).toBe(IMAGE_URL);
  });

  it('clears the picture to null, never an empty string', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).field('clearImage', 'true');

    expect(res.status).toBe(200);
    expect(res.body.data.contentPack.items[0].imageUrl).toBeNull();
    expect(mockUpload.deleteCustomCardObject).toHaveBeenCalledWith('customcard_kid42/image-1.bin');
  });

  it('refuses a picture and a clear together, in words a parent can act on', async () => {
    const res = await request(app)
      .patch(`${CARD}/content/1`)
      .field('clearImage', 'true')
      .attach('image', RAW_FRAME, 'card_picture.bin');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('Send either a new picture or a request to remove it, not both.');
  });

  it('accepts the .bin extension and an octet-stream content type', async () => {
    // Both the filename check and the magic-byte sniff had to be relaxed for a
    // packed frame to get through at all; a `.bin` has no magic bytes to sniff.
    const res = await request(app)
      .patch(`${CARD}/content/1`)
      .attach('image', LVGL_FRAME, { filename: 'card_picture_1234.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(mockUpload.uploadCustomCardImage.mock.calls[0][0]).toEqual(LVGL_FRAME);
  });

  it('refuses a picture that is not a panel frame', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toBe('That picture is not the right size for the toy\'s screen. Please choose it again.');
  });

  it('404s for a recording that is not on the card', async () => {
    const res = await request(app).patch(`${CARD}/content/9`).field('title', 'Nowhere');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That recording could not be found on this card.');
  });

  it('404s for another parent\'s child', async () => {
    const res = await request(app)
      .patch(`${BASE}/kids/${KID_ID + 1}/custom-card/content/1`)
      .field('title', 'Not mine');

    expect(res.status).toBe(404);
    expect(res.body.msg).toBe('That child could not be found.');
  });
});

// ── freshness ───────────────────────────────────────────────────────────────

describe('ETag on GET', () => {
  it('offers a tag for the body, and answers 304 when the client already has it', async () => {
    const first = await request(app).get(CARD);
    expect(first.status).toBe(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);

    const second = await request(app).get(CARD).set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.body).toEqual({});
  });

  it('answers 200 again once the card has been edited', async () => {
    const before = (await request(app).get(CARD)).headers.etag;
    await request(app).patch(`${CARD}/content/1`).field('title', 'Moved on');

    const res = await request(app).get(CARD).set('If-None-Match', before);

    expect(res.status).toBe(200);
    expect(res.headers.etag).not.toBe(before);
    expect(res.body.data.contentPack.items[0].title).toBe('Moved on');
  });

  // Pairing writes nothing to the pack. A tag keyed on the version answered 304
  // here, and the app kept showing "no toy paired" until the next edit.
  it('answers 200 once a toy is paired, even though the pack version has not moved', async () => {
    prisma.ai_device.findFirst.mockResolvedValue(null);
    const unpaired = await request(app).get(CARD);
    expect(unpaired.body.data.deviceMac).toBeNull();

    prisma.ai_device.findFirst.mockResolvedValue({ mac_address: MAC });
    const res = await request(app).get(CARD).set('If-None-Match', unpaired.headers.etag);

    expect(res.status).toBe(200);
    expect(res.body.data.deviceMac).toBe(MAC);
    expect(res.body.data.contentPack.version).toBe('4');
  });

  it('tags a child with no pack too, so "nothing recorded yet" revalidates the same way', async () => {
    prisma.rfid_content_pack.findFirst.mockResolvedValue(null);

    const res = await request(app).get(CARD);

    expect(res.status).toBe(200);
    expect(res.body.data.contentPack).toBeNull();
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
  });
});

describe('If-Match', () => {
  it('writes when the version the client saw is still current', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).set('If-Match', '"4"').field('title', 'Fenced');

    expect(res.status).toBe(200);
    expect(res.body.data.contentPack.version).toBe('5');
  });

  it('answers 412 with the current card, and writes nothing', async () => {
    const res = await request(app).patch(`${CARD}/content/1`).set('If-Match', '"3"').field('title', 'Too late');

    expect(res.status).toBe(412);
    expect(res.body.msg).toBe('Someone else updated this card. Here is the latest version.');
    // The body carries the card, so the app can repaint from what actually
    // happened rather than showing a generic failure.
    expect(res.body.data.contentPack.version).toBe('4');
    expect(res.body.data.contentPack.items[0].title).toBe('Bedtime story');
    expect(item().title).toBe('Bedtime story');
  });

  it('writes unconditionally when the header is absent', async () => {
    // Load-bearing: no legacy caller sends one, and they all live for ever.
    const res = await request(app).patch(`${CARD}/content/1`).field('title', 'Unfenced');

    expect(res.status).toBe(200);
    expect(res.body.data.contentPack.version).toBe('5');
  });
});

// ── retries ─────────────────────────────────────────────────────────────────

describe('Idempotency-Key', () => {
  it('replays the first response instead of bumping the version twice', async () => {
    const send = () => request(app)
      .patch(`${CARD}/content/1`)
      .set('Idempotency-Key', 'retry-me')
      .field('title', 'Sent twice');

    const first = await send();
    const second = await send();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // The retry is what a dropped response looks like from the phone. A second
    // bump would send every toy holding this card off to re-download it.
    expect(pack.version).toBe('5');
    expect(prisma.content_item.update).toHaveBeenCalledTimes(1);
  });

  it('stops a retried upload from appending the same recording twice', async () => {
    const send = () => request(app)
      .post(`${CARD}/content`)
      .set('Idempotency-Key', 'upload-once')
      .attach('file', MP3, 'a.mp3');

    const first = await send();
    const second = await send();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(mockUpload.uploadCustomCardAudio).toHaveBeenCalledTimes(1);
  });

  it('treats a different key as a different request', async () => {
    await request(app).patch(`${CARD}/content/1`).set('Idempotency-Key', 'one').field('title', 'First');
    await request(app).patch(`${CARD}/content/1`).set('Idempotency-Key', 'two').field('title', 'Second');

    expect(item().title).toBe('Second');
    expect(pack.version).toBe('6');
  });

  it('does not remember a failure, so a fixed retry can still succeed', async () => {
    const bad = await request(app)
      .patch(`${CARD}/content/1`)
      .set('Idempotency-Key', 'fix-me')
      .attach('image', PNG, 'drawing.png');
    expect(bad.status).toBe(400);

    const good = await request(app)
      .patch(`${CARD}/content/1`)
      .set('Idempotency-Key', 'fix-me')
      .attach('image', RAW_FRAME, 'card_picture.bin');

    expect(good.status).toBe(200);
  });

  it('runs unprotected rather than failing when the store is unavailable', async () => {
    // A database that has not caught up with its migrations must not be able to
    // stop a parent saving an edit.
    prisma.idempotency_record.create.mockRejectedValue(new Error('relation does not exist'));

    const res = await request(app)
      .patch(`${CARD}/content/1`)
      .set('Idempotency-Key', 'no-table')
      .field('title', 'Still saved');

    expect(res.status).toBe(200);
    expect(item().title).toBe('Still saved');
  });
});

// ── the legacy routes, which never go away ──────────────────────────────────

describe('the legacy picture routes keep taking both formats', () => {
  it('stores a packed frame as-is, without converting it', async () => {
    const res = await request(app)
      .put(`${CARD}/content/1/image`)
      .attach('image', LVGL_FRAME, { filename: 'card_picture.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(mockUpload.uploadCustomCardImage.mock.calls[0][0]).toEqual(LVGL_FRAME);
    expect(require('../../src/utils/lvglImage').toLvglRgb565Bin).not.toHaveBeenCalled();
  });

  it('wraps the app\'s headerless frame the same way PATCH does', async () => {
    const res = await request(app)
      .put(`${CARD}/content/1/image`)
      .attach('image', RAW_FRAME, { filename: 'card_picture.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(mockUpload.uploadCustomCardImage.mock.calls[0][0].length).toBe(RAW_FRAME_BYTES + 12);
  });

  it('still accepts a PNG from a shipped build', async () => {
    // Every parent on the current build uploads one of these, and they have no
    // way to update before their next save.
    const res = await request(app).put(`${CARD}/content/1/image`).attach('image', PNG, 'drawing.png');

    expect(res.status).toBe(200);
    expect(require('../../src/utils/lvglImage').toLvglRgb565Bin).toHaveBeenCalled();
  });

  it('takes the app\'s frame as image_1 on POST /content, the create-card upload', async () => {
    // The request a current build makes when a parent adds a recording with a
    // picture: `files` plus `image_1`, the picture being the packed frame under
    // `application/octet-stream` and a `.bin` name. The deployed build answered
    // this with "Only PNG and JPEG pictures are supported." — the sniff found no
    // PNG/JPEG signature and stopped there, before the frame branch existed.
    const res = await request(app)
      .post(`${CARD}/content`)
      .attach('files', MP3, 'story.mp3')
      .attach('image_1', RAW_FRAME, { filename: 'card_picture_1756.bin', contentType: 'application/octet-stream' });

    expect(res.status).toBe(201);
    expect(res.body.msg).not.toMatch(/PNG and JPEG/);
    // Stored with the header, untouched otherwise — never handed to ffmpeg.
    expect(mockUpload.uploadCustomCardImage.mock.calls[0][0].length).toBe(RAW_FRAME_BYTES + 12);
    expect(require('../../src/utils/lvglImage').toLvglRgb565Bin).not.toHaveBeenCalled();
    const added = res.body.data.contentPack.items.at(-1);
    expect(added.imageUrl).toEqual(expect.any(String));
  });

  it('bumps the version on every legacy write', async () => {
    const set = await request(app).put(`${CARD}/content/1/image`).attach('image', PNG, 'drawing.png');
    expect(set.body.data.contentPack.version).toBe('5');

    const replaced = await request(app).put(`${CARD}/content/1`).attach('file', MP3, 'b.mp3');
    expect(replaced.body.data.contentPack.version).toBe('6');

    const cleared = await request(app).delete(`${CARD}/content/1/image`);
    expect(cleared.body.data.contentPack.version).toBe('7');

    const removed = await request(app).delete(`${CARD}/content/1`);
    expect(removed.body.data.contentPack.version).toBe('8');
  });
});
