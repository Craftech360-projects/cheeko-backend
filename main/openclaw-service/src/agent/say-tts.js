/**
 * Say.js TTS Client
 * Handles text-to-speech synthesis using Windows native TTS
 */

const say = require('say');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const sayExport = promisify(say.export);

class SayTTS {
    constructor() {
        this.voice = 'Microsoft Zira Desktop'; // Windows default voice
        this.isReady = true;
        this.tempDir = path.join(__dirname, '../../temp');

        // Ensure temp directory exists
        this.ensureTempDir();

        logger.info(`[SAY-TTS] TTS client initialized with voice: ${this.voice}`);
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            // Ignore if already exists
        }
    }

    /**
     * Convert text to speech
     * @param {string} text - Text to synthesize
     * @param {Object} options - Synthesis options
     * @returns {Promise<Buffer>} - Audio buffer (WAV)
     */
    async synthesize(text, options = {}) {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Text is required for synthesis');
            }

            logger.info(`[SAY-TTS] Synthesizing: "${text}"`);

            const outputFile = path.join(this.tempDir, `tts_${Date.now()}.wav`);

            // Use say.js to export audio
            await sayExport(text, this.voice, 1.0, outputFile);

            // Read the audio file
            const audioBuffer = await fs.readFile(outputFile);

            // Clean up temp file
            await fs.unlink(outputFile).catch(() => { });

            logger.info(`[SAY-TTS] Synthesis complete (${audioBuffer.length} bytes)`);
            return audioBuffer;

        } catch (error) {
            logger.error('[SAY-TTS] Synthesis error:', error);
            throw error;
        }
    }
}

module.exports = SayTTS;
