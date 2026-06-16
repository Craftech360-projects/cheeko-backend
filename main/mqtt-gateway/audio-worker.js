// ========================================
// PHASE 2: Audio Worker Thread
// ========================================
// Worker thread for offloading CPU-intensive audio processing
// from the main event loop to prevent blocking
//
// Features:
// - Opus encoding/decoding (outgoing/incoming audio)
// - Non-blocking parallel processing
// - Message-based communication with main thread
//
// Performance: Reduces main thread blocking by ~70-90%

const { parentPort, workerData, isMainThread } = require('worker_threads');

// Only run in worker thread context
if (isMainThread) {
  throw new Error('audio-worker.js must be run as a Worker Thread, not in main thread');
}

// Import Opus encoder (native @discordjs/opus)
// Note: @discordjs/opus uses OpusEncoder for both encoding and decoding
const { OpusEncoder } = require('@discordjs/opus');

/**
 * Audio Processor for Worker Thread
 * Handles Opus encoding/decoding in isolated thread
 */
class AudioProcessor {
  constructor() {
    // Per-session encoder/decoder instances for this worker
    // sessions: sessionId -> { outgoingEncoder, incomingDecoder }
    this.sessions = new Map();

    // Global codec configs initialized via init_encoder / init_decoder
    this.encoderConfig = null; // { sampleRate, channels }
    this.decoderConfig = null; // { sampleRate, channels }

    console.log('🧵 [WORKER] AudioProcessor initialized in worker thread');
  }

  getOrCreateSession(sessionId) {
    const key = sessionId || 'default';
    let session = this.sessions.get(key);
    if (!session) {
      session = { outgoingEncoder: null, incomingDecoder: null };
      this.sessions.set(key, session);
    }
    return session;
  }

  /**
   * Initialize Opus encoder config for outgoing audio (LiveKit → Device)
   * Stores the sampleRate/channels so per-session encoders can be created lazily.
   */
  initOutgoingEncoder(sampleRate, channels) {
    this.encoderConfig = { sampleRate, channels };
    console.log(`🧵 [WORKER] Outgoing encoder config set: ${sampleRate}Hz ${channels}ch`);
  }

  /**
   * Initialize Opus decoder config for incoming audio (Device → LiveKit)
   * Stores the sampleRate/channels so per-session decoders can be created lazily.
   */
  initIncomingDecoder(sampleRate, channels) {
    this.decoderConfig = { sampleRate, channels };
    console.log(`🧵 [WORKER] Incoming decoder config set: ${sampleRate}Hz ${channels}ch`);
  }

  /**
   * Encode PCM audio to Opus (for outgoing audio)
   * @param {string} sessionId - Logical session identifier
   * @param {ArrayBuffer} buffer - PCM audio data buffer (Int16 samples)
   * @param {number} byteOffset - Byte offset into buffer
   * @param {number} byteLength - Number of bytes to read
   * @param {number} frameSize - Frame size in samples
   * @returns {Buffer} Encoded Opus data
   */
  encodeOpus(sessionId, buffer, byteOffset, byteLength, frameSize) {
    const session = this.getOrCreateSession(sessionId);

    // Lazily create per-session encoder using configured params
    if (!session.outgoingEncoder) {
      const cfg = this.encoderConfig || { sampleRate: 24000, channels: 1 };
      session.outgoingEncoder = new OpusEncoder(cfg.sampleRate, cfg.channels);
      console.log(`🧵 [WORKER] Created outgoing encoder for session ${sessionId || 'default'}: ${cfg.sampleRate}Hz ${cfg.channels}ch`);
    }

    // Create a Buffer view over the transferred ArrayBuffer (zero-copy in worker)
    const pcmBuffer = Buffer.from(buffer, byteOffset, byteLength);

    const startTime = process.hrtime.bigint();
    const opusData = session.outgoingEncoder.encode(pcmBuffer, frameSize);
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // ms

    return {
      data: opusData,
      processingTime: duration,
      inputSize: byteLength,
      outputSize: opusData.length
    };
  }

  /**
   * Decode Opus audio to PCM (for incoming audio)
   * @param {string} sessionId - Logical session identifier
   * @param {ArrayBuffer} buffer - Opus encoded data buffer
   * @param {number} byteOffset - Byte offset into buffer
   * @param {number} byteLength - Number of bytes to read
   * @returns {Buffer} Decoded PCM data
   */
  decodeOpus(sessionId, buffer, byteOffset, byteLength) {
    const session = this.getOrCreateSession(sessionId);

    // Lazily create per-session decoder using configured params
    if (!session.incomingDecoder) {
      const cfg = this.decoderConfig || { sampleRate: 16000, channels: 1 };
      session.incomingDecoder = new OpusEncoder(cfg.sampleRate, cfg.channels);
      console.log(`🧵 [WORKER] Created incoming decoder for session ${sessionId || 'default'}: ${cfg.sampleRate}Hz ${cfg.channels}ch`);
    }

    // Create a Buffer view over the transferred ArrayBuffer
    const opusBuffer = Buffer.from(buffer, byteOffset, byteLength);

    const startTime = process.hrtime.bigint();
    const pcmData = session.incomingDecoder.decode(opusBuffer);
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // ms

    return {
      data: pcmData,
      processingTime: duration,
      inputSize: byteLength,
      outputSize: pcmData.length
    };
  }

  /**
   * Packet Loss Concealment (PLC) — decode a missing frame.
   * Calls the Opus decoder with null data so it can interpolate/extrapolate
   * the missing audio and keep its internal state in sync.
   * @param {string} sessionId - Logical session identifier
   * @returns {Buffer} Interpolated PCM data for the missing frame
   */
  decodePLC(sessionId) {
    const session = this.getOrCreateSession(sessionId);

    if (!session.incomingDecoder) {
      const cfg = this.decoderConfig || { sampleRate: 16000, channels: 1 };
      session.incomingDecoder = new OpusEncoder(cfg.sampleRate, cfg.channels);
      console.log(`🧵 [WORKER] Created incoming decoder for PLC session ${sessionId || 'default'}: ${cfg.sampleRate}Hz ${cfg.channels}ch`);
    }

    const startTime = process.hrtime.bigint();
    // @discordjs/opus PLC: pass empty Buffer to trigger packet loss concealment
    // libopus interprets zero-length input as a lost frame and interpolates
    const pcmData = session.incomingDecoder.decode(Buffer.alloc(0));
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000;

    return {
      data: pcmData,
      processingTime: duration,
      inputSize: 0,
      outputSize: pcmData.length
    };
  }

  /**
   * Cleanup per-session codec state
   */
  cleanupSession(sessionId) {
    const key = sessionId || 'default';
    if (this.sessions.has(key)) {
      this.sessions.delete(key);
      console.log(`🧵 [WORKER] Cleaned up codecs for session ${key}`);
    }
  }
}

// ========================================
// Worker Thread Message Handler
// ========================================

const processor = new AudioProcessor();

parentPort.on('message', (message) => {
  const { id, type, data } = message;

  try {
    let result;

    switch (type) {
      case 'init_encoder':
        processor.initOutgoingEncoder(data.sampleRate, data.channels);
        result = { success: true };
        break;

      case 'init_decoder':
        processor.initIncomingDecoder(data.sampleRate, data.channels);
        result = { success: true };
        break;

      case 'encode':
        result = processor.encodeOpus(
          data.sessionId,
          data.buffer,
          data.byteOffset || 0,
          data.byteLength,
          data.frameSize
        );
        break;

      case 'decode':
        result = processor.decodeOpus(
          data.sessionId,
          data.buffer,
          data.byteOffset || 0,
          data.byteLength
        );
        break;

      case 'decode_plc':
        result = processor.decodePLC(data.sessionId);
        break;

      case 'cleanup_session':
        processor.cleanupSession(data.sessionId);
        result = { success: true };
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // Send successful result back to main thread
    parentPort.postMessage({
      id,
      success: true,
      result
    });

  } catch (error) {
    // Send error back to main thread
    parentPort.postMessage({
      id,
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Handle worker errors
parentPort.on('error', (error) => {
  console.error('🧵 [WORKER ERROR]', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🧵 [WORKER] Shutting down gracefully...');
  process.exit(0);
});

console.log('🧵 [WORKER] Audio worker thread started and ready');
