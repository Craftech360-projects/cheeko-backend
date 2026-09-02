#!/usr/bin/env node
/**
 * Put the bucket CORS rule custom-card assets need.
 *
 * Custom-card pictures and recordings are read with `fetch`/XHR rather than an
 * `<img>` or `<audio>` tag — the manager dashboard decodes the RGB565 frame onto
 * a canvas, and the parent app does the same. `fetch` is CORS-gated in a way a
 * tag was not, so without this rule the picture simply disappears in the browser
 * while working fine on the phone.
 *
 * `ExposeHeaders` is the half that is easy to forget. Without it the browser can
 * read neither `ETag` nor `Content-Length`, so the conditional fetch that makes
 * an overwritten object cheap to revalidate degrades silently into a full
 * 142 KB download on every card view.
 *
 * Two things this script cannot do, both distribution settings rather than
 * bucket ones. Do them once, by hand, or CORS still will not work through the
 * CDN:
 *
 *   1. The CloudFront cache policy must forward `Origin`, `Access-Control-*`
 *      request headers, and include `Origin` in the cache key. An origin
 *      request policy of `CORS-S3Origin` plus a response headers policy is the
 *      usual pairing.
 *   2. `ETag` and `Content-Length` must survive to the client, which they do
 *      once the response headers policy is not stripping them.
 *
 * Run:  node scripts/set-customcard-cors.js [--dry-run]
 * Env:  S3_BUCKET_NAME, AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID,
 *       AWS_SECRET_ACCESS_KEY, and optionally CUSTOM_CARD_CORS_ORIGINS as a
 *       comma-separated allowlist (defaults to *, which is safe here: the
 *       objects are already public and unauthenticated).
 */

'use strict';

require('dotenv').config();

const {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';
const REGION = process.env.AWS_DEFAULT_REGION || 'eu-north-1';
const ORIGINS = (process.env.CUSTOM_CARD_CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const RULE = {
  ID: 'custom-card-assets',
  AllowedOrigins: ORIGINS,
  AllowedMethods: ['GET', 'HEAD'],
  // The conditional request the no-cache + ETag pair depends on.
  AllowedHeaders: ['Range', 'If-None-Match', 'If-Modified-Since'],
  // Without these two the browser cannot read the headers it needs to
  // revalidate, and every card view re-downloads every frame in full.
  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  MaxAgeSeconds: 3000
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = new S3Client({ region: REGION });

  const existing = await client
    .send(new GetBucketCorsCommand({ Bucket: BUCKET }))
    .catch(() => ({ CORSRules: [] }));

  // Keep every rule that is not ours, so this cannot quietly delete a CORS
  // policy some other part of the product depends on.
  const kept = (existing.CORSRules || []).filter((rule) => rule.ID !== RULE.ID);
  const next = [...kept, RULE];

  console.log(`Bucket:   ${BUCKET} (${REGION})`);
  console.log(`Existing: ${(existing.CORSRules || []).length} rule(s), keeping ${kept.length}`);
  console.log(JSON.stringify(RULE, null, 2));

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  await client.send(new PutBucketCorsCommand({
    Bucket: BUCKET,
    CORSConfiguration: { CORSRules: next }
  }));
  console.log('\nCORS rule applied.');
  console.log('Remember the CloudFront side: forward Origin, and keep ETag and Content-Length.');
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
