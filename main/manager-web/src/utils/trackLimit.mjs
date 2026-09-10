// A content pack's track limit: the flat list holds at most MAX_TRACKS, and in
// grouped mode each story does.
// Pure + dependency-free so it can be checked with: node src/utils/trackLimit.mjs

export const MAX_TRACKS = 11;

/**
 * How many tracks a folder may add to a list that already holds `current`.
 * A replace clears the list first, so the whole limit is free.
 */
export const roomFor = (current, { replacing = false } = {}) =>
  Math.max(0, MAX_TRACKS - (replacing ? 0 : current));

// ---- self-check: node src/utils/trackLimit.mjs ----
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('trackLimit.mjs')) {
  const eq = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
  };

  eq(MAX_TRACKS, 11, 'limit is 11');
  eq(roomFor(0), 11, 'empty list takes 11');
  eq(roomFor(8), 3, '8 tracks leave room for 3');
  eq(roomFor(9), 2, '9 tracks leave room for 2');
  eq(roomFor(11), 0, 'full list takes none');
  eq(roomFor(13), 0, 'an over-full legacy list takes none, never a negative');
  eq(roomFor(8, { replacing: true }), 11, 'a replace frees the whole limit');
  eq(roomFor(11, { replacing: true }), 11, 'a replace of a full list still takes 11');

  // The folder is refused whole when it has more tracks than roomFor allows.
  const accepts = (current, folder, opts) => folder <= roomFor(current, opts);
  eq(accepts(9, 2), true, '9 + 2 = 11 is accepted');
  eq(accepts(9, 3), false, '9 + 3 = 12 is refused');
  eq(accepts(8, 5), false, '8 + 5 is refused');
  eq(accepts(11, 1), false, 'nothing fits a full list');
  eq(accepts(5, 11, { replacing: true }), true, 'replace with 11 is accepted');
  eq(accepts(5, 12, { replacing: true }), false, 'replace with 12 is refused');

  console.log('trackLimit: all checks passed');
}
