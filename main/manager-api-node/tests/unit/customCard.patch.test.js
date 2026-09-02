'use strict';

/**
 * Editing one recording in place.
 *
 * The three properties that separate PATCH from the legacy replace-and-reinsert
 * routes, and that a passing "it returned 200" would not catch:
 *
 *  - the row keeps its id and its number, and the pack keeps its create_date;
 *  - one request bumps the version exactly once, whatever it changed;
 *  - `If-Match` is compared against the pack as it is at write time, and a
 *    stale one writes nothing and hands back the card the caller is behind on.
 */

const path = require('path');
const { LVGL_FRAME_BYTES, RAW_FRAME_BYTES } = jest.requireActual('../../src/utils/lvglImage');

jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  // PATCH never converts, so reaching ffmpeg at all is the failure this catches.
  toLvglRgb565Bin: jest.fn(async () => { throw new Error('PATCH must not convert a picture'); }),
}));

const CDN = 'https://cdn.test';
const USER_ID = 7;
const KID_ID = 42;
const MAC = 'AA:BB:CC:DD:EE:FF';
const PACK_CREATED = new Date('2026-01-01T00:00:00.000Z');

const AUDIO_KEY = 'customcard_kid42/audio-1.mp3';
const IMAGE_KEY = 'customcard_kid42/image-1.bin';

// ── a stateful stand-in for the two tables PATCH touches ────────────────────

let pack;
let items;
let freshKeys;

const packRow = () => ({ ...pack });

const mockPrisma = {
  kid_profile: {
    findFirst: jest.fn(async ({ where }) => (
      String(where.id) === String(KID_ID) && String(where.user_id) === String(USER_ID)
        ? { id: BigInt(KID_ID), name: 'Aarav' }
        : null
    )),
  },
  ai_device: { findFirst: jest.fn(async () => ({ mac_address: MAC })) },
  rfid_content_pack: {
    findFirst: jest.fn(async () => packRow()),
    findUnique: jest.fn(async () => packRow()),
    upsert: jest.fn(async () => packRow()),
    update: jest.fn(async ({ data }) => {
      pack = { ...pack, ...data };
      return packRow();
    }),
  },
  content_item: {
    findMany: jest.fn(async () => items.map((row) => ({ ...row }))),
    update: jest.fn(async ({ where, data }) => {
      const row = items.find((item) => String(item.id) === String(where.id));
      if (!row) throw new Error('no such content_item');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  // Interactive transaction, run against the same fake. Rollback is not
  // simulated; the tests that care assert on what was written, not on recovery.
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};

const mockUpload = {
  // Mirrors the real service: reuse the key when it is offered and the extension
  // agrees, otherwise mint a new one. The rule itself is tested against a
  // stubbed S3 in upload.service.customCard.test.js.
  uploadCustomCardAudio: jest.fn(async (buffer, kidId, filename, mimeType, { reuseKey } = {}) => {
    const ext = path.extname(filename || '') || '.mp3';
    const key = reuseKey && path.extname(reuseKey) === ext
      ? reuseKey
      : `customcard_kid${kidId}/audio-${++freshKeys}${ext}`;
    return { s3Key: key, url: `${CDN}/${key}` };
  }),
  uploadCustomCardImage: jest.fn(async (buffer, kidId, { reuseKey } = {}) => {
    const key = reuseKey || `customcard_kid${kidId}/image-${++freshKeys}.bin`;
    return { s3Key: key, url: `${CDN}/${key}` };
  }),
  deleteCustomCardObject: jest.fn(async () => {}),
  customCardKeyFromUrl: jest.requireActual('../../src/services/upload.service').customCardKeyFromUrl,
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/upload.service', () => mockUpload);
jest.mock('../../src/services/rfid.service', () => ({ updateContentPack: jest.fn() }));

const customCardService = require('../../src/services/customCard.service');

// ── fixtures ────────────────────────────────────────────────────────────────

const MP3 = (name = 'new.mp3') => ({
  buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]),
  originalname: name,
});
const WAV = (name = 'new.wav') => ({
  buffer: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(64)]),
  originalname: name,
});

/** The bytes the app uploads: a packed panel frame, no container. */
const rawFrame = (fill = 0xa5) => ({
  buffer: Buffer.alloc(RAW_FRAME_BYTES, fill),
  originalname: 'card_picture_1234.bin',
});
/** The same frame with the LVGL v9 header the toy and the dashboard both read. */
const lvglFrame = () => ({
  buffer: jest.requireActual('../../src/utils/lvglImage').toDeviceFrame(Buffer.alloc(RAW_FRAME_BYTES, 0x11)),
  originalname: 'card_picture_1234.bin',
});

const patch = (changes, itemNumber = 1) =>
  customCardService.patchCustomCardItem(USER_ID, KID_ID, itemNumber, changes);

const itemOne = () => items[0];

beforeEach(() => {
  jest.clearAllMocks();
  freshKeys = 1;
  pack = {
    id: BigInt(7),
    pack_code: 'CUSTOM_KID_42',
    name: 'Custom Card',
    version: '4',
    content_hash: 'hash-before',
    total_items: 2,
    create_date: PACK_CREATED,
    update_date: PACK_CREATED,
  };
  items = [
    {
      id: BigInt(101),
      item_number: 1,
      title: 'Bedtime story',
      audio_url: `${CDN}/${AUDIO_KEY}`,
      audio_size_bytes: BigInt(2048),
      image_url: `${CDN}/${IMAGE_KEY}`,
    },
    {
      id: BigInt(102),
      item_number: 2,
      title: 'Lullaby',
      audio_url: `${CDN}/customcard_kid42/audio-2.mp3`,
      audio_size_bytes: BigInt(4096),
      image_url: null,
    },
  ];
});

// ── the picture ─────────────────────────────────────────────────────────────

describe('the picture PATCH accepts', () => {
  it('wraps the app\'s headerless frame in the LVGL header the toy reads', async () => {
    await patch({ imageFile: rawFrame() });

    const [stored] = mockUpload.uploadCustomCardImage.mock.calls[0];
    expect(stored.length).toBe(LVGL_FRAME_BYTES);
    expect(stored[0]).toBe(0x19);                    // LVGL v9 magic
    expect(stored[1]).toBe(0x12);                    // LV_COLOR_FORMAT_RGB565
    expect(stored.readUInt16LE(4)).toBe(296);
    expect(stored.readUInt16LE(6)).toBe(240);
    // The pixels are the parent's, byte for byte. Nothing decoded, scaled or
    // re-encoded them on the way through.
    expect(stored.subarray(12)).toEqual(Buffer.alloc(RAW_FRAME_BYTES, 0xa5));
  });

  it('stores an already-wrapped frame untouched', async () => {
    const frame = lvglFrame();
    await patch({ imageFile: frame });

    expect(mockUpload.uploadCustomCardImage.mock.calls[0][0]).toEqual(frame.buffer);
  });

  it('never reaches the converter', async () => {
    // toLvglRgb565Bin throws in this file. A picture arriving at ffmpeg would be
    // a raw framebuffer being decoded as if it were a picture file.
    await expect(patch({ imageFile: rawFrame() })).resolves.toBeDefined();
  });

  it.each([
    ['one byte short', RAW_FRAME_BYTES - 1],
    ['one byte long', RAW_FRAME_BYTES + 1],
    ['a truncated upload', 4096],
  ])('refuses %s in words a parent can act on', async (_label, size) => {
    await expect(patch({ imageFile: { buffer: Buffer.alloc(size), originalname: 'p.bin' } }))
      .rejects.toThrow('That picture is not the right size for the toy\'s screen. Please choose it again.');
    expect(mockUpload.uploadCustomCardImage).not.toHaveBeenCalled();
  });

  it('refuses a picture and a clear in the same request', async () => {
    await expect(patch({ imageFile: rawFrame(), clearImage: true }))
      .rejects.toThrow('Send either a new picture or a request to remove it, not both.');
    expect(mockPrisma.content_item.update).not.toHaveBeenCalled();
  });

  it('is not fooled by the .bin extension — the length is the whole test', async () => {
    // §12.3: the extension check must not be what decides. A frame named
    // anything at all is still a frame.
    await expect(patch({ imageFile: { buffer: Buffer.alloc(RAW_FRAME_BYTES), originalname: 'no-extension' } }))
      .resolves.toBeDefined();
  });
});

// ── what each field does ────────────────────────────────────────────────────

describe('a title-only edit', () => {
  it('changes the title and nothing else', async () => {
    const card = await patch({ title: 'Goodnight moon' });

    expect(itemOne().title).toBe('Goodnight moon');
    expect(itemOne().audio_url).toBe(`${CDN}/${AUDIO_KEY}`);
    expect(itemOne().image_url).toBe(`${CDN}/${IMAGE_KEY}`);
    expect(mockUpload.uploadCustomCardAudio).not.toHaveBeenCalled();
    expect(mockUpload.uploadCustomCardImage).not.toHaveBeenCalled();
    expect(card.contentPack.items[0].title).toBe('Goodnight moon');
  });

  it('trims it, and refuses one too long to show', async () => {
    await patch({ title: '  Goodnight moon  ' });
    expect(itemOne().title).toBe('Goodnight moon');

    await expect(patch({ title: 'x'.repeat(customCardService.MAX_TITLE_CHARS + 1) }))
      .rejects.toThrow(`That name is too long. Please keep it under ${customCardService.MAX_TITLE_CHARS} characters.`);
  });

  it('treats an empty title as clear-to-fallback, not as an error', async () => {
    // The detail screen lets a parent wipe the field; that means "use the
    // default name again", not "reject my save".
    await patch({ title: '   ' });
    expect(itemOne().title).toBe('Recording 1');
  });

  it('falls back to the name of a recording sent in the same request', async () => {
    await patch({ title: '', audioFile: MP3('grandma-singing.mp3') });
    expect(itemOne().title).toBe('grandma-singing.mp3');
  });
});

describe('an audio-only edit', () => {
  it('overwrites the recording in place, so fileUrl is unchanged', async () => {
    const before = itemOne().audio_url;

    const card = await patch({ audioFile: MP3() });

    expect(itemOne().audio_url).toBe(before);
    expect(card.contentPack.items[0].fileUrl).toBe(before);
    expect(mockUpload.uploadCustomCardAudio.mock.calls[0][4]).toEqual({ reuseKey: AUDIO_KEY });
  });

  it('records the new size and leaves the title alone', async () => {
    await patch({ audioFile: MP3('some-other-name.mp3') });

    expect(Number(itemOne().audio_size_bytes)).toBe(MP3().buffer.length);
    // The parent owns the title now. Replacing the audio must not silently
    // rename the recording after the file that happened to carry it.
    expect(itemOne().title).toBe('Bedtime story');
  });

  it('retires the old recording when the format changes the key', async () => {
    await patch({ audioFile: WAV() });

    expect(itemOne().audio_url).toBe(`${CDN}/customcard_kid42/audio-2.wav`);
    expect(mockUpload.deleteCustomCardObject).toHaveBeenCalledWith(AUDIO_KEY);
  });

  it('runs the same validator the legacy replace route does', async () => {
    await expect(patch({ audioFile: { buffer: Buffer.from('not audio at all'), originalname: 'a.mp3' } }))
      .rejects.toThrow('That file does not look like a valid MP3 or WAV recording.');
    await expect(patch({ audioFile: { buffer: Buffer.alloc(11 * 1024 * 1024), originalname: 'a.mp3' } }))
      .rejects.toThrow('That recording is larger than 10 MB. Please choose a shorter one.');
  });
});

describe('an image-only edit', () => {
  it('overwrites the picture in place, so imageUrl is unchanged', async () => {
    const before = itemOne().image_url;

    const card = await patch({ imageFile: rawFrame() });

    expect(itemOne().image_url).toBe(before);
    expect(card.contentPack.items[0].imageUrl).toBe(before);
    expect(mockUpload.uploadCustomCardImage.mock.calls[0][2]).toEqual({ reuseKey: IMAGE_KEY });
    // Nothing to sweep: the object it replaced is the object it wrote.
    expect(mockUpload.deleteCustomCardObject).not.toHaveBeenCalled();
  });

  it('takes a new key for a recording that had no picture', async () => {
    const card = await patch({ imageFile: rawFrame() }, 2);

    expect(items[1].image_url).toBe(`${CDN}/customcard_kid42/image-2.bin`);
    expect(card.contentPack.items[1].imageUrl).toBe(`${CDN}/customcard_kid42/image-2.bin`);
  });

  it('moves the content hash even though every URL stayed the same', async () => {
    // This is the trap the stable-URL decision sets. Two edits to the same
    // recording write different pixels to the same key, so every field the hash
    // used to be built from — item number, audio url, image url, title — is
    // byte-identical across them. Hashing those alone would answer
    // card_up_to_date for a card whose picture had just changed, and the toy
    // would keep showing the old one for ever.
    await patch({ imageFile: rawFrame(0x01) });
    const first = pack.content_hash;

    await patch({ imageFile: rawFrame(0x02) });

    expect(items[0].image_url).toBe(`${CDN}/${IMAGE_KEY}`);
    expect(pack.content_hash).not.toBe(first);
  });
});

describe('packContentHash', () => {
  const ITEMS = [{ itemNumber: 1, audioUrl: 'a', imageUrl: 'i', title: 't' }];

  it('separates two versions of an identical item set', () => {
    expect(customCardService.packContentHash(ITEMS, '5'))
      .not.toBe(customCardService.packContentHash(ITEMS, '6'));
  });

  it('separates a retitled item at the same version', () => {
    expect(customCardService.packContentHash(ITEMS, '5'))
      .not.toBe(customCardService.packContentHash([{ ...ITEMS[0], title: 'other' }], '5'));
  });

  it('is stable for the same input', () => {
    expect(customCardService.packContentHash(ITEMS, '5'))
      .toBe(customCardService.packContentHash([{ ...ITEMS[0] }], '5'));
  });
});

describe('clearImage', () => {
  it('sets imageUrl to null — never an empty string — and sweeps the object', async () => {
    const card = await patch({ clearImage: true });

    expect(itemOne().image_url).toBeNull();
    // An empty string reaches the app as a url and renders as a broken picture
    // on a recording that deliberately has none.
    expect(card.contentPack.items[0].imageUrl).toBeNull();
    expect(mockUpload.deleteCustomCardObject).toHaveBeenCalledWith(IMAGE_KEY);
  });

  it('leaves the recording and the title alone', async () => {
    await patch({ clearImage: true });
    expect(itemOne().audio_url).toBe(`${CDN}/${AUDIO_KEY}`);
    expect(itemOne().title).toBe('Bedtime story');
  });
});

// ── version ─────────────────────────────────────────────────────────────────

describe('the version', () => {
  it.each([
    ['a title', { title: 'New name' }],
    ['audio', { audioFile: MP3() }],
    ['a picture', { imageFile: rawFrame() }],
    ['a cleared picture', { clearImage: true }],
  ])('moves when the save changes %s', async (_label, changes) => {
    const card = await patch(changes);

    expect(pack.version).toBe('5');
    expect(card.contentPack.version).toBe('5');
  });

  it('moves exactly once when all three change together', async () => {
    // Three fields, three writes, one bump — a card that re-downloaded three
    // times for one save would look like a device bug.
    const card = await patch({ title: 'All three', audioFile: MP3(), imageFile: rawFrame() });

    expect(card.contentPack.version).toBe('5');
    expect(mockPrisma.rfid_content_pack.update).toHaveBeenCalledTimes(1);
  });

  it('reports the save\'s own timestamp, not the one from before it', async () => {
    // The response is built from the row the write returned. Echoing the copy
    // read at the top of the request would show the parent a save time from
    // before their save.
    const card = await patch({ title: 'Freshly saved' });

    expect(card.contentPack.updatedAt).not.toEqual(PACK_CREATED);
    expect(card.contentPack.updatedAt.getTime()).toBeGreaterThan(PACK_CREATED.getTime());
  });

  it('is a monotonic integer serialised as a string', async () => {
    await patch({ title: 'a' });
    expect(pack.version).toBe('5');
    await patch({ title: 'b' });
    expect(pack.version).toBe('6');
    expect(typeof pack.version).toBe('string');
  });

  it('does not move for a request that writes nothing', async () => {
    const card = await patch({});

    expect(pack.version).toBe('4');
    expect(card.contentPack.version).toBe('4');
    expect(mockPrisma.content_item.update).not.toHaveBeenCalled();
  });
});

// ── identity ────────────────────────────────────────────────────────────────

describe('item identity', () => {
  it('updates the row by its own id rather than deleting and reinserting it', async () => {
    await patch({ title: 'Renamed' });

    expect(mockPrisma.content_item.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BigInt(101) } })
    );
  });

  it('leaves id, item_number, the rest of the pack and create_date untouched', async () => {
    await patch({ title: 'Renamed', audioFile: MP3(), imageFile: rawFrame() });

    expect(items[0].id).toBe(BigInt(101));
    expect(items[0].item_number).toBe(1);
    expect(items[1]).toEqual(expect.objectContaining({
      id: BigInt(102), item_number: 2, title: 'Lullaby', image_url: null,
    }));
    expect(pack.create_date).toBe(PACK_CREATED);
    expect(pack.update_date).not.toBe(PACK_CREATED);
  });
});

// ── concurrency ─────────────────────────────────────────────────────────────

describe('If-Match', () => {
  it('writes when the version matches', async () => {
    const card = await patch({ title: 'Fenced', ifMatch: '4' });
    expect(card.contentPack.version).toBe('5');
  });

  it('writes unconditionally when the header is absent', async () => {
    // Load-bearing, not a fallback: the legacy endpoints live for ever and none
    // of them sends one.
    const card = await patch({ title: 'Unfenced', ifMatch: null });
    expect(card.contentPack.version).toBe('5');
  });

  it('accepts * as "whatever the card is on now"', async () => {
    await expect(patch({ title: 'Any', ifMatch: '*' })).resolves.toBeDefined();
  });

  it('refuses a stale version, writes nothing, and hands back the current card', async () => {
    const error = await patch({ title: 'Late', ifMatch: '3' }).catch((e) => e);

    expect(error.statusCode).toBe(412);
    expect(error.message).toBe('Someone else updated this card. Here is the latest version.');
    expect(error.data.contentPack.version).toBe('4');
    expect(error.data.contentPack.items[0].title).toBe('Bedtime story');
    expect(pack.version).toBe('4');
    expect(mockPrisma.content_item.update).not.toHaveBeenCalled();
    expect(mockUpload.uploadCustomCardImage).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction, so a version that moves mid-request loses', async () => {
    // The pre-check passes and the S3 write happens; the row is only saved by
    // the comparison made at write time. Checking once, up front, would let this
    // through and lose the other parent's edit.
    mockPrisma.rfid_content_pack.findUnique.mockImplementationOnce(async () => ({ version: '9' }));

    const error = await patch({ imageFile: rawFrame(), ifMatch: '4' }).catch((e) => e);

    expect(error.statusCode).toBe(412);
    expect(mockPrisma.content_item.update).not.toHaveBeenCalled();
  });
});

describe('parseIfMatch', () => {
  it.each([
    ['a quoted strong tag', '"42"', '42'],
    ['a weak tag', 'W/"42"', '42'],
    ['a bare value', '42', '42'],
    ['a wildcard', '*', '*'],
    ['nothing', undefined, null],
    ['an empty header', '  ', null],
  ])('reads %s', (_label, header, expected) => {
    expect(customCardService.parseIfMatch(header)).toBe(expected);
  });
});

// ── who may edit what ───────────────────────────────────────────────────────

describe('the 404 vocabulary', () => {
  it('answers "no such child" for another parent\'s kid, without touching storage', async () => {
    await expect(customCardService.patchCustomCardItem(USER_ID, KID_ID + 1, 1, { title: 'x' }))
      .rejects.toThrow('That child could not be found.');
    expect(mockUpload.uploadCustomCardImage).not.toHaveBeenCalled();
  });

  it('answers "no such recording" for an item number off the end', async () => {
    await expect(patch({ title: 'x' }, 9))
      .rejects.toThrow('That recording could not be found on this card.');
  });

  it('answers "no content" for a child with no pack', async () => {
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValueOnce(null);
    await expect(patch({ title: 'x' }))
      .rejects.toThrow('This child has no custom card content.');
  });
});
