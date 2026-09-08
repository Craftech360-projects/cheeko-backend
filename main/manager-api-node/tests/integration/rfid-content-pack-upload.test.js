/**
 * Content pack artwork over the wire.
 *
 * The toy's firmware draws only pre-decoded LVGL RGB565 frames, so a PNG stored
 * as-is leaves the screen blank. Admins used to run the firmware's converter by
 * hand before uploading; the upload route now does it, and what these tests pin
 * is that decision — which uploads get converted, which are left alone, and what
 * name and content type the bytes are stored under.
 *
 * The conversion itself shells out to ffmpeg and is covered in
 * tests/unit/customCard.image.test.js; here it is stubbed, because the subject
 * is the route contract rather than the pixels. Storage is stubbed for the same
 * reason a test that filled a real bucket could not be run twice.
 */

'use strict';

const CONVERTED = Buffer.alloc(64, 0x5a);

jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(64, 0x5a)),
}));

jest.mock('../../src/middleware/auth', () => ({
  ...jest.requireActual('../../src/middleware/auth'),
  requireAdmin: (req, _res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
}));

jest.mock('../../src/services/upload.service', () => ({
  ...jest.requireActual('../../src/services/upload.service'),
  uploadContentFile: jest.fn(async (_buffer, filename) => ({
    success: true,
    url: `https://cdn.test/rfidcontent/images/${filename}`,
    s3Key: `rfidcontent/images/${filename}`,
    filename,
  })),
}));

jest.mock('../../src/services/rfid.service', () => ({
  ...jest.requireActual('../../src/services/rfid.service'),
  updateContentPack: jest.fn(async () => ({ id: 31 })),
}));

const request = require('supertest');
const app = require('../../src/app');
const { toLvglRgb565Bin } = require('../../src/utils/lvglImage');
const uploadService = require('../../src/services/upload.service');
const rfidService = require('../../src/services/rfid.service');

const URL = '/toy/admin/rfid/content-pack/upload';

// Real magic bytes, padded past the 12-byte sniff window. The bodies are not
// real pictures, which is exactly why the converter is stubbed.
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
// A 296x240 LVGL v9 RGB565 frame header — what the firmware's converter emits.
const BIN = Buffer.concat([Buffer.from('19120000280100f0003002000000', 'hex'), Buffer.alloc(64)]);

const upload = (buffer, filename, fields = {}) => {
  let req = request(app).post(URL).field('category', 'images');
  Object.entries(fields).forEach(([key, value]) => { req = req.field(key, String(value)); });
  return req.attach('file', buffer, filename);
};

const storedCall = () => uploadService.uploadContentFile.mock.calls[0];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /admin/rfid/content-pack/upload — item artwork', () => {
  it('converts a PNG and stores it as a .bin', async () => {
    const res = await upload(PNG, 'lion.png');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(toLvglRgb565Bin).toHaveBeenCalledTimes(1);

    const [buffer, filename, contentType, category, mimeType] = storedCall();
    expect(buffer).toEqual(CONVERTED);
    expect(filename).toBe('lion.bin');
    expect(mimeType).toBe('application/octet-stream');
    expect(contentType).toBe('rfidcontent');
    expect(category).toBe('images');
    expect(res.body.data.url).toMatch(/lion\.bin$/);
  });

  it('converts a JPEG too, whatever the extension says', async () => {
    const res = await upload(JPEG, 'zebra.JPEG');

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).toHaveBeenCalledTimes(1);
    expect(storedCall()[1]).toBe('zebra.bin');
  });

  // The workflow this route change replaces: rename the PNG to .bin, upload it,
  // and the toy shows nothing because the bytes are still a PNG. Sniffing rather
  // than trusting the extension is what makes the old habit harmless.
  it('converts a PNG that was renamed .bin', async () => {
    const res = await upload(PNG, 'lion.bin');

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).toHaveBeenCalledTimes(1);

    const [buffer, filename] = storedCall();
    expect(buffer).toEqual(CONVERTED);
    expect(filename).toBe('lion.bin');
  });

  it('leaves an already-converted .bin untouched', async () => {
    const res = await upload(BIN, 'tiger.bin');

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).not.toHaveBeenCalled();

    const [buffer, filename, , , mimeType] = storedCall();
    expect(buffer).toEqual(BIN);
    expect(filename).toBe('tiger.bin');
    expect(mimeType).toBe('application/octet-stream');
  });

  it('leaves audio alone', async () => {
    const res = await upload(MP3, 'lion.mp3');

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).not.toHaveBeenCalled();
    expect(storedCall()[1]).toBe('lion.mp3');
  });

  it('answers 400 when the picture cannot be decoded', async () => {
    const failure = new Error('ffmpeg could not decode the image: bad header');
    failure.decodeFailed = true;
    toLvglRgb565Bin.mockRejectedValueOnce(failure);

    const res = await upload(PNG, 'broken.png');

    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe(0);
    expect(uploadService.uploadContentFile).not.toHaveBeenCalled();
  });
});

describe('POST /admin/rfid/content-pack/upload — pack thumbnail', () => {
  // The thumbnail is cover art the dashboard shows in a plain <img>, which
  // cannot render an LVGL frame. It is the one image on this route that must
  // come back out the way it went in.
  it('keeps a thumbnail a web image when purpose says so', async () => {
    const res = await upload(PNG, 'cover.png', { purpose: 'thumbnail' });

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).not.toHaveBeenCalled();

    const [buffer, filename, , , mimeType] = storedCall();
    expect(buffer).toEqual(PNG);
    expect(filename).toBe('cover.png');
    expect(mimeType).toBe('image/png');
  });

  // The regression this pair exists for: the dialog has no pack id until the
  // pack is saved, so keying "is this a thumbnail" off contentPackId converted
  // the cover art of every new pack.
  it('keeps a thumbnail a web image for a pack that has no id yet', async () => {
    const res = await upload(PNG, 'cover.png', { purpose: 'thumbnail' });

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).not.toHaveBeenCalled();
    expect(rfidService.updateContentPack).not.toHaveBeenCalled();
    expect(res.body.data.url).toMatch(/cover\.png$/);
  });

  it('still treats an upload carrying a contentPackId as the pack thumbnail', async () => {
    const res = await upload(PNG, 'cover.png', { contentPackId: 31 });

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).not.toHaveBeenCalled();
    expect(storedCall()[1]).toBe('cover.png');
  });

  // The upload hands back a URL and writes nothing. It used to save the pack's
  // thumbnail on the spot, which meant the new cover reached the row before
  // Save did — so the save that was meant to adopt it saw nothing new, judged
  // the pack unchanged and left the version alone. The editor sends
  // thumbnailUrl with the rest of the pack, so Save is what stores it.
  it('does not write the pack row, even when the upload names a pack', async () => {
    const res = await upload(PNG, 'cover.png', { contentPackId: 31 });

    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/cover\.png$/);
    expect(rfidService.updateContentPack).not.toHaveBeenCalled();
  });

  it('converts item artwork even when the pack has an id', async () => {
    const res = await upload(PNG, 'lion.png', { packCode: 'CK0001' });

    expect(res.status).toBe(200);
    expect(toLvglRgb565Bin).toHaveBeenCalledTimes(1);
    expect(storedCall()[1]).toBe('lion.bin');
  });
});
