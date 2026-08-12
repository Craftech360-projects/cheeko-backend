/**
 * Backfill imagine_image from the S3 bucket.
 *
 * Imagine images have never had a database row — the gallery was a raw
 * ListObjectsV2 on imagine/<mac>/. This walks every existing object and records
 * whose it is, so the feed can be served from the table instead.
 *
 * Attribution is the device's CURRENT child. For a toy that has served two
 * children in turn that merges their galleries, but the prefix listing merged
 * them already, so this is not a regression — and a survey on 2026-08-12 found
 * no device on either database has changed hands yet.
 *
 * S3 LastModified becomes created_at, so the ordering a parent already sees does
 * not change. Idempotent: s3_key is unique and conflicts are skipped, so it can
 * be re-run after new uploads without duplicating anything.
 *
 * Usage: DATABASE_URL=... AWS_...=... node scripts/backfill-imagine-images.js [--apply]
 * Without --apply it reports what it would insert and writes nothing.
 */
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;

const prisma = new PrismaClient();
const s3 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'eu-north-1',
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// imagine/<mac-with-dashes>/<uuid>.jpg. Objects directly under imagine/ predate
// device bucketing and cannot be attributed to anyone.
const KEY_RE = /^imagine\/([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\/[^/]+$/;

const ownerKeyFor = (device, dashedMac) =>
  (device && device.kid_id ? `kid:${device.kid_id}` : `mac:${dashedMac.replace(/-/g, ':')}`);

(async () => {
  const devices = await prisma.ai_device.findMany({ select: { mac_address: true, kid_id: true } });
  const byDashedMac = new Map(
    devices.map((d) => [d.mac_address.toLowerCase().replace(/:/g, '-'), d]),
  );

  let scanned = 0;
  let unattributable = 0;
  const rows = [];
  let token;

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: 'imagine/',
      ContinuationToken: token,
    }));
    for (const obj of page.Contents || []) {
      scanned++;
      const match = KEY_RE.exec(obj.Key);
      if (!match) { unattributable++; continue; }
      const dashedMac = match[1];
      rows.push({
        owner_key: ownerKeyFor(byDashedMac.get(dashedMac), dashedMac),
        mac_address: dashedMac.replace(/-/g, ':').toUpperCase(),
        s3_key: obj.Key,
        size_bytes: obj.Size ? BigInt(obj.Size) : null,
        created_at: obj.LastModified || new Date(),
      });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const attributed = rows.filter((r) => r.owner_key.startsWith('kid:')).length;
  console.log(`Scanned ${scanned} objects`);
  console.log(`  ${rows.length} recordable (${attributed} to a child, ${rows.length - attributed} to a device)`);
  console.log(`  ${unattributable} skipped - not under a device prefix, so nobody owns them`);

  if (!APPLY) {
    console.log('\nDry run - nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await prisma.imagine_image.createMany({
      data: rows.slice(i, i + 500),
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  console.log(`\nInserted ${inserted} rows (${rows.length - inserted} already present).`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await prisma.$disconnect();
  process.exitCode = 1;
});
