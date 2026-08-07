/**
 * Custom Card Service
 *
 * Parent-uploaded audio for a kid's custom RFID card.
 *
 * Ownership model: a card belongs to a kid, a kid belongs to a sys_user. The
 * Flutter app resolves kidId client-side and does not prove ownership, so every
 * entry point here re-verifies the kid against the authenticated parent.
 *
 * Storage model: only the S3 object key is persisted. Playable URLs are signed
 * on demand (see rfid.service lookupCardByUid) so a stored URL can never expire
 * mid-playback.
 */

const { prisma } = require('../config/database');
const uploadService = require('./upload.service');
const profileService = require('./profile.service');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB, matches the client-side check

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
 * Verify the kid belongs to the authenticated parent.
 * Answers "not found" rather than "forbidden" so the endpoint cannot be used to
 * probe which kid ids exist under other parents.
 */
const assertKidOwnedByUser = async (userId, kidId) => {
  const kid = await profileService.getKidById(userId, kidId);
  if (!kid) {
    throw new ApiError('That child profile could not be found.', 404);
  }
  return kid;
};

/**
 * Shape a card + its active pack into the response the Flutter app renders.
 * contentPack is null when nothing has been uploaded yet; rfidUid is null until
 * an admin assigns the physical card. Neither is an error for the client.
 */
const serializeCard = async (card, pack) => {
  let contentPack = null;

  if (pack) {
    contentPack = {
      id: String(pack.id),
      kidId: String(pack.kid_id),
      customCardId: String(card.id),
      title: pack.file_name || null,
      fileName: pack.file_name || null,
      // Signed per request: the app plays it immediately, and the tap lookup
      // signs its own copy independently.
      fileUrl: await uploadService.getSignedAudioUrl(pack.file_key),
      mimeType: pack.file_type || null,
      sizeBytes: pack.file_size_bytes ? Number(pack.file_size_bytes) : null,
      durationSeconds: pack.duration_seconds ?? null,
      updatedAt: pack.update_date
    };
  }

  return {
    id: String(card.id),
    kidId: String(card.kid_id),
    rfidUid: card.rfid_uid || null,
    contentPack
  };
};

const findActivePack = (kidId) =>
  prisma.custom_content_pack.findFirst({
    where: { kid_id: BigInt(kidId), is_active: true },
    orderBy: { create_date: 'desc' }
  });

/**
 * GET the kid's custom card and whatever content is on it.
 * @returns {Promise<Object|null>} null when the kid has no card row yet
 */
const getCustomCardForKid = async (userId, kidId) => {
  await assertKidOwnedByUser(userId, kidId);

  const card = await prisma.custom_card.findFirst({
    where: { kid_id: BigInt(kidId) }
  });
  if (!card) return null;

  const pack = await findActivePack(kidId);
  return serializeCard(card, pack);
};

/**
 * Replace the kid's custom card content with a new upload.
 *
 * Upserts the card (leaving rfid_uid NULL for the admin to fill in later),
 * retires the previous pack, and inserts the new one. Returns the same shape as
 * the GET so the app can render "On the card now" without a refetch.
 */
const replaceCustomCardContent = async (userId, kidId, file, { title } = {}) => {
  // Use the row's own id from here on, never the caller's string, so nothing
  // caller-shaped can reach the S3 key.
  const kid = await assertKidOwnedByUser(userId, kidId);
  const id = kid.id;

  const { ext, mimeType } = validateAudioUpload(file, title);

  // Upload before touching the DB: a failed upload should leave no trace, and an
  // orphaned object is cheaper than a row pointing at a key that does not exist.
  const { s3Key } = await uploadService.uploadCustomCardAudio(
    file.buffer,
    id,
    file.originalname || `recording${ext}`,
    mimeType
  );

  const card = await prisma.custom_card.upsert({
    where: { kid_id: id },
    create: { kid_id: id, creator: BigInt(userId) },
    update: { updater: BigInt(userId), update_date: new Date() }
  });

  const previous = await findActivePack(id);

  const pack = await prisma.$transaction(async (tx) => {
    // Soft retire every currently-active pack for this kid, so the "one active
    // pack" invariant holds even if a prior run left more than one behind.
    await tx.custom_content_pack.updateMany({
      where: { kid_id: id, is_active: true },
      data: { is_active: false, updater: BigInt(userId), update_date: new Date() }
    });

    return tx.custom_content_pack.create({
      data: {
        kid_id: id,
        file_key: s3Key,
        file_name: title || file.originalname || null,
        file_type: mimeType,
        file_size_bytes: BigInt(file.buffer.length),
        creator: BigInt(userId)
      }
    });
  });

  // The retired row keeps its key for audit, but the object itself is a child's
  // recording that has been replaced — remove it rather than leave it readable.
  if (previous?.file_key && previous.file_key !== s3Key) {
    await uploadService.deleteCustomCardAudio(previous.file_key);
  }

  logger.info(
    `[CUSTOM-CARD] Replaced content for kid_id=${kidId}: pack_id=${pack.id}, key=${s3Key}, retired=${previous?.id || 'none'}`
  );

  return serializeCard(card, pack);
};

module.exports = {
  getCustomCardForKid,
  replaceCustomCardContent,
  // exported for tests
  validateAudioUpload,
  sniffAudioExtension,
  MAX_UPLOAD_BYTES
};
