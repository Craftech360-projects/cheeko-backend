'use strict';

/**
 * Deleting a recording.
 *
 * The regression this file exists for: `DELETE .../content/:itemNumber` used to
 * answer HTTP 200 while leaving the row in the database. The item write goes
 * through rfidService.updateContentPack, which did delete-all-then-reinsert with
 * both halves wrapped in a catch-and-log. A failing delete meant the rows
 * survived, the reinsert added renumbered duplicates, and the endpoint reported
 * success. A failing insert meant the whole card was wiped, and the endpoint
 * still reported success.
 *
 * Two things are asserted here, and they are the whole fix: the delete removes
 * exactly one item and renumbers what is left, and a write that fails propagates
 * instead of being swallowed.
 */

const mockPrisma = {
  kid_profile: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn(), upsert: jest.fn() },
  content_item: { findMany: jest.fn() }
};

const mockUpload = {
  uploadCustomCardAudio: jest.fn(),
  uploadCustomCardImage: jest.fn(),
  deleteCustomCardObject: jest.fn(async () => {})
};

const mockRfid = { updateContentPack: jest.fn() };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/upload.service', () => ({
  // Pure, and the sweep depends on what it returns to decide which objects are
  // safe to delete. Stubbing it would test the stub.
  customCardKeyFromUrl: jest.requireActual('../../src/services/upload.service').customCardKeyFromUrl,
  ...mockUpload,
}));
jest.mock('../../src/services/rfid.service', () => mockRfid);
jest.mock('../../src/utils/lvglImage', () => ({ toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12)) }));

const customCardService = require('../../src/services/customCard.service');

const USER_ID = 7;
const KID_ID = 42;
const PACK = { id: BigInt(7), pack_code: 'CK000042', name: 'Aarav — Custom Card', version: '1' };

const AUDIO = (n) => `https://cdn.test/customcard_kid42/audio${n}.mp3`;

// An in-memory pack, so what the database holds after the call is observed
// rather than asserted about. The response has to agree with it — the old bug
// was precisely a response that disagreed.
let rows = [];

const seed = (count) => {
  rows = Array.from({ length: count }, (_, index) => ({
    id: BigInt(index + 1),
    item_number: index + 1,
    title: `recording${index + 1}.mp3`,
    audio_url: AUDIO(index + 1),
    audio_size_bytes: 100,
    image_url: null
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  seed(3);

  mockPrisma.kid_profile.findFirst.mockResolvedValue({ id: BigInt(KID_ID), name: 'Aarav' });
  mockPrisma.ai_device.findFirst.mockResolvedValue({ mac_address: 'AA:BB:CC:DD:EE:FF' });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
  mockPrisma.content_item.findMany.mockImplementation(async () => rows.map((row) => ({ ...row })));

  mockRfid.updateContentPack.mockImplementation(async (data) => {
    rows = data.items.map((item, index) => ({
      id: BigInt(index + 1),
      item_number: item.itemNumber,
      title: item.title,
      audio_url: item.audioUrl,
      audio_size_bytes: item.audioSizeBytes,
      image_url: item.imageUrl == null ? null : item.imageUrl
    }));
  });
});

describe('deleteCustomCardItem', () => {
  it('removes exactly one recording and renumbers the survivors', async () => {
    const card = await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 2);

    // The toy selects by sequence, so a gap would have it ask for an item that
    // is not there.
    expect(rows.map((row) => [row.item_number, row.audio_url])).toEqual([
      [1, AUDIO(1)],
      [2, AUDIO(3)]
    ]);
    // The response is what the client rebuilds its list from, so it has to be
    // the database and not a hopeful copy of it.
    expect(card.contentPack.items.map((item) => [item.itemNumber, item.fileUrl])).toEqual([
      [1, AUDIO(1)],
      [2, AUDIO(3)]
    ]);
    expect(card.contentPack.totalItems).toBe(2);
  });

  it('sweeps only the deleted recording from storage', async () => {
    await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 2);

    expect(mockUpload.deleteCustomCardObject.mock.calls.map(([key]) => key))
      .toEqual(['customcard_kid42/audio2.mp3']);
  });

  it('leaves an empty but present pack when the last recording goes', async () => {
    seed(1);

    const card = await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1);

    // Not the same state as "never recorded anything": contentPack stays
    // non-null with an empty list, so the app can tell the two apart.
    expect(rows).toEqual([]);
    expect(card.contentPack).not.toBeNull();
    expect(card.contentPack.items).toEqual([]);
    expect(card.contentPack.totalItems).toBe(0);
  });

  it('propagates a failed write instead of answering success', async () => {
    // This is the regression. updateContentPack is now a transaction that
    // rethrows, so a failure reaches the route's asyncHandler as a 500 and the
    // card is left exactly as it was.
    mockRfid.updateContentPack.mockRejectedValue(new Error('deleteMany failed'));

    await expect(customCardService.deleteCustomCardItem(USER_ID, KID_ID, 2))
      .rejects.toThrow('deleteMany failed');

    expect(rows.map((row) => row.item_number)).toEqual([1, 2, 3]);
    // Nothing is swept either — the sweep runs after the write, never before.
    expect(mockUpload.deleteCustomCardObject).not.toHaveBeenCalled();
  });

  it('404s for an item number the card does not have', async () => {
    await expect(customCardService.deleteCustomCardItem(USER_ID, KID_ID, 9))
      .rejects.toThrow('That recording could not be found on this card.');
    expect(mockRfid.updateContentPack).not.toHaveBeenCalled();
  });

  it('404s before any pack exists', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);

    await expect(customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1))
      .rejects.toThrow('This child has no custom card content.');
  });

  it('404s for a child belonging to another parent', async () => {
    mockPrisma.kid_profile.findFirst.mockResolvedValue(null);

    // Not-found rather than forbidden: the endpoint must not reveal which kid
    // ids exist.
    await expect(customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1))
      .rejects.toThrow('That child could not be found.');
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });
});

describe('updateContentPack, as deleteCustomCardItem calls it', () => {
  // The service is what the route sees; this is the contract it depends on.
  it('hands the writer the complete surviving item set, not a delta', async () => {
    await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1);

    const [data] = mockRfid.updateContentPack.mock.calls[0];
    expect(data.id).toBe(Number(PACK.id));
    expect(data.items).toEqual([
      expect.objectContaining({ itemNumber: 1, audioUrl: AUDIO(2) }),
      expect.objectContaining({ itemNumber: 2, audioUrl: AUDIO(3) })
    ]);
    // The toy compares the hash first and falls back to the version, so both
    // have to move or it keeps playing its cached copy of the deleted card.
    expect(data.version).toBe('2');
    expect(data.contentHash).toEqual(expect.any(String));
  });
});
