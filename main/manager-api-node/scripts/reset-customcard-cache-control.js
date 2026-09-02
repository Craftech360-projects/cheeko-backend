#!/usr/bin/env node
/**
 * Reset Cache-Control on every custom-card object already in the bucket.
 *
 * Objects uploaded before keys were reused went out with max-age=31536000. Now
 * that an edit overwrites the object at its existing key, a client holding one
 * of those keeps the old picture or recording for up to a year — a CloudFront
 * invalidation clears the edge, not the app's cache. New uploads carry
 * `no-cache` (CUSTOM_CARD_CACHE_CONTROL, upload.service.js); this brings the
 * existing objects in line, once, by copying each over itself with fresh
 * headers. Bytes and ETag are unchanged.
 *
 * A client that fetched before this runs still holds its copy until that
 * expires or the app's cache is cleared; everyone who fetches afterwards gets
 * the revalidating headers. With CLOUDFRONT_DISTRIBUTION_ID set, `/customcard*`
 * is invalidated at the end so the edge stops handing out the old headers too.
 *
 * Run:  node scripts/reset-customcard-cache-control.js [--dry-run]
 * Env:  S3_BUCKET_NAME, AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID,
 *       AWS_SECRET_ACCESS_KEY, and optionally CLOUDFRONT_DISTRIBUTION_ID
 */

'use strict';

require('dotenv').config();

const { randomUUID } = require('crypto');
const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';
const REGION = process.env.AWS_DEFAULT_REGION || 'eu-north-1';
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || '';
// CUSTOM_CARD_CACHE_CONTROL in upload.service.js.
const CACHE_CONTROL = 'no-cache';
// Both layouts: customcard_<mac>/ from before packs moved to the child, and
// customcard_kid<id>/ since.
const PREFIX = 'customcard';

async function* listKeys(client) {
  let ContinuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken }));
    for (const object of page.Contents || []) yield object.Key;
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = new S3Client({ region: REGION });
  let seen = 0;
  let reset = 0;

  console.log(`Bucket: ${BUCKET} (${REGION}), prefix ${PREFIX}`);

  for await (const key of listKeys(client)) {
    seen += 1;
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (head.CacheControl === CACHE_CONTROL) continue;

    reset += 1;
    console.log(`${dryRun ? 'would reset' : 'reset'} ${key}  (${head.CacheControl || 'no Cache-Control'} -> ${CACHE_CONTROL})`);
    if (dryRun) continue;

    // REPLACE drops every header not restated, so the content type rides along.
    await client.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: key,
      CopySource: `${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`,
      MetadataDirective: 'REPLACE',
      ContentType: head.ContentType,
      CacheControl: CACHE_CONTROL
    }));
  }

  console.log(`\n${seen} object(s) under ${PREFIX}, ${reset} ${dryRun ? 'to reset' : 'reset'}.`);
  if (dryRun || reset === 0) return;

  if (!DISTRIBUTION_ID) {
    console.log(`CLOUDFRONT_DISTRIBUTION_ID is unset: invalidate /${PREFIX}* by hand so the edge drops the old headers.`);
    return;
  }
  const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
  await new CloudFrontClient({ region: REGION }).send(new CreateInvalidationCommand({
    DistributionId: DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: randomUUID(),
      Paths: { Quantity: 1, Items: [`/${PREFIX}*`] }
    }
  }));
  console.log(`CloudFront invalidation requested for /${PREFIX}*.`);
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
