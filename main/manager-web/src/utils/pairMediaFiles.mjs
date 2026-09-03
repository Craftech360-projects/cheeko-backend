// Pairs the audio + image files of a picked folder into content pack items.
// Pure + dependency-free so it can be checked with: node src/utils/pairMediaFiles.mjs

const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a'];
const IMAGE_EXT = ['bin', 'png', 'jpg', 'jpeg', 'gif', 'webp'];

export const fileName = (path) => String(path).split(/[\\/]/).pop();

const extOf = (path) => {
  const file = fileName(path);
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
};

const baseOf = (path) => {
  const file = fileName(path);
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
};

const naturalSort = (a, b) =>
  baseOf(a).localeCompare(baseOf(b), undefined, { numeric: true, sensitivity: 'base' });

export const titleFromName = (path) =>
  baseOf(path)
    .replace(/^\d+\s*[-_.)]\s*/, '') // "01-lion" -> "lion"
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @param {string[]} paths file names or webkitRelativePaths
 * @returns {{audio: string, image: string|null, title: string}[]} in play order
 */
export function pairMediaFiles(paths) {
  const audios = paths.filter((p) => AUDIO_EXT.includes(extOf(p))).sort(naturalSort);
  const images = paths.filter((p) => IMAGE_EXT.includes(extOf(p))).sort(naturalSort);

  const imageByBase = new Map();
  for (const img of images) {
    const key = baseOf(img).toLowerCase();
    if (!imageByBase.has(key)) imageByBase.set(key, img);
  }

  const matches = audios.filter((a) => imageByBase.has(baseOf(a).toLowerCase()));

  // ponytail: no basename overlap but equal counts means the folder pairs by
  // order instead (e.g. separate audio/ and images/ subfolders, different
  // naming). Anything smarter needs a real convention to key off.
  if (matches.length === 0 && audios.length > 0 && audios.length === images.length) {
    return audios.map((audio, i) => ({ audio, image: images[i], title: titleFromName(audio) }));
  }

  return audios.map((audio) => ({
    audio,
    image: imageByBase.get(baseOf(audio).toLowerCase()) || null,
    title: titleFromName(audio),
  }));
}

// ---- self-check: node src/utils/pairMediaFiles.mjs ----
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('pairMediaFiles.mjs')) {
  // Local assert instead of node:assert — webpack resolves `node:` imports even
  // in this dead branch and fails the build.
  const eq = (actual, expected, label) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${label}\n  expected ${b}\n  actual   ${a}`);
  };

  // exact basename match, natural order, non-media ignored
  eq(
    pairMediaFiles(['pack/10-zebra.bin', 'pack/2-lion.mp3', 'pack/10-zebra.mp3', 'pack/2-lion.bin', 'pack/notes.txt']),
    [
      { audio: 'pack/2-lion.mp3', image: 'pack/2-lion.bin', title: 'lion' },
      { audio: 'pack/10-zebra.mp3', image: 'pack/10-zebra.bin', title: 'zebra' },
    ],
    'exact basename match'
  );

  // index fallback: no shared basenames, equal counts
  eq(
    pairMediaFiles(['p/audio/a1.mp3', 'p/audio/a2.mp3', 'p/img/i1.bin', 'p/img/i2.bin']),
    [
      { audio: 'p/audio/a1.mp3', image: 'p/img/i1.bin', title: 'a1' },
      { audio: 'p/audio/a2.mp3', image: 'p/img/i2.bin', title: 'a2' },
    ],
    'index fallback'
  );

  // unequal counts with no match -> audio kept, image left null (no bogus pairing)
  eq(pairMediaFiles(['a.mp3', 'b.mp3', 'z.png']), [
    { audio: 'a.mp3', image: null, title: 'a' },
    { audio: 'b.mp3', image: null, title: 'b' },
  ], 'no bogus pairing on unequal counts');

  // partial match: matched pairs win, unmatched audio still becomes an item
  eq(pairMediaFiles(['a.mp3', 'a.png', 'b.mp3']), [
    { audio: 'a.mp3', image: 'a.png', title: 'a' },
    { audio: 'b.mp3', image: null, title: 'b' },
  ], 'partial match');

  // no audio -> nothing to import
  eq(pairMediaFiles(['x.png', 'y.bin']), [], 'no audio');

  eq(titleFromName('03_the_lion_king.mp3'), 'the lion king', 'title cleanup');

  console.log('pairMediaFiles: all checks passed');
}
