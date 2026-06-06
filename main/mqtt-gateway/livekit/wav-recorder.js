const fs = require("fs");
const path = require("path");

class WavRecorder {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.outputDir = options.outputDir || path.resolve(process.cwd(), "logs", "audio-capture");
    this.label = this.sanitizeSegment(options.label || "audio");
    this.deviceId = this.sanitizeSegment(options.deviceId || "unknown-device");
    this.sessionId = this.sanitizeSegment(options.sessionId || "unknown-session");
    this.sampleRate = Number(options.sampleRate) || 24000;
    this.channels = Number(options.channels) || 1;
    this.bitsPerSample = Number(options.bitsPerSample) || 16;
    this.maxDurationSeconds = Number(options.maxDurationSeconds) || 30;
    this.bytesPerSample = this.bitsPerSample / 8;
    this.maxPcmBytes = Math.floor(
      this.sampleRate * this.channels * this.bytesPerSample * this.maxDurationSeconds
    );

    this.fd = null;
    this.filePath = null;
    this.recordedPcmBytes = 0;
    this.isFinalized = false;
    this.finalInfo = null;
    this.fileIndex = 0;
  }

  sanitizeSegment(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "unknown";
  }

  appendPcmChunk(pcmChunk) {
    if (!this.enabled || !pcmChunk || pcmChunk.length === 0) {
      return null;
    }

    if (this.isFinalized) {
      this.resetForNextFile();
    }

    let chunk = Buffer.isBuffer(pcmChunk) ? pcmChunk : Buffer.from(pcmChunk);
    const byteRemainder = chunk.length % this.bytesPerSample;
    if (byteRemainder !== 0) {
      chunk = chunk.subarray(0, chunk.length - byteRemainder);
    }

    if (chunk.length === 0) {
      return null;
    }

    this.ensureFileInitialized();

    const remaining = this.maxPcmBytes - this.recordedPcmBytes;
    if (remaining <= 0) {
      return this.finalize();
    }

    const writeLength = Math.min(remaining, chunk.length);
    fs.writeSync(this.fd, chunk, 0, writeLength, 44 + this.recordedPcmBytes);
    this.recordedPcmBytes += writeLength;

    if (this.recordedPcmBytes >= this.maxPcmBytes) {
      return this.finalize();
    }

    return null;
  }

  ensureFileInitialized() {
    if (this.fd !== null) {
      return;
    }

    fs.mkdirSync(this.outputDir, { recursive: true });
    this.fileIndex += 1;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}_${this.label}_${this.deviceId}_${this.sessionId}_part${String(this.fileIndex).padStart(4, "0")}.wav`;
    this.filePath = path.join(this.outputDir, fileName);
    this.fd = fs.openSync(this.filePath, "w");
    fs.writeSync(this.fd, this.buildWavHeader(0), 0, 44, 0);
  }

  buildWavHeader(dataSize) {
    const header = Buffer.alloc(44);
    const blockAlign = this.channels * this.bytesPerSample;
    const byteRate = this.sampleRate * blockAlign;

    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(this.bitsPerSample, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(dataSize, 40);

    return header;
  }

  finalize() {
    if (!this.enabled) {
      return null;
    }

    if (this.isFinalized) {
      return this.finalInfo;
    }

    if (this.fd === null) {
      this.isFinalized = true;
      this.finalInfo = null;
      return null;
    }

    fs.writeSync(this.fd, this.buildWavHeader(this.recordedPcmBytes), 0, 44, 0);
    fs.closeSync(this.fd);

    this.isFinalized = true;
    this.fd = null;
    this.finalInfo = {
      filePath: this.filePath,
      recordedPcmBytes: this.recordedPcmBytes,
      durationSeconds: this.recordedPcmBytes / (this.sampleRate * this.channels * this.bytesPerSample),
    };

    return this.finalInfo;
  }

  resetForNextFile() {
    this.fd = null;
    this.filePath = null;
    this.recordedPcmBytes = 0;
    this.isFinalized = false;
    this.finalInfo = null;
  }
}

module.exports = {
  WavRecorder,
};
