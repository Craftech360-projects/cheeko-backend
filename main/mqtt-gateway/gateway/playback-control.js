/**
 * Playback Control
 * 
 * Handles media playback controls (next, previous, start).
 * Integrates with Cerebrium Media API for music and story bots.
 */

const axios = require('axios');
const { MEDIA_API_BASE, mediaAxiosConfig } = require('../core/media-api-client');

/**
 * Playback control handler
 */
class PlaybackControl {
    constructor() {
        this.activeRooms = new Map(); // Track active playback rooms
    }

    /**
     * Handle next track request
     * @param {string} roomName - LiveKit room name
     * @param {string} mode - Mode (music or story)
     */
    async handleNext(roomName, mode) {
        console.log(`⏭️ [PLAYBACK] Next requested for room: ${roomName} (${mode})`);

        try {
            const endpoint = mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/next`,
                {},
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Next track started:`, response.data);
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Next track error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle previous track request
     * @param {string} roomName - LiveKit room name
     * @param {string} mode - Mode (music or story)
     */
    async handlePrevious(roomName, mode) {
        console.log(`⏮️ [PLAYBACK] Previous requested for room: ${roomName} (${mode})`);

        try {
            const endpoint = mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/previous`,
                {},
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Previous track started:`, response.data);
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Previous track error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle start playback request
     * @param {string} roomName - LiveKit room name
     * @param {string} mode - Mode (music or story)
     * @param {Object} options - Playback options
     */
    async handleStart(roomName, mode, options = {}) {
        console.log(`▶️ [PLAYBACK] Start requested for room: ${roomName} (${mode})`);

        try {
            const endpoint = mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/start`,
                options,
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Playback started:`, response.data);
            this.activeRooms.set(roomName, { mode, startedAt: Date.now() });
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Start playback error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle stop playback request
     * @param {string} roomName - LiveKit room name
     */
    async handleStop(roomName) {
        console.log(`⏹️ [PLAYBACK] Stop requested for room: ${roomName}`);

        const roomInfo = this.activeRooms.get(roomName);
        if (!roomInfo) {
            console.warn(`⚠️ [PLAYBACK] No active playback for room: ${roomName}`);
            return;
        }

        try {
            const endpoint = roomInfo.mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/stop`,
                {},
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Playback stopped:`, response.data);
            this.activeRooms.delete(roomName);
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Stop playback error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle pause playback request
     * @param {string} roomName - LiveKit room name
     */
    async handlePause(roomName) {
        console.log(`⏸️ [PLAYBACK] Pause requested for room: ${roomName}`);

        const roomInfo = this.activeRooms.get(roomName);
        if (!roomInfo) {
            console.warn(`⚠️ [PLAYBACK] No active playback for room: ${roomName}`);
            return;
        }

        try {
            const endpoint = roomInfo.mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/pause`,
                {},
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Playback paused:`, response.data);
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Pause playback error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle resume playback request
     * @param {string} roomName - LiveKit room name
     */
    async handleResume(roomName) {
        console.log(`▶️ [PLAYBACK] Resume requested for room: ${roomName}`);

        const roomInfo = this.activeRooms.get(roomName);
        if (!roomInfo) {
            console.warn(`⚠️ [PLAYBACK] No active playback for room: ${roomName}`);
            return;
        }

        try {
            const endpoint = roomInfo.mode === 'music' ? 'music-bot' : 'story-bot';
            const response = await axios.post(
                `${MEDIA_API_BASE}/${endpoint}/${roomName}/resume`,
                {},
                mediaAxiosConfig()
            );

            console.log(`✅ [PLAYBACK] Playback resumed:`, response.data);
            return response.data;
        } catch (error) {
            console.error(`❌ [PLAYBACK] Resume playback error:`, error.message);
            throw error;
        }
    }

    /**
     * Get active playback rooms
     */
    getActiveRooms() {
        return Array.from(this.activeRooms.entries()).map(([roomName, info]) => ({
            roomName,
            ...info,
        }));
    }

    /**
     * Clean up room tracking
     * @param {string} roomName - Room name to clean up
     */
    cleanup(roomName) {
        this.activeRooms.delete(roomName);
    }
}

module.exports = {
    PlaybackControl,
};
