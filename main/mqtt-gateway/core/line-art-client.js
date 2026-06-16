/**
 * Line Art Client
 *
 * HTTP client for the line_art FastAPI service.
 * Used by ai_printer devices to generate 1-bit monochrome bitmaps
 * from audio (WAV) or text input.
 */

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');

class LineArtClient {
  /**
   * @param {string} [baseUrl] - Base URL of the line_art service
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl || process.env.LINE_ART_URL || 'http://localhost:8003';
    logger.info(`[LINE-ART] Client initialized: ${this.baseUrl}`);
  }

  /**
   * Generate line art from audio (WAV buffer).
   * @param {Buffer} wavBuffer - WAV audio file buffer (16kHz, mono, 16-bit PCM)
   * @returns {Promise<{transcription: string, raw_mono: string, width: number, height: number, prompt_used: string}>}
   */
  async generateFromAudio(wavBuffer) {
    const form = new FormData();
    form.append('file', wavBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav',
    });

    const response = await axios.post(`${this.baseUrl}/generate`, form, {
      headers: form.getHeaders(),
      timeout: 60000, // 60s — image gen can take 20-30s
      maxContentLength: 50 * 1024 * 1024,
      maxBodyLength: 50 * 1024 * 1024,
    });

    return response.data;
  }

  /**
   * Generate line art from text prompt.
   * @param {string} text - Subject to draw (e.g., "cat")
   * @returns {Promise<{transcription: string, raw_mono: string, width: number, height: number, prompt_used: string}>}
   */
  async generateFromText(text) {
    const form = new FormData();
    form.append('text', text);

    const response = await axios.post(`${this.baseUrl}/generate`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });

    return response.data;
  }

  /**
   * Check if the line_art service is healthy.
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

module.exports = { LineArtClient };
