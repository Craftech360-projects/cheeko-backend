'use strict';

/**
 * Custom-card audio conversion: the encoder profile the toy depends on, and the
 * four places a stored recording can end up described by the file it was made
 * from rather than the file that exists.
 *
 * The profile matters more than it looks. The toy downloads these objects to its
 * SD card and decodes them itself, so nothing between here and the speaker can
 * fix a file that is the wrong shape — see src/utils/audioTranscode.js.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Conversion shells out to ffmpeg. The wiring tests below care about which bytes
// and which numbers land on which item, not about encoding, so they run against
// a stub; the encoder itself is exercised for real at the bottom of the file.
//
// The stub's output is deliberately a different length from its input and its
// duration is derived from the input, so a test can tell a converted file from
// an uploaded one and two different uploads apart.
jest.mock('../../src/utils/audioTranscode', () => ({
  ...jest.requireActual('../../src/utils/audioTranscode'),
  toDeviceMp3: jest.fn(async (buffer) => ({
    buffer: Buffer.alloc(1024 + buffer.length, 0x11),
    durationMs: buffer.length * 10
  }))
}));

jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565Bin: jest.fn(async () => Buffer.alloc(12))
}));

const mockPrisma = {
  kid_profile: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn(), upsert: jest.fn() },
  content_item: { findMany: jest.fn() }
};

const mockUpload = {
  uploadCustomCardAudio: jest.fn(),
  uploadCustomCardImage: jest.fn(),
  deleteCustomCardObject: jest.fn(async () => {}),
  customCardKeyFromUrl: jest.requireActual('../../src/services/upload.service').customCardKeyFromUrl
};

const mockRfid = { updateContentPack: jest.fn() };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/upload.service', () => mockUpload);
jest.mock('../../src/services/rfid.service', () => mockRfid);

const customCardService = require('../../src/services/customCard.service');
const { toDeviceMp3 } = require('../../src/utils/audioTranscode');

const USER_ID = 7;
const KID_ID = 42;
const PACK = { id: BigInt(7), pack_code: 'CK000042', name: 'Custom Card', version: '1' };
const AUDIO = (n) => `https://cdn.test/customcard_kid42/audio${n}.mp3`;

const asUpload = (buffer, originalname) => ({ buffer, originalname });

/** Magic-byte-valid headers. Real encoding is exercised against real ffmpeg below. */
const mp3Upload = (name = 'song.mp3', pad = 64) =>
  asUpload(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(pad)]), name);
const wavUpload = (name = 'memo.wav', pad = 64) =>
  asUpload(
    Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(pad)]),
    name
  );

// A real recording in the shape the app's recorder writes: AAC-LC, mono,
// 44.1 kHz, 128 kbps, two seconds, with the moov index *after* the audio.
const M4A_FIXTURE = fs.readFileSync(path.join(__dirname, '../fixtures/recording.m4a'));
// Spaces, and a dot before the extension — how the app names a recording.
const RECORDED_NAME = 'Recording 2026-09-11 10.00.m4a';
const ftypHeader = (brand, pad = 64) => Buffer.concat([
  Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftyp'), Buffer.from(brand, 'ascii'), Buffer.alloc(pad)
]);

let rows = [];
let writes = [];

const rowFor = (item, index) => ({
  id: BigInt(index + 1),
  item_number: item.itemNumber,
  title: item.title,
  audio_url: item.audioUrl,
  audio_size_bytes: item.audioSizeBytes,
  audio_duration_ms: item.audioDurationMs,
  image_url: item.imageUrl ?? null
});

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  writes = [];

  mockPrisma.kid_profile.findFirst.mockResolvedValue({ id: BigInt(KID_ID), name: 'Aarav' });
  mockPrisma.ai_device.findFirst.mockResolvedValue({ mac_address: 'AA:BB:CC:DD:EE:FF' });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
  mockPrisma.rfid_content_pack.upsert.mockResolvedValue(PACK);
  mockPrisma.content_item.findMany.mockImplementation(async () => rows.map((row) => ({ ...row })));

  mockRfid.updateContentPack.mockImplementation(async (data) => {
    writes.push(data);
    rows = data.items.map(rowFor);
  });

  let audioSeq = 0;
  mockUpload.uploadCustomCardAudio.mockImplementation(async () => {
    audioSeq += 1;
    return { s3Key: `k${audioSeq}`, url: AUDIO(audioSeq) };
  });
  mockUpload.uploadCustomCardImage.mockImplementation(async () => ({ s3Key: 'i1', url: 'https://cdn.test/i1.bin' }));
});

const lastWrite = () => writes[writes.length - 1];
const audioCall = (n = 0) => mockUpload.uploadCustomCardAudio.mock.calls[n];

// ── what reaches storage ────────────────────────────────────────────────────

describe('the bytes that reach S3', () => {
  it('stores the conversion, never the upload', async () => {
    const upload = mp3Upload();
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [upload], {});

    const [buffer, kidId, filename, mimeType] = audioCall();
    expect(buffer).not.toEqual(upload.buffer);
    expect(buffer.length).toBe(1024 + upload.buffer.length);
    expect(String(kidId)).toBe(String(KID_ID));
    expect(filename).toBe('recording.mp3');
    expect(mimeType).toBe('audio/mpeg');
  });

  it('stores a WAV as an MP3, under a name that says so', async () => {
    // The toy picks its decoder off the name it downloads, so a converted file
    // behind a `.wav` key is a file whose name lies about its contents.
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [wavUpload()], {});

    expect(audioCall()[2]).toBe('recording.mp3');
    expect(audioCall()[3]).toBe('audio/mpeg');
  });

  it('does not let the parent\'s own filename choose the stored extension', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [wavUpload('grandma singing.wav')], {});

    expect(audioCall()[2]).toBe('recording.mp3');
    // The name the parent gave it is still what they see on the card.
    expect(lastWrite().items[0].title).toBe('grandma singing.wav');
  });

  it('stores an app recording as an MP3, keeping its name as the title', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [asUpload(M4A_FIXTURE, RECORDED_NAME)], {});

    expect(toDeviceMp3).toHaveBeenCalledWith(M4A_FIXTURE);
    // The key is ours — a UUID plus `.mp3` — so the name's spaces never reach S3.
    expect(audioCall()[2]).toBe('recording.mp3');
    expect(audioCall()[3]).toBe('audio/mpeg');
    expect(lastWrite().items[0].title).toBe(RECORDED_NAME);
  });

  it('converts every file in a batch before storing any of them', async () => {
    // All-or-nothing: a batch whose third file will not convert must not leave
    // the first two sitting in the bucket.
    toDeviceMp3
      .mockImplementationOnce(async (b) => ({ buffer: Buffer.alloc(b.length), durationMs: 1 }))
      .mockImplementationOnce(async (b) => ({ buffer: Buffer.alloc(b.length), durationMs: 1 }))
      .mockImplementationOnce(async () => {
        const error = new Error('ffmpeg could not convert the recording: bad frame');
        error.transcodeFailed = true;
        throw error;
      });

    await expect(customCardService.addCustomCardContent(
      USER_ID, KID_ID, [mp3Upload('a.mp3'), mp3Upload('b.mp3'), mp3Upload('c.mp3')], {}
    )).rejects.toThrow('That recording could not be converted. Please try another file.');

    expect(mockUpload.uploadCustomCardAudio).not.toHaveBeenCalled();
    expect(mockRfid.updateContentPack).not.toHaveBeenCalled();
  });
});

// ── what reaches the database ───────────────────────────────────────────────

describe('the metadata on the row', () => {
  it('records the converted size and running time on an add', async () => {
    const upload = mp3Upload('song.mp3', 100);
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [upload], {});

    expect(lastWrite().items[0]).toEqual(expect.objectContaining({
      audioSizeBytes: 1024 + upload.buffer.length,
      audioDurationMs: upload.buffer.length * 10
    }));
    // The upload's own length is not persisted anywhere: an app rendering it
    // would be describing a file that exists nowhere.
    expect(lastWrite().items[0].audioSizeBytes).not.toBe(upload.buffer.length);
  });

  it('records the converted size and running time on a replace', async () => {
    await customCardService.addCustomCardContent(USER_ID, KID_ID, [mp3Upload()], {});
    const replacement = wavUpload('new.wav', 300);

    await customCardService.replaceCustomCardItem(USER_ID, KID_ID, 1, replacement, {});

    expect(lastWrite().items[0]).toEqual(expect.objectContaining({
      itemNumber: 1,
      audioSizeBytes: 1024 + replacement.buffer.length,
      audioDurationMs: replacement.buffer.length * 10
    }));
  });

  it('keeps each recording\'s own running time when a delete renumbers the card', async () => {
    // The grafting bug this guards: item 2 becomes item 1, and updateContentPack
    // matches rows by item_number. A payload that left the duration out would
    // fall back to whatever the old item 1 had, and the card would show one
    // recording's length against another's audio.
    await customCardService.addCustomCardContent(
      USER_ID, KID_ID, [mp3Upload('a.mp3', 100), mp3Upload('b.mp3', 500)], {}
    );
    const [first, second] = lastWrite().items;
    expect(first.audioDurationMs).not.toBe(second.audioDurationMs);

    await customCardService.deleteCustomCardItem(USER_ID, KID_ID, 1);

    expect(lastWrite().items).toEqual([
      expect.objectContaining({ itemNumber: 1, audioDurationMs: second.audioDurationMs })
    ]);
  });
});

// ── what the app is told ────────────────────────────────────────────────────

describe('the serialized card', () => {
  it('reports the running time in seconds, per item and at pack level', async () => {
    // 103 bytes of fixture -> 1030 ms from the stub.
    const card = await customCardService.addCustomCardContent(USER_ID, KID_ID, [mp3Upload('a.mp3', 100)], {});

    expect(card.contentPack.items[0].durationSeconds).toBe(1);
    expect(card.contentPack.durationSeconds).toBe(1);
    expect(card.contentPack.items[0].sizeBytes).toBe(1024 + 103);
  });

  it('reports no running time for a recording stored before conversion existed', async () => {
    // A legacy row: real audio, no measured duration. Rendering a 0 here would
    // tell the parent their recording is empty.
    rows = [{
      id: BigInt(1), item_number: 1, title: 'Old', audio_url: AUDIO(1),
      audio_size_bytes: BigInt(4096), audio_duration_ms: null, image_url: null
    }];

    const card = await customCardService.getCustomCardForKid(USER_ID, KID_ID);

    expect(card.contentPack.items[0].durationSeconds).toBeNull();
    expect(card.contentPack.durationSeconds).toBeNull();
    expect(card.contentPack.items[0].sizeBytes).toBe(4096);
  });
});

// ── validation is unchanged ─────────────────────────────────────────────────

describe('the input contract, which conversion does not relax', () => {
  it('still bounds the upload at 10 MB', async () => {
    const big = asUpload(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(11 * 1024 * 1024)]), 'big.mp3');

    await expect(customCardService.addCustomCardContent(USER_ID, KID_ID, [big], {}))
      .rejects.toThrow('That recording is larger than 10 MB. Please choose a shorter one.');
    expect(toDeviceMp3).not.toHaveBeenCalled();
  });

  it('still accepts both MP3 and WAV', () => {
    expect(customCardService.validateAudioUpload(mp3Upload())).toEqual({ ext: '.mp3', mimeType: 'audio/mpeg' });
    expect(customCardService.validateAudioUpload(wavUpload())).toEqual({ ext: '.wav', mimeType: 'audio/wav' });
  });

  it('accepts a recording made in the app, under every brand a phone writes', () => {
    expect(customCardService.validateAudioUpload(asUpload(M4A_FIXTURE, RECORDED_NAME)))
      .toEqual({ ext: '.m4a', mimeType: 'audio/mp4' });
    for (const brand of ['M4A ', 'isom', 'mp42', 'mp41', 'iso2']) {
      expect(customCardService.validateAudioUpload(asUpload(ftypHeader(brand), RECORDED_NAME)).ext).toBe('.m4a');
    }
  });

  it('refuses an MPEG-4 file under a brand no recorder writes', () => {
    // `qt  ` is a QuickTime movie: an ftyp box alone is not enough.
    expect(() => customCardService.validateAudioUpload(asUpload(ftypHeader('qt  '), 'clip.m4a')))
      .toThrow('That file does not look like a valid MP3, WAV or M4A recording.');
  });

  it('trusts the bytes, not the name, in both directions', () => {
    expect(() => customCardService.validateAudioUpload(mp3Upload(RECORDED_NAME)))
      .toThrow('The file contents do not match its .m4a extension.');
    expect(() => customCardService.validateAudioUpload(asUpload(M4A_FIXTURE, 'song.mp3')))
      .toThrow('The file contents do not match its .mp3 extension.');
  });

  it('names M4A when the extension is not one it takes', () => {
    expect(() => customCardService.validateAudioUpload(asUpload(M4A_FIXTURE, 'memo.ogg')))
      .toThrow('Only MP3, WAV and M4A recordings are supported.');
  });

  it('gives an oversized recording the size message, not a format one', () => {
    const big = asUpload(ftypHeader('M4A ', 10 * 1024 * 1024), RECORDED_NAME);

    expect(() => customCardService.validateAudioUpload(big))
      .toThrow('That recording is larger than 10 MB. Please choose a shorter one.');
  });

  it('still rejects anything that is neither, before spending an ffmpeg on it', async () => {
    await expect(customCardService.addCustomCardContent(
      USER_ID, KID_ID, [asUpload(Buffer.from('not audio at all'), 'x.mp3')], {}
    )).rejects.toThrow('That file does not look like a valid MP3, WAV or M4A recording.');
    expect(toDeviceMp3).not.toHaveBeenCalled();
  });

  it('imposes no ceiling on the converted file', async () => {
    // Deliberate: the 10 MB bound is on what the parent sends. A conversion that
    // came out large is still the best available rendering of a file we already
    // accepted, and refusing it here would reject an upload that passed.
    toDeviceMp3.mockImplementationOnce(async () => ({
      buffer: Buffer.alloc(9 * 1024 * 1024, 0x11), durationMs: 600000
    }));

    await customCardService.addCustomCardContent(USER_ID, KID_ID, [mp3Upload()], {});

    expect(lastWrite().items[0].audioSizeBytes).toBe(9 * 1024 * 1024);
  });
});

// ── the encoder ─────────────────────────────────────────────────────────────

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const toolsAvailable = spawnSync(FFMPEG, ['-version']).status === 0
  && spawnSync('ffprobe', ['-version']).status === 0;

// Skipped rather than failed where ffmpeg is absent: the runtime image installs
// it (Dockerfile), but a bare dev box may not have it.
const describeEncoder = toolsAvailable ? describe : describe.skip;
if (!toolsAvailable) {
  // eslint-disable-next-line no-console
  console.warn('[customCard.audio] ffmpeg/ffprobe not found — encoder tests skipped');
}

describeEncoder('toDeviceMp3, against real ffmpeg', () => {
  const { toDeviceMp3: encode, TARGET_SAMPLE_RATE, TARGET_BITRATE_KBPS } =
    jest.requireActual('../../src/utils/audioTranscode');

  /** A real recording, in whatever shape a parent's phone might hand us. */
  const synth = (args) => {
    const result = spawnSync(FFMPEG, [
      '-v', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
      ...args, 'pipe:1'
    ], { maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`fixture failed: ${result.stderr}`);
    return result.stdout;
  };

  const probe = (buffer) => {
    const result = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate',
      '-of', 'json', 'pipe:0'
    ], { input: buffer, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(result.stdout.toString()).streams[0];
  };

  /**
   * How long the encoded file actually plays, by decoding it and counting
   * samples. ffprobe cannot answer this off a pipe — sizing an MP3 stream means
   * seeking it — and a decode is the ground truth the derived figure is
   * checked against anyway.
   */
  const playedSeconds = (buffer) => {
    const pcm = spawnSync(FFMPEG, [
      '-v', 'error', '-nostdin', '-i', 'pipe:0',
      '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'
    ], { input: buffer, maxBuffer: 64 * 1024 * 1024 });
    if (pcm.status !== 0) throw new Error(`decode failed: ${pcm.stderr}`);
    return pcm.stdout.length / (2 * 24000);
  };

  const STEREO_WAV = ['-ac', '2', '-c:a', 'pcm_s16le', '-f', 'wav'];
  const HIGH_MP3 = ['-ac', '2', '-c:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3'];

  it('encodes a stereo 44.1 kHz WAV to mono 24 kHz MP3 at 128 kbps', async () => {
    const { buffer } = await encode(synth(STEREO_WAV));
    const out = probe(buffer);

    expect(out.codec_name).toBe('mp3');
    expect(Number(out.sample_rate)).toBe(TARGET_SAMPLE_RATE);
    expect(out.channels).toBe(1);
    expect(Number(out.bit_rate)).toBe(TARGET_BITRATE_KBPS * 1000);
  });

  it('normalises an MP3 that is already an MP3', async () => {
    // A 320 kbps stereo file is still the wrong shape; "already MP3" is not
    // "already right", so this path must not be a passthrough.
    const source = synth(HIGH_MP3);
    const { buffer } = await encode(source);
    const out = probe(buffer);

    expect(Number(out.sample_rate)).toBe(TARGET_SAMPLE_RATE);
    expect(out.channels).toBe(1);
    expect(Number(out.bit_rate)).toBe(TARGET_BITRATE_KBPS * 1000);
    expect(buffer.length).toBeLessThan(source.length);
  });

  it('shrinks a WAV by roughly an order of magnitude', async () => {
    // The whole point of storing the conversion: uncompressed 44.1 kHz stereo is
    // ~10x the bytes of the same audio at the profile above.
    const source = synth(STEREO_WAV);
    const { buffer } = await encode(source);

    expect(buffer.length).toBeLessThan(source.length / 5);
  });

  it('converts a phone recording whose index sits after the audio', async () => {
    // Guard the fixture's layout, or regenerating it with +faststart would make
    // this test pass vacuously. Off a pipe, this layout is undecodable.
    const boxes = [];
    for (let i = 0; i < M4A_FIXTURE.length; i += M4A_FIXTURE.readUInt32BE(i)) {
      boxes.push(M4A_FIXTURE.toString('ascii', i + 4, i + 8));
    }
    expect(boxes.indexOf('moov')).toBeGreaterThan(boxes.indexOf('mdat'));

    const { buffer, durationMs } = await encode(M4A_FIXTURE);
    const out = probe(buffer);

    expect(out.codec_name).toBe('mp3');
    expect(Number(out.sample_rate)).toBe(TARGET_SAMPLE_RATE);
    expect(out.channels).toBe(1);
    expect(Number(out.bit_rate)).toBe(TARGET_BITRATE_KBPS * 1000);
    expect(Math.abs(durationMs / 1000 - playedSeconds(buffer))).toBeLessThan(0.05);
    expect(Math.abs(durationMs - 2000)).toBeLessThan(100);
  });

  it('reports a running time that matches the file it produced', async () => {
    const { buffer, durationMs } = await encode(synth(STEREO_WAV));

    // Derived from the CBR bitrate rather than measured, so this is the check
    // that the derivation and the encoder still agree — within one MP3 frame.
    expect(Math.abs(durationMs / 1000 - playedSeconds(buffer))).toBeLessThan(0.05);
    expect(durationMs).toBeGreaterThan(2900);
    expect(durationMs).toBeLessThan(3200);
  });

  it('drops cover art rather than carrying it into the object the toy downloads', async () => {
    const withArt = spawnSync(FFMPEG, [
      '-v', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=44100',
      '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1',
      '-map', '0:a', '-map', '1:v', '-frames:v', '1',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3',
      '-f', 'mp3', 'pipe:1'
    ], { maxBuffer: 64 * 1024 * 1024 });
    expect(withArt.status).toBe(0);

    const { buffer } = await encode(withArt.stdout);
    const streams = JSON.parse(spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', 'pipe:0'
    ], { input: buffer }).stdout.toString()).streams;

    expect(streams.map((s) => s.codec_type)).toEqual(['audio']);
  });

  it('rejects a file whose header is honest and whose body is not', async () => {
    const truncated = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);

    await expect(encode(truncated)).rejects.toMatchObject({ transcodeFailed: true });
  });

  it('rejects an empty buffer without spawning anything', async () => {
    await expect(encode(Buffer.alloc(0))).rejects.toMatchObject({ transcodeFailed: true });
  });
});
