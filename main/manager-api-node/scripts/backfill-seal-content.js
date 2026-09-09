#!/usr/bin/env node
'use strict';
/**
 * Re-seal existing pack files (spec §9 step 4).
 *
 * For every content_item audio/image URL that is still plaintext: download,
 * seal under the pack key, upload under a NEW uuid-suffixed key (the old one is
 * cached at the edge for a year), point the row at the new URL. Old objects
 * are left in place for a rollback window; delete them by hand later.
 *
 *   node scripts/backfill-seal-content.js --dry-run
 *   node scripts/backfill-seal-content.js --pack STORY01
 *
 * Nothing here requires Prisma, AWS or contentKeys at module load time — those
 * are all pulled in lazily inside main(), so `require`-ing this file (as the
 * test does, to reach resealItem) never opens a DB connection or touches S3.
 */
const path = require('path');
const { seal, parseHeader } = require('../src/utils/contentCrypto');

// uploadContentFile derives Content-Type from a caller-supplied mimeType; the
// brief's sketch only recognised .mp3 and fell back to octet-stream for
// everything else, which would have shipped resealed images as
// application/octet-stream instead of image/*. Cover the extensions this
// table actually sees (RFID pack audio + item images).
const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
function mimeTypeFor(filename) {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

// uploadContentFile keys every object as rfidcontent/<category>/<filename>,
// where <category> is whatever folder the ORIGINAL upload used — "audio",
// "images", a language name, anything an admin route passed. The brief's
// sketch guessed the category from a `url.includes('/images/')` check, which
// silently mis-files any item whose original category wasn't literally
// "images" (e.g. an item uploaded under a language folder). Read the real
// folder back out of the existing URL instead of guessing one.
function categoryFromUrl(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  const i = segments.indexOf('rfidcontent');
  if (i === -1 || i + 2 >= segments.length) return null;
  return segments.slice(i + 1, -1).join('/');
}

// uploadContentFile suffixes every filename with "-<8 hex chars>" (Task 3) so
// a re-upload mints a fresh URL/key. Strip that suffix so a reseal doesn't
// chain a second suffix onto an already-suffixed name; a filename that never
// had one (the normal case — this is usually the file's first reseal) passes
// through unchanged because the regex simply won't match it.
function stripUuidSuffix(filename) {
  return filename.replace(/-[0-9a-f]{8}(\.[a-z0-9]+)$/i, '$1');
}

async function resealOne(url, packCode, d) {
  if (!url) return 'skipped';
  const bytes = await d.fetchBytes(url);
  if (parseHeader(bytes)) return 'already';

  if (d.dryRun) {
    // Read-only lookup. contentKeys.getOrCreatePackKey is a get-OR-CREATE: for
    // a pack with no content_key yet it generates one and persists it via
    // prisma.rfid_content_pack.updateMany BEFORE any dryRun check could run —
    // so calling it here would make `--dry-run` provision real encryption keys
    // in the live table. getPackKey only reads, so a dry run can report
    // accurately without side effects.
    const key = await d.getPackKey(packCode);
    return key ? 'would-seal' : 'nokey';
  }

  const key = await d.getOrCreatePackKey(packCode);
  if (!key) return 'nokey';

  const category = categoryFromUrl(url) || (url.includes('/images/') ? 'images' : 'audio');
  const name = decodeURIComponent(stripUuidSuffix(path.basename(new URL(url).pathname)));

  // seal() happens exactly once, right here, on the bytes we just downloaded.
  // d.upload's signature below is (buf, name, category) — it has no sealKey
  // parameter for anyone to pass, so there is no path through this file that
  // could hand an already-sealed buffer to uploadContentFile's own sealKey
  // option and double-seal it. Do not add one.
  const up = await d.upload(seal(bytes, key), name, category);
  return up.url;
}

async function resealItem(item, d) {
  const patch = {};
  const status = {};

  for (const [field, url] of [['audio', item.audio_url], ['image', item.image_url]]) {
    try {
      const r = await resealOne(url, item.pack_code, d);
      if (r.startsWith('http')) {
        patch[`${field}_url`] = r;
        status[field] = 'sealed';
      } else {
        status[field] = r;
      }
    } catch (err) {
      // A failure on one field (e.g. the image upload) must not swallow a
      // field that already succeeded (e.g. the audio was already sealed and
      // uploaded) — that upload still lands in patch below and gets a row
      // reference, so it isn't orphaned just because its sibling field failed.
      status[field] = 'error';
      console.error(`item ${item.id} ${field}: reseal failed - ${err.message}`);
    }
  }

  if (Object.keys(patch).length && !d.dryRun) {
    try {
      await d.updateItem(item.id, patch);
    } catch (err) {
      // The sealed object(s) in `patch` already landed in S3, but the row
      // update that would reference them just failed — they're orphaned in
      // the bucket until an operator finds them from this log line.
      for (const url of Object.values(patch)) {
        console.error(`ORPHANED sealed object (item ${item.id} row update failed): ${url}`);
      }
      throw err;
    }
  }
  return status;
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const packIndex = argv.indexOf('--pack');
  const pack = packIndex !== -1 ? argv[packIndex + 1] || null : null;
  return { dryRun, pack };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

  const contentKeys = require('../src/services/contentKeys.service');
  if (!contentKeys.isEnabled()) throw new Error('CONTENT_MASTER_KEY is not set');

  const { prisma } = require('../src/config/database');
  const uploadService = require('../src/services/upload.service');

  const { dryRun, pack } = parseArgs(process.argv.slice(2));

  // Prisma Client API, not raw SQL — `pack` never touches a query string, so
  // there is nothing here for a hand-typed --pack value to inject into.
  const rows = await prisma.content_item.findMany({
    where: {
      OR: [{ audio_url: { not: null } }, { image_url: { not: null } }],
      ...(pack ? { rfid_content_pack: { pack_code: pack } } : {})
    },
    select: {
      id: true,
      audio_url: true,
      image_url: true,
      rfid_content_pack: { select: { pack_code: true } }
    },
    orderBy: { id: 'asc' }
  });

  const d = {
    dryRun,
    fetchBytes: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    getPackKey: contentKeys.getPackKey,
    getOrCreatePackKey: contentKeys.getOrCreatePackKey,
    // Intentionally 3 params, no sealKey slot — see the comment in resealOne.
    upload: (buf, name, category) =>
      uploadService.uploadContentFile(buf, name, 'rfidcontent', category, mimeTypeFor(name)),
    updateItem: (id, patch) => prisma.content_item.update({ where: { id }, data: patch })
  };

  const tally = {};
  for (const row of rows) {
    const item = {
      id: row.id,
      audio_url: row.audio_url,
      image_url: row.image_url,
      pack_code: row.rfid_content_pack?.pack_code || null
    };
    // One bad row must not abort the whole run — record it as failed and
    // keep going, so the tally below still reflects every row that made it
    // through, and still gets printed even when some rows failed.
    try {
      const r = await resealItem(item, d);
      for (const v of Object.values(r)) tally[v] = (tally[v] || 0) + 1;
      console.log(`${item.pack_code || '(no pack)'} item ${item.id}: audio=${r.audio} image=${r.image}`);
    } catch (err) {
      tally.failed = (tally.failed || 0) + 1;
      console.error(`${item.pack_code || '(no pack)'} item ${item.id}: FAILED - ${err.message}`);
    }
  }
  console.log(tally);
  await prisma.$disconnect();
}

module.exports = { resealItem, resealOne, categoryFromUrl, stripUuidSuffix, mimeTypeFor, parseArgs };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
