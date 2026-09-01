/**
 * Manual integration test: custom card create + replace, including the S3 cleanup.
 *
 * Hits real S3 and the real DB — run against dev only.
 *   node scripts/test-custom-card-upload.js <kidId> <userId> <fileA> <fileB>
 *
 * Verifies, in order:
 *   1. First upload creates the child's pack and puts the object in S3
 *   2. Second upload replaces it, bumps the version and the content hash
 *   3. The FIRST object is gone from S3 — a replaced recording must not linger
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const customCardService = require('../src/services/customCard.service');
const { packCodeForKid } = require('../src/utils/helpers');
const { prisma } = require('../src/config/database');

const s3 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';

// The stored URL is <publicBase>/<key>; strip scheme + host to get the key back.
const keyFromUrl = (url) => (url ? url.split('/').slice(3).join('/') : null);

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
  const [kidId, userId, fileA, fileB] = process.argv.slice(2);
  if (!kidId || !userId || !fileA || !fileB) {
    throw new Error('usage: node scripts/test-custom-card-upload.js <kidId> <userId> <fileA> <fileB>');
  }

  console.log(`bucket=${BUCKET} region=${process.env.AWS_DEFAULT_REGION}`);
  console.log(`db=${(process.env.DATABASE_URL || '').split('@')[1] || 'unset'}\n`);

  // Start from a clean card so the cap assertions are deterministic.
  const startPack = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCodeForKid(kidId) },
  });
  if (startPack) {
    const stale = await prisma.content_item.findMany({
      where: { content_pack_id: startPack.id },
      select: { item_number: true },
      orderBy: { item_number: 'desc' },
    });
    for (const item of stale) {
      await customCardService.deleteCustomCardItem(userId, kidId, item.item_number);
    }
    console.log(`(cleared ${stale.length} pre-existing item(s))\n`);
  }

  // ── 1. Create ────────────────────────────────────────────────────────────
  console.log(`--- upload A: ${path.basename(fileA)} ---`);
  const first = await customCardService.addCustomCardContent(userId, kidId, [fakeUpload(fileA)], {
    title: path.basename(fileA),
  });
  const keyA = keyFromUrl(first.contentPack.fileUrl);
  console.log(`pack=${first.contentPack.packCode} version=${first.contentPack.version}`);

  check('A: folder is customcard_kid<id>', keyA.startsWith(`customcard_kid${kidId}/`), keyA);
  check('A: object exists in S3', await exists(keyA));
  check('A: one item', first.contentPack.totalItems === 1, `${first.contentPack.totalItems}`);
  check('A: size recorded', first.contentPack.sizeBytes === fs.statSync(fileA).size,
    `${first.contentPack.sizeBytes} vs ${fs.statSync(fileA).size}`);

  const packRow = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: first.contentPack.packCode },
  });
  const hashA = packRow.content_hash;
  check('A: content_hash set', Boolean(hashA));

  // ── 2. Append (must NOT wipe the first) ──────────────────────────────────
  console.log(`\n--- upload B (append): ${path.basename(fileB)} ---`);
  const second = await customCardService.addCustomCardContent(userId, kidId, [fakeUpload(fileB)], {
    title: path.basename(fileB),
  });
  const keyB = keyFromUrl(second.contentPack.items[1]?.fileUrl);
  console.log(`pack=${second.contentPack.packCode} version=${second.contentPack.version} items=${second.contentPack.totalItems}`);

  check('B: same pack reused (one per device)', second.contentPack.packCode === first.contentPack.packCode);
  check('B: appended, now two items', second.contentPack.totalItems === 2, `${second.contentPack.totalItems}`);
  check('B: version bumped', Number(second.contentPack.version) === Number(first.contentPack.version) + 1,
    `${first.contentPack.version} -> ${second.contentPack.version}`);
  check('B: item numbers are 1,2', second.contentPack.items.map(i => i.itemNumber).join(',') === '1,2');
  check('B: new object exists in S3', await exists(keyB));
  check('B: FIRST object still in S3 (append, not replace)', await exists(keyA), keyA);

  const packRow2 = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: second.contentPack.packCode },
  });
  check('B: content_hash changed', packRow2.content_hash !== hashA);
  check('B: total_items synced by updateContentPack', packRow2.total_items === 2, `${packRow2.total_items}`);

  // ── 3. Cap ───────────────────────────────────────────────────────────────
  console.log('\n--- cap: attempt to exceed MAX_ITEMS ---');
  const overflow = Array.from({ length: customCardService.MAX_ITEMS }, () => fakeUpload(fileA));
  let capMsg = null;
  try {
    await customCardService.addCustomCardContent(userId, kidId, overflow, {});
  } catch (err) {
    capMsg = err.message;
  }
  check('cap: over-cap upload rejected', Boolean(capMsg), capMsg || 'no error thrown');

  const afterCap = await prisma.content_item.findMany({
    where: { content_pack_id: packRow2.id },
    select: { id: true },
  });
  check('cap: rejected whole, nothing partially added', afterCap.length === 2, `${afterCap.length} items`);

  // ── 4. Delete one, and its object ────────────────────────────────────────
  console.log('\n--- delete item 1 ---');
  const afterDelete = await customCardService.deleteCustomCardItem(userId, kidId, 1);
  check('delete: one item left', afterDelete.contentPack.totalItems === 1, `${afterDelete.contentPack.totalItems}`);
  check('delete: survivor renumbered to 1', afterDelete.contentPack.items[0]?.itemNumber === 1);
  check('delete: survivor is file B', keyFromUrl(afterDelete.contentPack.items[0]?.fileUrl) === keyB);
  check('delete: removed object gone from S3', (await exists(keyA)) === false, keyA);
  check('delete: surviving object still in S3', await exists(keyB));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('ERROR:', err.message);
  try { await prisma.$disconnect(); } catch (_) { /* already down */ }
  process.exit(1);
});
