/**
 * Opus Codec Initializer
 * 
 * Initializes Opus encoder and decoder using @discordjs/opus library.
 * Handles library loading, validation, and encoder/decoder setup.
 */

const {
    OUTGOING_SAMPLE_RATE,
    INCOMING_SAMPLE_RATE,
    CHANNELS,
    OUTGOING_FRAME_DURATION_MS,
    INCOMING_FRAME_DURATION_MS,
} = require("../constants/audio");

let OpusEncoder, OpusDecoder;
let opusLib = null;
let opusEncoder = null;
let opusDecoder = null;

/**
 * Load and validate Opus library
 * @throws {Error} If Opus library is not available
 */
function loadOpusLibrary() {
    try {
        const discordOpus = require("@discordjs/opus");
        OpusEncoder = discordOpus.OpusEncoder;
        OpusDecoder = discordOpus.OpusEncoder; // Discord opus uses same class for encoding/decoding
        opusLib = "@discordjs/opus";
        // console.log("✅ [OPUS] Using native @discordjs/opus");
        return true;
    } catch (err) {
        console.error("❌ [OPUS] @discordjs/opus not available:", err.message);
        console.error("❌ [OPUS] Please run: npm install @discordjs/opus");
        OpusEncoder = null;
        OpusDecoder = null;
        return false;
    }
}

/**
 * Initialize Opus encoder and decoder
 * @returns {Object} Object containing encoder and decoder instances
 * @throws {Error} If initialization fails
 */
function initializeOpus() {
    if (!OpusEncoder) {
        const loaded = loadOpusLibrary();
        if (!loaded) {
            process.exit(1); // Exit if Opus not available - it's required
        }
    }

    try {
        // @discordjs/opus API: new OpusEncoder(sampleRate, channels)
        opusEncoder = new OpusEncoder(OUTGOING_SAMPLE_RATE, CHANNELS);
        opusDecoder = new OpusEncoder(INCOMING_SAMPLE_RATE, CHANNELS); // Same class for decode

        // console.log(`✅ [OPUS] Encoder: ${OUTGOING_SAMPLE_RATE}Hz, Decoder: ${INCOMING_SAMPLE_RATE}Hz`);

        return { opusEncoder, opusDecoder };
    } catch (err) {
        console.error(`❌ [OPUS] Failed to initialize encoder/decoder:`, err.message);
        process.exit(1); // Exit if initialization fails
    }
}

/**
 * Get initialized Opus encoder
 * @returns {OpusEncoder} Opus encoder instance
 */
function getOpusEncoder() {
    if (!opusEncoder) {
        initializeOpus();
    }
    return opusEncoder;
}

/**
 * Get initialized Opus decoder
 * @returns {OpusDecoder} Opus decoder instance
 */
function getOpusDecoder() {
    if (!opusDecoder) {
        initializeOpus();
    }
    return opusDecoder;
}

module.exports = {
    loadOpusLibrary,
    initializeOpus,
    getOpusEncoder,
    getOpusDecoder,
    // Export for direct access if needed
    get opusEncoder() {
        return opusEncoder;
    },
    get opusDecoder() {
        return opusDecoder;
    },
    get opusLib() {
        return opusLib;
    },
};
