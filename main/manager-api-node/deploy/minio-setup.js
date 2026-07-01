// One-time setup for AI Imagine local storage on MinIO (or any S3-compatible endpoint):
// creates the bucket and applies a public-read policy so the device can GET image URLs
// without credentials.
//
// Start MinIO first:
//   docker run -d -p 9000:9000 -p 9001:9001 \
//     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
//     minio/minio server /data --console-address ":9001"
//
// Then:  node deploy/minio-setup.js
// Env (all optional, shown with defaults):
//   S3_ENDPOINT=http://127.0.0.1:9000  S3_BUCKET_NAME=imagine-local
//   AWS_ACCESS_KEY_ID=minioadmin  AWS_SECRET_ACCESS_KEY=minioadmin  AWS_DEFAULT_REGION=us-east-1
const { S3Client, CreateBucketCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

const endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9000';
const bucket = process.env.S3_BUCKET_NAME || 'imagine-local';
const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';

(async () => {
  const s3 = new S3Client({
    region, endpoint, forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
    },
  });

  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log('created bucket:', bucket);
  } catch (e) {
    if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(`${e.name}${e.message}`)) console.log('bucket already exists:', bucket);
    else throw e;
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }],
  };
  await s3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }));
  console.log('applied public-read policy on:', bucket, '@', endpoint);
})().catch((e) => { console.error('minio-setup failed:', e && e.message); process.exit(1); });
