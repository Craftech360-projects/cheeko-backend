/**
 * Message Adapter
 *
 * Converts message formats between the existing MQTT/device protocol
 * and Pipecat's expected message types.
 */

const logger = require("../utils/logger");

/**
 * Message type mappings from device/MQTT to Pipecat
 */
const TO_PIPECAT_MAP = {
  // Control messages
  "abort": "interrupt",
  "ready_for_greeting": "ready_for_greeting", // Pipecat may auto-greet
  "end_prompt": "end_prompt",
  "disconnect_agent": "disconnect",
  "shutdown_request": "shutdown",

  // Push-to-talk events
  "ptt_event": "ptt_event",
  "listen": "listen",

  // Function calls (pass through)
  "function_call": "function_call",

  // MCP messages (pass through)
  "mcp": "mcp",

  // User text/RFID input
  "user_text": "user_text",
};

/**
 * Message type mappings from Pipecat to device/MQTT
 */
const FROM_PIPECAT_MAP = {
  // Agent state
  "state": "agent_state_changed",
  "agent_state": "agent_state_changed",

  // TTS events
  "tts_start": "tts",
  "tts_stop": "tts",
  "speech_created": "speech_created",

  // Function calls (pass through)
  "function_call": "function_call",
  "function_response": "function_response",

  // Device control
  "device_control": "device_control",

  // LLM responses
  "llm": "llm",
  "emotion": "llm",

  // Character change
  "character_change": "character-change",

  // Playback control
  "playback_stopped": "music_playback_stopped",
};

/**
 * Convert a message from device/MQTT format to Pipecat format
 *
 * @param {Object} message - The incoming device message
 * @returns {Object} Message in Pipecat format
 */
function toPipecat(message) {
  if (!message || !message.type) {
    return message;
  }

  const originalType = message.type;
  const pipecatType = TO_PIPECAT_MAP[originalType] || originalType;

  // Create new message with mapped type
  const pipecatMessage = {
    ...message,
    type: pipecatType,
  };

  // Special handling for specific message types
  switch (originalType) {
    case "abort":
      // Pipecat uses "interrupt" for stopping current response
      pipecatMessage.type = "interrupt";
      break;

    case "listen":
      // Map listen start/stop to Pipecat PTT format
      pipecatMessage.type = "ptt_event";
      pipecatMessage.action = message.state === "start" ? "press" : "release";
      break;

    case "agent_state_changed":
      // Already in correct format, just rename type
      pipecatMessage.type = "state";
      break;
  }

  if (originalType !== pipecatMessage.type) {
    logger.debug(`[MSG-ADAPT] Converted ${originalType} -> ${pipecatMessage.type}`);
  }

  return pipecatMessage;
}

/**
 * Convert a message from Pipecat format to device/MQTT format
 *
 * @param {Object} message - The incoming Pipecat message
 * @returns {Object} Message in device/MQTT format
 */
function fromPipecat(message) {
  if (!message || !message.type) {
    return message;
  }

  const originalType = message.type;
  const deviceType = FROM_PIPECAT_MAP[originalType] || originalType;

  // Create new message with mapped type
  const deviceMessage = {
    ...message,
    type: deviceType,
  };

  // Special handling for specific message types
  switch (originalType) {
    case "state":
    case "agent_state":
      // Convert Pipecat state format to agent_state_changed
      deviceMessage.type = "agent_state_changed";
      if (message.state && message.old_state === undefined) {
        // Pipecat sends { state: "speaking" }, convert to { data: { old_state, new_state } }
        deviceMessage.data = {
          old_state: message.previous_state || "unknown",
          new_state: message.state,
        };
      }
      break;

    case "tts_start":
      deviceMessage.type = "tts";
      deviceMessage.state = "start";
      break;

    case "tts_stop":
      deviceMessage.type = "tts";
      deviceMessage.state = "stop";
      break;

    case "emotion":
      // Pipecat emotion -> LLM message with emotion
      deviceMessage.type = "llm";
      deviceMessage.emotion = message.emotion || message.value;
      deviceMessage.text = message.emoji || message.text || "";
      break;

    case "character_change":
      deviceMessage.type = "character-change";
      deviceMessage.characterName = message.character || message.characterName;
      break;
  }

  if (originalType !== deviceMessage.type) {
    logger.debug(`[MSG-ADAPT] Converted Pipecat ${originalType} -> ${deviceMessage.type}`);
  }

  return deviceMessage;
}

/**
 * Check if a message type should be forwarded to Pipecat
 *
 * @param {string} messageType - The message type to check
 * @returns {boolean} True if should be forwarded
 */
function shouldForwardToPipecat(messageType) {
  const forwardTypes = [
    "abort",
    "interrupt",
    "ptt_event",
    "listen",
    "function_call",
    "mcp",
    "user_text",
    "ready_for_greeting",
    "end_prompt",
    "playback_control",
  ];
  return forwardTypes.includes(messageType);
}

/**
 * Check if a message type should be forwarded to the device
 *
 * @param {string} messageType - The message type to check
 * @returns {boolean} True if should be forwarded to device
 */
function shouldForwardToDevice(messageType) {
  const forwardTypes = [
    "agent_state_changed",
    "state",
    "tts",
    "tts_start",
    "tts_stop",
    "speech_created",
    "llm",
    "emotion",
    "function_call",
    "function_response",
    "device_control",
    "mcp",
    "character-change",
    "music_playback_stopped",
  ];
  return forwardTypes.includes(messageType);
}

/**
 * Build agent greeting metadata from device context
 *
 * @param {Object} context - Device context
 * @returns {Object} Greeting metadata for Pipecat
 */
function buildGreetingMetadata(context) {
  return {
    device_mac: context.macAddress || context.device_mac || "",
    device_id: context.deviceId || context.device_id || "",
    character: context.character || context.currentCharacter || "Cheeko",
    child_profile: context.childProfile || context.child_profile || null,
    memories: context.memories || context.mem0Memories || null,
    room_type: context.roomType || context.room_type || "conversation",
    ptt_mode: context.deviceMode || context.ptt_mode || "manual",
    session_id: context.sessionId || context.session_id || null,
  };
}

module.exports = {
  toPipecat,
  fromPipecat,
  shouldForwardToPipecat,
  shouldForwardToDevice,
  buildGreetingMetadata,
  TO_PIPECAT_MAP,
  FROM_PIPECAT_MAP,
};
