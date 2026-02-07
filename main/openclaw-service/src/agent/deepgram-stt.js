/**
 * Deepgram STT Client
 * Handles speech-to-text transcription using Deepgram API
 */

const { createClient } = require('@deepgram/sdk');
const logger = require('../utils/logger');

class DeepgramSTT {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('Deepgram API key is required');
        }
        
        this.client = createClient(apiKey);
        this.isReady = true;
        logger.info('[DEEPGRAM] STT client initialized');
    }

    /**
     * Transcribe audio buffer to text
     * @param {Buffer} audioBuffer - Audio data (PCM, WAV, etc.)
     * @param {Object} options - Transcription options
     * @returns {Promise<string>} - Transcribed text
     */
    async transcribe(audioBuffer, options = {}) {
        try {
            const { result, error } = await this.client.listen.prerecorded.transcribeFile(
                audioBuffer,
                {
                    model: options.model || 'nova-2',
                    language: options.language || 'en',
                    smart_format: true,
                    punctuate: true,
                    utterances: false,
                }
            );

            if (error) {
                throw error;
            }

            const transcript = result.results.channels[0].alternatives[0].transcript;
            logger.info(`[DEEPGRAM] Transcribed: "${transcript}"`);
            
            return transcript;
        } catch (error) {
            logger.error('[DEEPGRAM] Transcription error:', error);
            throw error;
        }
    }

    /**
     * Create a live transcription stream
     * @param {Object} options - Stream options
     * @returns {Object} - Deepgram live stream
     */
    createLiveStream(options = {}) {
        try {
            const connection = this.client.listen.live({
                model: options.model || 'nova-2',
                language: options.language || 'en',
                smart_format: true,
                punctuate: true,
                interim_results: options.interimResults || false,
                encoding: options.encoding || 'linear16',
                sample_rate: options.sampleRate || 16000,
            });

            logger.info('[DEEPGRAM] Live stream created');
            return connection;
        } catch (error) {
            logger.error('[DEEPGRAM] Stream creation error:', error);
            throw error;
        }
    }
}

module.exports = DeepgramSTT;
