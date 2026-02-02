/**
 * Pipecat Signaling Client
 *
 * HTTP client for WebRTC signaling with Pipecat server.
 * Handles SDP offer/answer exchange and session management.
 */

const axios = require("axios");
const logger = require("../utils/logger");

// Global config manager reference
let configManager = null;

function setConfigManager(cm) {
  configManager = cm;
}

/**
 * Get Pipecat configuration from config manager or environment
 * @returns {Object} Pipecat config with url, endpoints, and timeout
 */
function getPipecatConfig() {
  let config = {
    url: process.env.PIPECAT_URL || "http://192.168.1.168:7860",
    offer_endpoint: "/api/offer",
    timeout_ms: 10000,
  };

  // Override with config file if available
  if (configManager) {
    const pipecatConfig = configManager.get("pipecat");
    if (pipecatConfig) {
      config = { ...config, ...pipecatConfig };
    }
  }

  return config;
}

/**
 * Send SDP offer to Pipecat server and get SDP answer
 *
 * @param {string} sdpOffer - The SDP offer from the device
 * @param {Object} metadata - Device metadata to pass to Pipecat
 * @param {string} metadata.device_mac - Device MAC address
 * @param {string} metadata.device_id - Device ID
 * @param {string} metadata.character - Character name for agent personality
 * @param {Object} metadata.child_profile - Child profile data (name, age)
 * @param {Object} metadata.memories - Mem0 memories data
 * @returns {Promise<Object>} Response with sdp answer and pc_id
 */
async function sendOffer(sdpOffer, metadata = {}) {
  const config = getPipecatConfig();
  const url = `${config.url}${config.offer_endpoint}`;

  logger.info(`🔄 [PIPECAT-SIG] Sending SDP offer to: ${url}`);
  logger.info(`🔄 [PIPECAT-SIG] Metadata: ${JSON.stringify({
    device_mac: metadata.device_mac,
    character: metadata.character,
    child_name: metadata.child_profile?.name,
  })}`);

  try {
    const requestBody = {
      sdp: sdpOffer,
      type: "offer",
      // Pass device metadata for Pipecat agent to use
      metadata: {
        device_mac: metadata.device_mac || "",
        device_id: metadata.device_id || "",
        character: metadata.character || "Cheeko",
        child_profile: metadata.child_profile || null,
        memories: metadata.memories || null,
        room_type: metadata.room_type || "conversation",
        timestamp: Date.now(),
      },
    };

    const response = await axios.post(url, requestBody, {
      timeout: config.timeout_ms,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.data && response.data.sdp) {
      logger.info(`✅ [PIPECAT-SIG] Received SDP answer, pc_id: ${response.data.pc_id || "none"}`);
      return {
        sdp: response.data.sdp,
        type: response.data.type || "answer",
        pc_id: response.data.pc_id || null,
      };
    } else {
      logger.error(`❌ [PIPECAT-SIG] Invalid response - missing SDP answer`);
      throw new Error("Invalid Pipecat response: missing SDP answer");
    }
  } catch (error) {
    if (error.response) {
      logger.error(`❌ [PIPECAT-SIG] Server error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      logger.error(`❌ [PIPECAT-SIG] No response from server: ${error.message}`);
    } else {
      logger.error(`❌ [PIPECAT-SIG] Request error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Send application message to Pipecat via HTTP (data channel proxy)
 * Used for control messages when device can't send directly via WebRTC data channel
 *
 * @param {string} pcId - Peer connection ID from Pipecat
 * @param {Object} message - Message to send (will be JSON stringified)
 * @returns {Promise<Object>} Response from Pipecat
 */
async function sendAppMessage(pcId, message) {
  const config = getPipecatConfig();
  const url = `${config.url}/api/message`;

  logger.info(`📤 [PIPECAT-SIG] Sending message to pc_id: ${pcId}, type: ${message.type || "unknown"}`);

  try {
    const response = await axios.post(url, {
      pc_id: pcId,
      message: message,
    }, {
      timeout: config.timeout_ms,
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info(`✅ [PIPECAT-SIG] Message delivered to Pipecat`);
    return response.data;
  } catch (error) {
    if (error.response) {
      logger.error(`❌ [PIPECAT-SIG] Message send error: ${error.response.status}`);
    } else {
      logger.error(`❌ [PIPECAT-SIG] Message send error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Terminate a Pipecat session
 *
 * @param {string} pcId - Peer connection ID to terminate
 * @returns {Promise<Object>} Response from Pipecat
 */
async function terminateSession(pcId) {
  const config = getPipecatConfig();
  const url = `${config.url}/api/disconnect`;

  logger.info(`🔌 [PIPECAT-SIG] Terminating session: ${pcId}`);

  try {
    const response = await axios.post(url, {
      pc_id: pcId,
    }, {
      timeout: config.timeout_ms,
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info(`✅ [PIPECAT-SIG] Session terminated: ${pcId}`);
    return response.data;
  } catch (error) {
    // Session might already be closed, that's okay
    if (error.response && error.response.status === 404) {
      logger.warn(`⚠️ [PIPECAT-SIG] Session not found (already closed?): ${pcId}`);
      return { status: "not_found" };
    }
    logger.error(`❌ [PIPECAT-SIG] Terminate error: ${error.message}`);
    throw error;
  }
}

/**
 * Check Pipecat server health
 *
 * @returns {Promise<boolean>} True if server is healthy
 */
async function checkHealth() {
  const config = getPipecatConfig();
  const url = `${config.url}/health`;

  try {
    const response = await axios.get(url, {
      timeout: 5000,
    });
    return response.status === 200;
  } catch (error) {
    logger.warn(`⚠️ [PIPECAT-SIG] Health check failed: ${error.message}`);
    return false;
  }
}

module.exports = {
  setConfigManager,
  getPipecatConfig,
  sendOffer,
  sendAppMessage,
  terminateSession,
  checkHealth,
};
