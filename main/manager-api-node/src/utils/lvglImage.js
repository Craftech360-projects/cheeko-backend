/**
 * LVGL v9 image encoder.
 *
 * The toy has no JPEG decoder compiled in (LV_USE_TJPGD and
 * LV_USE_LIBJPEG_TURBO are both off in the firmware sdkconfig), so a JPEG that
 * reaches the device is silently dropped and the screen simply stays blank.
 * PNG would decode, but at the cost of decode RAM and with no bound on the file
 * size. Every asset already on the SD card is therefore a pre-decoded LVGL
 * binary, and parent artwork is converted to the same thing here.
 *
 * Output layout — 12-byte header then raw pixels, matching the firmware's own
 * converter (cheeko-os-v2/imageConverter/image_to_bin_converter.py):
 *
 *   0  u8   0x19   magic, LVGL v9
 *   1  u8   0x12   LV_COLOR_FORMAT_RGB565
 *   2  u16  flags  0 — uncompressed
 *   4  u16  width
 *   6  u16  height
 *   8  u16  stride (bytes per row = width * 2)
 *   10 u16  reserved
 *
 * Every picture is fitted to the panel's 296x240 (DISPLAY_WIDTH/DISPLAY_HEIGHT,
 * boards/cheeko-v2/config.h) — aspect preserved, letterboxed on white — so the
 * result is a fixed 142,092 bytes, comfortably under the loader's 300 KB ceiling
 * (kMaxImageBytes, cheeko_sd_image_loader.cc).
 *
 * ffmpeg decodes, scales, pads and flattens transparency onto white; the RGB565
 * packing is done here rather than with `-pix_fmt rgb565le` because swscale
 * dithers when it drops to 16 bits, and the firmware converter truncates. Asking
 * ffmpeg for rgb24 is byte-exact, so doing the last step in JS is what makes the
 * output identical to the reference converter's.
 */

'use strict';

const { spawn } = require('child_process');

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// Panel geometry — see boards/cheeko-v2/config.h.
const PANEL_WIDTH = 296;
const PANEL_HEIGHT = 240;

// kMaxImageBytes in the firmware's SD image loader. A 296x240 RGB565 frame is
// 142,092 bytes, so this only ever fires if the geometry above changes.
const MAX_BIN_BYTES = 300 * 1024;

// ffmpeg is a subprocess per upload. Without these two bounds, ten parents
// uploading at once are ten decoders competing for the API box.
const FFMPEG_TIMEOUT_MS = Number(process.env.IMAGE_CONVERT_TIMEOUT_MS || 15000);
const MAX_CONCURRENT = Math.max(1, Number(process.env.IMAGE_CONVERT_CONCURRENCY || 2));

let active = 0;
const waiting = [];

const acquireSlot = () => new Promise((resolve) => {
  if (active < MAX_CONCURRENT) {
    active += 1;
    resolve();
    return;
  }
  waiting.push(resolve);
});

const releaseSlot = () => {
  const next = waiting.shift();
  // Hand the slot straight to the next waiter; `active` is unchanged because the
  // count of running conversions is unchanged.
  if (next) next();
  else active -= 1;
};

/** An input ffmpeg could not turn into a picture. Callers map this to a 400. */
const decodeError = (message) => {
  const error = new Error(message);
  error.decodeFailed = true;
  return error;
};

// LVGL v9 colour formats. RGB565A8 is RGB565 followed by a separate 8-bit
// alpha plane — same pixel plane, same stride, an extra w*h bytes on the end.
const LV_COLOR_FORMAT_RGB565 = 0x12;
const LV_COLOR_FORMAT_RGB565A8 = 0x14;

// Stride is the RGB565 plane's row length in both formats: the alpha plane sits
// after the pixels, and the firmware derives its offset from stride * height.
const buildHeader = (width, height, colorFormat = LV_COLOR_FORMAT_RGB565) => {
  const header = Buffer.alloc(12);
  header.writeUInt8(0x19, 0);
  header.writeUInt8(colorFormat, 1);
  header.writeUInt16LE(0, 2);
  header.writeUInt16LE(width, 4);
  header.writeUInt16LE(height, 6);
  header.writeUInt16LE(width * 2, 8);
  header.writeUInt16LE(0, 10);
  return header;
};

/**
 * Pack rgb24 to RGB565 little-endian, truncating each channel exactly as the
 * firmware's converter does: ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3).
 */
const packRgb565 = (rgb24, width, height) => {
  const pixels = Buffer.alloc(width * height * 2);
  for (let src = 0, dst = 0; dst < pixels.length; src += 3, dst += 2) {
    const color = ((rgb24[src] >> 3) << 11) | ((rgb24[src + 1] >> 2) << 5) | (rgb24[src + 2] >> 3);
    pixels.writeUInt16LE(color, dst);
  }
  return pixels;
};

/**
 * Decode one frame through ffmpeg and hand back exactly `expectedBytes` of raw
 * pixels, or reject.
 *
 * `-frames:v 1` is what makes an animated PNG a still. The two callers below
 * differ only in their filter graph and pixel format; everything here — the
 * timeout, the EPIPE handling, the short-read check — is the same either way.
 */
const decodeFrame = (buffer, { filter, pixFmt, expectedBytes }) => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG_BIN, [
    '-v', 'error',
    '-nostdin',
    '-f', 'image2pipe',
    '-i', 'pipe:0',
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', pixFmt,
    'pipe:1'
  ]);

  const stdout = [];
  const stderr = [];
  let settled = false;

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    if (settled) return;
    settled = true;
    reject(decodeError('Image conversion timed out.'));
  }, FFMPEG_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  // ffmpeg closes stdin as soon as it has rejected a malformed file, so writing
  // the body races the exit. That EPIPE is not the error worth reporting — the
  // exit code below is.
  child.stdin.on('error', () => {});
  child.stdin.end(buffer);

  child.on('error', (err) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    reject(err);
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;

    const raw = Buffer.concat(stdout);
    if (code !== 0 || raw.length !== expectedBytes) {
      const detail = Buffer.concat(stderr).toString().trim().split('\n').pop() || `exit ${code}`;
      reject(decodeError(`ffmpeg could not decode the image: ${detail}`));
      return;
    }
    resolve(raw);
  });
});

/**
 * Raw rgb24, fitted to width x height on a white ground.
 *
 * The white `color` source doubles as both the letterbox and the backdrop
 * transparency is flattened against — ffmpeg would otherwise composite an alpha
 * PNG onto black.
 */
const decodeToRgb24 = (buffer, width, height) => decodeFrame(buffer, {
  filter: [
    `color=c=white:s=${width}x${height},format=rgb24[bg]`,
    `[0:v]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2:format=rgb,format=rgb24[out]'
  ].join(';'),
  pixFmt: 'rgb24',
  expectedBytes: width * height * 3
});

/**
 * Raw rgba, fitted to width x height on a TRANSPARENT ground.
 *
 * This is the whole reason RGB565A8 exists as a separate path: a character
 * sprite is drawn over the conversation background, so flattening it onto white
 * the way decodeToRgb24 does would put a white rectangle around every face.
 *
 * The letterbox is `pad` with a fully transparent colour rather than an overlay
 * onto a coloured source, because there is no ground to composite against —
 * the padding has to stay alpha 0 all the way to the panel.
 */
const decodeToRgba = (buffer, width, height) => decodeFrame(buffer, {
  filter: [
    `[0:v]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#00000000,format=rgba[out]`
  ].join(','),
  pixFmt: 'rgba',
  expectedBytes: width * height * 4
});

/**
 * Convert a PNG or JPEG buffer into the LVGL RGB565 binary the toy renders.
 *
 * @param {Buffer} buffer - the uploaded image bytes
 * @param {{width?: number, height?: number}} [options] - override the target
 *   geometry; only tests should need this
 * @returns {Promise<Buffer>}
 */
const toLvglRgb565Bin = async (buffer, { width = PANEL_WIDTH, height = PANEL_HEIGHT } = {}) => {
  if (!buffer || buffer.length === 0) {
    throw decodeError('The image is empty.');
  }

  await acquireSlot();
  let rgb24;
  try {
    rgb24 = await decodeToRgb24(buffer, width, height);
  } finally {
    releaseSlot();
  }

  const bin = Buffer.concat([buildHeader(width, height), packRgb565(rgb24, width, height)]);

  // Post-conditions, not defensive noise: a wrong length here is a picture the
  // firmware rejects at load time, on a device with no way to tell us it did.
  if (bin.length !== 12 + width * height * 2) {
    throw new Error(`LVGL image is ${bin.length} bytes, expected ${12 + width * height * 2}`);
  }
  if (bin.length > MAX_BIN_BYTES) {
    throw new Error(`LVGL image is ${bin.length} bytes, over the device's ${MAX_BIN_BYTES} limit`);
  }

  return bin;
};

/**
 * Split rgba into the two planes RGB565A8 stores back to back: every pixel's
 * colour first, then every pixel's alpha.
 *
 * The colour channels are truncated exactly as packRgb565 does, so a fully
 * opaque RGB565A8 frame and an RGB565 one of the same picture hold identical
 * colour bytes. A fully transparent pixel keeps whatever colour it arrived
 * with — the firmware never samples it, and forcing it to black would fringe
 * the edges dark wherever the panel blends.
 */
const packRgb565A8 = (rgba, width, height) => {
  const count = width * height;
  const colors = Buffer.alloc(count * 2);
  const alpha = Buffer.alloc(count);
  for (let i = 0, src = 0; i < count; i++, src += 4) {
    const color = ((rgba[src] >> 3) << 11) | ((rgba[src + 1] >> 2) << 5) | (rgba[src + 2] >> 3);
    colors.writeUInt16LE(color, i * 2);
    alpha[i] = rgba[src + 3];
  }
  return Buffer.concat([colors, alpha]);
};

/**
 * Convert a PNG buffer into the LVGL RGB565A8 binary a character sprite is
 * stored as — RGB565 pixels plus an 8-bit alpha plane.
 *
 * Character artwork is drawn OVER the conversation background, so unlike the
 * custom-card path it cannot be flattened onto white. Anything without an alpha
 * channel still converts; it just comes out fully opaque, which is a rectangle
 * on the panel. That is a content problem, not one this function should guess
 * at — a PNG with transparency is what the four state sprites are meant to be.
 *
 * @param {Buffer} buffer - the uploaded image bytes
 * @param {{width?: number, height?: number}} [options] - override the target
 *   geometry; only tests should need this
 * @returns {Promise<Buffer>}
 */
const toLvglRgb565A8Bin = async (buffer, { width = PANEL_WIDTH, height = PANEL_HEIGHT } = {}) => {
  if (!buffer || buffer.length === 0) {
    throw decodeError('The image is empty.');
  }

  await acquireSlot();
  let rgba;
  try {
    rgba = await decodeToRgba(buffer, width, height);
  } finally {
    releaseSlot();
  }

  const bin = Buffer.concat([
    buildHeader(width, height, LV_COLOR_FORMAT_RGB565A8),
    packRgb565A8(rgba, width, height)
  ]);

  // Same post-conditions as the RGB565 path, and for the same reason: a frame
  // of the wrong length is one the device rejects silently at load time.
  const expected = 12 + width * height * 3;
  if (bin.length !== expected) {
    throw new Error(`LVGL RGB565A8 image is ${bin.length} bytes, expected ${expected}`);
  }
  if (bin.length > MAX_BIN_BYTES) {
    throw new Error(`LVGL RGB565A8 image is ${bin.length} bytes, over the device's ${MAX_BIN_BYTES} limit`);
  }

  return bin;
};

/**
 * The two lengths a device frame can arrive as, and the one it is stored as.
 *
 * The parent app packs the panel itself and uploads RAW_FRAME_BYTES of RGB565
 * with no container (lib/utils/toy_screen_image.dart). The toy's SD image loader
 * and the manager dashboard's preview both parse the 12-byte LVGL v9 header, so
 * a headerless frame renders nowhere — the header is added here rather than
 * asking every consumer to guess. Nothing about the pixels changes.
 */
const LVGL_HEADER_BYTES = 12;
const RAW_FRAME_BYTES = PANEL_WIDTH * PANEL_HEIGHT * 2;      // 142,080
const LVGL_FRAME_BYTES = LVGL_HEADER_BYTES + RAW_FRAME_BYTES; // 142,092

// A character sprite carries the extra w*h alpha plane on the end.
const LVGL_A8_FRAME_BYTES = LVGL_FRAME_BYTES + PANEL_WIDTH * PANEL_HEIGHT; // 213,132

/** True for a buffer that already carries the LVGL v9 RGB565 header. */
const isLvglFrame = (buffer) =>
  Buffer.isBuffer(buffer)
  && buffer.length === LVGL_FRAME_BYTES
  && buffer[0] === 0x19
  && buffer[1] === 0x12;

/**
 * A pre-packed panel frame as the toy stores it, or null when the buffer is not
 * one. Byte-for-byte on the pixels either way: a raw frame is wrapped, an
 * already-wrapped one is returned untouched. No decode, no resize, no re-encode
 * — see the custom-card spec's "do not convert" rule, which is about the pixel
 * data, not the container.
 */
const toDeviceFrame = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (isLvglFrame(buffer)) return buffer;
  if (buffer.length === RAW_FRAME_BYTES) {
    return Buffer.concat([buildHeader(PANEL_WIDTH, PANEL_HEIGHT), buffer]);
  }
  return null;
};

module.exports = {
  toLvglRgb565Bin,
  toLvglRgb565A8Bin,
  toDeviceFrame,
  isLvglFrame,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  MAX_BIN_BYTES,
  LVGL_HEADER_BYTES,
  RAW_FRAME_BYTES,
  LVGL_FRAME_BYTES,
  LVGL_A8_FRAME_BYTES,
  LV_COLOR_FORMAT_RGB565,
  LV_COLOR_FORMAT_RGB565A8
};
