/**
 * Upload Service
 * Handles file uploads to AWS S3
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');
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
 * AI Imagine: upload a generated JPEG to S3 and return the public CloudFront URL.
 * When deviceMac is provided the object is bucketed under imagine/<mac>/<uuid>.jpg
 * so images can be listed per device; otherwise it falls back to imagine/<uuid>.jpg.
 * No DB persistence — caller (mqtt-gateway) owns the device-facing image{url} message.
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
  const url = `${IMAGINE_PUBLIC_BASE}/${s3Key}`;
  return { success: true, url, s3Key };
}

/**
 * AI Imagine: list a device's generated images, newest first. Returns [] for an
 * unknown/malformed MAC. Pass dateISO (YYYY-MM-DD) to filter to that IST calendar
 * day — S3 has no server-side date filter, so this filters the listed page in memory.
 * ponytail: single ListObjectsV2 page (1000 max) — add a continuation token if a
 * device ever exceeds 1000 images.
 */
async function listImagineImages(deviceMac, dateISO) {
  const mac = macKeySegment(deviceMac);
  if (!mac) return [];
  const out = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: `imagine/${mac}/`,
  }));
  let items = (out.Contents || []).map((o) => ({
    key: o.Key,
    url: `${IMAGINE_PUBLIC_BASE}/${o.Key}`,
    size: o.Size,
    createdAt: o.LastModified,
  }));
  if (dateISO) {
    items = items.filter((i) =>
      new Date(i.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === dateISO);
  }
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

// Custom card audio is one child's private recording, not shared catalogue content,
// so it is never served from the public CloudFront origin. Callers persist only the
// returned key and mint a short-lived signed URL per tap via getSignedAudioUrl.
const CUSTOM_CARD_URL_TTL_SECONDS = parseInt(process.env.CUSTOM_CARD_URL_TTL_SECONDS, 10) || 21600; // 6h

/**
 * Upload a parent-recorded custom card audio file to S3.
 * Returns the object key ONLY — deliberately no url, so a URL cannot be persisted
 * by accident and later expire mid-playback.
 * @param {Buffer} fileBuffer - Audio buffer
 * @param {number|string} kidId - Kid profile id the audio belongs to
 * @param {string} filename - Original filename (used only for the extension)
 * @param {string} mimeType - Validated MIME type
 * @returns {Promise<{s3Key: string}>}
 */
async function uploadCustomCardAudio(fileBuffer, kidId, filename, mimeType) {
  const ext = (path.extname(filename || '') || '.mp3').toLowerCase();
  const s3Key = `customcards/${kidId}/${randomUUID()}${ext}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType || 'audio/mpeg',
    // No long-lived cache header: these objects are private and reached via
    // signed URLs that rotate, so a shared cache must not hold onto them.
    CacheControl: 'private, max-age=0, no-store'
  }));

  logger.info('Custom card audio uploaded to S3', { s3Key, kidId, size: fileBuffer.length });
  return { s3Key };
}

/**
 * Mint a short-lived signed URL for a stored audio key.
 * Called fresh on every tap lookup — never persisted.
 * @param {string} s3Key - Stored object key
 * @param {number} [ttlSeconds] - Expiry, defaults to CUSTOM_CARD_URL_TTL_SECONDS
 * @returns {Promise<string|null>} Signed URL, or null if signing fails
 */
async function getSignedAudioUrl(s3Key, ttlSeconds = CUSTOM_CARD_URL_TTL_SECONDS) {
  if (!s3Key) return null;
  try {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
    return await getSignedUrl(s3Client, command, { expiresIn: ttlSeconds });
  } catch (error) {
    logger.error(`Failed to sign custom card audio key ${s3Key}: ${error.message}`);
    return null;
  }
}

/**
 * Delete a retired custom card audio object. Best-effort: an orphaned object is
 * preferable to failing a request whose DB write already succeeded.
 */
async function deleteCustomCardAudio(s3Key) {
  if (!s3Key || !s3Key.startsWith('customcards/') || s3Key.includes('..')) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
  } catch (error) {
    logger.warn(`Failed to delete retired custom card audio ${s3Key}: ${error.message}`);
  }
}

module.exports = {
  uploadContentFile,
  uploadThumbnail,
  uploadImagineImage,
  uploadKidAvatar,
  deleteKidAvatarByUrl,
  listImagineImages,
  uploadCustomCardAudio,
  getSignedAudioUrl,
  deleteCustomCardAudio
};
