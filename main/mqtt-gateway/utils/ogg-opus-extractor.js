/**
 * Simple OGG Opus packet extractor
 * Extracts raw Opus packets from OGG container
 */

class OggOpusExtractor {
    /**
     * Extract Opus packets from OGG container
     * @param {Buffer} oggBuffer - OGG file buffer
     * @returns {Array<Buffer>} - Array of raw Opus packets
     */
    static extractOpusPackets(oggBuffer) {
        const packets = [];
        let offset = 0;

        while (offset < oggBuffer.length) {
            // Check for OGG page header "OggS"
            if (offset + 27 > oggBuffer.length) break;

            const capture = oggBuffer.toString('ascii', offset, offset + 4);
            if (capture !== 'OggS') {
                // Skip to next potential page
                offset++;
                continue;
            }

            // Read page header
            const headerType = oggBuffer[offset + 5];
            const segmentCount = oggBuffer[offset + 26];

            if (offset + 27 + segmentCount > oggBuffer.length) break;

            // Read segment table
            const segmentTable = [];
            for (let i = 0; i < segmentCount; i++) {
                segmentTable.push(oggBuffer[offset + 27 + i]);
            }

            // Calculate total payload size
            const payloadSize = segmentTable.reduce((sum, size) => sum + size, 0);
            const payloadOffset = offset + 27 + segmentCount;

            if (payloadOffset + payloadSize > oggBuffer.length) break;

            // Extract payload (Opus packet)
            const payload = oggBuffer.slice(payloadOffset, payloadOffset + payloadSize);

            // Skip OpusHead and OpusTags packets (metadata)
            if (payload.length > 8) {
                const header = payload.toString('ascii', 0, 8);
                if (header !== 'OpusHead' && header !== 'OpusTags') {
                    // This is an actual Opus audio packet
                    packets.push(payload);
                }
            }

            // Move to next page
            offset = payloadOffset + payloadSize;
        }

        return packets;
    }
}

module.exports = OggOpusExtractor;
