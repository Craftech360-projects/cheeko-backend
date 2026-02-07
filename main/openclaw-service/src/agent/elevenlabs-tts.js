/**
 * ElevenLabs TTS Client
 * Handles text-to-speech synthesis using ElevenLabs API
 */

const { ElevenLabsClient } = require('elevenlabs');
const logger = require('../utils/logger');

class ElevenLabsTTS {
    constructor(apiKey, voiceId) {
        if (!apiKey) {
            throw new Error('ElevenLabs API key is required');
        }

        this.client = new ElevenLabsClient({ apiKey });
        this.voiceId = voiceId || 'EXAVITQu4vr4xnSDxMaL'; // Default voice
        this.model = 'eleven_turbo_v2_5'; // Low latency model
        this.isReady = true;

        logger.info(`[ELEVENLABS-TTS] TTS client initialized with voice: ${this.voiceId}`);
    }

    /**
     * Convert text to speech
     * @param {string} text - Text to synthesize
     * @param {Object} options - Synthesis options
     * @returns {Promise<Buffer>} - Audio buffer (MP3/Opus)
     */
    async synthesize(text, options = {}) {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Text is required for synthesis');
            }

            logger.info(`[ELEVENLABS-TTS] Synthesizing: "${text}"`);

            const audioStream = await this.client.textToSpeech.convert(
                options.voiceId || this.voiceId,
                {
                    text,
                    model_id: options.model || this.model,
                    output_format: 'pcm_16000', // PCM 16kHz (Gateway will encode to Opus)
                }
            );

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of audioStream) {
                chunks.push(chunk);
            }
            const audioBuffer = Buffer.concat(chunks);

            logger.info(`[ELEVENLABS-TTS] Synthesis complete (${audioBuffer.length} bytes)`);

            // Save audio to file for verification (optional debugging)
            if (process.env.SAVE_AUDIO_FILES === 'true') {
                const fs = require('fs').promises;
                const path = require('path');
                const audioDir = path.join(__dirname, '../../audio-output');
                try {
                    await fs.mkdir(audioDir, { recursive: true });
                    const filename = `tts_eleven_${Date.now()}.opus`;
                    const filepath = path.join(audioDir, filename);
                    await fs.writeFile(filepath, audioBuffer);
                    logger.info(`[ELEVENLABS-TTS] Audio saved to: ${filepath}`);
                } catch (saveError) {
                    logger.warn(`[ELEVENLABS-TTS] Failed to save audio file:`, saveError.message);
                }
            }

            return audioBuffer;

        } catch (error) {
            let errorMessage = error.message;
            if (error.body && error.body._readableState) {
                // Try to read the error body stream
                try {
                    const chunks = [];
                    for await (const chunk of error.body) {
                        chunks.push(chunk);
                    }
                    const bodyText = Buffer.concat(chunks).toString('utf8');
                    logger.error(`[ELEVENLABS-TTS] API Error Body: ${bodyText}`);
                    errorMessage += ` | Body: ${bodyText}`;
                } catch (readError) {
                    logger.warn('[ELEVENLABS-TTS] Could not read error body stream');
                }
            } else if (error.body) {
                logger.error(`[ELEVENLABS-TTS] API Error Body:`, JSON.stringify(error.body));
            }

            logger.error('[ELEVENLABS-TTS] Synthesis error:', errorMessage);
            throw error;
        }
    }
}

module.exports = ElevenLabsTTS;
