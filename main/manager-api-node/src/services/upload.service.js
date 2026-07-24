/**
 * Upload Service
 * Handles file uploads to AWS S3
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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
    const cleanFilename = `${baseName}${ext}`;

    // S3 key: music/English/filename.mp3 or stories/Fantasy/filename.mp3
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
 * unknown/malformed MAC. ponytail: single ListObjectsV2 page (1000 max) — add a
 * continuation token if a device ever exceeds 1000 images.
 */
async function listImagineImages(deviceMac) {
  const mac = macKeySegment(deviceMac);
  if (!mac) return [];
  const out = await s3Client.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: `imagine/${mac}/`,
  }));
  return (out.Contents || [])
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))
    .map((o) => ({ url: `${IMAGINE_PUBLIC_BASE}/${o.Key}`, createdAt: o.LastModified }));
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

module.exports = {
  uploadContentFile,
  uploadThumbnail,
  uploadImagineImage,
  uploadKidAvatar,
  listImagineImages
};
