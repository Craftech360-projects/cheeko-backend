/**
 * Custom Card Service
 *
 * Parent-uploaded audio for a device's custom RFID cards.
 *
 * Ownership model: a custom pack belongs to a *device*, not a kid or a card.
 * `custom_card` is a flat allowlist of issued custom-card UIDs with no device
 * binding — tapping any issued custom card on a toy plays that toy's own pack.
 * The parent proves ownership of the MAC, never of the card.
 *
 * Storage model: the audio is a normal `rfid_content_pack` (pack_code
 * CUSTOM_<MAC>) holding a single `content_item`, so the tap handshake, the
 * download manifest and the ESP32 download path are the stock content-card ones
 * — there is no second content path to maintain.
 */

const { createHash } = require('crypto');
const { prisma } = require('../config/database');
const uploadService = require('./upload.service');
const rfidService = require('./rfid.service');
const { normalizeMacAddress, packCodeForMac } = require('../utils/helpers');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, matches the client-side check

// Same ceiling as a catalogue content pack.
const MAX_ITEMS = 10;

// Extension -> the MIME type we persist. The client sends audio/mpeg for .mp3 and
// audio/wav for .wav, but the header is attacker-controlled so extension and
// sniffed magic bytes both have to agree before we accept the file.
const ALLOWED_AUDIO = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

/**
 * Identify audio format from magic bytes.
 * MP3: an ID3v2 tag ("ID3") or a raw MPEG frame sync (11 bits set).
 * WAV: RIFF....WAVE container.
 * @returns {'.mp3'|'.wav'|null}
 */
const sniffAudioExtension = (buffer) => {
  if (!buffer || buffer.length < 12) return null;

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    return '.wav';
  }
  if (buffer.toString('ascii', 0, 3) === 'ID3') return '.mp3';
  // Raw MPEG audio frame: 0xFF followed by 0xEx/0xFx (sync bits + MPEG-1/2 layer).
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return '.mp3';

  return null;
};

const extensionOf = (name) => {
  const dot = (name || '').lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

/**
 * Validate an uploaded audio file server-side. The client checks are a
 * convenience, not a control — this is the enforcing copy.
 *
 * The extension is read from the multipart part's filename, falling back to the
 * `title` field. Flutter's MultipartFile.fromBytes() omits the filename unless
 * one is passed explicitly, and without the fallback a perfectly valid MP3 would
 * be rejected as an unsupported type. The sniffed magic bytes below are the
 * actual control, so taking the name from either source loses nothing.
 *
 * @returns {{ext: string, mimeType: string}}
 * @throws {ApiError} with a human-readable message for the app's error mapper
 */
const validateAudioUpload = (file, fallbackName) => {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ApiError('The audio file is empty. Please choose a different recording.', 400);
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError('That recording is larger than 10 MB. Please choose a shorter one.', 400);
  }

  const ext = extensionOf(file.originalname) || extensionOf(fallbackName);
  if (!ALLOWED_AUDIO[ext]) {
    throw new ApiError('Only MP3 and WAV recordings are supported.', 400);
  }

  const sniffed = sniffAudioExtension(file.buffer);
  if (!sniffed) {
    throw new ApiError('That file does not look like a valid MP3 or WAV recording.', 400);
  }
  if (sniffed !== ext) {
    throw new ApiError(`The file contents do not match its ${ext} extension.`, 400);
  }

  return { ext, mimeType: ALLOWED_AUDIO[ext] };
};

/**
 * Verify the device belongs to the authenticated parent.
 * Answers "not found" rather than "forbidden" so the endpoint cannot be used to
 * probe which MACs are registered to other parents.
 * @returns {Promise<Object>} the ai_device row
 */
const assertDeviceOwnedByUser = async (userId, mac) => {
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) {
    throw new ApiError('That device address is not valid.', 400);
  }

  const device = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac, user_id: BigInt(userId) },
    select: { id: true, mac_address: true, alias: true, kid_id: true }
  });
  if (!device) {
    throw new ApiError('That device could not be found.', 404);
  }
  return device;
};

const findPackForMac = (mac) =>
  prisma.rfid_content_pack.findFirst({ where: { pack_code: packCodeForMac(mac) } });

/**
 * Shape a device's pack into the response the Flutter app renders.
 * contentPack is null when nothing has been uploaded yet — not an error.
 * `items` is the full list; `fileUrl`/`fileName` mirror the first item so a
 * client written against the single-recording shape keeps working.
 */
const serializePack = (device, pack, items = []) => {
  const first = items[0] || null;

  return {
    macAddress: device.mac_address,
    deviceAlias: device.alias || null,
    maxItems: MAX_ITEMS,
    contentPack: pack
      ? {
        id: String(pack.id),
        packCode: pack.pack_code,
        macAddress: device.mac_address,
        title: first?.title || pack.name,
        fileName: first?.title || null,
        // Public CloudFront URL — the same one the toy downloads, so what the
        // parent previews is exactly what plays.
        fileUrl: first?.audio_url || null,
        mimeType: null,
        sizeBytes: first?.audio_size_bytes ? Number(first.audio_size_bytes) : null,
        durationSeconds: null,
        version: pack.version,
        updatedAt: pack.update_date,
        totalItems: items.length,
        items: items.map((item) => ({
          itemNumber: item.item_number,
          title: item.title,
          fileUrl: item.audio_url,
          sizeBytes: item.audio_size_bytes ? Number(item.audio_size_bytes) : null
        }))
      }
      : null
  };
};

// Columns are listed explicitly because deployed databases lag the Prisma model
// (story_number / story_title are absent on some), and an unqualified query
// selects every model column and dies on whichever one is missing.
const CONTENT_ITEM_FIELDS = {
  id: true,
  item_number: true,
  title: true,
  audio_url: true,
  audio_size_bytes: true
};

const loadPackItems = (packId) =>
  prisma.content_item.findMany({
    where: { content_pack_id: packId },
    orderBy: { item_number: 'asc' },
    select: CONTENT_ITEM_FIELDS
  });

// The stored URL is <publicBase>/<key>; strip scheme + host to recover the key.
const keyFromUrl = (url) => (url ? String(url).split('/').slice(3).join('/') : null);

/**
 * Delete storage objects for items that are no longer in the pack.
 *
 * Runs AFTER the DB write, never before: if storage went first and the write
 * then failed, rows would point at objects that no longer exist and the card
 * would go silent with nothing on the server to explain why. An orphaned object
 * is the cheaper failure.
 *
 * deleteCustomCardAudio ignores keys outside the customcard prefix, which is
 * what stops a pack that somehow references catalogue audio from deleting it.
 */
const deleteOrphanedAudio = async (before, keptUrls) => {
  for (const item of before) {
    if (item.audio_url && !keptUrls.has(item.audio_url)) {
      await uploadService.deleteCustomCardAudio(keyFromUrl(item.audio_url));
    }
  }
};

/**
 * GET the device's custom pack.
 * @returns {Promise<Object>} always shaped; contentPack is null before first upload
 */
const getCustomCardForDevice = async (userId, mac) => {
  const device = await assertDeviceOwnedByUser(userId, mac);
  const pack = await findPackForMac(device.mac_address);
  const items = pack ? await loadPackItems(pack.id) : [];
  return serializePack(device, pack, items);
};

/**
 * Ensure the device has a pack row, creating an empty one on first use.
 * Item writes go through rfidService.updateContentPack from here on, so this
 * only has to establish the pack itself.
 */
const ensurePackForDevice = async (device, userId) => {
  const packCode = packCodeForMac(device.mac_address);

  return prisma.rfid_content_pack.upsert({
    where: { pack_code: packCode },
    create: {
      pack_code: packCode,
      name: device.alias ? `${device.alias} — Custom Card` : 'Custom Card',
      content_type: 'rfidcontent',
      total_items: 0,
      version: '0',
      active: true,
      creator: BigInt(userId)
    },
    update: {}
  });
};

/**
 * Write a new item set for the device's pack, then clean up storage.
 *
 * The DB write is delegated to rfidService.updateContentPack — the same function
 * the dashboard's content pack editor uses — so item ordering, total_items and
 * the optional-column handling live in one place. What it does not do is touch
 * storage, so the orphan sweep is ours.
 *
 * Version and hash move on every write. The toy compares hash first and falls
 * back to version, so both have to change or it keeps playing its cached copy.
 */
const writePackItems = async (device, pack, items, userId) => {
  const before = await loadPackItems(pack.id);
  const nextVersion = String(Number(pack.version || 0) + 1);
  // Hash covers the whole set, so adding, removing or reordering all register as
  // a change — not just a different first recording.
  const contentHash = createHash('sha256')
    .update(items.map((item) => `${item.itemNumber}:${item.audioUrl}`).join('|'))
    .digest('hex');

  await rfidService.updateContentPack({
    id: Number(pack.id),
    items,
    version: nextVersion,
    contentHash,
    active: true
  }, userId);

  await deleteOrphanedAudio(before, new Set(items.map((item) => item.audioUrl)));

  const saved = await prisma.rfid_content_pack.findFirst({ where: { id: pack.id } });
  const savedItems = await loadPackItems(pack.id);

  logger.info(
    `[CUSTOM-CARD] Wrote ${savedItems.length} item(s) for mac=${device.mac_address}: pack_code=${pack.pack_code}, version=${nextVersion}`
  );

  return serializePack(device, saved, savedItems);
};

const toItemPayload = (item) => ({
  itemNumber: item.item_number,
  title: item.title,
  audioUrl: item.audio_url,
  audioSizeBytes: item.audio_size_bytes ? Number(item.audio_size_bytes) : null
});

/**
 * Add one or more recordings to the device's custom card.
 *
 * Appends rather than replaces: a parent building a card up over several
 * sessions must not lose what is already on it. Capped at MAX_ITEMS, and an
 * over-cap request is rejected whole rather than partially applied — a silently
 * truncated upload reads as a bug from the app.
 *
 * @param {Array|Object} files - multer file object(s)
 */
const addCustomCardContent = async (userId, mac, files, { title } = {}) => {
  const uploads = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (uploads.length === 0) {
    throw new ApiError('Please choose a recording to upload.', 400);
  }

  const device = await assertDeviceOwnedByUser(userId, mac);
  // Validate every file before uploading any, so a bad third file cannot leave
  // the first two sitting in storage.
  const validated = uploads.map((file) => ({ file, ...validateAudioUpload(file, title) }));

  const pack = await ensurePackForDevice(device, userId);
  const existing = await loadPackItems(pack.id);

  if (existing.length + validated.length > MAX_ITEMS) {
    throw new ApiError(
      `This card holds up to ${MAX_ITEMS} recordings. It already has ${existing.length}, so ${validated.length} more will not fit — remove one first.`,
      400
    );
  }

  const appended = [];
  for (const [index, entry] of validated.entries()) {
    const { url } = await uploadService.uploadCustomCardAudio(
      entry.file.buffer,
      device.mac_address,
      entry.file.originalname || `recording${entry.ext}`,
      entry.mimeType
    );

    const itemNumber = existing.length + index + 1;
    appended.push({
      itemNumber,
      title: entry.file.originalname || title || `Recording ${itemNumber}`,
      audioUrl: url,
      audioSizeBytes: entry.file.buffer.length
    });
  }

  return writePackItems(device, pack, [...existing.map(toItemPayload), ...appended], userId);
};

/**
 * Swap the audio at one position, leaving the rest of the card alone.
 *
 * Distinct from delete-then-add: that appends, so fixing recording 2 of 3 would
 * silently move it to position 3 and reorder the card under the parent. Here the
 * item number is preserved and only that slot's audio changes. The old object is
 * removed by the orphan sweep in writePackItems.
 */
const replaceCustomCardItem = async (userId, mac, itemNumber, file, { title } = {}) => {
  if (!file) {
    throw new ApiError('Please choose a recording to upload.', 400);
  }

  const device = await assertDeviceOwnedByUser(userId, mac);
  const { ext, mimeType } = validateAudioUpload(file, title);

  const pack = await findPackForMac(device.mac_address);
  if (!pack) {
    throw new ApiError('This device has no custom card content.', 404);
  }

  const existing = await loadPackItems(pack.id);
  const target = existing.find((item) => item.item_number === Number(itemNumber));
  if (!target) {
    throw new ApiError('That recording could not be found on this card.', 404);
  }

  const { url } = await uploadService.uploadCustomCardAudio(
    file.buffer,
    device.mac_address,
    file.originalname || `recording${ext}`,
    mimeType
  );

  const items = existing.map((item) => (
    item.item_number === Number(itemNumber)
      ? {
        itemNumber: item.item_number,
        title: file.originalname || title || item.title,
        audioUrl: url,
        audioSizeBytes: file.buffer.length
      }
      : toItemPayload(item)
  ));

  return writePackItems(device, pack, items, userId);
};

/**
 * Remove one recording from the device's card, and its object from storage.
 * Survivors are renumbered so item_number stays contiguous — the toy selects by
 * sequence, and a gap would have it ask for an item that is not there.
 */
const deleteCustomCardItem = async (userId, mac, itemNumber) => {
  const device = await assertDeviceOwnedByUser(userId, mac);
  const pack = await findPackForMac(device.mac_address);
  if (!pack) {
    throw new ApiError('This device has no custom card content.', 404);
  }

  const existing = await loadPackItems(pack.id);
  const target = existing.find((item) => item.item_number === Number(itemNumber));
  if (!target) {
    throw new ApiError('That recording could not be found on this card.', 404);
  }

  const items = existing
    .filter((item) => item.item_number !== Number(itemNumber))
    .map((item, index) => ({ ...toItemPayload(item), itemNumber: index + 1 }));

  return writePackItems(device, pack, items, userId);
};

module.exports = {
  getCustomCardForDevice,
  addCustomCardContent,
  replaceCustomCardItem,
  deleteCustomCardItem,
  MAX_ITEMS,
  // exported for tests
  validateAudioUpload,
  sniffAudioExtension,
  MAX_UPLOAD_BYTES
};
