'use strict';

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

const { deleteKidAvatarByUrl } = require('../../src/services/upload.service');

const CDN = 'https://dsmzc13oafp54.cloudfront.net';

describe('deleteKidAvatarByUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('deletes the object for an avatar URL under the kids/avatars prefix', async () => {
    await deleteKidAvatarByUrl(`${CDN}/kids/avatars/12-abc.jpg`);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual(
      expect.objectContaining({ Key: 'kids/avatars/12-abc.jpg' })
    );
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['a foreign host', 'https://evil.example.com/kids/avatars/12-abc.jpg'],
    ['a key outside the avatar prefix', `${CDN}/rfidcontent/voicecards/vc.mp3`],
    ['a prefix-escaping key', `${CDN}/kids/avatars/../../music/song.mp3`],
  ])('does not delete anything for %s', async (_label, url) => {
    await deleteKidAvatarByUrl(url);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('swallows S3 failures so the caller request still succeeds', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));
    await expect(deleteKidAvatarByUrl(`${CDN}/kids/avatars/12-abc.jpg`)).resolves.toBeUndefined();
  });
});
