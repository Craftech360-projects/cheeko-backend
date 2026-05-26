/**
 * Test script for S3 upload
 * Usage: node scripts/test-s3-upload.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetBucketLocationCommand } = require('@aws-sdk/client-s3');

// Configuration
const S3_BUCKET = process.env.S3_BUCKET_NAME || 'cheeko-music-files';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net';

// Test file path
const testFilePath = path.join(__dirname, '..', 'Instrumental - Achyutam Keshavam  Krishna Bhajan.mp3');

console.log('='.repeat(60));
console.log('S3 Upload Test Script');
console.log('='.repeat(60));

// Check configuration
console.log('\nConfiguration:');
console.log(`  Bucket: ${S3_BUCKET}`);
console.log(`  CloudFront: ${CLOUDFRONT_DOMAIN}`);
console.log(`  Access Key: ${process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '...' : 'NOT SET'}`);
console.log(`  Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'}`);

// Check if file exists
console.log('\nTest File:');
console.log(`  Path: ${testFilePath}`);

if (!fs.existsSync(testFilePath)) {
  console.error('  ERROR: Test file does not exist!');
  process.exit(1);
}

const fileStats = fs.statSync(testFilePath);
console.log(`  Size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

async function getBucketRegion() {
  // Use us-east-1 to query bucket location (works for any bucket)
  const client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  try {
    const command = new GetBucketLocationCommand({ Bucket: S3_BUCKET });
    const response = await client.send(command);
    // Empty or null means us-east-1
    const region = response.LocationConstraint || 'us-east-1';
    console.log(`  Bucket region detected: ${region}`);
    return region;
  } catch (error) {
    console.error(`  Could not detect bucket region: ${error.message}`);
    // Default to us-east-1
    return 'us-east-1';
  }
}

async function testUpload() {
  try {
    console.log('\n--- Detecting Bucket Region ---');
    const region = await getBucketRegion();

    // Create S3 client with correct region
    const s3Client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    console.log('\n--- Starting Upload Test ---\n');

    // Read file
    const fileBuffer = fs.readFileSync(testFilePath);
    const filename = path.basename(testFilePath);

    // Clean filename
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext)
      .replace(/[^a-zA-Z0-9\s\-\_]/g, '')
      .trim();
    const cleanFilename = `${baseName}${ext}`;

    // S3 key
    const s3Key = `music/English/${cleanFilename}`;

    console.log(`Uploading to: s3://${S3_BUCKET}/${s3Key}`);
    console.log(`File size: ${fileBuffer.length} bytes`);
    console.log(`Region: ${region}`);

    // Upload
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'audio/mpeg',
      CacheControl: 'max-age=31536000'
    });

    const startTime = Date.now();
    await s3Client.send(command);
    const duration = Date.now() - startTime;

    // Generate CloudFront URL
    const encodedFilename = encodeURIComponent(cleanFilename);
    const url = `https://${CLOUDFRONT_DOMAIN}/music/English/${encodedFilename}`;

    console.log('\n--- Upload Successful! ---\n');
    console.log(`  Duration: ${duration}ms`);
    console.log(`  S3 Key: ${s3Key}`);
    console.log(`  CloudFront URL: ${url}`);
    console.log(`\n  IMPORTANT: Update AWS_DEFAULT_REGION=${region} in your .env file!`);
    console.log('\nYou can test the URL in your browser to verify the file is accessible.');

  } catch (error) {
    console.error('\n--- Upload Failed! ---\n');
    console.error(`  Error: ${error.message}`);

    if (error.Code) {
      console.error(`  Code: ${error.Code}`);
    }

    if (error.message.includes('Access Denied')) {
      console.error('\nPossible causes:');
      console.error('  1. IAM user lacks s3:PutObject permission');
      console.error('  2. Bucket policy blocks this action');
      console.error('  3. Wrong bucket name');
      console.error(`\nVerify bucket "${S3_BUCKET}" exists and IAM user has permissions.`);
    }

    process.exit(1);
  }
}

testUpload();
