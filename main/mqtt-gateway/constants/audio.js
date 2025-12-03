/**
 * Audio Constants for MQTT Gateway
 * 
 * Defines sample rates, frame sizes, and durations for audio processing
 * between ESP32 devices and LiveKit infrastructure.
 */

// Sample rates
const OUTGOING_SAMPLE_RATE = 24000; // Hz - for LiveKit → ESP32
const INCOMING_SAMPLE_RATE = 16000; // Hz - for ESP32 → LiveKit
const CHANNELS = 1; // Mono

// Frame durations
const OUTGOING_FRAME_DURATION_MS = 60; // 60ms frames for outgoing (LiveKit → ESP32)
const INCOMING_FRAME_DURATION_MS = 60; // 60ms frames for incoming (ESP32 → LiveKit)

// Frame sizes in samples
const OUTGOING_FRAME_SIZE_SAMPLES =
    (OUTGOING_SAMPLE_RATE * OUTGOING_FRAME_DURATION_MS) / 1000; // 24000 * 60 / 1000 = 1440
const INCOMING_FRAME_SIZE_SAMPLES =
    (INCOMING_SAMPLE_RATE * INCOMING_FRAME_DURATION_MS) / 1000; // 16000 * 60 / 1000 = 960

// Frame sizes in bytes (16-bit PCM = 2 bytes per sample)
const OUTGOING_FRAME_SIZE_BYTES = OUTGOING_FRAME_SIZE_SAMPLES * 2; // 1440 samples * 2 bytes/sample = 2880 bytes PCM
const INCOMING_FRAME_SIZE_BYTES = INCOMING_FRAME_SIZE_SAMPLES * 2; // 960 samples * 2 bytes/sample = 1920 bytes PCM

module.exports = {
    OUTGOING_SAMPLE_RATE,
    INCOMING_SAMPLE_RATE,
    CHANNELS,
    OUTGOING_FRAME_DURATION_MS,
    INCOMING_FRAME_DURATION_MS,
    OUTGOING_FRAME_SIZE_SAMPLES,
    INCOMING_FRAME_SIZE_SAMPLES,
    OUTGOING_FRAME_SIZE_BYTES,
    INCOMING_FRAME_SIZE_BYTES,
};
