/**
 * MQTT Message Parser
 * 
 * Parses MQTT messages from devices including hello, goodbye, and abort messages.
 * Handles client ID parsing (GID@@@MAC@@@UUID format).
 */

/**
 * Parse client ID in format: GID@@@MAC@@@UUID
 * @param {string} clientId - Client ID string
 * @returns {Object} { gid, mac, uuid } or null if invalid
 */
function parseClientId(clientId) {
    if (!clientId || typeof clientId !== 'string') {
        return null;
    }

    const parts = clientId.split('@@@');
    if (parts.length !== 3) {
        console.warn(`⚠️ [PARSE] Invalid client ID format: ${clientId}`);
        return null;
    }

    return {
        gid: parts[0],
        mac: parts[1],
        uuid: parts[2],
    };
}

/**
 * Parse hello message from device
 * @param {Object} message - MQTT message object
 * @returns {Object} Parsed hello data
 */
function parseHelloMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        return {
            type: 'hello',
            clientId: data.client_id || data.clientId,
            audioParams: data.audio_params || data.audioParams,
            features: data.features || {},
            protocolVersion: data.protocol_version || data.protocolVersion || 1,
            timestamp: data.timestamp || Date.now(),
        };
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing hello message:`, error);
        return null;
    }
}

/**
 * Parse goodbye message from device
 * @param {Object} message - MQTT message object
 * @returns {Object} Parsed goodbye data
 */
function parseGoodbyeMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        return {
            type: 'goodbye',
            clientId: data.client_id || data.clientId,
            reason: data.reason || 'unknown',
            sessionId: data.session_id || data.sessionId,
            timestamp: data.timestamp || Date.now(),
        };
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing goodbye message:`, error);
        return null;
    }
}

/**
 * Parse abort message from device
 * @param {Object} message - MQTT message object
 * @returns {Object} Parsed abort data
 */
function parseAbortMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        return {
            type: 'abort',
            clientId: data.client_id || data.clientId,
            reason: data.reason || 'unknown',
            timestamp: data.timestamp || Date.now(),
        };
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing abort message:`, error);
        return null;
    }
}

/**
 * Parse mode change message
 * @param {Object} message - MQTT message object
 * @returns {Object} Parsed mode change data
 */
function parseModeChangeMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        return {
            type: 'mode_change',
            clientId: data.client_id || data.clientId,
            newMode: data.new_mode || data.newMode,
            oldMode: data.old_mode || data.oldMode,
            isModeSwitch: data.is_mode_switch !== undefined ? data.is_mode_switch : true,
            timestamp: data.timestamp || Date.now(),
        };
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing mode change message:`, error);
        return null;
    }
}

/**
 * Parse character change message
 * @param {Object} message - MQTT message object
 * @returns {Object} Parsed character change data
 */
function parseCharacterChangeMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        return {
            type: 'character_change',
            clientId: data.client_id || data.clientId,
            newCharacter: data.new_character || data.newCharacter,
            oldCharacter: data.old_character || data.oldCharacter,
            timestamp: data.timestamp || Date.now(),
        };
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing character change message:`, error);
        return null;
    }
}

/**
 * Parse generic MQTT message and determine type
 * @param {string|Object} message - MQTT message
 * @returns {Object} Parsed message with type
 */
function parseMessage(message) {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        const type = data.type || 'unknown';

        switch (type) {
            case 'hello':
                return parseHelloMessage(data);
            case 'goodbye':
                return parseGoodbyeMessage(data);
            case 'abort':
                return parseAbortMessage(data);
            case 'mode_change':
                return parseModeChangeMessage(data);
            case 'character_change':
                return parseCharacterChangeMessage(data);
            default:
                return { type, data };
        }
    } catch (error) {
        console.error(`❌ [PARSE] Error parsing message:`, error);
        return null;
    }
}

module.exports = {
    parseClientId,
    parseHelloMessage,
    parseGoodbyeMessage,
    parseAbortMessage,
    parseModeChangeMessage,
    parseCharacterChangeMessage,
    parseMessage,
};
