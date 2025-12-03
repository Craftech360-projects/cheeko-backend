/**
 * Device Handlers
 * 
 * Handles device events: hello, goodbye, mode change, character change.
 * Coordinates with LiveKit, MQTT, and Manager API.
 */

const axios = require('axios');

/**
 * Device event handlers
 */
class DeviceHandlers {
    constructor(gateway) {
        this.gateway = gateway;
        this.managerApiUrl = process.env.MANAGER_API_URL || 'http://localhost:3000/toy';
    }

    /**
     * Handle device hello message
     * @param {Object} data - Parsed hello data
     * @param {Object} clientInfo - Client connection info
     */
    async handleHello(data, clientInfo) {
        const { mac, uuid, gid } = clientInfo;
        console.log(`👋 [HELLO] Device connected: ${mac} (UUID: ${uuid})`);

        try {
            // Query Manager API for device info and mode
            const deviceInfo = await this.getDeviceInfo(mac);
            console.log(`📱 [DEVICE-INFO] Mode: ${deviceInfo.mode}, Character: ${deviceInfo.character}`);

            // Store device connection
            this.gateway.deviceConnections.set(mac, {
                mac,
                uuid,
                gid,
                mode: deviceInfo.mode || 'conversation',
                character: deviceInfo.character || 'default',
                connectedAt: Date.now(),
                clientInfo,
            });

            return deviceInfo;
        } catch (error) {
            console.error(`❌ [HELLO] Error handling hello:`, error.message);
            throw error;
        }
    }

    /**
     * Handle device goodbye message
     * @param {Object} data - Parsed goodbye data
     * @param {string} mac - Device MAC address
     */
    async handleGoodbye(data, mac) {
        console.log(`👋 [GOODBYE] Device disconnecting: ${mac}`);

        try {
            // Clean up device connection
            const deviceInfo = this.gateway.deviceConnections.get(mac);
            if (deviceInfo) {
                // Clean up LiveKit room if exists
                if (deviceInfo.livekitBridge) {
                    await deviceInfo.livekitBridge.disconnect();
                }

                // Remove from tracking
                this.gateway.deviceConnections.delete(mac);
                console.log(`✅ [GOODBYE] Device cleaned up: ${mac}`);
            }
        } catch (error) {
            console.error(`❌ [GOODBYE] Error handling goodbye:`, error.message);
        }
    }

    /**
     * Handle mode change request
     * @param {Object} data - Mode change data
     * @param {string} mac - Device MAC address
     */
    async handleModeChange(data, mac) {
        const { newMode, oldMode, isModeSwitch } = data;
        console.log(`🔄 [MODE-CHANGE] ${mac}: ${oldMode} → ${newMode}`);

        try {
            const deviceInfo = this.gateway.deviceConnections.get(mac);
            if (!deviceInfo) {
                console.error(`❌ [MODE-CHANGE] Device not found: ${mac}`);
                return;
            }

            // Clean up old LiveKit room
            if (deviceInfo.livekitBridge) {
                console.log(`🧹 [MODE-CHANGE] Cleaning up old room for ${mac}`);
                await deviceInfo.livekitBridge.disconnect();
                deviceInfo.livekitBridge = null;
            }

            // Update device mode
            deviceInfo.mode = newMode;
            deviceInfo.isModeSwitch = isModeSwitch;

            // Create new LiveKit room for new mode
            console.log(`🏠 [MODE-CHANGE] Creating new ${newMode} room for ${mac}`);
            // The actual room creation will be handled by the connection flow

            return { success: true, newMode };
        } catch (error) {
            console.error(`❌ [MODE-CHANGE] Error:`, error.message);
            throw error;
        }
    }

    /**
     * Handle character change request
     * @param {Object} data - Character change data
     * @param {string} mac - Device MAC address
     */
    async handleCharacterChange(data, mac) {
        const { newCharacter, oldCharacter } = data;
        console.log(`🎭 [CHARACTER-CHANGE] ${mac}: ${oldCharacter} → ${newCharacter}`);

        try {
            const deviceInfo = this.gateway.deviceConnections.get(mac);
            if (!deviceInfo) {
                console.error(`❌ [CHARACTER-CHANGE] Device not found: ${mac}`);
                return;
            }

            // Update character
            deviceInfo.character = newCharacter;

            // Notify LiveKit room if exists
            if (deviceInfo.livekitBridge) {
                // Send character change notification
                console.log(`📢 [CHARACTER-CHANGE] Notifying room for ${mac}`);
            }

            return { success: true, newCharacter };
        } catch (error) {
            console.error(`❌ [CHARACTER-CHANGE] Error:`, error.message);
            throw error;
        }
    }

    /**
     * Get device info from Manager API
     * @param {string} mac - Device MAC address
     * @returns {Object} Device info
     */
    async getDeviceInfo(mac) {
        try {
            const response = await axios.get(`${this.managerApiUrl}/${mac}`, {
                timeout: 5000,
            });

            return {
                mode: response.data.mode || 'conversation',
                character: response.data.character || 'default',
                userData: response.data,
            };
        } catch (error) {
            console.warn(`⚠️ [MANAGER-API] Failed to get device info for ${mac}:`, error.message);
            // Return defaults if API fails
            return {
                mode: 'conversation',
                character: 'default',
                userData: null,
            };
        }
    }

    /**
     * Handle device inactivity timeout
     * @param {string} mac - Device MAC address
     */
    async handleInactivityTimeout(mac) {
        console.log(`⏰ [TIMEOUT] Inactivity timeout for device: ${mac}`);

        try {
            const deviceInfo = this.gateway.deviceConnections.get(mac);
            if (deviceInfo && deviceInfo.livekitBridge) {
                // Send goodbye message
                await this.handleGoodbye({ reason: 'inactivity_timeout' }, mac);
            }
        } catch (error) {
            console.error(`❌ [TIMEOUT] Error handling timeout:`, error.message);
        }
    }
}

module.exports = {
    DeviceHandlers,
};

