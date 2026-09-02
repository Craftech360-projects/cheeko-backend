/**
 * Upload Service
 * Handles file uploads to AWS S3
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { normalizeMacAddress, ownerKeyForDevice } = require('../utils/helpers');
const path = require('path');

// S3 Configuration
const AWS_REGION = process.env.AWS_DEFAULT_REGION || 'eu-north-1';
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';
// Optional local S3-compatible endpoint (e.g. MinIO). When set, uploads use it with
// path-style URLs instead of AWS. Leave unset for real AWS S3.
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;
// Public base for AI Imagine image URLs. For MinIO set e.g.
// http://192.168.0.186:9000/<bucket>; falls back to CloudFront for AWS.
const IMAGINE_PUBLIC_BASE = process.env.IMAGINE_PUBLIC_BASE || `https://${CLOUDFRONT_DOMAIN}`;
// Set to invalidate overwritten custom-card objects at the edge. Belt-and-braces
// only: the objects carry Cache-Control: no-cache, which is what actually makes
// an overwrite visible — invalidations are slow, rate-limited and eventually
// consistent, so nothing waits on one. Unset in local and test environments.
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || '';

logger.info('S3 Upload Service initialized', {
  region: AWS_REGION,
  bucket: S3_BUCKET,
  cloudfront: CLOUDFRONT_DOMAIN,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ? `${process.env.AWS_ACCESS_KEY_ID.substring(0, 8)}...` : 'NOT SET',
  secretKeySet: !!process.env.AWS_SECRET_ACCESS_KEY
});

const s3Client = new S3Client({
  region: AWS_REGION,
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Upload content file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} contentType - 'music' or 'story'
 * @param {string} category - Category/language (e.g., 'English', 'Hindi')
 * @param {string} mimeType - File MIME type
 * @returns {Promise<Object>} Upload result with URL
 */
const uploadContentFile = async (fileBuffer, filename, contentType, category, mimeType) => {
  try {
    // Determine S3 folder based on content type
    let folder = 'stories';
    if (contentType === 'music') folder = 'music';
    if (contentType === 'rfidcontent') folder = 'rfidcontent';
    const categoryFolder = category || 'English';

    // Clean filename (remove special chars but keep extension)
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext)
      .replace(/[^a-zA-Z0-9\s\-\_]/g, '')
      .trim();
    // Suffix a short unique token so re-uploading a same-named file produces a
    // NEW key + URL. Without this the key is deterministic, S3 overwrites in
    // place, the URL is unchanged, and CloudFront serves the year-cached old
    // file forever ("updated but old file still served").
    const cleanFilename = `${baseName}-${randomUUID().slice(0, 8)}${ext}`;

    // S3 key: music/English/filename-a1b2c3d4.mp3 or stories/Fantasy/...
    const s3Key = `${folder}/${categoryFolder}/${cleanFilename}`;

    logger.info('Attempting S3 upload', {
      bucket: S3_BUCKET,
      key: s3Key,
      fileSize: fileBuffer.length,
      mimeType: mimeType || 'audio/mpeg'
    });

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: mimeType || 'audio/mpeg',
      CacheControl: 'max-age=31536000' // 1 year cache
    });

    await s3Client.send(command);

    // Generate CloudFront URL
    const encodedFilename = encodeURIComponent(cleanFilename);
    const url = `https://${CLOUDFRONT_DOMAIN}/${folder}/${categoryFolder}/${encodedFilename}`;

    logger.info('File uploaded to S3', { s3Key, url });

    return {
      success: true,
      url,
      s3Key,
      filename: cleanFilename,
      folder,
      category: categoryFolder
    };
  } catch (error) {
    logger.error('Failed to upload file to S3', { error: error.message });
    throw new Error(`Upload failed: ${error.message}`);
  }
};

/**
 * Upload thumbnail image to S3
 * @param {Buffer} fileBuffer - Image buffer
 * @param {string} filename - Original filename
 * @param {string} contentType - 'music' or 'story'
 * @param {string} mimeType - File MIME type
 * @returns {Promise<Object>} Upload result with URL
 */
const uploadThumbnail = async (fileBuffer, filename, contentType, mimeType) => {
  try {
    // Determine S3 folder for thumbnails
    const folder = contentType === 'music' ? 'songs_thumbnails' : 'stories_thumbnails';

    // Clean filename
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext)
      .replace(/[^a-zA-Z0-9\s\-\_]/g, '')
      .trim();
    const cleanFilename = `${baseName}${ext}`;

    const s3Key = `${folder}/${cleanFilename}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: mimeType || 'image/png',
      CacheControl: 'max-age=31536000'
    });

    await s3Client.send(command);

    // Generate CloudFront URL
    const encodedFilename = encodeURIComponent(cleanFilename);
    const url = `https://${CLOUDFRONT_DOMAIN}/${folder}/${encodedFilename}`;

    logger.info('Thumbnail uploaded to S3', { s3Key, url });

    return {
      success: true,
      url,
      s3Key,
      filename: cleanFilename
    };
  } catch (error) {
    logger.error('Failed to upload thumbnail to S3', { error: error.message });
    throw new Error(`Thumbnail upload failed: ${error.message}`);
  }
};

// S3 keys are case-sensitive, so canonicalize the MAC (lowercase, colons->dashes)
// in BOTH write and list paths so they always match regardless of caller casing.
// Returns '' for a missing/malformed MAC so callers fall back to the flat prefix.
function macKeySegment(deviceMac) {
  if (!deviceMac || typeof deviceMac !== 'string') return '';
  const m = deviceMac.trim().toLowerCase().replace(/:/g, '-');
  return /^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/.test(m) ? m : '';
}

/**
 * The owner key for a device's pictures, or null when the MAC is unusable or the
 * device is unknown. Same key the workspace and memory stores use, so a pairing
 * adopts all four in one statement.
 */
async function imagineOwnerKey(deviceMac) {
  const normalized = normalizeMacAddress(deviceMac);
  if (!normalized) return null;
  const device = await prisma.ai_device.findUnique({
    where: { mac_address: normalized },
    select: { kid_id: true, mac_address: true },
  });
  if (!device) return null;
  return ownerKeyForDevice(device);
}

/**
 * AI Imagine: upload a generated JPEG to S3, record whose it is, and return the
 * public CloudFront URL. The object is bucketed under imagine/<mac>/<uuid>.jpg
 * and that key never moves again — a child changing toys updates the row's
 * owner_key, so no picture is ever copied between prefixes.
 */
async function uploadImagineImage(fileBuffer, deviceMac) {
  const mac = macKeySegment(deviceMac);
  const s3Key = `imagine/${mac ? `${mac}/` : ''}${randomUUID()}.jpg`;
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'max-age=31536000',
  }));

  // The picture is already safe in S3. Losing the row costs it from the gallery
  // until the backfill re-reads the bucket, which is worth far less than failing
  // an upload the child has already waited on.
  const ownerKey = await imagineOwnerKey(deviceMac).catch(() => null);
  if (ownerKey) {
    try {
      await prisma.imagine_image.create({
        data: {
          owner_key: ownerKey,
          mac_address: normalizeMacAddress(deviceMac),
          s3_key: s3Key,
          size_bytes: fileBuffer.length,
        },
      });
    } catch (err) {
      logger.warn(`[imagine] uploaded ${s3Key} but failed to record it: ${err.message}`);
    }
  }

  const url = `${IMAGINE_PUBLIC_BASE}/${s3Key}`;
  return { success: true, url, s3Key };
}

/**
 * The UTC instants bounding an IST calendar day. IST is a fixed +05:30 with no
 * daylight saving, so the offset is a constant rather than a lookup.
 */
function istDayRange(dateISO) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const midnightIST = new Date(`${dateISO}T00:00:00.000Z`).getTime() - IST_OFFSET_MS;
  return { gte: new Date(midnightIST), lt: new Date(midnightIST + 24 * 60 * 60 * 1000) };
}

/**
 * AI Imagine: list one owner's pictures, newest first.
 *
 * Reads the imagine_image table rather than listing the bucket, which is what
 * makes the gallery follow the child and removes the old 1000-object ceiling —
 * ListObjectsV2 returned a single page and the date filter was applied to
 * whatever happened to be on it.
 *
 * @param {string} deviceMac
 * @param {string|null} dateISO - YYYY-MM-DD, filtered as an IST calendar day
 * @param {{limit?: number, cursor?: string|number}} [options] - cursor is the id
 *   of the last row of the previous page
 */
async function listImagineImages(deviceMac, dateISO, options = {}) {
  const ownerKey = await imagineOwnerKey(deviceMac);
  if (!ownerKey) return [];
  return listImagineImagesForOwner(ownerKey, dateISO, options);
}

async function listImagineImagesForOwner(ownerKey, dateISO, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 1000);
  const cursor = options.cursor ? BigInt(options.cursor) : null;

  const rows = await prisma.imagine_image.findMany({
    where: {
      owner_key: ownerKey,
      ...(dateISO ? { created_at: istDayRange(dateISO) } : {}),
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit,
  });

  return rows.map((row) => ({
    id: String(row.id),
    key: row.s3_key,
    url: `${IMAGINE_PUBLIC_BASE}/${row.s3_key}`,
    size: row.size_bytes ? Number(row.size_bytes) : null,
    createdAt: row.created_at,
  }));
}

/** The gallery for one child, wherever the pictures were made. */
async function listImagineImagesForKid(kidId, dateISO, options = {}) {
  return listImagineImagesForOwner(`kid:${kidId}`, dateISO, options);
}

/**
 * Upload a kid's profile avatar image to S3 and return the public CloudFront URL.
 */
async function uploadKidAvatar(fileBuffer, kidId, mimeType) {
  const ext = mimeType === 'image/png' ? '.png' : '.jpg';
  const s3Key = `kids/avatars/${kidId}-${randomUUID()}${ext}`;
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType || 'image/jpeg',
    CacheControl: 'max-age=31536000',
  }));
  const url = `https://${CLOUDFRONT_DOMAIN}/${s3Key}`;
  return { success: true, url, s3Key };
}

/**
 * Delete a previously uploaded kid avatar, given the public URL stored on the
 * profile. Avatars are served publicly with a 1-year cache header, so a replaced
 * or deleted child's photo must not be left readable in the bucket.
 *
 * Best-effort: a failure here leaves an orphaned object, which is preferable to
 * failing the request that already succeeded.
 */
async function deleteKidAvatarByUrl(url) {
  const prefix = `https://${CLOUDFRONT_DOMAIN}/`;
  if (!url || !url.startsWith(prefix)) return;
  const s3Key = url.slice(prefix.length);
  // avatar_url is client-writable via PUT /kids/:id, so treat it as untrusted:
  // confine deletes to the avatar prefix and reject any traversal segment.
  if (!s3Key.startsWith('kids/avatars/') || s3Key.includes('..')) return;

  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
  } catch (error) {
    logger.warn(`Failed to delete old kid avatar ${s3Key}: ${error.message}`);
  }
}

/**
 * Upload a parent-recorded custom card audio file to S3 under customcard_kid<id>/.
 * Returns a public CloudFront URL: the toy downloads this straight from the
 * content manifest, exactly like catalogue audio, so it cannot be a signed URL
 * that expires while the manifest sits cached on the device.
 * ponytail: unguessable key, not access control — a leaked URL is readable.
 * Upgrade path: CloudFront signed URLs if a recording must be truly private.
 * @param {Buffer} fileBuffer - Audio buffer
 * @param {bigint|number|string} kidId - the child the recording belongs to
 * @param {string} filename - Original filename (used only for the extension)
 * @param {string} mimeType - Validated MIME type
 * @returns {Promise<{s3Key: string, url: string}>}
 */
// The `customcard` prefix is load-bearing: deleteCustomCardObject refuses any
// key that does not start with it, which is what stops a pack that somehow
// references catalogue audio from deleting it. A layout like `kid42/customcard/`
// would slip past that guard and take the orphan sweep silently dead with it.
function customCardFolder(kidId) {
  return `customcard_kid${kidId}`;
}

// Custom-card objects are overwritten at a stable key rather than getting a new
// one on every edit, so a year-long edge cache would serve last week's recording
// forever. `no-cache` is not `no-store`: the object is still cached, but every
// fetch revalidates against the ETag S3 computes, so an unchanged asset costs a
// 304 and a changed one is picked up on the next tap.
const CUSTOM_CARD_CACHE_CONTROL = 'no-cache';

/**
 * Recover the S3 key from a stored custom-card URL. The stored value is
 * <publicBase>/<key>, so everything from the fourth slash on is the key.
 * Returns null for anything that is not a custom-card object, which is what
 * keeps an in-place overwrite from ever landing on catalogue content.
 */
function customCardKeyFromUrl(url) {
  if (!url) return null;
  const key = String(url).split('/').slice(3).join('/');
  if (!key || !key.startsWith('customcard') || key.includes('..')) return null;
  // The key is written by us and never contains an escape, but a stored URL is
  // still data from a row — decode so a %20 in a legacy filename matches.
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * Ask CloudFront to forget a key it may be holding. Best-effort in every sense:
 * no distribution configured is a no-op, the SDK is loaded lazily so a
 * deployment without it still boots, and a failure is logged rather than failing
 * a write that has already succeeded. `no-cache` is the real freshness
 * guarantee — this only shortens the window in which an edge that ignores it
 * could still answer.
 */
async function invalidateCloudFront(keys) {
  const paths = [...new Set((keys || []).filter(Boolean))].map((key) => `/${key}`);
  if (!CLOUDFRONT_DISTRIBUTION_ID || paths.length === 0) return;

  try {
    const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
    const client = new CloudFrontClient({ region: AWS_REGION });
    await client.send(new CreateInvalidationCommand({
      DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: randomUUID(),
        Paths: { Quantity: paths.length, Items: paths }
      }
    }));
    logger.info('CloudFront invalidation requested', { paths });
  } catch (error) {
    logger.warn(`CloudFront invalidation failed for ${paths.join(', ')}: ${error.message}`);
  }
}

/**
 * @param {Buffer} fileBuffer
 * @param {bigint|number|string} kidId
 * @param {string} filename - used only for the extension
 * @param {string} mimeType - validated MIME type
 * @param {{reuseKey?: string|null}} [options] - the key of the recording this
 *   one replaces. Overwriting it keeps `fileUrl` stable, which is what lets the
 *   app cache a frame and the toy hold a manifest across an edit. Honoured only
 *   when the extension matches: a WAV written over a `.mp3` key would hand the
 *   toy a file whose name lies about its contents, so a format change takes a
 *   fresh key and lets the orphan sweep retire the old one.
 */
async function uploadCustomCardAudio(fileBuffer, kidId, filename, mimeType, { reuseKey = null } = {}) {
  const ext = (path.extname(filename || '') || '.mp3').toLowerCase();
  const reusable = reuseKey && path.extname(reuseKey).toLowerCase() === ext ? reuseKey : null;
  const s3Key = reusable || `${customCardFolder(kidId)}/${randomUUID()}${ext}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType || 'audio/mpeg',
    CacheControl: CUSTOM_CARD_CACHE_CONTROL
  }));
  if (reusable) await invalidateCloudFront([s3Key]);

  // Public CloudFront URL, same as every other content pack: the ESP32 fetches
  // this straight out of the download manifest, and a signed URL would expire
  // while the manifest sits cached on the toy.
  const url = `${IMAGINE_PUBLIC_BASE}/${s3Key}`;
  logger.info('Custom card audio uploaded to S3', { s3Key, kidId: String(kidId), size: fileBuffer.length, overwritten: !!reusable });
  return { s3Key, url };
}

/**
 * Upload a converted custom card picture to S3, alongside that child's audio.
 *
 * Same prefix as the recordings on purpose: deleteCustomCardObject only touches
 * keys under `customcard`, so sharing it means the existing orphan sweep covers
 * pictures too, and a picture stays inside its own child's namespace.
 *
 * The body is already an LVGL binary — octet-stream, not an image type, because
 * that is what the toy downloads and writes to the SD card verbatim.
 *
 * A replacement overwrites the picture it replaces rather than taking a new key,
 * so `imageUrl` is stable across an edit. Freshness comes from the no-cache +
 * ETag pair above, not from a changing URL — a picture is always `.bin`, so
 * unlike the audio there is no extension to disagree about.
 * @param {Buffer} binBuffer - LVGL RGB565 binary
 * @param {bigint|number|string} kidId - the child the picture belongs to
 * @param {{reuseKey?: string|null}} [options] - the key of the picture this one
 *   replaces, if any
 * @returns {Promise<{s3Key: string, url: string}>}
 */
async function uploadCustomCardImage(binBuffer, kidId, { reuseKey = null } = {}) {
  const s3Key = reuseKey || `${customCardFolder(kidId)}/${randomUUID()}.bin`;

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: binBuffer,
    ContentType: 'application/octet-stream',
    CacheControl: CUSTOM_CARD_CACHE_CONTROL
  }));
  if (reuseKey) await invalidateCloudFront([s3Key]);

  const url = `${IMAGINE_PUBLIC_BASE}/${s3Key}`;
  logger.info('Custom card image uploaded to S3', { s3Key, kidId: String(kidId), size: binBuffer.length, overwritten: !!reuseKey });
  return { s3Key, url };
}

/**
 * Delete a retired custom card object — a recording or a picture. Best-effort:
 * an orphaned object is preferable to failing a request whose DB write already
 * succeeded.
 */
async function deleteCustomCardObject(s3Key) {
  if (!s3Key || !s3Key.startsWith('customcard') || s3Key.includes('..')) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
  } catch (error) {
    logger.warn(`Failed to delete retired custom card object ${s3Key}: ${error.message}`);
  }
}

module.exports = {
  uploadContentFile,
  uploadThumbnail,
  uploadImagineImage,
  uploadKidAvatar,
  deleteKidAvatarByUrl,
  listImagineImages,
  listImagineImagesForKid,
  uploadCustomCardAudio,
  uploadCustomCardImage,
  customCardKeyFromUrl,
  invalidateCloudFront,
  deleteCustomCardObject,
  // Pre-image name, kept so nothing that still calls it breaks.
  deleteCustomCardAudio: deleteCustomCardObject
};
