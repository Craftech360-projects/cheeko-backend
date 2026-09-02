/**
 * Custom Card Service
 *
 * Parent-uploaded audio for a child's custom RFID cards.
 *
 * Ownership model: a custom pack belongs to a *child*, not a toy or a card, so
 * the recordings follow the child to a new toy and a toy handed to a sibling
 * never plays them. `custom_card` is a flat allowlist of issued custom-card
 * UIDs with no child binding — tapping any issued custom card on a toy plays
 * the pack of the child paired to it, and nothing at all if it is unpaired. The
 * parent proves ownership of the child, never of the card.
 *
 * Storage model: the audio is a normal `rfid_content_pack` (pack_code
 * CUSTOM_KID_<kidId>) holding a single `content_item`, so the tap handshake, the
 * download manifest and the ESP32 download path are the stock content-card ones
 * — there is no second content path to maintain.
 */

const { createHash } = require('crypto');
const { prisma } = require('../config/database');
const uploadService = require('./upload.service');
const rfidService = require('./rfid.service');
const { packCodeForKid } = require('../utils/helpers');
const { toLvglRgb565Bin, toDeviceFrame, RAW_FRAME_BYTES, LVGL_FRAME_BYTES } = require('../utils/lvglImage');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, matches the client-side check

// Pictures are far smaller than recordings, and every one of them is decoded by
// an ffmpeg subprocess, so the ceiling is lower than the audio one.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// A second ceiling, on the canvas rather than the file, because the two are only
// loosely related: zlib will expand 5 MB of flat-colour PNG into gigabytes, and
// the decoder allocates the whole frame before anything is scaled down. 40 MP is
// far above any photograph that fits in 5 MB, and puts the worst case at roughly
// 160 MB of RGBA per conversion — bounded in turn by the concurrency gate in
// lvglImage.
const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;

// Same ceiling as a catalogue content pack.
const MAX_ITEMS = 10;

// A title is a line under a picture on a phone, and the column is VARCHAR(255).
const MAX_TITLE_CHARS = 80;

// Extension -> the MIME type we persist. The client sends audio/mpeg for .mp3 and
// audio/wav for .wav, but the header is attacker-controlled so extension and
// sniffed magic bytes both have to agree before we accept the file.
const ALLOWED_AUDIO = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

// The formats a parent's phone actually produces. Whatever arrives is converted
// to an LVGL binary before it reaches storage, so this list bounds what we are
// willing to decode, not what the toy can render.
const ALLOWED_IMAGE = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
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
 * Identify a picture from its magic bytes.
 * PNG: the 8-byte signature. JPEG: SOI followed by the first marker.
 * @returns {'.png'|'.jpg'|null}
 */
const sniffImageExtension = (buffer) => {
  if (!buffer || buffer.length < 8) return null;

  if (buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';

  return null;
};

/**
 * A JPEG's dimensions, read by walking the marker segments to the frame header.
 *
 * Everything before SOS is a marker with a big-endian length, so the walk is a
 * hop from one to the next until an SOFn turns up; SOFn carries precision, then
 * height, then width. Null once entropy-coded data starts, or if the file runs
 * out first — a JPEG whose frame header we cannot find is one ffmpeg will not
 * decode either.
 */
const jpegDimensions = (buffer) => {
  let offset = 2; // past SOI

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;

    const marker = buffer[offset + 1];
    // Fill bytes, and the standalone markers that carry no payload.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Start of scan: the compressed data begins, and marker walking ends.
    if (marker === 0xda) return null;

    // SOF0..SOF15, minus the three markers that share the range but are not
    // frame headers: DHT (c4), JPG (c8) and DAC (cc).
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > buffer.length) return null;
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }

  return null;
};

/**
 * The picture's dimensions as its own header declares them, or null when they
 * cannot be read. Cheap — no decoder involved, which is the whole point: this
 * has to run before anything allocates a frame.
 *
 * PNG's IHDR is mandated to be the first chunk, so its width and height sit at
 * fixed offsets.
 */
const imageDimensions = (buffer, sniffed) => {
  if (sniffed === '.png') {
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (sniffed === '.jpg') return jpegDimensions(buffer);
  return null;
};

/**
 * Validate an uploaded picture. Same shape as validateAudioUpload: size, then
 * magic bytes, then agreement with the extension.
 *
 * The order differs in one way — the sniff comes first and the extension is
 * only a cross-check, because it is optional. Flutter's MultipartFile.fromBytes()
 * sends no filename unless one is passed explicitly, and rejecting a perfectly
 * good PNG for having no name is the bug the audio validator already had to work
 * around with its `fallbackName`. The magic bytes are the control either way.
 *
 * @returns {{ext: string, mimeType: string}}
 * @throws {ApiError} with a human-readable message for the app's error mapper
 */
const validateImageUpload = (file) => {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ApiError('That picture is empty. Please choose a different one.', 400);
  }
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError('That picture is larger than 5 MB. Please choose a smaller one.', 400);
  }

  const sniffed = sniffImageExtension(file.buffer);

  // A current app build fits the picture to the panel itself and uploads the
  // packed frame, so there is nothing here to decode, sniff or name-check: the
  // length is the whole test. Deliberately tried only after the PNG/JPEG sniff,
  // so a photograph that happens to be exactly frame-length is still read as a
  // photograph. `.bin` needs no place on the extension allowlist because the
  // extension is never consulted on this branch (spec §12.3).
  if (!sniffed) {
    const frame = toDeviceFrame(file.buffer);
    if (frame) return { kind: 'frame', frame, ext: '.bin', mimeType: 'application/octet-stream' };
    throw new ApiError('Only PNG and JPEG pictures are supported.', 400);
  }

  const ext = extensionOf(file.originalname);
  if (ext && !ALLOWED_IMAGE[ext]) {
    throw new ApiError('Only PNG and JPEG pictures are supported.', 400);
  }
  // Compared by MIME type so .jpeg and .jpg both agree with a sniffed JPEG.
  if (ext && ALLOWED_IMAGE[ext] !== ALLOWED_IMAGE[sniffed]) {
    throw new ApiError(`The file contents do not match its ${ext} extension.`, 400);
  }

  // Unreadable dimensions are let through rather than rejected: ffmpeg has to
  // find the same header we could not, so it will fail on its own, and the
  // timeout in lvglImage is the backstop.
  const size = imageDimensions(file.buffer, sniffed);
  if (size && size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new ApiError(
      `That picture is ${size.width} by ${size.height} pixels, which is too large to process. Please choose a smaller one.`,
      400
    );
  }

  return { kind: 'photo', ext: sniffed, mimeType: ALLOWED_IMAGE[sniffed] };
};

/**
 * The picture part of PATCH, which is the one place the client is guaranteed to
 * be a build that packs the frame itself. Nothing but a panel frame is accepted
 * here — a photograph would have to be fitted server-side, and the crop is the
 * parent's decision, made in the editor.
 *
 * The legacy upload paths keep taking PNG and JPEG for ever (spec §13.2); this
 * strictness is scoped to PATCH alone.
 */
const validateFrameUpload = (file) => {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ApiError('That picture is empty. Please choose a different one.', 400);
  }
  const frame = toDeviceFrame(file.buffer);
  if (!frame) {
    throw new ApiError('That picture is not the right size for the toy\'s screen. Please choose it again.', 400);
  }
  return { kind: 'frame', frame, ext: '.bin', mimeType: 'application/octet-stream' };
};

/**
 * What a title change means.
 *
 * Empty is clear-to-fallback rather than a validation error, because that is
 * what the detail screen does when a parent wipes the field. There is no
 * separate filename column, so the fallback is the name of whatever recording
 * the same request carries, and failing that the item's position.
 */
const resolveTitle = (raw, { audioFile, itemNumber }) => {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length > MAX_TITLE_CHARS) {
    throw new ApiError(`That name is too long. Please keep it under ${MAX_TITLE_CHARS} characters.`, 400);
  }
  return trimmed || audioFile?.originalname || `Recording ${itemNumber}`;
};

/**
 * Convert a validated picture into the LVGL binary the toy renders.
 *
 * Kept separate from the upload so a batch can convert everything before storing
 * anything: this is the last step that can fail cheaply, and a bad third picture
 * must not leave the first two sitting in the bucket.
 *
 * A decode failure past validation means a file whose header is honest but whose
 * body is not — a truncated PNG, say. That is the parent's file being wrong, so
 * it is a 400 in the same words as an unsupported type; anything else (ffmpeg
 * missing, timing out) is ours and stays a 500.
 */
const toDeviceImage = async (file, validated) => {
  // Already the bytes the toy renders. Converting it would mean decoding a raw
  // framebuffer as if it were a picture file, which is exactly the corruption
  // the "no server-side processing" rule exists to prevent.
  if (validated?.kind === 'frame') return validated.frame;

  try {
    return await toLvglRgb565Bin(file.buffer);
  } catch (error) {
    if (error.decodeFailed) {
      logger.warn(`[CUSTOM-CARD] Image decode failed: ${error.message}`);
      throw new ApiError('Only PNG and JPEG pictures are supported.', 400);
    }
    throw error;
  }
};

/**
 * Store a picture and return the public URL to hang on the item.
 *
 * `replacing` is the URL of the picture this one supersedes. Its key is reused
 * so `imageUrl` survives an edit unchanged, which is what lets the app cache a
 * frame and the toy hold a manifest across one. A legacy URL that is not a
 * custom-card object resolves to null and simply gets a fresh key.
 */
const uploadDeviceImage = async (bin, kidId, replacing = null) => {
  const { url } = await uploadService.uploadCustomCardImage(bin, kidId, {
    reuseKey: uploadService.customCardKeyFromUrl(replacing)
  });
  return url;
};

/**
 * Pair the multipart parts of an add request.
 *
 * A picture is matched to a recording by its field-name index — `image_2` goes
 * with the second `files` part — never by the order the parts arrive in. Part
 * ordering is not guaranteed across HTTP clients, and positional pairing would
 * silently put one recording's picture on another. `image` is the companion of
 * the single-part `file` shape.
 *
 * @param {Object} filesByField - multer's req.files
 * @returns {{uploads: Array, images: Array}} images[i] belongs to uploads[i],
 *   or is null
 */
const pairCustomCardUploads = (filesByField = {}) => {
  const many = filesByField.files || [];
  const single = filesByField.file || [];
  const lone = filesByField.image || [];

  // An image_N past the end of `files`, or a bare `image` with no `file`, is a
  // client that mis-numbered its parts. Dropping the picture silently would look
  // like the upload having worked.
  const numberedOrphan = Object.keys(filesByField).some((field) => {
    const match = /^image_(\d+)$/.exec(field);
    return match && Number(match[1]) > many.length;
  });
  if (numberedOrphan || (lone.length > 0 && single.length === 0)) {
    throw new ApiError('Each picture must go with a recording.', 400);
  }

  return {
    uploads: [...many, ...single],
    images: [
      ...many.map((_, index) => (filesByField[`image_${index + 1}`] || [])[0] || null),
      ...single.map(() => lone[0] || null)
    ]
  };
};

/**
 * Verify the child belongs to the authenticated parent.
 * Answers "not found" rather than "forbidden" so the endpoint cannot be used to
 * probe which kid ids exist.
 * @returns {Promise<Object>} the kid_profile row
 */
const assertKidOwnedByUser = async (userId, kidId) => {
  let id;
  try {
    id = BigInt(kidId);
  } catch {
    throw new ApiError('That child could not be found.', 404);
  }

  const kid = await prisma.kid_profile.findFirst({
    where: { id, user_id: BigInt(userId) },
    select: { id: true, name: true }
  });
  if (!kid) {
    throw new ApiError('That child could not be found.', 404);
  }
  return kid;
};

const findPackForKid = (kidId) =>
  prisma.rfid_content_pack.findFirst({ where: { pack_code: packCodeForKid(kidId) } });

/**
 * The toy this child's recordings will play on right now, or null when they
 * have none. Informational only — the pack is the child's either way, and the
 * app uses this to tell a parent their recordings are silent until pairing.
 */
const currentDeviceMacForKid = async (kidId) => {
  const device = await prisma.ai_device.findFirst({
    where: { kid_id: BigInt(kidId) },
    select: { mac_address: true }
  });
  return device?.mac_address || null;
};

/**
 * Shape a child's pack into the response the Flutter app renders.
 * contentPack is null when nothing has been uploaded yet — not an error.
 * `items` is the full list; `fileUrl`/`fileName` mirror the first item so a
 * client written against the single-recording shape keeps working.
 *
 * `deviceMac` is which toy this will play on, not who owns it, and is null for
 * a child with no toy paired.
 */
const serializePack = (kid, pack, items = [], deviceMac = null) => {
  const first = items[0] || null;

  return {
    kidId: String(kid.id),
    kidName: kid.name || null,
    deviceMac: deviceMac || null,
    maxItems: MAX_ITEMS,
    contentPack: pack
      ? {
        id: String(pack.id),
        packCode: pack.pack_code,
        kidId: String(kid.id),
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
          sizeBytes: item.audio_size_bytes ? Number(item.audio_size_bytes) : null,
          // null when no artwork is set. Public CloudFront URL, same rules as
          // fileUrl. Deliberately not mirrored at pack level: the pack-level
          // fields describe items[0] and predate artwork.
          imageUrl: item.image_url || null
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
  audio_size_bytes: true,
  image_url: true
};

const loadPackItems = (packId) =>
  prisma.content_item.findMany({
    where: { content_pack_id: packId },
    orderBy: { item_number: 'asc' },
    select: CONTENT_ITEM_FIELDS
  });

/**
 * Delete storage objects for items that are no longer in the pack.
 *
 * Runs AFTER the DB write, never before: if storage went first and the write
 * then failed, rows would point at objects that no longer exist and the card
 * would go silent with nothing on the server to explain why. An orphaned object
 * is the cheaper failure.
 *
 * deleteCustomCardObject ignores keys outside the customcard prefix, which is
 * what stops a pack that somehow references catalogue audio from deleting it.
 * Pictures live under the same prefix, so they are swept by the same guard.
 */
const deleteOrphanedObjects = async (before, keptUrls) => {
  for (const item of before) {
    for (const url of [item.audio_url, item.image_url]) {
      if (url && !keptUrls.has(url)) {
        await uploadService.deleteCustomCardObject(uploadService.customCardKeyFromUrl(url));
      }
    }
  }
};

/**
 * GET the child's custom pack.
 * @returns {Promise<Object>} always shaped; contentPack is null before first upload
 */
const getCustomCardForKid = async (userId, kidId) => {
  const kid = await assertKidOwnedByUser(userId, kidId);
  const pack = await findPackForKid(kid.id);
  const items = pack ? await loadPackItems(pack.id) : [];
  return serializePack(kid, pack, items, await currentDeviceMacForKid(kid.id));
};

/**
 * Ensure the child has a pack row, creating an empty one on first use.
 * Item writes go through rfidService.updateContentPack from here on, so this
 * only has to establish the pack itself.
 */
const ensurePackForKid = async (kid, userId) => {
  const packCode = packCodeForKid(kid.id);

  return prisma.rfid_content_pack.upsert({
    where: { pack_code: packCode },
    create: {
      pack_code: packCode,
      name: kid.name ? `${kid.name} — Custom Card` : 'Custom Card',
      content_type: 'rfidcontent',
      total_items: 0,
      version: '0',
      active: true,
      creator: BigInt(userId)
    },
    update: {}
  });
};

/** The next pack version: a monotonic integer, +1 per write, stored as a string. */
const nextPackVersion = (pack) => String(Number(pack.version || 0) + 1);

/**
 * The freshness token the toy compares before it re-downloads a card.
 *
 * The version is part of the input, and has to be: since an edit now overwrites
 * the bytes at the existing S3 key, a replaced picture or recording leaves every
 * URL exactly where it was. Hashing the URLs alone would answer
 * card_up_to_date for a card whose contents had just changed, and the toy would
 * keep playing its cached copy for ever. Titles are in it for the same reason —
 * they are the one field with no object behind it at all.
 */
const packContentHash = (items, version) => createHash('sha256')
  .update([
    String(version),
    ...items.map((item) => `${item.itemNumber}:${item.audioUrl}:${item.imageUrl || ''}:${item.title || ''}`)
  ].join('|'))
  .digest('hex');

/**
 * Write a new item set for the child's pack, then clean up storage.
 *
 * The DB write is delegated to rfidService.updateContentPack — the same function
 * the dashboard's content pack editor uses — so item ordering, total_items and
 * the optional-column handling live in one place. What it does not do is touch
 * storage, so the orphan sweep is ours.
 *
 * Version and hash move on every write. The toy compares hash first and falls
 * back to version, so both have to change or it keeps playing its cached copy.
 */
const writePackItems = async (kid, pack, items, userId) => {
  const before = await loadPackItems(pack.id);
  const nextVersion = nextPackVersion(pack);
  const contentHash = packContentHash(items, nextVersion);

  await rfidService.updateContentPack({
    id: Number(pack.id),
    items,
    version: nextVersion,
    contentHash,
    active: true
  }, userId);

  await deleteOrphanedObjects(
    before,
    new Set(items.flatMap((item) => [item.audioUrl, item.imageUrl]).filter(Boolean))
  );

  const saved = await prisma.rfid_content_pack.findFirst({ where: { id: pack.id } });
  const savedItems = await loadPackItems(pack.id);

  logger.info(
    `[CUSTOM-CARD] Wrote ${savedItems.length} item(s) for kid=${kid.id}: pack_code=${pack.pack_code}, version=${nextVersion}`
  );

  return serializePack(kid, saved, savedItems, await currentDeviceMacForKid(kid.id));
};

const toItemPayload = (item) => ({
  itemNumber: item.item_number,
  title: item.title,
  audioUrl: item.audio_url,
  audioSizeBytes: item.audio_size_bytes ? Number(item.audio_size_bytes) : null,
  // Always present, never undefined. updateContentPack re-matches rows by
  // item_number and falls back to the existing row's value for anything left
  // undefined, so on a renumber an absent imageUrl would graft the picture of
  // whichever item used to hold that number onto this one.
  imageUrl: item.image_url || null
});

/**
 * The child, pack and item a per-item request names, or the 404 that says which
 * of the three was missing.
 */
const loadTargetItem = async (userId, kidId, itemNumber) => {
  const kid = await assertKidOwnedByUser(userId, kidId);
  const pack = await findPackForKid(kid.id);
  if (!pack) {
    throw new ApiError('This child has no custom card content.', 404);
  }

  const existing = await loadPackItems(pack.id);
  const target = existing.find((item) => item.item_number === Number(itemNumber));
  if (!target) {
    throw new ApiError('That recording could not be found on this card.', 404);
  }

  return { kid, pack, existing, target };
};

/**
 * Add one or more recordings to the child's custom card.
 *
 * Appends rather than replaces: a parent building a card up over several
 * sessions must not lose what is already on it. Capped at MAX_ITEMS, and an
 * over-cap request is rejected whole rather than partially applied — a silently
 * truncated upload reads as a bug from the app.
 *
 * @param {Array|Object} files - multer file object(s)
 * @param {{title?: string, images?: Array}} [options] - images[i] is the
 *   optional picture for files[i], already paired by pairCustomCardUploads
 */
const addCustomCardContent = async (userId, kidId, files, { title, images = [] } = {}) => {
  const uploads = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (uploads.length === 0) {
    throw new ApiError('Please choose a recording to upload.', 400);
  }

  const kid = await assertKidOwnedByUser(userId, kidId);
  // Validate every file before uploading any, so a bad third file cannot leave
  // the first two sitting in storage.
  const validated = uploads.map((file, index) => ({
    file,
    image: images[index] || null,
    ...validateAudioUpload(file, title)
  }));
  for (const entry of validated) {
    if (entry.image) entry.imageInfo = validateImageUpload(entry.image);
  }

  const pack = await ensurePackForKid(kid, userId);
  const existing = await loadPackItems(pack.id);

  if (existing.length + validated.length > MAX_ITEMS) {
    throw new ApiError(
      `This card holds up to ${MAX_ITEMS} recordings for one child. It already has ${existing.length}, so ${validated.length} more will not fit — remove one first.`,
      400
    );
  }

  // Decode before any upload, for the same all-or-nothing reason as validation:
  // ffmpeg failing on the third picture must not leave two in the bucket.
  for (const entry of validated) {
    if (entry.image) entry.imageBin = await toDeviceImage(entry.image, entry.imageInfo);
  }

  const appended = [];
  for (const [index, entry] of validated.entries()) {
    const { url } = await uploadService.uploadCustomCardAudio(
      entry.file.buffer,
      kid.id,
      entry.file.originalname || `recording${entry.ext}`,
      entry.mimeType
    );

    const itemNumber = existing.length + index + 1;
    appended.push({
      itemNumber,
      title: entry.file.originalname || title || `Recording ${itemNumber}`,
      audioUrl: url,
      audioSizeBytes: entry.file.buffer.length,
      imageUrl: entry.imageBin ? await uploadDeviceImage(entry.imageBin, kid.id) : null
    });
  }

  return writePackItems(kid, pack, [...existing.map(toItemPayload), ...appended], userId);
};

/**
 * Swap the audio at one position, leaving the rest of the card alone.
 *
 * Distinct from delete-then-add: that appends, so fixing recording 2 of 3 would
 * silently move it to position 3 and reorder the card under the parent. Here the
 * item number is preserved and only that slot's audio changes. The old object is
 * removed by the orphan sweep in writePackItems.
 *
 * A picture may ride along, but is optional: this endpoint replaces the
 * recording, so sending no picture keeps the one already on the item rather than
 * clearing it. Artwork on its own goes through setCustomCardItemImage.
 */
const replaceCustomCardItem = async (userId, kidId, itemNumber, file, { title, image } = {}) => {
  if (!file) {
    throw new ApiError('Please choose a recording to upload.', 400);
  }

  const { kid, pack, existing, target } = await loadTargetItem(userId, kidId, itemNumber);

  const { ext, mimeType } = validateAudioUpload(file, title);
  const imageInfo = image ? validateImageUpload(image) : null;

  const imageBin = image ? await toDeviceImage(image, imageInfo) : null;

  // Both objects overwrite the ones they replace, so fileUrl and imageUrl come
  // back from an edit unchanged — see uploadCustomCardAudio for the one case
  // that cannot be honoured (a recording changing format).
  const { url } = await uploadService.uploadCustomCardAudio(
    file.buffer,
    kid.id,
    file.originalname || `recording${ext}`,
    mimeType,
    { reuseKey: uploadService.customCardKeyFromUrl(target.audio_url) }
  );
  const imageUrl = imageBin ? await uploadDeviceImage(imageBin, kid.id, target.image_url) : null;

  const items = existing.map((item) => (
    item.item_number === Number(itemNumber)
      ? {
        itemNumber: item.item_number,
        title: file.originalname || title || item.title,
        audioUrl: url,
        audioSizeBytes: file.buffer.length,
        imageUrl: imageUrl || item.image_url || null
      }
      : toItemPayload(item)
  ));

  return writePackItems(kid, pack, items, userId);
};

/**
 * Set one item's artwork without touching its recording.
 *
 * Goes through writePackItems like every other write, so the version bump, the
 * content hash and the sweep of the picture it replaces all happen in one place.
 */
const setCustomCardItemImage = async (userId, kidId, itemNumber, file) => {
  if (!file) {
    throw new ApiError('Please choose a picture to upload.', 400);
  }

  const { kid, pack, existing, target } = await loadTargetItem(userId, kidId, itemNumber);
  const imageInfo = validateImageUpload(file);

  const imageUrl = await uploadDeviceImage(
    await toDeviceImage(file, imageInfo), kid.id, target.image_url
  );

  const items = existing.map((item) => (
    item.item_number === Number(itemNumber)
      ? { ...toItemPayload(item), imageUrl }
      : toItemPayload(item)
  ));

  return writePackItems(kid, pack, items, userId);
};

/**
 * Clear one item's artwork, keeping the recording. Idempotent — an item with no
 * picture is not an error, it is already in the state being asked for.
 */
const clearCustomCardItemImage = async (userId, kidId, itemNumber) => {
  const { kid, pack, existing } = await loadTargetItem(userId, kidId, itemNumber);

  const items = existing.map((item) => (
    item.item_number === Number(itemNumber)
      ? { ...toItemPayload(item), imageUrl: null }
      : toItemPayload(item)
  ));

  return writePackItems(kid, pack, items, userId);
};

/**
 * Remove one recording from the child's card, and its object from storage.
 * Survivors are renumbered so item_number stays contiguous — the toy selects by
 * sequence, and a gap would have it ask for an item that is not there.
 *
 * The renumbering is why an itemNumber is only valid against the list it came
 * from: every mutating endpoint returns the complete current card, and a client
 * must rebuild from that response rather than reuse a number read before it.
 */
const deleteCustomCardItem = async (userId, kidId, itemNumber) => {
  const { kid, pack, existing } = await loadTargetItem(userId, kidId, itemNumber);

  const items = existing
    .filter((item) => item.item_number !== Number(itemNumber))
    .map((item, index) => ({ ...toItemPayload(item), itemNumber: index + 1 }));

  return writePackItems(kid, pack, items, userId);
};

// ── editing one recording in place ──────────────────────────────────────────

/**
 * The version a client claims to have seen, from an `If-Match` header.
 *
 * Quoting and the weak prefix are the header's syntax, not part of the value, so
 * both are stripped before comparing. `*` is HTTP's "any current representation"
 * and matches whatever the pack is on. A missing header returns null, which is
 * an unconditional write and last-write-wins — required rather than tolerated,
 * because the legacy endpoints live for ever and none of them sends one.
 */
const parseIfMatch = (header) => {
  const raw = String(header ?? '').trim();
  if (!raw) return null;
  if (raw === '*') return '*';
  return raw.replace(/^W\//i, '').replace(/^"|"$/g, '');
};

const versionMatches = (packVersion, ifMatch) =>
  ifMatch === null || ifMatch === '*' || String(packVersion ?? '0') === ifMatch;

/**
 * The tag GET offers for `If-None-Match`: a hash of the serialized card, not
 * the pack version. `deviceMac` and `kidName` are in the body and change
 * without any card write, so a version-keyed 304 kept answering "no toy paired"
 * after a toy was paired, until the next edit happened to bump the version.
 * `If-Match` on PATCH is still the version — that fences a write against the
 * pack, which is the thing being written.
 */
const cardETag = (card) => createHash('sha256').update(JSON.stringify(card)).digest('hex').slice(0, 32);

const STALE_CARD_MESSAGE = 'Someone else updated this card. Here is the latest version.';

/** The whole card as GET would answer it. */
const cardFor = async (kid, pack) => {
  const items = pack ? await loadPackItems(pack.id) : [];
  return serializePack(kid, pack, items, await currentDeviceMacForKid(kid.id));
};

/**
 * A 412 that carries the card the caller is behind on, so the app can repaint
 * from what actually happened rather than showing a generic failure.
 */
const staleVersionError = async (kid, pack) => {
  const error = new ApiError(STALE_CARD_MESSAGE, 412);
  error.stale = true;
  error.data = await cardFor(kid, pack);
  return error;
};

/**
 * Change the picture, title and audio of one recording, in one atomic request.
 *
 * Three properties this endpoint has that the legacy ones do not:
 *
 * - **Identity survives.** The row is updated by its own id, so `id`,
 *   `item_number` and the pack's `create_date` are untouched and nothing
 *   renumbers. The legacy paths rewrite the whole item set through
 *   rfidService.updateContentPack, which deletes and reinserts.
 * - **Ordering is storage first, database last.** Every validation runs before a
 *   single byte reaches S3, because the write is destructive: an object
 *   overwritten in place has taken the parent's previous picture with it, and no
 *   rollback brings it back.
 * - **`If-Match` is compared inside the write transaction.** Checking first and
 *   writing second reopens the race it exists to close; the pre-check further up
 *   is only there to fail before S3.
 *
 * @param {{title?: string, audioFile?: Object, imageFile?: Object,
 *          clearImage?: boolean, ifMatch?: string|null}} changes
 */
const patchCustomCardItem = async (userId, kidId, itemNumber, {
  title, audioFile = null, imageFile = null, clearImage = false, ifMatch = null
} = {}) => {
  if (clearImage && imageFile) {
    throw new ApiError('Send either a new picture or a request to remove it, not both.', 400);
  }

  const { kid, pack, target } = await loadTargetItem(userId, kidId, itemNumber);
  const number = Number(itemNumber);

  // ── everything that can fail, before anything is written ──────────────────
  const nextTitle = title === undefined
    ? undefined
    : resolveTitle(title, { audioFile, itemNumber: number });
  const audioInfo = audioFile ? validateAudioUpload(audioFile, title) : null;
  const frameInfo = imageFile ? validateFrameUpload(imageFile) : null;

  if (nextTitle === undefined && !audioInfo && !frameInfo && !clearImage) {
    // A request that writes nothing. Left alone deliberately: a bump here would
    // send every toy holding this card off to re-download it for no change.
    return cardFor(kid, pack);
  }

  if (!versionMatches(pack.version, ifMatch)) {
    throw await staleVersionError(kid, pack);
  }

  // ── storage ───────────────────────────────────────────────────────────────
  const data = { updater: BigInt(userId), update_date: new Date() };
  if (nextTitle !== undefined) data.title = nextTitle;

  if (audioInfo) {
    const { url } = await uploadService.uploadCustomCardAudio(
      audioFile.buffer,
      kid.id,
      audioFile.originalname || `recording${audioInfo.ext}`,
      audioInfo.mimeType,
      { reuseKey: uploadService.customCardKeyFromUrl(target.audio_url) }
    );
    data.audio_url = url;
    data.audio_size_bytes = BigInt(audioFile.buffer.length);
  }
  if (frameInfo) {
    data.image_url = await uploadDeviceImage(frameInfo.frame, kid.id, target.image_url);
  }
  if (clearImage) {
    // null, never '': an empty string reaches the app as a url and renders as a
    // broken picture on a recording that deliberately has none.
    data.image_url = null;
  }

  // ── database ──────────────────────────────────────────────────────────────
  const commit = () => prisma.$transaction(async (tx) => {
    const current = await tx.rfid_content_pack.findUnique({
      where: { id: pack.id },
      select: { version: true }
    });
    if (!versionMatches(current?.version, ifMatch)) {
      const conflict = new Error('stale');
      conflict.staleVersion = true;
      throw conflict;
    }

    const version = nextPackVersion(current || pack);
    await tx.content_item.update({ where: { id: target.id }, data });

    const items = await tx.content_item.findMany({
      where: { content_pack_id: pack.id },
      orderBy: { item_number: 'asc' },
      select: CONTENT_ITEM_FIELDS
    });

    // The updated row, not the one read at the top: the response's `updatedAt`
    // and `version` both come from it, and echoing the stale copy would have the
    // app show a save timestamp from before the save.
    return tx.rfid_content_pack.update({
      where: { id: pack.id },
      data: {
        version,
        content_hash: packContentHash(items.map(toItemPayload), version),
        total_items: items.length,
        updater: BigInt(userId),
        update_date: new Date()
      }
    });
  });

  let saved;
  try {
    saved = await commit();
  } catch (error) {
    if (error.staleVersion) throw await staleVersionError(kid, pack);

    // The bytes are already new and the row is not. Retry once; the URLs are
    // unchanged either way, so the worst surviving state is the new picture
    // under the old version — which the version bump below at least makes the
    // toy fetch. Neither is allowed to swallow the failure.
    logger.warn(`[CUSTOM-CARD] Commit failed for kid=${kid.id} item=${number}, retrying: ${error.message}`);
    try {
      saved = await commit();
    } catch (retryError) {
      if (retryError.staleVersion) throw await staleVersionError(kid, pack);
      await prisma.rfid_content_pack
        .update({ where: { id: pack.id }, data: { version: nextPackVersion(pack), update_date: new Date() } })
        .catch(() => {});
      logger.error(`[CUSTOM-CARD] Edit stored in S3 but not committed for kid=${kid.id} item=${number}: ${retryError.message}`);
      throw new ApiError('That change could not be saved. Please try again.', 500);
    }
  }

  // Post-commit, so a failed write never leaves a row pointing at an object that
  // is gone. Only a picture can be orphaned: audio either overwrites its own key
  // or changes format, and a format change retires the old recording here too.
  const retired = [
    clearImage || frameInfo ? target.image_url : null,
    data.audio_url && data.audio_url !== target.audio_url ? target.audio_url : null
  ].filter((url) => url && url !== data.image_url && url !== data.audio_url);
  for (const url of retired) {
    await uploadService.deleteCustomCardObject(uploadService.customCardKeyFromUrl(url));
  }

  logger.info(
    `[CUSTOM-CARD] Edited item ${number} for kid=${kid.id}: pack_code=${pack.pack_code}, version=${saved.version}`
  );

  return cardFor(kid, saved);
};

module.exports = {
  getCustomCardForKid,
  addCustomCardContent,
  patchCustomCardItem,
  parseIfMatch,
  cardETag,
  replaceCustomCardItem,
  deleteCustomCardItem,
  setCustomCardItemImage,
  clearCustomCardItemImage,
  pairCustomCardUploads,
  MAX_ITEMS,
  // exported for tests
  validateAudioUpload,
  validateImageUpload,
  validateFrameUpload,
  resolveTitle,
  packContentHash,
  MAX_TITLE_CHARS,
  RAW_FRAME_BYTES,
  LVGL_FRAME_BYTES,
  sniffAudioExtension,
  sniffImageExtension,
  imageDimensions,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS
};
