/**
 * Reader for the LVGL v9 RGB565 `.bin` frames the toy's screen draws.
 *
 * Most content items store their artwork as one of these rather than a PNG,
 * because the firmware has no JPEG decoder and PNG would cost decode RAM — see
 * manager-api-node/src/utils/lvglImage.js, which writes the same layout:
 *
 *   0  u8   0x19   magic, LVGL v9
 *   1  u8   0x12   LV_COLOR_FORMAT_RGB565
 *   2  u16  flags
 *   4  u16  width
 *   6  u16  height
 *   8  u16  stride (bytes per row)
 *   10 u16  reserved
 *
 * A browser cannot put one in an <img>, so anything that wants to show device
 * artwork decodes it to a canvas through here.
 */

export const LVGL_MAGIC = 0x19;
export const LVGL_RGB565 = 0x12;
export const LVGL_HEADER_BYTES = 12;

/** True for a URL that points at a device frame rather than a web image. */
export function isBinUrl(url) {
  return typeof url === 'string' && /\.bin(\?|#|$)/i.test(url);
}

/**
 * Decode an LVGL v9 RGB565 buffer to ImageData.
 * Throws when the header is not one we can read, so callers can fall back.
 */
export function decodeLvglBin(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < LVGL_HEADER_BYTES) {
    throw new Error('Buffer is too short to be an LVGL frame');
  }

  const view = new DataView(arrayBuffer);
  const magic = view.getUint8(0);
  const colorFormat = view.getUint8(1);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  const stride = view.getUint16(8, true) || width * 2;

  if (magic !== LVGL_MAGIC) throw new Error(`Not an LVGL frame (magic 0x${magic.toString(16)})`);
  if (colorFormat !== LVGL_RGB565) throw new Error(`Unsupported colour format 0x${colorFormat.toString(16)}`);
  if (!width || !height) throw new Error('LVGL frame has no dimensions');

  const needed = LVGL_HEADER_BYTES + stride * height;
  if (arrayBuffer.byteLength < needed) {
    throw new Error(`LVGL frame is truncated: ${arrayBuffer.byteLength} of ${needed} bytes`);
  }

  const imageData = new ImageData(width, height);
  const pixels = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = LVGL_HEADER_BYTES + (y * stride) + (x * 2);
      const dst = (y * width + x) * 4;
      const rgb565 = view.getUint16(src, true);

      const r = ((rgb565 >> 11) & 0x1f) << 3;
      const g = ((rgb565 >> 5) & 0x3f) << 2;
      const b = (rgb565 & 0x1f) << 3;

      // Replicate the high bits into the low ones so 0x1f maps to 255 rather
      // than 248 — without it every white comes out faintly grey.
      pixels[dst] = r | (r >> 5);
      pixels[dst + 1] = g | (g >> 6);
      pixels[dst + 2] = b | (b >> 5);
      pixels[dst + 3] = 255;
    }
  }

  return { imageData, width, height };
}

/** Decoded frame as a PNG data URL, ready for an <img src>. */
export function lvglBinToDataUrl(arrayBuffer) {
  const { imageData, width, height } = decodeLvglBin(arrayBuffer);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// One fetch per URL per session: the same frame appears in a lookup result, a
// pack editor and a card preview, and each one is ~142 KB over the wire.
const cache = new Map();

/**
 * The CDN serves these without an Access-Control-Allow-Origin header, so a
 * direct fetch is blocked. The API's proxy re-serves them same-origin — the
 * same route the pack editor's preview uses.
 */
function proxied(url) {
  return `/toy/content/proxy?url=${encodeURIComponent(url)}`;
}

function authHeaders() {
  const stored = localStorage.getItem('token');
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored);
    return parsed && parsed.token ? { Authorization: `Bearer ${parsed.token}` } : {};
  } catch (e) {
    return {};
  }
}

/**
 * Fetch a `.bin` and return a PNG data URL for it.
 * Resolves to null when the URL cannot be fetched or decoded, so a caller can
 * show a placeholder without a try/catch at every call site.
 */
export function loadLvglBinAsDataUrl(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);

  const pending = fetch(proxied(url), { headers: authHeaders() })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => lvglBinToDataUrl(buffer))
    .catch(error => {
      // Cache the failure too — a CORS-blocked host fails identically every
      // time, and retrying on each render would hammer it.
      console.warn(`[lvgl] could not render ${url}:`, error.message);
      return null;
    });

  cache.set(url, pending);
  return pending;
}
