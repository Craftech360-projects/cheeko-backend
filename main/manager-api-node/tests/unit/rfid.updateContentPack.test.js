'use strict';

/**
 * updateContentPack's item write.
 *
 * Items are written delete-all-then-reinsert. Both statements used to sit in
 * their own try/catch that logged and carried on, and neither was in a
 * transaction, so:
 *
 *   - a failing deleteMany left the old rows in place, the insert added
 *     renumbered duplicates, and the caller was told it succeeded;
 *   - a failing createMany wiped every item on the pack, and the caller was
 *     told it succeeded.
 *
 * The custom-card delete bug ("HTTP 200, row still there") was the first of
 * those. This file pins the fix: one transaction, nothing swallowed.
 *
 * Shared with the admin dashboard's content-pack editor, so the same guarantee
 * has to hold for both callers.
 */

const mockTx = {
  content_item: { deleteMany: jest.fn(), createMany: jest.fn() },
  rfid_content_pack: { updateMany: jest.fn() }
};

const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  content_item: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  rfid_content_pack: { updateMany: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

const PACK_ID = 7;
const ITEMS = [
  { itemNumber: 1, title: 'a.mp3', audioUrl: 'https://cdn.test/customcard_kid42/a.mp3' },
  { itemNumber: 2, title: 'b.mp3', audioUrl: 'https://cdn.test/customcard_kid42/b.mp3' }
];

beforeEach(() => {
  jest.clearAllMocks();
  // Column probes hit information_schema; the pre-load of existing items comes
  // back empty, which is the normal first-write case.
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
  // The pack row exists, so the header update matches it.
  mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
});

describe('updateContentPack item write', () => {
  it('deletes, reinserts and re-counts inside one transaction', async () => {
    await rfidService.updateContentPack({ id: PACK_ID, items: ITEMS }, 1);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // All three statements go through the transaction client, never the
    // top-level one — a statement on `prisma` would not roll back with the rest.
    expect(mockTx.content_item.deleteMany).toHaveBeenCalledWith({
      where: { content_pack_id: BigInt(PACK_ID) }
    });
    expect(mockTx.content_item.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ item_number: 1, audio_url: ITEMS[0].audioUrl }),
        expect.objectContaining({ item_number: 2, audio_url: ITEMS[1].audioUrl })
      ]
    });
    expect(mockTx.rfid_content_pack.updateMany).toHaveBeenCalledWith({
      where: { id: BigInt(PACK_ID) },
      data: { total_items: 2 }
    });
    expect(mockPrisma.content_item.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.content_item.createMany).not.toHaveBeenCalled();
  });

  it('rethrows when the delete fails, instead of reporting success', async () => {
    // Previously: logged, then the insert ran anyway and added renumbered
    // duplicates alongside the rows that were supposed to be gone.
    mockTx.content_item.deleteMany.mockRejectedValueOnce(new Error('delete blew up'));

    await expect(rfidService.updateContentPack({ id: PACK_ID, items: ITEMS }, 1))
      .rejects.toThrow('delete blew up');
  });

  it('rethrows when the insert fails, instead of reporting success', async () => {
    // Previously: logged, and the pack was left with no items at all.
    mockTx.content_item.createMany.mockRejectedValueOnce(new Error('insert blew up'));

    await expect(rfidService.updateContentPack({ id: PACK_ID, items: ITEMS }, 1))
      .rejects.toThrow('insert blew up');
  });

  it('empties the pack in the same transaction when the last item goes', async () => {
    await rfidService.updateContentPack({ id: PACK_ID, items: [] }, 1);

    expect(mockTx.content_item.deleteMany).toHaveBeenCalledTimes(1);
    // createMany with an empty array is a pointless round trip, so it is skipped
    // — but the count still has to be written, and inside the transaction.
    expect(mockTx.content_item.createMany).not.toHaveBeenCalled();
    expect(mockTx.rfid_content_pack.updateMany).toHaveBeenCalledWith({
      where: { id: BigInt(PACK_ID) },
      data: { total_items: 0 }
    });
  });

  it('leaves the items alone when the caller sends none', async () => {
    // `items` absent means "update the pack row only" — the dashboard renaming a
    // pack must not clear its contents.
    await rfidService.updateContentPack({ id: PACK_ID, name: 'Renamed' }, 1);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: BigInt(PACK_ID) },
      data: expect.objectContaining({ name: 'Renamed' })
    }));
  });

  it('still writes when the pre-load of existing items fails', async () => {
    // That read is only a fallback source for fields the payload leaves
    // undefined. Failing to read it is not a reason to refuse the write, so its
    // catch deliberately stays.
    mockPrisma.$queryRaw.mockRejectedValue(new Error('information_schema unavailable'));

    await rfidService.updateContentPack({ id: PACK_ID, items: ITEMS }, 1);

    expect(mockTx.content_item.createMany).toHaveBeenCalled();
  });
});

/**
 * updateMany reports success when it matches nothing, so a PUT for an id that
 * does not exist used to answer {code:0} having changed nothing — and then run
 * the item write anyway, deleting and reinserting content_item rows against a
 * pack that isn't there. The admin UI never hit it (it only sends ids it just
 * listed); API and MCP callers can send anything.
 */
describe('updateContentPack on an id that does not exist', () => {
  beforeEach(() => {
    mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 0 });
  });

  it('throws 404 instead of reporting success', async () => {
    await expect(rfidService.updateContentPack({ id: 999999, name: 'nope' }, 1))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not touch content_item', async () => {
    await expect(rfidService.updateContentPack({ id: 999999, items: ITEMS }, 1)).rejects.toThrow();

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockTx.content_item.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.content_item.createMany).not.toHaveBeenCalled();
  });
});
