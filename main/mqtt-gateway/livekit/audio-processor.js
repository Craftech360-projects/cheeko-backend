/**
 * LiveKit Audio Processor
 * 
 * Utilities for audio format detection and processing.
 * Handles Opus vs PCM detection, entropy calculation, and frame validation.
 */

/**
 * Detect if audio data is Opus or PCM based on entropy
 * @param {Buffer} data - Audio data buffer
 * @returns {string} 'opus' or 'pcm'
 */
function detectAudioFormat(data) {
    if (!data || data.length === 0) {
        return 'unknown';
    }

    // Calculate entropy to distinguish Opus (high entropy) from PCM (lower entropy)
    const entropy = calculateEntropy(data);

    // Opus typically has higher entropy (>= 6.0) due to compression
    // PCM has lower entropy (< 6.0) due to predictable waveform patterns
    return entropy >= 6.0 ? 'opus' : 'pcm';
}

/**
 * Calculate Shannon entropy of data
 * @param {Buffer} data - Data buffer
 * @returns {number} Entropy value
 */
function calculateEntropy(data) {
    const freq = new Map();

    // Count byte frequencies
    for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        freq.set(byte, (freq.get(byte) || 0) + 1);
    }

    // Calculate entropy
    let entropy = 0;
    const len = data.length;

    for (const count of freq.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }

    return entropy;
}

/**
 * Check if audio frame is silent or nearly silent
 * @param {Buffer} pcmData - PCM audio data (16-bit samples)
 * @returns {Object} { isSilent, isNearlySilent, maxAmplitude }
 */
function checkSilence(pcmData) {
    const samples = new Int16Array(
        pcmData.buffer,
        pcmData.byteOffset,
        pcmData.length / 2
    );

    const isSilent = samples.every((sample) => sample === 0);
    const maxAmplitude = Math.max(...samples.map((s) => Math.abs(s)));
    const isNearlySilent = maxAmplitude < 10;

    return { isSilent, isNearlySilent, maxAmplitude };
}

/**
 * Validate audio frame
 * @param {*} frame - Audio frame object
 * @returns {boolean} True if valid
 */
function validateAudioFrame(frame) {
    if (!frame || !frame.data) {
        return false;
    }

    if (!frame.data.buffer || !frame.data.byteOffset || !frame.data.byteLength) {
        return false;
    }

    return true;
}

module.exports = {
    detectAudioFormat,
    calculateEntropy,
    checkSilence,
    validateAudioFrame,
};
