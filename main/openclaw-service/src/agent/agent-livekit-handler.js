/**
 * Agent LiveKit Handler
 * Handles LiveKit audio streaming for the OpenClaw agent
 */

const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const logger = require('../utils/logger');

class AgentLiveKitHandler {
    constructor(config) {
        this.config = config;
        this.roomService = new RoomServiceClient(
            config.livekitUrl,
            config.livekitApiKey,
            config.livekitApiSecret
        );

        this.activeRooms = new Map(); // deviceMac -> room info
        logger.info('[AGENT-LIVEKIT] Handler initialized');
    }

    /**
     * Send audio to device via LiveKit
     * @param {string} deviceMac - Device MAC address
     * @param {Buffer} audioBuffer - Audio data (MP3)
     */
    async sendAudio(deviceMac, audioBuffer) {
        try {
            // Get or create room for device
            const roomName = this.getRoomName(deviceMac);

            logger.info(`[AGENT-LIVEKIT] Sending audio to ${deviceMac} in room ${roomName} (${audioBuffer.length} bytes)`);

            // For now, we'll publish via MQTT since LiveKit audio publishing
            // from server-side requires more complex setup
            // The MQTT gateway will forward this to LiveKit

            // TODO: Implement direct LiveKit audio track publishing
            // This would require creating a participant and audio track

            // For Phase 2, we'll use MQTT to send audio
            const mqttClient = require('../core/mqtt-client');
            await mqttClient.publishAudio(deviceMac, audioBuffer);

            logger.info(`[AGENT-LIVEKIT] Audio sent to ${deviceMac}`);

        } catch (error) {
            logger.error('[AGENT-LIVEKIT] Error sending audio:', error);
            throw error;
        }
    }

    /**
     * Get room name for device
     * @param {string} deviceMac - Device MAC address
     * @returns {string} - Room name
     */
    getRoomName(deviceMac) {
        const formattedMac = deviceMac.replace(/:/g, '_');
        return `${formattedMac}_conversation`;
    }

    /**
     * Create access token for device
     * @param {string} deviceMac - Device MAC address
     * @returns {string} - Access token
     */
    createAccessToken(deviceMac) {
        const roomName = this.getRoomName(deviceMac);
        const participantName = `agent_${deviceMac}`;

        const token = new AccessToken(
            this.config.livekitApiKey,
            this.config.livekitApiSecret,
            {
                identity: participantName,
                name: 'OpenClaw Agent',
            }
        );

        token.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
        });

        return token.toJwt();
    }

    /**
     * Get active rooms
     * @returns {Promise<Array>} - List of active rooms
     */
    async getActiveRooms() {
        try {
            const rooms = await this.roomService.listRooms();
            return rooms;
        } catch (error) {
            logger.error('[AGENT-LIVEKIT] Error getting rooms:', error);
            return [];
        }
    }
}

module.exports = AgentLiveKitHandler;
