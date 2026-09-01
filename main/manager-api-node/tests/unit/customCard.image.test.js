'use strict';

/**
 * Custom-card artwork: the validator, the LVGL conversion, and the three places
 * a picture can silently detach from its recording — the content hash, a
 * renumber after a delete, and the multipart pairing.
 */

const zlib = require('zlib');

// The conversion shells out to ffmpeg. The wiring tests below care about which
// URL lands on which item, not about pixels, so they run against a stub; the
// converter itself is exercised for real further down.
jest.mock('../../src/utils/lvglImage', () => ({
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12))
}));

const mockPrisma = {
  kid_profile: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn(), upsert: jest.fn() },
  content_item: { findMany: jest.fn() }
};

const mockUpload = {
  uploadCustomCardAudio: jest.fn(),
  uploadCustomCardImage: jest.fn(),
  deleteCustomCardObject: jest.fn(async () => {})
};

const mockRfid = { updateContentPack: jest.fn() };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/upload.service', () => mockUpload);
jest.mock('../../src/services/rfid.service', () => mockRfid);

const customCardService = require('../../src/services/customCard.service');

const USER_ID = 7;
const KID_ID = 42;
const MAC = 'AA:BB:CC:DD:EE:FF';
const PACK = { id: BigInt(7), pack_code: 'CUSTOM_KID_42', name: 'Custom Card', version: '1' };

const AUDIO = (n) => `https://cdn.test/customcard_kid42/audio${n}.mp3`;
const IMAGE = (n) => `https://cdn.test/customcard_kid42/image${n}.bin`;

// ── fixtures ──────────────────────────────────────────────────────────────

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A minimal truecolour PNG of one flat colour — no image library needed. */
const makePng = (width, height, [r, g, b]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

/**
 * Just enough JPEG to carry a frame header: SOI, an APP0 segment to be walked
 * past, then an SOF0 declaring the size. No entropy data — the validator only
 * ever reads as far as the frame header.
 */
const makeJpegHeader = (width, height) => {
  const app0 = Buffer.from('ffe000104a46494600010100000100010000', 'hex');
  const sof0 = Buffer.alloc(19);
  sof0.write('ffc00011', 0, 'hex');
  sof0.writeUInt8(8, 4);            // sample precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(3, 9);            // three components, then 3 bytes each
  return Buffer.concat([Buffer.from('ffd8', 'hex'), app0, sof0]);
};

const asUpload = (buffer, originalname) => ({ buffer, originalname });

const MP3 = asUpload(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]), 'song.mp3');
const PNG = asUpload(makePng(4, 4, [255, 0, 0]), 'drawing.png');
const JPEG = asUpload(Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(64)]), 'photo.jpg');

// ── an in-memory pack, so a renumber is observed rather than asserted about ──

let rows = [];
let writes = [];

const rowFor = (item, index) => ({
  id: BigInt(index + 1),
  item_number: item.itemNumber,
  title: item.title,
  audio_url: item.audioUrl,
  audio_size_bytes: item.audioSizeBytes,
  image_url: item.imageUrl == null ? null : item.imageUrl
});

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  writes = [];

  mockPrisma.kid_profile.findFirst.mockResolvedValue({ id: BigInt(KID_ID), name: 'Aarav' });
  // The toy the child is currently paired to — informational only; the pack is
  // theirs whether or not this returns anything.
  mockPrisma.ai_device.findFirst.mockResolvedValue({ mac_address: MAC });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
  mockPrisma.rfid_content_pack.upsert.mockResolvedValue(PACK);
  mockPrisma.content_item.findMany.mockImplementation(async () => rows.map((row) => ({ ...row })));

  mockRfid.updateContentPack.mockImplementation(async (data) => {
    writes.push(data);
    rows = data.items.map(rowFor);
  });

  let audioSeq = 0;
  let imageSeq = 0;
  mockUpload.uploadCustomCardAudio.mockImplementation(async () => {
    audioSeq += 1;
    return { s3Key: `k${audioSeq}`, url: AUDIO(audioSeq) };
  });
  mockUpload.uploadCustomCardImage.mockImplementation(async () => {
    imageSeq += 1;
    return { s3Key: `i${imageSeq}`, url: IMAGE(imageSeq) };
  });
});

const lastWrite = () => writes[writes.length - 1];

// ── validator ─────────────────────────────────────────────────────────────

describe('validateImageUpload', () => {
  it('accepts a PNG sent with no filename at all', () => {
    // Flutter's MultipartFile.fromBytes() omits the filename; the magic bytes
    // are the control, so this must not be rejected as an unsupported type.
    expect(customCardService.validateImageUpload(asUpload(PNG.buffer, undefined)))
      .toEqual({ ext: '.png', mimeType: 'image/png' });
  });

  it('accepts a JPEG named .jpeg', () => {
    expect(customCardService.validateImageUpload(asUpload(JPEG.buffer, 'photo.jpeg')))
      .toEqual({ ext: '.jpg', mimeType: 'image/jpeg' });
  });

  it('rejects a JPEG wearing a .png extension', () => {
    expect(() => customCardService.validateImageUpload(asUpload(JPEG.buffer, 'photo.png')))
      .toThrow('The file contents do not match its .png extension.');
  });

  it('rejects a file that is not a picture, whatever it is called', () => {
    expect(() => customCardService.validateImageUpload(asUpload(Buffer.from('hello world!!'), 'x.png')))
      .toThrow('Only PNG and JPEG pictures are supported.');
  });

  it('rejects a picture over 5 MB', () => {
    const big = Buffer.concat([PNG.buffer, Buffer.alloc(customCardService.MAX_IMAGE_BYTES)]);
    expect(() => customCardService.validateImageUpload(asUpload(big, 'big.png')))
      .toThrow('That picture is larger than 5 MB. Please choose a smaller one.');
  });

  it('rejects a PNG whose header declares a canvas far too big to decode', () => {
    // 30000 x 30000 of flat colour compresses to a few KB and unpacks to 3.6 GB.
    // The file-size ceiling cannot see this; only the header can.
    const bomb = Buffer.from(makePng(4, 4, [0, 0, 0]));
    bomb.writeUInt32BE(30000, 16);
    bomb.writeUInt32BE(30000, 20);

    expect(() => customCardService.validateImageUpload(asUpload(bomb, 'bomb.png')))
      .toThrow('That picture is 30000 by 30000 pixels, which is too large to process. Please choose a smaller one.');
  });

  it('rejects a JPEG whose frame header declares a canvas far too big to decode', () => {
    expect(() => customCardService.validateImageUpload(asUpload(makeJpegHeader(20000, 20000), 'bomb.jpg')))
      .toThrow('That picture is 20000 by 20000 pixels, which is too large to process. Please choose a smaller one.');
  });

  it('accepts a full-resolution phone photo', () => {
    // 48 MP is past the ceiling, but no 48 MP JPEG fits in 5 MB; 12 MP is what a
    // parent's camera roll actually holds, and it must not be turned away.
    expect(customCardService.validateImageUpload(asUpload(makeJpegHeader(4032, 3024), 'photo.jpg')))
      .toEqual({ ext: '.jpg', mimeType: 'image/jpeg' });
  });

  it('lets a picture with no readable frame header through to ffmpeg', () => {
    // Nothing we can measure means nothing ffmpeg can decode either, so the
    // subprocess timeout is the backstop rather than a guess here.
    expect(customCardService.imageDimensions(JPEG.buffer, '.jpg')).toBeNull();
    expect(customCardService.validateImageUpload(JPEG)).toEqual({ ext: '.jpg', mimeType: 'image/jpeg' });
  });

  it('reads dimensions out of each format\'s own header', () => {
    expect(customCardService.imageDimensions(makePng(296, 240, [0, 0, 0]), '.png'))
      .toEqual({ width: 296, height: 240 });
    expect(customCardService.imageDimensions(makeJpegHeader(296, 240), '.jpg'))
      .toEqual({ width: 296, height: 240 });
  });

  it('reads the format from magic bytes, not the extension', () => {
    expect(customCardService.sniffImageExtension(PNG.buffer)).toBe('.png');
    expect(customCardService.sniffImageExtension(JPEG.buffer)).toBe('.jpg');
    expect(customCardService.sniffImageExtension(Buffer.from('RIFFxxxxWAVE'))).toBeNull();
  });
});

// ── multipart pairing ─────────────────────────────────────────────────────

describe('pairCustomCardUploads', () => {
  const a = asUpload(MP3.buffer, 'a.mp3');
  const b = asUpload(MP3.buffer, 'b.mp3');

  it('pairs image_N with the Nth files part, whatever order the parts arrive in', () => {
    const { uploads, images } = customCardService.pairCustomCardUploads({
      image_2: [PNG], files: [a, b]
    });

    expect(uploads).toEqual([a, b]);
    expect(images).toEqual([null, PNG]);
  });

  it('pairs image with the single-file shape', () => {
    const { uploads, images } = customCardService.pairCustomCardUploads({ file: [a], image: [PNG] });

    expect(uploads).toEqual([a]);
    expect(images).toEqual([PNG]);
  });

  it('rejects an image_N with no recording at N', () => {
    expect(() => customCardService.pairCustomCardUploads({ files: [a, b], image_3: [PNG] }))
      .toThrow('Each picture must go with a recording.');
  });

  it('rejects a bare image with no file part', () => {
    expect(() => customCardService.pairCustomCardUploads({ files: [a], image: [PNG] }))
      .toThrow('Each picture must go with a recording.');
  });

  it('leaves recordings unpaired when no pictures were sent', () => {
    expect(customCardService.pairCustomCardUploads({ files: [a, b] }).images).toEqual([null, null]);
  });
});

// ── the write path ────────────────────────────────────────────────────────

describe('custom card artwork write path', () => {
  it('attaches each picture to its own recording', async () => {
    const card = await customCardService.addCustomCardContent(
      USER_ID, KID_ID, [asUpload(MP3.buffer, 'a.mp3'), asUpload(MP3.buffer, 'b.mp3')],
      { images: [null, PNG] }
    );

    expect(lastWrite().items).toEqual([
      expect.objectContaining({ itemNumber: 1, imageUrl: null }),
      expect.objectContaining({ itemNumber: 2, imageUrl: IMAGE(1) })
    ]);
    expect(card.contentPack.items[1].imageUrl).toBe(IMAGE(1));
  });

  it('uploads nothing when one picture in a batch is bad', async () => {
    await expect(customCardService.addCustomCardContent(
      USER_ID, KID_ID, [asUpload(MP3.buffer, 'a.mp3'), asUpload(MP3.buffer, 'b.mp3')],
      { images: [PNG, asUpload(Buffer.from('not a picture'), 'b.png')] }
    )).rejects.toThrow('Only PNG and JPEG pictures are supported.');

    // The whole request is refused before storage sees any of it, so the first
    // recording is not left orphaned in the bucket.
    expect(mockUpload.uploadCustomCardAudio).not.toHaveBeenCalled();
    expect(mockUpload.uploadCustomCardImage).not.toHaveBeenCalled();
  });

  it('moves the content hash when only the picture changes', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [MP3], {});
    const before = lastWrite().contentHash;

    await customCardService.setCustomCardItemImage(USER_ID, KID_ID, 1, PNG);

    // The toy compares the hash first. If artwork sat outside it, the tap
    // handshake would answer card_up_to_date and the new picture would never
    // reach the device.
    expect(lastWrite().contentHash).not.toBe(before);
    expect(lastWrite().items[0].audioUrl).toBe(AUDIO(1));
  });

  it('clears artwork without touching the recording, and sweeps the old object', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [MP3], { images: [PNG] });

    await customCardService.clearCustomCardItemImage(USER_ID, KID_ID, 1);

    expect(lastWrite().items).toEqual([
      expect.objectContaining({ itemNumber: 1, audioUrl: AUDIO(1), imageUrl: null })
    ]);
    expect(mockUpload.deleteCustomCardObject).toHaveBeenCalledWith('customcard_kid42/image1.bin');
  });

  it('keeps the existing picture when a recording is replaced without one', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [MP3], { images: [PNG] });

    await customCardService.replaceCustomCardItem(USER_ID, KID_ID, 1, asUpload(MP3.buffer, 'new.mp3'), {});

    expect(lastWrite().items[0]).toEqual(expect.objectContaining({
      audioUrl: AUDIO(2),
      imageUrl: IMAGE(1)
    }));
  });

  it('renumbers each surviving picture with its own recording', async () => {
    await customCardService.addCustomCardContent(
      USER_ID, KID_ID,
      [asUpload(MP3.buffer, 'a.mp3'), asUpload(MP3.buffer, 'b.mp3'), asUpload(MP3.buffer, 'c.mp3')],
      { images: [PNG, PNG, PNG] }
    );

    await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1);

    // updateContentPack falls back to the existing row at the same item_number
    // for anything left undefined, so items 2 and 3 sliding down to 1 and 2 is
    // exactly where a picture would graft itself onto the wrong recording.
    expect(lastWrite().items).toEqual([
      expect.objectContaining({ itemNumber: 1, audioUrl: AUDIO(2), imageUrl: IMAGE(2) }),
      expect.objectContaining({ itemNumber: 2, audioUrl: AUDIO(3), imageUrl: IMAGE(3) })
    ]);
    // Only the deleted item's two objects go.
    expect(mockUpload.deleteCustomCardObject.mock.calls.map(([key]) => key).sort()).toEqual([
      'customcard_kid42/audio1.mp3',
      'customcard_kid42/image1.bin'
    ]);
  });

  it('404s for an item that is not on the card', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [MP3], {});

    await expect(customCardService.setCustomCardItemImage(USER_ID, KID_ID, 4, PNG))
      .rejects.toThrow('That recording could not be found on this card.');
  });
});

// ── the converter ─────────────────────────────────────────────────────────

const ffmpegAvailable = require('child_process')
  .spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0;

// Skipped rather than failed where ffmpeg is absent: the runtime image installs
// it (Dockerfile), but a bare dev box may not have it.
const describeConverter = ffmpegAvailable ? describe : describe.skip;
if (!ffmpegAvailable) {
  // eslint-disable-next-line no-console
  console.warn('[customCard.image] ffmpeg not found — LVGL converter tests skipped');
}

describeConverter('toLvglRgb565Bin', () => {
  const { toLvglRgb565Bin, PANEL_WIDTH, PANEL_HEIGHT } = jest.requireActual('../../src/utils/lvglImage');

  const pixelAt = (bin, x, y) => bin.readUInt16LE(12 + (y * PANEL_WIDTH + x) * 2);

  it('emits the LVGL v9 RGB565 header the firmware loader expects', async () => {
    const bin = await toLvglRgb565Bin(makePng(PANEL_WIDTH, PANEL_HEIGHT, [255, 0, 0]));

    expect(bin.readUInt8(0)).toBe(0x19);           // LVGL v9 magic
    expect(bin.readUInt8(1)).toBe(0x12);           // LV_COLOR_FORMAT_RGB565
    expect(bin.readUInt16LE(2)).toBe(0);           // flags: uncompressed
    expect(bin.readUInt16LE(4)).toBe(PANEL_WIDTH);
    expect(bin.readUInt16LE(6)).toBe(PANEL_HEIGHT);
    expect(bin.readUInt16LE(8)).toBe(PANEL_WIDTH * 2); // stride
    expect(bin.readUInt16LE(10)).toBe(0);          // reserved
    expect(bin.length).toBe(12 + PANEL_WIDTH * PANEL_HEIGHT * 2);
    expect(bin.length).toBeLessThan(300 * 1024);   // kMaxImageBytes
  });

  it('packs colour the way the firmware converter does', async () => {
    const bin = await toLvglRgb565Bin(makePng(PANEL_WIDTH, PANEL_HEIGHT, [255, 0, 0]));

    // ((255 >> 3) << 11) | ((0 >> 2) << 5) | (0 >> 3), little-endian
    expect(pixelAt(bin, 0, 0)).toBe(0xf800);
    expect(pixelAt(bin, PANEL_WIDTH - 1, PANEL_HEIGHT - 1)).toBe(0xf800);
  });

  it('letterboxes a portrait picture on white rather than cropping or stretching', async () => {
    const bin = await toLvglRgb565Bin(makePng(60, 240, [0, 0, 255]));

    expect(bin.length).toBe(12 + PANEL_WIDTH * PANEL_HEIGHT * 2);
    expect(pixelAt(bin, 0, PANEL_HEIGHT / 2)).toBe(0xffff);                 // left bar
    expect(pixelAt(bin, PANEL_WIDTH - 1, PANEL_HEIGHT / 2)).toBe(0xffff);   // right bar
    expect(pixelAt(bin, PANEL_WIDTH / 2, PANEL_HEIGHT / 2)).toBe(0x001f);   // the picture
  });

  it('fits an oversized landscape photo to the panel', async () => {
    const bin = await toLvglRgb565Bin(makePng(1600, 400, [0, 255, 0]));

    expect(bin.length).toBe(12 + PANEL_WIDTH * PANEL_HEIGHT * 2);
    expect(pixelAt(bin, PANEL_WIDTH / 2, PANEL_HEIGHT / 2)).toBe(0x07e0);
    expect(pixelAt(bin, PANEL_WIDTH / 2, 0)).toBe(0xffff);                  // top bar
  });

  it('reports a file it cannot decode as the upload being wrong, not us', async () => {
    await expect(toLvglRgb565Bin(Buffer.from('this is not a picture')))
      .rejects.toMatchObject({ decodeFailed: true });
  });
});
