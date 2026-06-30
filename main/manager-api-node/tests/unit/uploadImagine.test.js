// Mock the v3 S3 SDK BEFORE requiring the service so the module-level client is the mock.
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn((input) => ({ __input: input })),
    __mockSend: mockSend,
  };
});

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const uploadService = require('../../src/services/upload.service');

describe('uploadImagineImage', () => {
  beforeEach(() => {
    const { __mockSend } = require('@aws-sdk/client-s3');
    __mockSend.mockClear();
    PutObjectCommand.mockClear();
  });

  it('uploads a JPEG under the imagine/ prefix and returns a public CloudFront URL', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG-ish bytes
    const result = await uploadService.uploadImagineImage(buf);

    // S3 was called once with a PutObjectCommand
    const { __mockSend } = require('@aws-sdk/client-s3');
    expect(__mockSend).toHaveBeenCalledTimes(1);
    const cmdInput = PutObjectCommand.mock.calls[0][0];
    expect(cmdInput.Key).toMatch(/^imagine\/[0-9a-f-]+\.jpg$/);
    expect(cmdInput.ContentType).toBe('image/jpeg');
    expect(cmdInput.Body).toBe(buf);

    // Returned contract
    expect(result.success).toBe(true);
    expect(result.s3Key).toBe(cmdInput.Key);
    expect(result.url).toBe(`https://${process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net'}/${cmdInput.Key}`);
  });

  it('generates a unique key per call', async () => {
    const a = await uploadService.uploadImagineImage(Buffer.from([1]));
    const b = await uploadService.uploadImagineImage(Buffer.from([1]));
    expect(a.s3Key).not.toBe(b.s3Key);
  });
});
