'use strict';
const crypto = require('crypto');

const sent = [];
jest.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand { constructor(input) { this.input = input; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; } }
  class ListObjectsV2Command { constructor(input) { this.input = input; } }
  class S3Client { async send(cmd) { sent.push(cmd.input); return {}; } }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command };
});
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const upload = require('../../src/services/upload.service');
const cc = require('../../src/utils/contentCrypto');

const K = crypto.randomBytes(16);
const MP3 = Buffer.from('ID3 fake mp3 body for sealing');

describe('upload sealing', () => {
  beforeEach(() => { sent.length = 0; });

  test('uploadContentFile writes plaintext when no sealKey is given', async () => {
    await upload.uploadContentFile(MP3, 'tiger.mp3', 'rfidcontent', 'audio', 'audio/mpeg');
    expect(sent[0].Body).toEqual(MP3);
  });

  test('uploadContentFile seals the body when sealKey is given, and the URL is unchanged in shape', async () => {
    const r = await upload.uploadContentFile(MP3, 'tiger.mp3', 'rfidcontent', 'audio', 'audio/mpeg', { sealKey: K });
    const body = sent[0].Body;
    expect(cc.parseHeader(body)).toMatchObject({ version: 1 });
    expect(cc.unseal(body, K)).toEqual(MP3);
    expect(sent[0].ContentType).toBe('audio/mpeg');
    expect(r.url).toMatch(/^https:\/\/.+\/rfidcontent\/audio\/tiger-[0-9a-f]{8}\.mp3$/);
  });

  test('custom card audio and image seal too', async () => {
    await upload.uploadCustomCardAudio(MP3, 42, 'rec.mp3', 'audio/mpeg', { sealKey: K });
    await upload.uploadCustomCardImage(Buffer.alloc(12, 1), 42, { sealKey: K });
    for (const put of sent) expect(cc.parseHeader(put.Body)).not.toBeNull();
  });

  test('character art is never sealed, even if a sealKey is passed', async () => {
    const bin = Buffer.alloc(12, 2);
    await upload.uploadCharacterArt(bin, 'tara', 1, 'talk', { sealKey: K });
    expect(sent[0].Body).toEqual(bin);
  });
});
