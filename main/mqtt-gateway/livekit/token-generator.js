/**
 * LiveKit Token Generator
 *
 * Generates access tokens for direct client connections to LiveKit.
 * Used when clients support WebRTC and can connect directly without UDP gateway bridging.
 */

const { AccessToken } = require("livekit-server-sdk");

// Global config manager reference (injected by app.js)
let configManager = null;

function setConfigManager(cm) {
  configManager = cm;
}

/**
 * Generate a LiveKit access token for a client to connect directly
 *
 * @param {string} roomName - The LiveKit room name
 * @param {string} identity - Participant identity (typically MAC address)
 * @param {Object} options - Additional options
 * @param {string} options.macAddress - Device MAC address
 * @param {string} options.uuid - Device UUID
 * @param {string} options.roomType - Room type (conversation, music, story)
 * @param {number} options.ttl - Token TTL in seconds (default: 24 hours)
 * @returns {Promise<string>} JWT token string
 */
async function generateClientToken(roomName, identity, options = {}) {
  if (!configManager) {
    throw new Error("ConfigManager not initialized. Call setConfigManager first.");
  }

  const livekitConfig = configManager.get("livekit");
  if (!livekitConfig || !livekitConfig.api_key || !livekitConfig.api_secret) {
    throw new Error("LiveKit configuration not found or incomplete");
  }

  // Override with environment variables if present
  const apiKey = process.env.LIVEKIT_API_KEY || livekitConfig.api_key;
  const apiSecret = process.env.LIVEKIT_API_SECRET || livekitConfig.api_secret;

  const {
    macAddress = "",
    uuid = "",
    roomType = "conversation",
    ttl = 24 * 60 * 60, // 24 hours default
  } = options;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: identity,
    name: `Device-${macAddress.replace(/:/g, "")}`,
    ttl: ttl, // Set TTL in constructor (seconds)
    attributes: {
      device_mac: macAddress,
      device_uuid: uuid,
      room_type: roomType,
      participant_type: "device",
      connection_mode: "direct", // Mark as direct connection
    },
  });

  // Grant permissions for the room
  at.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: false, // Room should already be created by gateway
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // Allow data channel messages
    canUpdateOwnMetadata: true,
  });

  return await at.toJwt();
}

/**
 * Get LiveKit URL from configuration
 * @returns {string} LiveKit WebSocket URL
 */
function getLiveKitUrl() {
  if (process.env.LIVEKIT_URL) {
    return process.env.LIVEKIT_URL;
  }

  if (configManager) {
    const livekitConfig = configManager.get("livekit");
    if (livekitConfig && livekitConfig.url) {
      return livekitConfig.url;
    }
  }

  throw new Error("LiveKit URL not configured");
}

/**
 * Generate complete LiveKit connection credentials for a client
 *
 * @param {string} roomName - The LiveKit room name
 * @param {string} identity - Participant identity
 * @param {Object} options - Additional options (passed to generateClientToken)
 * @returns {Promise<Object>} Object with url, token, and room_name
 */
async function generateLiveKitCredentials(roomName, identity, options = {}) {
  const url = getLiveKitUrl();
  const token = await generateClientToken(roomName, identity, options);

  return {
    url: url,
    token: token,
    room_name: roomName,
  };
}

module.exports = {
  generateClientToken,
  generateLiveKitCredentials,
  getLiveKitUrl,
  setConfigManager,
};
