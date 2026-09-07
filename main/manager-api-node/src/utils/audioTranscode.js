/**
 * Custom-card audio: one shape, decided here.
 *
 * A parent's recording is not played over the live voice link — the toy
 * downloads the object from CloudFront onto its SD card and decodes it there.
 * Nothing between the phone and the speaker can reinterpret it, so whatever is
 * stored is exactly what the firmware has to cope with. Re-encoding every
 * upload to one profile is what keeps that surface at one format instead of
 * "whatever the parent's phone happened to produce".
 *
 * The profile is 24 kHz mono MP3 at 128 kbps CBR:
 *
 * - **24 kHz** is the rate the speaker path already runs at everywhere else —
 *   the gateway's OUTGOING_SAMPLE_RATE (mqtt-gateway/constants/audio.js) and the
 *   pre-baked mode-change assets, which are `-ar 24000 -ac 1` for the same
 *   reason. Matching it means the device never resamples.
 * - **Mono**, because the toy has one speaker.
 * - **MP3**, so a WAV upload stops being a 10x-larger file for the same audio,
 *   and so the firmware only ever meets one decoder.
 * - **CBR**, which is what makes the duration below arithmetic rather than a
 *   second pass over the file.
 *
 * Upload validation is unchanged and still bounds the *input* at 10 MB; this
 * module bounds nothing, it only normalises. A 10 MB WAV lands at roughly
 * 1 MB of MP3 on its own.
 */

'use strict';

const { spawn } = require('child_process');

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

const TARGET_SAMPLE_RATE = 24000;
const TARGET_CHANNELS = 1;
const TARGET_BITRATE_KBPS = 128;

// What a transcoded recording is, everywhere downstream: the S3 key's
// extension, the object's Content-Type, and the extension the stored URL ends
// in. A WAV upload is an MP3 from this point on.
const TARGET_EXT = '.mp3';
const TARGET_MIME = 'audio/mpeg';

// ffmpeg is a subprocess per upload, exactly as it is for artwork. The bound is
// separate from the image converter's rather than shared: the two run at
// different costs and either one stalling should not starve the other of slots.
// The ceiling is higher than the image one because a 10 MB WAV is a real decode,
// not a single frame.
const FFMPEG_TIMEOUT_MS = Number(process.env.AUDIO_TRANSCODE_TIMEOUT_MS || 30000);
const MAX_CONCURRENT = Math.max(1, Number(process.env.AUDIO_TRANSCODE_CONCURRENCY || 2));

let active = 0;
const waiting = [];

const acquireSlot = () => new Promise((resolve) => {
  if (active < MAX_CONCURRENT) {
    active += 1;
    resolve();
    return;
  }
  waiting.push(resolve);
});

const releaseSlot = () => {
  const next = waiting.shift();
  // Hand the slot straight to the next waiter; `active` is unchanged because the
  // count of running conversions is unchanged.
  if (next) next();
  else active -= 1;
};

/** An input ffmpeg could not turn into audio. Callers map this to a 400. */
const transcodeError = (message) => {
  const error = new Error(message);
  error.transcodeFailed = true;
  return error;
};

/**
 * How long the encoded stream plays, in whole milliseconds.
 *
 * Exact by construction rather than measured: the stream is CBR at a bitrate we
 * chose, carries no ID3 tag (`-id3v2_version 0`) and no cover art (`-vn`), so
 * every byte in the buffer is audio and duration is just bytes over bitrate.
 * The one exception is libmp3lame's leading Xing/Info frame, which is kept for
 * player compatibility and puts the answer at most one frame — 24 ms — long.
 */
const durationMsOf = (buffer) =>
  Math.round((buffer.length * 8 * 1000) / (TARGET_BITRATE_KBPS * 1000));

/**
 * Decode anything ffmpeg understands and re-encode it to the profile above.
 *
 * `-vn` and `-map_metadata -1` are not tidiness: an MP3 carrying embedded cover
 * art is a two-stream input, and without `-vn` the mp3 muxer would try to carry
 * that picture through into the output the toy downloads.
 */
const encodeToMp3 = (buffer) => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG_BIN, [
    '-v', 'error',
    '-nostdin',
    '-i', 'pipe:0',
    '-vn',
    '-map_metadata', '-1',
    '-ac', String(TARGET_CHANNELS),
    '-ar', String(TARGET_SAMPLE_RATE),
    '-c:a', 'libmp3lame',
    '-b:a', `${TARGET_BITRATE_KBPS}k`,
    '-id3v2_version', '0',
    '-f', 'mp3',
    'pipe:1'
  ]);

  const stdout = [];
  const stderr = [];
  let settled = false;

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    if (settled) return;
    settled = true;
    reject(transcodeError('Audio conversion timed out.'));
  }, FFMPEG_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  // ffmpeg closes stdin as soon as it has rejected a malformed file, so writing
  // the body races the exit. That EPIPE is not the error worth reporting — the
  // exit code below is.
  child.stdin.on('error', () => {});
  child.stdin.end(buffer);

  child.on('error', (err) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    reject(err);
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;

    const encoded = Buffer.concat(stdout);
    if (code !== 0 || encoded.length === 0) {
      const detail = Buffer.concat(stderr).toString().trim().split('\n').pop() || `exit ${code}`;
      reject(transcodeError(`ffmpeg could not convert the recording: ${detail}`));
      return;
    }
    resolve(encoded);
  });
});

/**
 * Convert an uploaded MP3 or WAV into the recording the toy stores and plays.
 *
 * @param {Buffer} buffer - the validated upload bytes
 * @returns {Promise<{buffer: Buffer, durationMs: number}>} the bytes to store,
 *   and how long they play. Both describe the *converted* file: the caller has
 *   no business persisting the upload's size or the upload's extension after
 *   this point.
 */
const toDeviceMp3 = async (buffer) => {
  if (!buffer || buffer.length === 0) {
    throw transcodeError('The recording is empty.');
  }

  await acquireSlot();
  let encoded;
  try {
    encoded = await encodeToMp3(buffer);
  } finally {
    releaseSlot();
  }

  return { buffer: encoded, durationMs: durationMsOf(encoded) };
};

module.exports = {
  toDeviceMp3,
  durationMsOf,
  TARGET_SAMPLE_RATE,
  TARGET_CHANNELS,
  TARGET_BITRATE_KBPS,
  TARGET_EXT,
  TARGET_MIME
};
