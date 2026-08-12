// Set SERVICE_SECRET_KEY before any modules are loaded so auth.js captures the value.
process.env.SERVICE_SECRET_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';

// Mock the upload service so no real S3 call happens.
jest.mock('../../src/services/upload.service', () => ({
  uploadImagineImage: jest.fn().mockResolvedValue({
    success: true,
    url: 'https://cdn.example.net/imagine/abc.jpg',
    s3Key: 'imagine/abc.jpg',
  }),
}));

const request = require('supertest');
const app = require('../../src/app');
const uploadService = require('../../src/services/upload.service');

const SERVICE_KEY = process.env.SERVICE_SECRET_KEY || 'test-service-key';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe('POST /toy/imagine/upload', () => {
  beforeEach(() => uploadService.uploadImagineImage.mockClear());

  it('rejects without a service key (401)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
    expect(uploadService.uploadImagineImage).not.toHaveBeenCalled();
  });

  it('rejects with a wrong service key (401)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', 'definitely-wrong-key')
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
    expect(uploadService.uploadImagineImage).not.toHaveBeenCalled();
  });

  it('uploads a JPEG and returns the URL (200)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY)
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.url).toBe('https://cdn.example.net/imagine/abc.jpg');
    expect(res.body.data.s3Key).toBe('imagine/abc.jpg');
    expect(uploadService.uploadImagineImage).toHaveBeenCalledTimes(1);
    // Two arguments since the S3 key became device-bucketed: the second is the
    // MAC, absent here because this request sends no deviceMac field.
    expect(uploadService.uploadImagineImage).toHaveBeenCalledWith(expect.any(Buffer), undefined);
  });

  // The MAC decides the S3 prefix (imagine/<mac>/<uuid>.jpg), so a request that
  // loses it silently files the image where no gallery will list it.
  it('passes the device MAC through when the gateway sends one', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY)
      .field('deviceMac', 'AA:BB:CC:DD:EE:FF')
      .attach('file', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(uploadService.uploadImagineImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'AA:BB:CC:DD:EE:FF',
    );
  });

  it('rejects a non-JPEG file (400)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY)
      .attach('file', Buffer.from('hello'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(uploadService.uploadImagineImage).not.toHaveBeenCalled();
  });

  it('rejects when no file is attached (400)', async () => {
    const res = await request(app)
      .post('/toy/imagine/upload')
      .set('X-Service-Key', SERVICE_KEY);
    expect(res.status).toBe(400);
  });
});
