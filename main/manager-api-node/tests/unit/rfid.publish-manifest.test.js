'use strict';

/**
 * manifest.jsn is what the toy parses, and it is derived from rows — so it
 * must be rewritten every time the rows are, or the device downloads a manifest
 * that names files the pack no longer has.
 */

const mockPrisma = {
  $queryRaw: jest.fn(),
  rfid_content_pack: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  content_item: { createMany: jest.fn(), deleteMany: jest.fn() },
  $transaction: jest.fn(async (fn) => fn(mockPrisma))
};
const mockUpload = { uploadGamePackManifest: jest.fn(async (code) => ({ s3Key: `rfidcontent/apps/${code}/manifest.jsn`, url: `https://cdn.test/rfidcontent/apps/${code}/manifest.jsn` })) };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => mockUpload);
jest.mock('../../src/services/contentKeys.service', () => ({ isEnabled: () => false }));

const rfidService = require('../../src/services/rfid.service');

const PACK = { id: BigInt(9), pack_code: 'hometown', name: 'Around the House', content_type: 'sound_quiz', version: '2', content_hash: 'x' };
const item = (n, title, prompt, d) => ({
  id: BigInt(n), item_number: n, title, lyrics_text: prompt, description: d,
  audio_url: `https://cdn.test/${title}.mp3`, image_url: `https://cdn.test/${title}.png`, active: true
});
const ITEMS = [item(1, 'Doorbell', 'DING-DONG?', 'Phone,Clock'), item(2, 'Phone', 'RING?', 'Doorbell,Clock'), item(3, 'Clock', 'TICK?', 'Phone,Doorbell')];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    return Promise.resolve(sql.includes('information_schema') ? [] : ITEMS);
  });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
  mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
});

describe('publishSoundQuizManifest', () => {
  it('builds from rows and uploads to the fixed key', async () => {
    const result = await rfidService.publishSoundQuizManifest(9);
    expect(mockUpload.uploadGamePackManifest).toHaveBeenCalledTimes(1);
    const [code, manifest] = mockUpload.uploadGamePackManifest.mock.calls[0];
    expect(code).toBe('hometown');
    expect(manifest).toMatchObject({ template: 'sound_quiz', app_id: 'hometown', version: 2 });
    expect(manifest.rounds).toHaveLength(3);
    expect(result).toEqual({ url: expect.stringMatching(/manifest\.jsn$/), rounds: 3 });
  });

  it('does nothing for a non-game pack', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, content_type: 'story_pack' });
    const result = await rfidService.publishSoundQuizManifest(9);
    expect(result).toBeNull();
    expect(mockUpload.uploadGamePackManifest).not.toHaveBeenCalled();
  });

  it('is called by updateContentPack after the items are written', async () => {
    await rfidService.updateContentPack({
      id: 9,
      items: ITEMS.map((i) => ({ title: i.title, text: i.lyrics_text, description: i.description, audioUrl: i.audio_url, imageUrl: i.image_url }))
    }, 1);
    expect(mockUpload.uploadGamePackManifest).toHaveBeenCalledWith('hometown', expect.objectContaining({ template: 'sound_quiz' }));
  });

  it('surfaces an upload failure as an error after the rows are saved', async () => {
    mockUpload.uploadGamePackManifest.mockRejectedValueOnce(new Error('s3 down'));
    await expect(rfidService.updateContentPack({ id: 9, name: 'Renamed' }, 1)).rejects.toThrow(/manifest/i);
  });

  it('createContentPack rejects an invalid game pack code before inserting', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);
    await expect(rfidService.createContentPack({ packCode: 'Hometown', name: 'X', contentType: 'sound_quiz' }, 1))
      .rejects.toThrow(/1-8 chars/);
    expect(mockPrisma.rfid_content_pack.create).not.toHaveBeenCalled();
  });

  it('updateContentPack rejects switching a badly coded pack to sound_quiz before writing', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, pack_code: 'AroundTheHouse', content_type: 'story_pack' });
    await expect(rfidService.updateContentPack({ id: 9, contentType: 'sound_quiz' }, 1)).rejects.toThrow(/1-8 chars/);
    expect(mockPrisma.rfid_content_pack.updateMany).not.toHaveBeenCalled();
  });
});
