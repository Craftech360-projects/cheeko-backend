'use strict';

/**
 * Custom-card objects are overwritten at a stable key rather than getting a new
 * one on every edit, so that `fileUrl` and `imageUrl` survive an edit and the
 * app can cache a frame across one. Two things have to hold for that to be safe,
 * and neither is visible from the service layer:
 *
 * - the objects must be served `no-cache`, or CloudFront answers with last
 *   week's picture for a year and the version bump achieves nothing;
 * - a recording that changes format must NOT reuse its key, or the toy is handed
 *   a `.mp3` URL holding WAV bytes.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ input })),
  ListObjectsV2Command: jest.fn((input) => ({ input })),
  DeleteObjectCommand: jest.fn((input) => ({ __delete: true, input })),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  uploadCustomCardAudio,
  uploadCustomCardImage,
  customCardKeyFromUrl,
} = require('../../src/services/upload.service');

const CDN = 'https://dsmzc13oafp54.cloudfront.net';
const KID = 42;
const putInput = () => mockSend.mock.calls[0][0].input;

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({});
});

describe('customCardKeyFromUrl', () => {
  it('recovers the key from a stored custom-card URL', () => {
    expect(customCardKeyFromUrl(`${CDN}/customcard_kid42/abc.bin`)).toBe('customcard_kid42/abc.bin');
  });

  it('decodes an escaped legacy filename', () => {
    expect(customCardKeyFromUrl(`${CDN}/customcard_kid42/my%20song.mp3`)).toBe('customcard_kid42/my song.mp3');
  });

  it.each([
    ['nothing', null],
    ['an empty string', ''],
    // The guard is what stops an overwrite from ever landing on catalogue
    // content: a pack that somehow referenced a music file would otherwise have
    // an edit write a parent's recording over it.
    ['catalogue audio', `${CDN}/music/English/song.mp3`],
    ['a prefix-escaping key', `${CDN}/customcard_kid42/../music/song.mp3`],
  ])('refuses to resolve %s', (_label, url) => {
    expect(customCardKeyFromUrl(url)).toBeNull();
  });
});

describe('uploadCustomCardAudio', () => {
  it('overwrites the recording it replaces, leaving fileUrl unchanged', async () => {
    const existing = 'customcard_kid42/old.mp3';

    const { url, s3Key } = await uploadCustomCardAudio(
      Buffer.from('ID3'), KID, 'new.mp3', 'audio/mpeg', { reuseKey: existing }
    );

    expect(s3Key).toBe(existing);
    expect(url).toBe(`${CDN}/${existing}`);
    expect(putInput()).toEqual(expect.objectContaining({ Key: existing }));
  });

  it('takes a fresh key when the format changes, so the URL never lies', async () => {
    // A WAV written over a `.mp3` key hands the toy a file whose name disagrees
    // with its contents. The old object is left for the orphan sweep.
    const { s3Key } = await uploadCustomCardAudio(
      Buffer.from('RIFF'), KID, 'new.wav', 'audio/wav', { reuseKey: 'customcard_kid42/old.mp3' }
    );

    expect(s3Key).not.toBe('customcard_kid42/old.mp3');
    expect(s3Key).toMatch(/^customcard_kid42\/[0-9a-f-]+\.wav$/);
  });

  it('takes a fresh key when there is nothing to replace', async () => {
    const { s3Key } = await uploadCustomCardAudio(Buffer.from('ID3'), KID, 'a.mp3', 'audio/mpeg');
    expect(s3Key).toMatch(/^customcard_kid42\/[0-9a-f-]+\.mp3$/);
  });

  it('serves the recording no-cache, so an overwrite cannot be masked at the edge', async () => {
    await uploadCustomCardAudio(Buffer.from('ID3'), KID, 'a.mp3', 'audio/mpeg');
    expect(putInput().CacheControl).toBe('no-cache');
  });
});

describe('uploadCustomCardImage', () => {
  it('overwrites the picture it replaces, leaving imageUrl unchanged', async () => {
    const existing = 'customcard_kid42/old.bin';

    const { url, s3Key } = await uploadCustomCardImage(Buffer.alloc(8), KID, { reuseKey: existing });

    expect(s3Key).toBe(existing);
    expect(url).toBe(`${CDN}/${existing}`);
  });

  it('takes a fresh key for a recording that had no picture', async () => {
    const { s3Key } = await uploadCustomCardImage(Buffer.alloc(8), KID);
    expect(s3Key).toMatch(/^customcard_kid42\/[0-9a-f-]+\.bin$/);
  });

  it('serves the frame no-cache as octet-stream', async () => {
    await uploadCustomCardImage(Buffer.alloc(8), KID);
    expect(putInput()).toEqual(expect.objectContaining({
      ContentType: 'application/octet-stream',
      CacheControl: 'no-cache',
    }));
  });
});
