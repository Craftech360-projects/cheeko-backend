'use strict';

/**
 * Reordering a content pack's items.
 *
 * The dashboard editor lets an admin move a card between any two others. It
 * sends the whole item array back in the new order and updateContentPack writes
 * item_number from array position, so the reorder needs no endpoint of its own —
 * but it does need two guarantees the delete-all-then-reinsert write did not
 * previously give:
 *
 *   - each item's stored metadata has to travel with the item, not stay behind
 *     at the item_number it used to hold;
 *   - content_hash has to move, or the toy — which compares the hash before it
 *     re-downloads — keeps playing the pre-reorder running order for ever.
 *
 * Ordering itself is global by construction: item_number lives on the shared
 * content_item row, and every read path orders by it.
 */

const mockTx = {
  content_item: { deleteMany: jest.fn(), createMany: jest.fn() },
  rfid_content_pack: { updateMany: jest.fn(), findFirst: jest.fn() }
};

const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  content_item: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  rfid_content_pack: { updateMany: jest.fn(), findFirst: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

const PACK_ID = 7;

// A B C D as the database holds them. Duration and byte size exist only here —
// the editor never shows them, so they are exactly the fields a position-matched
// write would graft onto the wrong item.
const STORED = ['A', 'B', 'C', 'D'].map((letter, i) => ({
  id: BigInt(101 + i),
  content_pack_id: BigInt(PACK_ID),
  item_number: i + 1,
  title: `Card ${letter}`,
  description: `${letter} description`,
  audio_url: `https://cdn.test/${letter}.mp3`,
  image_url: `https://cdn.test/${letter}.bin`,
  audio_size_bytes: BigInt(1000 + i),
  audio_duration_ms: BigInt(60000 + i),
  images_json: null,
  lyrics_text: `${letter} lyrics`,
  content_text: null,
  story_number: null,
  story_title: null,
  active: true
}));

/** What the dashboard sends: the four editable fields plus the row's id. */
const asPayloadItem = (row, itemNumber) => ({
  id: Number(row.id),
  itemNumber,
  title: row.title,
  audioUrl: row.audio_url,
  imageUrl: row.image_url,
  text: row.lyrics_text,
  storyNumber: null,
  storyTitle: null
});

/** The pack's items in the order they were written, as {title, ...} rows. */
const written = () => mockTx.content_item.createMany.mock.calls[0][0].data;

const hashWritten = () =>
  mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data.content_hash;

const byTitle = (title) => written().find(row => row.title === title);

beforeEach(() => {
  jest.clearAllMocks();
  // The column probe and the pre-load of existing items both go through
  // $queryRaw. The probe asks information_schema and is answered with column
  // rows; anything else is the item pre-load.
  mockPrisma.$queryRaw.mockImplementation((strings) => {
    const sql = Array.isArray(strings) ? strings.join('') : String(strings);
    if (sql.includes('information_schema')) {
      return Promise.resolve([
        { column_name: 'content_text' },
        { column_name: 'story_number' },
        { column_name: 'story_title' }
      ]);
    }
    return Promise.resolve(STORED);
  });
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockTx));
  mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
  setStoredPack({ version: '4', content_hash: 'hash-of-something-older' });
});

/** The pack row the pre-write read and the in-transaction version read return. */
const setStoredPack = (row) => {
  const full = {
    name: 'Pack', description: 'd', content_type: 'story_pack', language: 'en',
    status: 'published', thumbnail_url: 't', active: true, ...row
  };
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(full);
  mockTx.rfid_content_pack.findFirst.mockResolvedValue(full);
};

const versionWritten = () =>
  mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data.version;

/** Clears the recorded calls without losing the beforeEach wiring. */
const resetCalls = () => {
  [mockTx.content_item.deleteMany, mockTx.content_item.createMany,
    mockTx.rfid_content_pack.updateMany, mockPrisma.rfid_content_pack.updateMany,
    mockPrisma.content_item.createMany].forEach(m => m.mockClear());
};

/**
 * Saves `letters` once to learn the hash the service derives for that order,
 * then makes it the stored hash — so the next save is one the service sees as
 * changing nothing. Asking the service for the value instead of restating its
 * formula here means a wrong formula cannot pass by matching a wrong copy.
 */
const settleAt = async (letters, version = '4') => {
  // Clear first: every assertion below reads mock.calls[0], so the probe save
  // has to be the only call on record when its hash is read back.
  resetCalls();
  await saveOrder(letters);
  const hash = hashWritten();
  resetCalls();
  setStoredPack({ version, content_hash: hash });
};

/** Saves the pack with its items in `order`, e.g. ['A','B','D','C']. */
const saveOrder = (letters, extra = {}) => {
  const items = letters.map((letter, idx) => {
    const row = STORED.find(r => r.title === `Card ${letter}`);
    return asPayloadItem(row, idx + 1);
  });
  return rfidService.updateContentPack({ id: PACK_ID, items, ...extra }, 1);
};

describe('reordering a flat pack', () => {
  it('writes item_number from the submitted order (A B C D → A B D C)', async () => {
    await saveOrder(['A', 'B', 'D', 'C']);

    expect(written().map(row => [row.item_number, row.title])).toEqual([
      [1, 'Card A'],
      [2, 'Card B'],
      [3, 'Card D'],
      [4, 'Card C']
    ]);
  });

  it('keeps each item\'s unshown metadata with that item, not with its old slot', async () => {
    await saveOrder(['A', 'B', 'D', 'C']);

    // D moved from slot 4 to slot 3. Matched by position it would have picked up
    // C's description, running time and byte size.
    expect(byTitle('Card D')).toMatchObject({
      item_number: 3,
      description: 'D description',
      audio_url: 'https://cdn.test/D.mp3',
      image_url: 'https://cdn.test/D.bin',
      audio_duration_ms: BigInt(60003),
      audio_size_bytes: BigInt(1003)
    });
    expect(byTitle('Card C')).toMatchObject({
      item_number: 4,
      description: 'C description',
      audio_duration_ms: BigInt(60002),
      audio_size_bytes: BigInt(1002)
    });
  });

  it.each([
    ['first to last', ['B', 'C', 'D', 'A']],
    ['last to first', ['D', 'A', 'B', 'C']],
    ['middle to first', ['C', 'A', 'B', 'D']],
    ['middle to last', ['A', 'B', 'D', 'C']],
    ['adjacent swap', ['B', 'A', 'C', 'D']],
    ['full reversal', ['D', 'C', 'B', 'A']]
  ])('%s keeps every item whole', async (_name, order) => {
    await saveOrder(order);

    const rows = written();
    expect(rows.map(r => r.item_number)).toEqual([1, 2, 3, 4]);
    expect(rows.map(r => r.title)).toEqual(order.map(l => `Card ${l}`));
    // Every row still carries its own audio, picture, description and timings.
    rows.forEach((row) => {
      const letter = row.title.slice(-1);
      expect(row).toMatchObject({
        description: `${letter} description`,
        audio_url: `https://cdn.test/${letter}.mp3`,
        image_url: `https://cdn.test/${letter}.bin`,
        lyrics_text: `${letter} lyrics`
      });
    });
  });

  it('inserts a new item between two existing ones without disturbing them', async () => {
    // "Add item here" between B and C: the new row has no id yet.
    const items = [
      asPayloadItem(STORED[0], 1),
      asPayloadItem(STORED[1], 2),
      { itemNumber: 3, title: 'Card N', audioUrl: 'https://cdn.test/N.mp3', imageUrl: '', text: '', storyNumber: null, storyTitle: null },
      asPayloadItem(STORED[2], 4),
      asPayloadItem(STORED[3], 5)
    ];

    await rfidService.updateContentPack({ id: PACK_ID, items }, 1);

    expect(written().map(r => [r.item_number, r.title])).toEqual([
      [1, 'Card A'], [2, 'Card B'], [3, 'Card N'], [4, 'Card C'], [5, 'Card D']
    ]);
    // The new row is new: it must not inherit the timings of the C that used to
    // sit at item_number 3.
    expect(byTitle('Card N')).toMatchObject({
      audio_duration_ms: null,
      audio_size_bytes: null,
      description: null
    });
    expect(byTitle('Card C')).toMatchObject({ audio_duration_ms: BigInt(60002) });
  });

  it('deletes an item after a reorder without renumbering the survivors wrongly', async () => {
    await saveOrder(['A', 'D', 'C']);

    expect(written().map(r => [r.item_number, r.title])).toEqual([
      [1, 'Card A'], [2, 'Card D'], [3, 'Card C']
    ]);
    expect(byTitle('Card D')).toMatchObject({ audio_duration_ms: BigInt(60003) });
    expect(mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data.total_items).toBe(3);
  });
});

describe('story mode', () => {
  it('keeps a reordered track\'s metadata and its story grouping', async () => {
    // Two stories; the tracks of story 1 are rearranged.
    const items = [
      { ...asPayloadItem(STORED[1], 1), storyNumber: 1, storyTitle: 'One' },
      { ...asPayloadItem(STORED[0], 2), storyNumber: 1, storyTitle: 'One' },
      { ...asPayloadItem(STORED[2], 3), storyNumber: 2, storyTitle: 'Two' },
      { ...asPayloadItem(STORED[3], 4), storyNumber: 2, storyTitle: 'Two' }
    ];

    await rfidService.updateContentPack({ id: PACK_ID, items }, 1);

    expect(written().map(r => [r.item_number, r.story_number, r.title])).toEqual([
      [1, 1, 'Card B'],
      [2, 1, 'Card A'],
      [3, 2, 'Card C'],
      [4, 2, 'Card D']
    ]);
    expect(byTitle('Card B')).toMatchObject({
      story_title: 'One',
      description: 'B description',
      audio_duration_ms: BigInt(60001)
    });
  });
});

describe('content_hash, so the toy notices', () => {
  it('changes when only the order changes', async () => {
    await saveOrder(['A', 'B', 'C', 'D']);
    const before = hashWritten();

    jest.clearAllMocks();
    mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
    await saveOrder(['A', 'B', 'D', 'C']);

    expect(hashWritten()).not.toBe(before);
  });

  it('changes when an item is added, edited or removed', async () => {
    await saveOrder(['A', 'B', 'C', 'D']);
    const baseline = hashWritten();

    const rerun = async (fn) => {
      jest.clearAllMocks();
      mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
      await fn();
      return hashWritten();
    };

    // Removal.
    expect(await rerun(() => saveOrder(['A', 'B', 'C']))).not.toBe(baseline);
    // Addition.
    expect(await rerun(() => rfidService.updateContentPack({
      id: PACK_ID,
      items: [...['A', 'B', 'C', 'D'].map((l, i) => asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1)),
        { itemNumber: 5, title: 'Card N', audioUrl: 'https://cdn.test/N.mp3' }]
    }, 1))).not.toBe(baseline);
    // A retitled item, with every URL unchanged.
    expect(await rerun(() => rfidService.updateContentPack({
      id: PACK_ID,
      items: ['A', 'B', 'C', 'D'].map((l, i) => ({
        ...asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1),
        title: l === 'B' ? 'Card B (fixed)' : `Card ${l}`
      }))
    }, 1))).not.toBe(baseline);
  });

  it('is the same for the same order, so an untouched save is not churn', async () => {
    await saveOrder(['A', 'B', 'C', 'D']);
    const first = hashWritten();

    jest.clearAllMocks();
    mockPrisma.rfid_content_pack.updateMany.mockResolvedValue({ count: 1 });
    await saveOrder(['A', 'B', 'C', 'D']);

    expect(hashWritten()).toBe(first);
  });

  it('leaves a caller-supplied hash alone', async () => {
    // The custom-card flow computes its own, folding the version in so that
    // replacing the bytes behind an unchanged URL still registers.
    await saveOrder(['A', 'B', 'C', 'D'], { contentHash: 'caller-computed' });

    expect(mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data)
      .toEqual({ total_items: 4 });
    expect(mockPrisma.rfid_content_pack.updateMany.mock.calls[0][0].data)
      .toMatchObject({ content_hash: 'caller-computed' });
  });
});

describe('the version bump', () => {
  it('advances by one when the order changes', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await saveOrder(['A', 'B', 'D', 'C']);

    expect(versionWritten()).toBe('5');
  });

  it('advances by one when an item is added, and again when one is deleted', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');
    await rfidService.updateContentPack({
      id: PACK_ID,
      items: [...['A', 'B', 'C', 'D'].map((l, i) => asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1)),
        { itemNumber: 5, title: 'Card N', audioUrl: 'https://cdn.test/N.mp3' }]
    }, 1);
    expect(versionWritten()).toBe('5');

    await settleAt(['A', 'B', 'C', 'D'], '9');
    await saveOrder(['A', 'B', 'C']);
    expect(versionWritten()).toBe('10');
  });

  it('advances when a recording is replaced, leaving every other field alone', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await rfidService.updateContentPack({
      id: PACK_ID,
      items: ['A', 'B', 'C', 'D'].map((l, i) => ({
        ...asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1),
        audioUrl: l === 'C' ? 'https://cdn.test/C-v2.mp3' : `https://cdn.test/${l}.mp3`
      }))
    }, 1);

    expect(versionWritten()).toBe('5');
  });

  it('advances when only the voice script changes', async () => {
    // The text has no object behind it, so nothing else about the save differs.
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await rfidService.updateContentPack({
      id: PACK_ID,
      items: ['A', 'B', 'C', 'D'].map((l, i) => ({
        ...asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1),
        text: l === 'B' ? 'a corrected script' : `${l} lyrics`
      }))
    }, 1);

    expect(versionWritten()).toBe('5');
  });

  it('advances when only the pack is renamed', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await rfidService.updateContentPack({
      id: PACK_ID,
      name: 'A better name',
      items: ['A', 'B', 'C', 'D'].map((l, i) => asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1))
    }, 1);

    expect(versionWritten()).toBe('5');
  });

  it('does not advance when the save changes nothing', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await saveOrder(['A', 'B', 'C', 'D']);

    expect(versionWritten()).toBeUndefined();
    // and the rest of the write still happens
    expect(mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data.total_items).toBe(4);
  });

  it('advances by exactly one per save, not once per changed item', async () => {
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await rfidService.updateContentPack({
      id: PACK_ID,
      name: 'Renamed too',
      items: ['D', 'C', 'B', 'A'].map((l, i) => ({
        ...asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1),
        title: `Card ${l} v2`
      }))
    }, 1);

    expect(versionWritten()).toBe('5');
  });

  it('counts from what is stored, not from what the client sent', async () => {
    // Two admins with the dialog open: the second still shows v4 in its copy of
    // the pack, but the pack is at 7 by the time the save lands.
    await settleAt(['A', 'B', 'C', 'D'], '7');

    await saveOrder(['D', 'C', 'B', 'A']);

    expect(versionWritten()).toBe('8');
  });

  it('starts a pack with no usable version at 1', async () => {
    for (const stored of [null, '', 'not-a-number']) {
      await settleAt(['A', 'B', 'C', 'D'], stored);
      await saveOrder(['B', 'A', 'C', 'D']);
      expect(versionWritten()).toBe('1');
    }
  });

  it('treats a dotted version as its leading integer', async () => {
    // "1.0.0" and "1" already compare equal for the toy, so the next one is 2.
    await settleAt(['A', 'B', 'C', 'D'], '1.0.0');

    await saveOrder(['B', 'A', 'C', 'D']);

    expect(versionWritten()).toBe('2');
  });

  it('leaves a caller-supplied version alone', async () => {
    // The custom-card flow computes its own and would otherwise be bumped twice.
    await settleAt(['A', 'B', 'C', 'D'], '4');

    await saveOrder(['D', 'C', 'B', 'A'], { version: '99', contentHash: 'caller-computed' });

    expect(versionWritten()).toBeUndefined();
    expect(mockPrisma.rfid_content_pack.updateMany.mock.calls[0][0].data)
      .toMatchObject({ version: '99', content_hash: 'caller-computed' });
  });

  it('leaves the version alone on a pack-row-only update', async () => {
    // No items in the payload means "rename the pack", and the item write —
    // where the bump lives — does not run at all.
    await rfidService.updateContentPack({ id: PACK_ID, name: 'Renamed' }, 1);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.rfid_content_pack.updateMany.mock.calls[0][0].data.version).toBeUndefined();
  });
});

/**
 * cached_audio_urls is a {"1": url} map, and "1" looks like an item_number — so
 * a reorder looks like it should invalidate it. It does not, and this pins why:
 * the map is only ever read by lookupContentByRfidUid, inside the branch that
 * also reads the pack's content_md, against a sequence the device sends and
 * extractBySequence resolves against that markdown. It indexes positions in
 * content_md, which this editor never writes. The item-based download manifest
 * does not consult it at all.
 *
 * So the only obligation a reorder has towards it is to leave it alone.
 */
describe('sequence-keyed cached audio', () => {
  it('is not rewritten, cleared or remapped by an item write', async () => {
    await rfidService.updateContentPack({
      id: PACK_ID,
      items: ['D', 'C', 'B', 'A'].map((l, i) =>
        asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1))
    }, 1);

    const headerWrite = mockPrisma.rfid_content_pack.updateMany.mock.calls[0][0].data;
    const itemWrite = mockTx.rfid_content_pack.updateMany.mock.calls[0][0].data;
    expect(headerWrite).not.toHaveProperty('cached_audio_urls');
    expect(itemWrite).not.toHaveProperty('cached_audio_urls');
  });

  it('is still passed straight through when the caller sends one', async () => {
    // The dashboard round-trips the value it read on open, and that has to stay
    // a plain write — remapping it against item_number would corrupt a map that
    // is not keyed by item_number in the first place.
    const map = { 1: 'https://cdn.test/tts-1.mp3', 2: 'https://cdn.test/tts-2.mp3' };
    await rfidService.updateContentPack({
      id: PACK_ID,
      cachedAudioUrls: map,
      items: ['B', 'A'].map((l, i) =>
        asPayloadItem(STORED.find(r => r.title === `Card ${l}`), i + 1))
    }, 1);

    expect(mockPrisma.rfid_content_pack.updateMany.mock.calls[0][0].data.cached_audio_urls)
      .toEqual(map);
  });
});

describe('payloads that carry no ids keep their old matching', () => {
  it('still falls back to item_number, as the custom-card and import flows rely on', async () => {
    // No ids anywhere: identity by position is all there is, and those callers
    // send a complete item and never reorder.
    await rfidService.updateContentPack({
      id: PACK_ID,
      items: [
        { itemNumber: 1, title: 'Card A', audioUrl: 'https://cdn.test/A.mp3' },
        { itemNumber: 2, title: 'Card B', audioUrl: 'https://cdn.test/B.mp3' }
      ]
    }, 1);

    // Picked up from the stored rows at those item numbers, exactly as before.
    expect(written()[0]).toMatchObject({
      item_number: 1,
      description: 'A description',
      audio_duration_ms: BigInt(60000)
    });
    expect(written()[1]).toMatchObject({
      item_number: 2,
      description: 'B description',
      audio_duration_ms: BigInt(60001)
    });
  });
});
