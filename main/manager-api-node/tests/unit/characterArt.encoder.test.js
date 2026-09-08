'use strict';

/**
 * The RGB565A8 encoder that turns an uploaded character sprite into the binary
 * the toy's panel draws.
 *
 * The reason this format exists separately from the RGB565 one used for content
 * artwork is the alpha plane: a character is drawn OVER the conversation
 * background, so a sprite that arrives opaque is a rectangle on the screen. The
 * assertions below are the ones that fail silently on a real device — the
 * firmware rejects a frame of the wrong length at load time with nothing to
 * report it, and a lost alpha plane looks like artwork that was simply drawn
 * badly.
 */

const zlib = require('zlib');
const {
  toLvglRgb565A8Bin,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  LVGL_HEADER_BYTES,
  LVGL_A8_FRAME_BYTES,
  LV_COLOR_FORMAT_RGB565A8
} = require('../../src/utils/lvglImage');

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

/**
 * A minimal RGBA PNG — no image library needed. `alphaAt(x, y)` decides each
 * pixel's opacity, which is what lets a test draw a shape with a transparent
 * surround the way a real sprite is drawn.
 */
const makeRgbaPng = (width, height, [r, g, b], alphaAt = () => 255) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 4] = r;
      raw[row + 2 + x * 4] = g;
      raw[row + 3 + x * 4] = b;
      raw[row + 4 + x * 4] = alphaAt(x, y);
    }
  }

  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
};

const ALPHA_OFFSET = LVGL_HEADER_BYTES + PANEL_WIDTH * PANEL_HEIGHT * 2;
const colorAt = (bin, x, y) => bin.readUInt16LE(LVGL_HEADER_BYTES + ((y * PANEL_WIDTH) + x) * 2);
const alphaAt = (bin, x, y) => bin.readUInt8(ALPHA_OFFSET + (y * PANEL_WIDTH) + x);

const ffmpegAvailable = require('child_process')
  .spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0;

// Skipped rather than failed where ffmpeg is absent: the runtime image installs
// it (Dockerfile), but a bare dev box may not have it.
const describeConverter = ffmpegAvailable ? describe : describe.skip;
if (!ffmpegAvailable) {
  // eslint-disable-next-line no-console
  console.warn('[characterArt.encoder] ffmpeg not found — converter tests skipped');
}

describeConverter('toLvglRgb565A8Bin', () => {
  it('emits the RGB565A8 header and length the shipped sprites have', async () => {
    const bin = await toLvglRgb565A8Bin(makeRgbaPng(PANEL_WIDTH, PANEL_HEIGHT, [255, 0, 0]));

    expect(bin.readUInt8(0)).toBe(0x19);                        // LVGL v9 magic
    expect(bin.readUInt8(1)).toBe(LV_COLOR_FORMAT_RGB565A8);    // 0x14, not 0x12
    expect(bin.readUInt16LE(2)).toBe(0);                        // flags: uncompressed
    expect(bin.readUInt16LE(4)).toBe(PANEL_WIDTH);
    expect(bin.readUInt16LE(6)).toBe(PANEL_HEIGHT);
    // Stride is the COLOUR plane's row length in this format too — the alpha
    // plane is indexed per pixel, after the colour plane ends.
    expect(bin.readUInt16LE(8)).toBe(PANEL_WIDTH * 2);
    expect(bin.readUInt16LE(10)).toBe(0);                       // reserved

    // 213,132 — the size every character sprite already on the CDN is.
    expect(bin.length).toBe(LVGL_A8_FRAME_BYTES);
    expect(bin.length).toBe(12 + PANEL_WIDTH * PANEL_HEIGHT * 3);
    expect(bin.length).toBeLessThan(300 * 1024);                // kMaxImageBytes
  });

  it('packs colour identically to the RGB565 path', async () => {
    const bin = await toLvglRgb565A8Bin(makeRgbaPng(PANEL_WIDTH, PANEL_HEIGHT, [255, 0, 0]));

    // ((255 >> 3) << 11) | ((0 >> 2) << 5) | (0 >> 3)
    expect(colorAt(bin, 0, 0)).toBe(0xf800);
    expect(colorAt(bin, PANEL_WIDTH - 1, PANEL_HEIGHT - 1)).toBe(0xf800);
  });

  it('carries the source alpha through to the alpha plane', async () => {
    // Opaque on the left half, transparent on the right.
    const png = makeRgbaPng(PANEL_WIDTH, PANEL_HEIGHT, [0, 0, 255],
      (x) => (x < PANEL_WIDTH / 2 ? 255 : 0));

    const bin = await toLvglRgb565A8Bin(png);

    expect(alphaAt(bin, 10, PANEL_HEIGHT / 2)).toBe(255);
    expect(alphaAt(bin, PANEL_WIDTH - 10, PANEL_HEIGHT / 2)).toBe(0);
  });

  it('letterboxes with transparency, not with white', async () => {
    // A portrait sprite on a landscape panel: the bars are what would show as a
    // white block behind the character if this were flattened like content art.
    const bin = await toLvglRgb565A8Bin(makeRgbaPng(60, 240, [0, 0, 255]));

    expect(bin.length).toBe(LVGL_A8_FRAME_BYTES);
    expect(alphaAt(bin, 0, PANEL_HEIGHT / 2)).toBe(0);                 // left bar
    expect(alphaAt(bin, PANEL_WIDTH - 1, PANEL_HEIGHT / 2)).toBe(0);   // right bar
    expect(alphaAt(bin, PANEL_WIDTH / 2, PANEL_HEIGHT / 2)).toBe(255); // the sprite
    expect(colorAt(bin, PANEL_WIDTH / 2, PANEL_HEIGHT / 2)).toBe(0x001f);
  });

  it('fits an oversized sprite to the panel', async () => {
    const bin = await toLvglRgb565A8Bin(makeRgbaPng(1600, 400, [0, 255, 0]));

    expect(bin.length).toBe(LVGL_A8_FRAME_BYTES);
    expect(colorAt(bin, PANEL_WIDTH / 2, PANEL_HEIGHT / 2)).toBe(0x07e0);
    expect(alphaAt(bin, PANEL_WIDTH / 2, 0)).toBe(0);                  // top bar
  });

  it('reports a file it cannot decode as the upload being wrong, not us', async () => {
    await expect(toLvglRgb565A8Bin(Buffer.from('this is not a picture')))
      .rejects.toMatchObject({ decodeFailed: true });
  });

  it('rejects an empty upload', async () => {
    await expect(toLvglRgb565A8Bin(Buffer.alloc(0)))
      .rejects.toMatchObject({ decodeFailed: true });
  });
});
