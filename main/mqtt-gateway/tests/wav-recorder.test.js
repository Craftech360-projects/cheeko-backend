const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { WavRecorder } = require("../livekit/wav-recorder");

test("WavRecorder writes valid WAV and enforces max duration", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wav-recorder-"));
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const maxDurationSeconds = 1;
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);

  const recorder = new WavRecorder({
    enabled: true,
    outputDir: tmpDir,
    label: "agent-audio",
    deviceId: "AA:BB:CC:DD",
    sessionId: "session-1",
    sampleRate,
    channels,
    bitsPerSample,
    maxDurationSeconds,
  });

  const oversizedChunk = Buffer.alloc(bytesPerSecond + 8000, 0x01);
  recorder.appendPcmChunk(oversizedChunk);
  const result = recorder.finalize();

  assert.ok(result);
  assert.ok(result.filePath);
  assert.strictEqual(result.recordedPcmBytes, bytesPerSecond);

  const wav = fs.readFileSync(result.filePath);
  assert.strictEqual(wav.length, 44 + bytesPerSecond);
  assert.strictEqual(wav.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(wav.toString("ascii", 8, 12), "WAVE");
  assert.strictEqual(wav.readUInt32LE(4), 36 + bytesPerSecond);
  assert.strictEqual(wav.readUInt32LE(40), bytesPerSecond);
});

test("WavRecorder does not create file when disabled", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wav-recorder-disabled-"));
  const recorder = new WavRecorder({
    enabled: false,
    outputDir: tmpDir,
  });

  recorder.appendPcmChunk(Buffer.alloc(3200));
  const result = recorder.finalize();

  assert.strictEqual(result, null);
  assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
});

test("WavRecorder starts a new file after max duration is reached", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wav-recorder-rollover-"));
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const maxDurationSeconds = 1;
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);

  const recorder = new WavRecorder({
    enabled: true,
    outputDir: tmpDir,
    sampleRate,
    channels,
    bitsPerSample,
    maxDurationSeconds,
  });

  recorder.appendPcmChunk(Buffer.alloc(bytesPerSecond, 0x10));
  recorder.appendPcmChunk(Buffer.alloc(bytesPerSecond / 2, 0x20));
  recorder.finalize();

  const files = fs
    .readdirSync(tmpDir)
    .filter((name) => name.endsWith(".wav"))
    .sort();

  assert.strictEqual(files.length, 2);

  const firstWav = fs.readFileSync(path.join(tmpDir, files[0]));
  const secondWav = fs.readFileSync(path.join(tmpDir, files[1]));

  assert.strictEqual(firstWav.length, 44 + bytesPerSecond);
  assert.strictEqual(secondWav.length, 44 + bytesPerSecond / 2);
});
