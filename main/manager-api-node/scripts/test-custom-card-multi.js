/**
 * Manual integration test: multi-file upload in one request, and removing an
 * item from the middle of a pack.
 *
 * Covers what test-custom-card-upload.js does not: that path only ever uploaded
 * one file at a time (its cap check rejects before uploading anything), and only
 * ever deleted item 1, so mid-list renumbering was untested.
 *
 *   node scripts/test-custom-card-multi.js <mac> <userId> <fileA> <fileB> <fileC>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const customCardService = require('../src/services/customCard.service');
const { packCodeForMac } = require('../src/utils/helpers');
const { prisma } = require('../src/config/database');

const s3 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';

const keyFromUrl = (url) => (url ? String(url).split('/').slice(3).join('/') : null);

const exists = async (key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
};

const fakeUpload = (filePath) => ({
  buffer: fs.readFileSync(filePath),
  originalname: path.basename(filePath),
});

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

(async () => {
  const [mac, userId, ...files] = process.argv.slice(2);
  if (!mac || !userId || files.length < 3) {
    throw new Error('usage: node scripts/test-custom-card-multi.js <mac> <userId> <fileA> <fileB> <fileC>');
  }

  // Clean slate so item numbers are deterministic.
  const startPack = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCodeForMac(mac) },
  });
  if (startPack) {
    const stale = await prisma.content_item.findMany({
      where: { content_pack_id: startPack.id },
      select: { item_number: true },
      orderBy: { item_number: 'desc' },
    });
    for (const item of stale) {
      await customCardService.deleteCustomCardItem(userId, mac, item.item_number);
    }
    console.log(`(cleared ${stale.length} pre-existing item(s))\n`);
  }

  // ── 1. All three files in ONE request ────────────────────────────────────
  console.log(`--- multi-upload: ${files.map((f) => path.basename(f)).join(', ')} ---`);
  const packed = await customCardService.addCustomCardContent(userId, mac, files.map(fakeUpload), {});
  const items = packed.contentPack.items;
  const keys = items.map((i) => keyFromUrl(i.fileUrl));

  check('multi: three items created', packed.contentPack.totalItems === 3, `${packed.contentPack.totalItems}`);
  check('multi: numbered 1,2,3', items.map((i) => i.itemNumber).join(',') === '1,2,3',
    items.map((i) => i.itemNumber).join(','));
  check('multi: order matches upload order',
    items.map((i) => i.title).join('|') === files.map((f) => path.basename(f)).join('|'),
    items.map((i) => i.title).join('|'));

  for (const [index, key] of keys.entries()) {
    check(`multi: object ${index + 1} in S3`, await exists(key));
  }
  check('multi: all keys distinct', new Set(keys).size === 3);

  const packRow = await prisma.rfid_content_pack.findFirst({ where: { pack_code: packed.contentPack.packCode } });
  check('multi: total_items synced', packRow.total_items === 3, `${packRow.total_items}`);
  const hashBefore = packRow.content_hash;

  // ── 2. Replace the MIDDLE item in place ──────────────────────────────────
  console.log(`\n--- replace item 2 in place with ${path.basename(files[2])} ---`);
  const swapped = await customCardService.replaceCustomCardItem(userId, mac, 2, fakeUpload(files[2]), {});
  const swappedItems = swapped.contentPack.items;
  const newKey2 = keyFromUrl(swappedItems[1].fileUrl);

  check('replace: still three items', swapped.contentPack.totalItems === 3, `${swapped.contentPack.totalItems}`);
  check('replace: numbering unchanged 1,2,3', swappedItems.map((i) => i.itemNumber).join(',') === '1,2,3');
  check('replace: item 2 is the new file', swappedItems[1].title === path.basename(files[2]), swappedItems[1].title);
  check('replace: item 2 points at a NEW object', newKey2 !== keys[1], newKey2);
  check('replace: new object in S3', await exists(newKey2));
  check('replace: OLD item-2 object deleted', (await exists(keys[1])) === false, keys[1]);
  check('replace: neighbours untouched',
    keyFromUrl(swappedItems[0].fileUrl) === keys[0] && keyFromUrl(swappedItems[2].fileUrl) === keys[2]);

  // Re-point the tracked keys: item 2's object has changed.
  keys[1] = newKey2;

  // ── 3. Delete the MIDDLE item ────────────────────────────────────────────
  console.log('\n--- delete middle item (2) ---');
  const after = await customCardService.deleteCustomCardItem(userId, mac, 2);
  const afterItems = after.contentPack.items;

  check('middle: two items left', after.contentPack.totalItems === 2, `${after.contentPack.totalItems}`);
  check('middle: renumbered 1,2 with no gap', afterItems.map((i) => i.itemNumber).join(',') === '1,2',
    afterItems.map((i) => i.itemNumber).join(','));
  check('middle: survivors are file 1 and file 3, in order',
    afterItems.map((i) => i.title).join('|') === `${path.basename(files[0])}|${path.basename(files[2])}`,
    afterItems.map((i) => i.title).join('|'));
  check('middle: version bumped past the replace', Number(after.contentPack.version) > Number(swapped.contentPack.version),
    `${swapped.contentPack.version} -> ${after.contentPack.version}`);
  check('middle: survivors keep their original objects',
    keyFromUrl(afterItems[0].fileUrl) === keys[0] && keyFromUrl(afterItems[1].fileUrl) === keys[2]);

  check('middle: removed object gone from S3', (await exists(keys[1])) === false, keys[1]);
  check('middle: first object still in S3', await exists(keys[0]));
  check('middle: third object still in S3', await exists(keys[2]));

  const packRow2 = await prisma.rfid_content_pack.findFirst({ where: { pack_code: packed.contentPack.packCode } });
  check('middle: total_items synced', packRow2.total_items === 2, `${packRow2.total_items}`);
  check('middle: content_hash changed', packRow2.content_hash !== hashBefore);
  check('middle: version bumped', Number(packRow2.version) > Number(packed.contentPack.version),
    `${packed.contentPack.version} -> ${packRow2.version}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('ERROR:', err.message);
  try { await prisma.$disconnect(); } catch (_) { /* already down */ }
  process.exit(1);
});
