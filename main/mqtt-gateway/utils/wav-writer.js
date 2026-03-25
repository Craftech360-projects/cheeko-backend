/**
 * WAV Writer Utility
 *
 * Wraps raw PCM samples into a valid WAV file buffer (44-byte header + PCM data).
 * Used by ai_printer flow to convert decoded Opus frames into WAV for the line_art API.
 */

/**
 * Create a WAV file buffer from raw PCM data.
 * @param {Buffer} pcmBuffer - Raw PCM samples (16-bit signed, little-endian)
 * @param {number} [sampleRate=16000] - Sample rate in Hz
 * @param {number} [channels=1] - Number of channels (1 = mono)
 * @param {number} [bitDepth=16] - Bits per sample
 * @returns {Buffer} Complete WAV file buffer (44-byte header + PCM data)
 */
function createWavBuffer(pcmBuffer, sampleRate = 16000, channels = 1, bitDepth = 16) {
  const dataLength = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);                                       // ChunkID
  header.writeUInt32LE(36 + dataLength, 4);                      // ChunkSize
  header.write('WAVE', 8);                                       // Format

  // fmt sub-chunk
  header.write('fmt ', 12);                                      // Subchunk1ID
  header.writeUInt32LE(16, 16);                                  // Subchunk1Size (PCM = 16)
  header.writeUInt16LE(1, 20);                                   // AudioFormat (PCM = 1)
  header.writeUInt16LE(channels, 22);                            // NumChannels
  header.writeUInt32LE(sampleRate, 24);                          // SampleRate
  header.writeUInt32LE(sampleRate * channels * bitDepth / 8, 28); // ByteRate
  header.writeUInt16LE(channels * bitDepth / 8, 32);             // BlockAlign
  header.writeUInt16LE(bitDepth, 34);                            // BitsPerSample

  // data sub-chunk
  header.write('data', 36);                                      // Subchunk2ID
  header.writeUInt32LE(dataLength, 40);                          // Subchunk2Size

  return Buffer.concat([header, pcmBuffer]);
}

module.exports = { createWavBuffer };
