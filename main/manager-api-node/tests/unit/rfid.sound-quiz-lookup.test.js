'use strict';

/**
 * A card mapped to a sound_quiz pack must come back in the game shape the
 * gateway turns into card_game — and never in the items/stories shape, which
 * the gateway would route as a content pack and the toy would try to play as
 * audio tracks.
 */

const mockPrisma = {
  $queryRaw: jest.fn(),
  rfid_card_mapping: { findFirst: jest.fn() },
  rfid_series: { findFirst: jest.fn() },
  custom_card: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
const mockContentKeys = { isEnabled: () => false, getPackKey: jest.fn(), getDeviceSecret: jest.fn() };
jest.mock('../../src/services/contentKeys.service', () => mockContentKeys);

const rfidService = require('../../src/services/rfid.service');

const UID = '04A1B2C3';
const MAC = 'AA:BB:CC:DD:EE:FF';
const PACK = {
  id: BigInt(9), pack_code: 'hometown', name: 'Around the House',
  content_type: 'sound_quiz', version: '3', content_hash: 'h3', thumbnail_url: null
};
const item = (n, title, prompt, distractors) => ({
  id: BigInt(n), content_pack_id: BigInt(9), item_number: n, title,
  lyrics_text: prompt, description: distractors,
  audio_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-a1.mp3`,
  image_url: `https://cdn.test/apps/hometown/${title.toLowerCase()}-b2.png`,
  story_number: null, story_title: null, active: true
});
const ITEMS = [
  item(1, 'Doorbell', 'DING-DONG?', 'Phone,Clock'),
  item(2, 'Phone', 'RING?', 'Doorbell,Clock'),
  item(3, 'Clock', 'TICK-TOCK?', 'Phone,Doorbell'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    return Promise.resolve(sql.includes('information_schema') ? [] : ITEMS);
  });
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({
    id: BigInt(1), rfid_uid: UID, content_pack_id: BigInt(9), card_type: 'game', active: true
  });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
});

describe('sound_quiz lookup', () => {
  it('returns the game shape: appId, prompts, assets, no items', async () => {
    const result = await rfidService.lookupCardByUid(UID, MAC);

    expect(result).toMatchObject({
      rfid_uid: UID, contentType: 'sound_quiz', appId: 'hometown',
      title: 'Around the House', version: '3', contentHash: 'h3'
    });
    expect(result.items).toBeUndefined();
    expect(result.stories).toBeUndefined();
    expect(result.encryption).toBeUndefined();
    expect(result.prompts).toEqual([
      { sound: 'Doorbell', prompt: 'DING-DONG?', file: 'doorbell.mp3' },
      { sound: 'Phone', prompt: 'RING?', file: 'phone.mp3' },
      { sound: 'Clock', prompt: 'TICK-TOCK?', file: 'clock.mp3' }
    ]);
    expect(result.assets[0]).toEqual({
      name: 'manifest.jsn', url: expect.stringMatching(/\/rfidcontent\/apps\/hometown\/manifest\.jsn$/)
    });
    expect(result.assets).toHaveLength(7);
  });

  it('returns null (card_unknown) when the pack code is not a valid app id', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, pack_code: 'AroundTheHouse' });
    const result = await rfidService.lookupCardByUid(UID, MAC);
    expect(result).toBeNull();
  });

  it('leaves ordinary content packs on the items shape', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue({ ...PACK, content_type: 'story_pack' });
    const result = await rfidService.lookupCardByUid(UID, MAC);
    expect(result.items).toHaveLength(3);
    expect(result.assets).toBeUndefined();
  });
});

describe('getContentPackByCode', () => {
  it('returns description on each item so the dashboard can round-trip distractors', async () => {
    const pack = await rfidService.getContentPackByCode('hometown');
    expect(pack.items[0]).toMatchObject({ title: 'Doorbell', description: 'Phone,Clock', text: 'DING-DONG?' });
  });
});
