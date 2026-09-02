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

const buildHeader = (width, height) => {
  const header = Buffer.alloc(12);
  header.writeUInt8(0x19, 0);
  header.writeUInt8(0x12, 1);
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
 * Decode one frame to raw rgb24, fitted to width x height on a white ground.
 *
 * `-frames:v 1` is what makes an animated PNG a still. The white `color` source
 * doubles as both the letterbox and the backdrop transparency is flattened
 * against — ffmpeg would otherwise composite an alpha PNG onto black.
 */
const decodeToRgb24 = (buffer, width, height) => new Promise((resolve, reject) => {
  const filter = [
    `color=c=white:s=${width}x${height},format=rgb24[bg]`,
    `[0:v]format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    '[bg][fg]overlay=(W-w)/2:(H-h)/2:format=rgb,format=rgb24[out]'
  ].join(';');

  const child = spawn(FFMPEG_BIN, [
    '-v', 'error',
    '-nostdin',
    '-f', 'image2pipe',
    '-i', 'pipe:0',
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
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
    const expected = width * height * 3;
    if (code !== 0 || raw.length !== expected) {
      const detail = Buffer.concat(stderr).toString().trim().split('\n').pop() || `exit ${code}`;
      reject(decodeError(`ffmpeg could not decode the image: ${detail}`));
      return;
    }
    resolve(raw);
  });
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
  toDeviceFrame,
  isLvglFrame,
  PANEL_WIDTH,
  PANEL_HEIGHT,
  MAX_BIN_BYTES,
  LVGL_HEADER_BYTES,
  RAW_FRAME_BYTES,
  LVGL_FRAME_BYTES
};
