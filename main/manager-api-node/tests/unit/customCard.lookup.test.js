'use strict';

/**
 * Custom card resolution: the allowlist decides *whether* a UID is a custom card,
 * and the child paired to the tapping toy decides *which* pack plays. These are
 * the outcomes the device depends on, and the ones that silently regress if the
 * two halves drift.
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
// Stubbed so the suite does not need the AWS SDK: nothing on the read path uploads.
jest.mock('../../src/services/upload.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

const MAC = 'AA:BB:CC:DD:EE:FF';
const UID = '04A1B2C3';
const KID_ID = BigInt(42);

const PACK = {
  id: BigInt(77),
  pack_code: 'CUSTOM_KID_42',
  name: 'Aarav — Custom Card',
  content_type: 'rfidcontent',
  version: '3',
  content_hash: 'abc123'
};

const ITEM = {
  id: BigInt(1),
  content_pack_id: BigInt(77),
  item_number: 1,
  title: 'grandma-story.mp3',
  audio_url: 'https://cdn.example/customcard_kid42/x.mp3',
  image_url: null,
  lyrics_text: null,
  story_number: null,
  story_title: null,
  active: true
};

beforeEach(() => {
  jest.clearAllMocks();
  // Column probes hit information_schema; everything else is the item select.
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    return Promise.resolve(sql.includes('information_schema') ? [] : [ITEM]);
  });
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue(null);
  mockPrisma.rfid_series.findFirst.mockResolvedValue(null);
  // The tapping toy, paired to a child, unless a test says otherwise.
  mockPrisma.ai_device.findFirst.mockResolvedValue({ kid_id: KID_ID });
});

describe('custom card lookup', () => {
  it('resolves an issued card to the pack of the child on the tapping toy', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);

    const result = await rfidService.lookupCardByUid(UID, MAC);

    // The MAC is looked up normalized — the toy may send it with any separators.
    expect(mockPrisma.ai_device.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mac_address: MAC } })
    );
    // Derived from the child, not the toy — the upload path builds the same
    // code, and a mismatch here means silent playback of nothing.
    expect(mockPrisma.rfid_content_pack.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pack_code: 'CUSTOM_KID_42', active: true } })
    );
    expect(result.contentType).toBe('rfidcontent');
    expect(result.packCode).toBe('CUSTOM_KID_42');
    expect(result.version).toBe('3');
    expect(result.items).toEqual([
      expect.objectContaining({ sequence: 1, audioUrl: ITEM.audio_url })
    ]);
  });

  it('carries a recording\'s artwork through to the device', async () => {
    const withImage = { ...ITEM, image_url: 'https://cdn.example/customcard_kid42/y.bin' };
    mockPrisma.$queryRaw.mockImplementation((strings) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
      return Promise.resolve(sql.includes('information_schema') ? [] : [withImage]);
    });
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);

    const result = await rfidService.lookupCardByUid(UID, MAC);

    // The gateway turns items[].imageUrl into the images list the toy downloads;
    // dropping it here is invisible until a card plays with a blank screen.
    expect(result.items).toEqual([
      expect.objectContaining({ sequence: 1, imageUrl: withImage.image_url })
    ]);
  });

  it('reports an issued card with no recording as unknown', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);

    // Null on purpose: the gateway turns it into card_unknown. Answering with a
    // prompt card instead spun up an LLM session to speak one fixed sentence.
    expect(await rfidService.lookupCardByUid(UID, MAC)).toBeNull();
  });

  it('returns null for a UID that is not in the allowlist', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue(null);

    expect(await rfidService.lookupCardByUid(UID, MAC)).toBeNull();
    expect(mockPrisma.ai_device.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });

  it('plays nothing on an unpaired toy', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });
    mockPrisma.ai_device.findFirst.mockResolvedValue({ kid_id: null });

    // The deliberate regression of kid-only binding: a toy handed to a sibling
    // before a child is picked must not play the previous child's recordings.
    expect(await rfidService.lookupCardByUid(UID, MAC)).toBeNull();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when the tapping MAC is not a registered device', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });
    mockPrisma.ai_device.findFirst.mockResolvedValue(null);

    expect(await rfidService.lookupCardByUid(UID, MAC)).toBeNull();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when no MAC was supplied at all', async () => {
    mockPrisma.custom_card.findFirst.mockResolvedValue({ id: BigInt(5), rfid_uid: UID });

    expect(await rfidService.lookupCardByUid(UID)).toBeNull();
    expect(mockPrisma.ai_device.findFirst).not.toHaveBeenCalled();
  });
});
