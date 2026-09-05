/**
 * Regenerates the favicon set from a source mark.
 *
 *   node scripts/make-favicons.js [source]   default: public/icon_foreground.png
 *
 * The source may be any square-ish image. `CROP` below takes the lower portion
 * of the canvas — the fox head — because the wordmark half is illegible at
 * 16px. Set CROP to null to use the whole image.
 *
 * Rendering goes through chrome-headless-shell (already used by
 * docs/design/render.js), so there is no image library to install.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.resolve(ROOT, process.argv[2] || 'public/icon_foreground.png');
const OUT = path.join(ROOT, 'public');
const WORK = path.join(ROOT, '.work');

// Region of the source to show, as fractions (0–1) of its width/height.
//
// Measured from icon_foreground.png (1254px square) by scanning for non-cream
// pixels: the wordmark occupies y 329–536, the fox y 608–983, and the two
// together span x 322–930. Cropping to exactly that ink box is 608×654 — near
// enough to square that both land edge-to-edge with no dead band above the
// wordmark or below the fox's chin.
const CROP = {
  x: 322 / 1254,
  y: 329 / 1254,
  w: (930 - 322) / 1254,
  h: (983 - 329) / 1254
};

// Where the fitted region sits when its aspect leaves slack in one axis.
const ANCHOR = 'bottom';   // 'bottom' | 'center'

// pad 0 throughout: the crop is already tight to the artwork, so any padding
// reintroduces the white gap this is meant to remove.
const SIZES = [
  { file: 'favicon-16x16.png', px: 16, pad: 0 },
  { file: 'favicon-32x32.png', px: 32, pad: 0 },
  { file: 'favicon-48x48.png', px: 48, pad: 0 },
  { file: 'apple-touch-icon.png', px: 180, pad: 0 }
];

function findShell() {
  if (process.env.CHROME_SHELL) return process.env.CHROME_SHELL;
  const roots = [
    path.join(ROOT, 'docs', 'design', 'browsers'),
    path.join(process.env.HOME || '', '.cache', 'puppeteer')
  ];
  for (const root of roots) {
    const base = path.join(root, 'chrome-headless-shell');
    if (!fs.existsSync(base)) continue;
    for (const rev of fs.readdirSync(base)) {
      const hit = fs.readdirSync(path.join(base, rev))
        .map(d => path.join(base, rev, d, 'chrome-headless-shell'))
        .find(fs.existsSync);
      if (hit) return hit;
    }
  }
  throw new Error('chrome-headless-shell not found — npx @puppeteer/browsers install chrome-headless-shell@stable');
}

if (!fs.existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  process.exit(1);
}

fs.mkdirSync(WORK, { recursive: true });
const b64 = fs.readFileSync(SOURCE).toString('base64');
const shell = findShell();

for (const { file, px, pad } of SIZES) {
  const box = px - pad * 2;                       // drawable area inside the frame
  const c = CROP || { x: 0, y: 0, w: 1, h: 1 };

  // Fit the region into the box, preserving its aspect, then centre it.
  const regionAspect = c.w / c.h;
  const drawW = regionAspect >= 1 ? box : box * regionAspect;
  const drawH = regionAspect >= 1 ? box / regionAspect : box;
  const imgW = drawW / c.w;                       // full source at this scale
  const imgH = imgW;                              // source is square

  // The clip window is the region itself. Clipping only to the frame would let
  // whatever sits above the region (here, the wordmark) bleed into the
  // letterboxed band.
  const clipLeft = pad + (box - drawW) / 2;
  const clipTop = ANCHOR === 'bottom'
    ? px - pad - drawH
    : pad + (box - drawH) / 2;

  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${px}px;height:${px}px;overflow:hidden}
    .frame{width:${px}px;height:${px}px;border-radius:${Math.max(2, Math.round(px / 6))}px;
      background:#FAF9F7;overflow:hidden;position:relative}
    .clip{position:absolute;left:${clipLeft}px;top:${clipTop}px;
      width:${drawW}px;height:${drawH}px;overflow:hidden}
    img{position:absolute;left:${-c.x * imgW}px;top:${-c.y * imgH}px;
      width:${imgW}px;height:${imgH}px}
  </style><div class="frame"><div class="clip">
    <img src="data:image/png;base64,${b64}"></div></div>`;

  const page = path.join(WORK, `icon-${px}.html`);
  fs.writeFileSync(page, html);

  execFileSync(shell, [
    '--single-process', '--no-zygote', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${px},${px}`, '--timeout=5000',
    `--screenshot=${path.join(OUT, file)}`, 'file://' + page
  ], { stdio: 'ignore', env: { ...process.env, MAC_CHROMIUM_TMPDIR: WORK } });

  console.log(`${file}  ${px}x${px}`);
}

console.log('\nDone. Rebuild to pick them up:  npx vue-cli-service build');
