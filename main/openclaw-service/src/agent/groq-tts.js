/**
 * Groq TTS Client
 * Handles text-to-speech synthesis using Groq API with canopylabs/orpheus-v1-english
 */

const Groq = require('groq-sdk');
const logger = require('../utils/logger');

class GroqTTS {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('Groq API key is required');
        }

        this.client = new Groq({ apiKey });
        this.model = 'canopylabs/orpheus-v1-english';
        this.isReady = true;

        logger.info(`[GROQ-TTS] TTS client initialized with model: ${this.model}`);
    }

    /**
     * Convert text to speech
     * @param {string} text - Text to synthesize
     * @param {Object} options - Synthesis options
     * @returns {Promise<Buffer>} - Audio buffer
     */
    async synthesize(text, options = {}) {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Text is required for synthesis');
            }

            logger.info(`[GROQ-TTS] Synthesizing: "${text}"`);

            // Use Groq's audio.speech.create API
            const response = await this.client.audio.speech.create({
                model: this.model,
                input: text,
                voice: options.voice || 'alloy', // Default voice
                response_format: options.format || 'mp3',
            });

            // Convert response to buffer
            const audioBuffer = Buffer.from(await response.arrayBuffer());

            logger.info(`[GROQ-TTS] Synthesis complete (${audioBuffer.length} bytes)`);
            return audioBuffer;

        } catch (error) {
            logger.error('[GROQ-TTS] Synthesis error:', error);
            throw error;
        }
    }
}

module.exports = GroqTTS;
