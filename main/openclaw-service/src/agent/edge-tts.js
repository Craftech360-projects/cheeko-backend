/**
 * Edge-TTS Client
 * Handles text-to-speech synthesis using Microsoft Edge TTS (free)
 */

const EdgeTTS = require('edge-tts');
const logger = require('../utils/logger');

class EdgeTTSClient {
    constructor() {
        this.voice = 'en-US-AriaNeural'; // Friendly female voice
        this.isReady = true;

        logger.info(`[EDGE-TTS] TTS client initialized with voice: ${this.voice}`);
    }

    /**
     * Convert text to speech
     * @param {string} text - Text to synthesize
     * @param {Object} options - Synthesis options
     * @returns {Promise<Buffer>} - Audio buffer (MP3)
     */
    async synthesize(text, options = {}) {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Text is required for synthesis');
            }

            logger.info(`[EDGE-TTS] Synthesizing: "${text}"`);

            const voice = options.voice || this.voice;

            // Use Edge-TTS JavaScript API
            const tts = new EdgeTTS();
            await tts.setVoice(voice);

            const audioData = await tts.ttsPromise(text);

            // Convert to buffer
            const audioBuffer = Buffer.from(audioData);

            logger.info(`[EDGE-TTS] Synthesis complete (${audioBuffer.length} bytes)`);
            return audioBuffer;

        } catch (error) {
            logger.error('[EDGE-TTS] Synthesis error:', error);
            throw error;
        }
    }
}

module.exports = EdgeTTSClient;

