/**
 * Pipecat Bridge
 *
 * Manages Pipecat WebRTC connections for each device.
 * Handles SDP signaling, session tracking, and message forwarding.
 *
 * Replaces LiveKitBridge for Pipecat-based architecture.
 * Audio streams directly from ESP32 to Pipecat via WebRTC.
 * Gateway only handles MQTT signaling and metadata injection.
 */

const { EventEmitter } = require("events");
const logger = require("../utils/logger");
const {
  sendOffer,
  sendAppMessage,
  terminateSession,
  setConfigManager: setSignalingConfigManager,
} = require("./pipecat-signaling");
const {
  toPipecat,
  fromPipecat,
  shouldForwardToPipecat,
  shouldForwardToDevice,
  buildGreetingMetadata,
} = require("./message-adapter");

// Global config manager reference
let configManager = null;

function setConfigManager(cm) {
  configManager = cm;
  setSignalingConfigManager(cm);
}

class PipecatBridge extends EventEmitter {
  constructor(connection, protocolVersion, macAddress, uuid, userData, workerPool, options = {}) {
    super();
    this.connection = connection;
    this.macAddress = macAddress;
    this.uuid = uuid;
    this.userData = userData;
    this.sessionId = uuid;
    this.roomType = connection.roomType || "conversation";
    this.protocolVersion = protocolVersion;

    // Pipecat session state
    this.pcId = null; // Peer connection ID from Pipecat
    this.sdpAnswer = null; // SDP answer to send to device
    this.isConnected = false;

    // Audio state tracking (for UI state management)
    this.isAudioPlaying = false;
    this.audioPlayingStartTime = null;

    // Agent state tracking
    this.agentJoined = false; // For Pipecat, agent is always running
    this.greetingSent = false;
    this.agentDeployed = false;
    this.primaryAgentIdentity = "pipecat-agent"; // Single agent identity

    // MCP request tracking for async responses
    this.pendingMcpRequests = new Map();
    this.mcpRequestCounter = 1;

    // Volume adjustment queue
    this.volumeAdjustmentQueue = [];
    this.isAdjustingVolume = false;
    this.lastKnownVolume = null;
    this.volumeDebounceTimer = null;
    this.pendingVolumeAction = null;

    // Character and child profile
    this.currentCharacter = connection.currentCharacter || "Cheeko";
    this.childProfile = connection.childProfile || null;
    this.mem0Memories = connection.mem0Memories || null;

    logger.info(`🔧 [PIPECAT-BRIDGE] Created for device: ${macAddress}, character: ${this.currentCharacter}`);
  }

  /**
   * Connect to Pipecat server by exchanging SDP
   *
   * @param {Object} audioParams - Audio parameters from device
   * @param {Object} features - Device features
   * @param {string} sdpOffer - SDP offer from the device
   * @returns {Promise<Object>} Connection result with SDP answer
   */
  async connect(audioParams, features, sdpOffer) {
    const connectStartTime = Date.now();
    logger.info(`🔗 [PIPECAT-BRIDGE] Connecting to Pipecat for device: ${this.macAddress}`);

    try {
      // Build metadata to send to Pipecat
      const metadata = buildGreetingMetadata({
        macAddress: this.macAddress,
        deviceId: this.connection.deviceId,
        character: this.currentCharacter,
        childProfile: this.childProfile,
        memories: this.mem0Memories,
        roomType: this.roomType,
        deviceMode: this.connection.deviceMode,
        sessionId: this.sessionId,
      });

      // Send SDP offer to Pipecat and get answer
      const response = await sendOffer(sdpOffer, metadata);

      this.pcId = response.pc_id;
      this.sdpAnswer = response.sdp;
      this.isConnected = true;
      this.agentJoined = true; // Pipecat agent is always ready
      this.agentDeployed = true;

      const connectTime = Date.now() - connectStartTime;
      logger.info(`✅ [PIPECAT-BRIDGE] Connected in ${connectTime}ms, pc_id: ${this.pcId}`);

      // Generate session_id from MAC and UUID
      const macForSession = this.macAddress.replace(/:/g, "");
      const sessionId = `${this.uuid}_${macForSession}_${this.roomType}`;
      this.sessionId = sessionId;

      return {
        session_id: sessionId,
        pc_id: this.pcId,
        sdp_answer: this.sdpAnswer,
        audio_params: {
          sample_rate: 24000,
          channels: 1,
          frame_duration: 60,
          format: "opus",
        },
      };
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Connection failed: ${error.message}`);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Check if bridge is alive
   */
  isAlive() {
    return this.isConnected && this.pcId !== null;
  }

  /**
   * Send abort/interrupt signal to Pipecat
   */
  async sendAbortSignal(sessionId) {
    if (!this.isConnected || !this.pcId) {
      logger.warn(`⚠️ [PIPECAT-BRIDGE] Cannot send abort - not connected`);
      return;
    }

    try {
      const message = toPipecat({
        type: "abort",
        session_id: sessionId,
        timestamp: Date.now(),
      });

      await sendAppMessage(this.pcId, message);
      logger.info(`🛑 [PIPECAT-BRIDGE] Sent interrupt signal`);

      // Clear audio state
      this.isAudioPlaying = false;
      this.audioPlayingStartTime = null;
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Failed to send abort: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send end prompt signal to Pipecat
   */
  async sendEndPrompt(sessionId) {
    if (!this.isConnected || !this.pcId) {
      logger.warn(`⚠️ [PIPECAT-BRIDGE] Cannot send end prompt - not connected`);
      return;
    }

    try {
      const message = {
        type: "end_prompt",
        session_id: sessionId,
        prompt: "You must end this conversation now. Start with 'Time flies so fast' and say a SHORT goodbye in 1-2 sentences maximum. Do NOT ask questions or suggest activities. Just say goodbye emotionally and end the conversation.",
        timestamp: Date.now(),
      };

      await sendAppMessage(this.pcId, message);
      logger.info(`👋 [PIPECAT-BRIDGE] Sent end prompt`);
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Failed to send end prompt: ${error.message}`);
    }
  }

  /**
   * Forward a message to Pipecat
   */
  async forwardMessage(message) {
    if (!this.isConnected || !this.pcId) {
      logger.warn(`⚠️ [PIPECAT-BRIDGE] Cannot forward message - not connected`);
      return false;
    }

    if (!shouldForwardToPipecat(message.type)) {
      logger.debug(`[PIPECAT-BRIDGE] Message type ${message.type} not forwarded to Pipecat`);
      return false;
    }

    try {
      const pipecatMessage = toPipecat(message);
      await sendAppMessage(this.pcId, pipecatMessage);
      logger.info(`📤 [PIPECAT-BRIDGE] Forwarded ${message.type} to Pipecat`);
      return true;
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Failed to forward message: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle incoming message from Pipecat (via webhook or polling)
   * This would be called when Pipecat sends messages back
   */
  handlePipecatMessage(message) {
    if (!message || !message.type) {
      return;
    }

    const deviceMessage = fromPipecat(message);
    logger.info(`📨 [PIPECAT-BRIDGE] Received from Pipecat: ${message.type}`);

    // Handle specific message types
    switch (deviceMessage.type) {
      case "agent_state_changed":
        this.handleAgentStateChange(deviceMessage);
        break;

      case "speech_created":
        this.isAudioPlaying = true;
        this.audioPlayingStartTime = Date.now();
        if (this.connection && this.connection.updateActivityTime) {
          this.connection.updateActivityTime();
        }
        this.sendTtsStartMessage(deviceMessage.text || deviceMessage.data?.text);
        break;

      case "function_call":
        this.handleFunctionCall(deviceMessage);
        break;

      case "llm":
        this.sendEmotionMessage(deviceMessage.text, deviceMessage.emotion);
        break;

      case "character-change":
        if (this.connection && this.connection.gateway) {
          this.connection.gateway.handleDeviceCharacterChange(
            this.macAddress,
            { characterName: deviceMessage.characterName }
          );
        }
        break;

      case "mcp":
        // Forward MCP responses to connection
        if (this.connection) {
          this.connection.forwardMcpResponse(
            deviceMessage.payload,
            deviceMessage.session_id,
            deviceMessage.request_id
          );
        }
        break;

      default:
        // Forward other messages to device via MQTT
        if (shouldForwardToDevice(deviceMessage.type)) {
          this.sendToDevice(deviceMessage);
        }
    }
  }

  /**
   * Handle agent state change from Pipecat
   */
  handleAgentStateChange(stateMessage) {
    const data = stateMessage.data || stateMessage;
    const oldState = data.old_state || data.previous_state;
    const newState = data.new_state || data.state;

    logger.info(`🔄 [PIPECAT-BRIDGE] Agent state: ${oldState} → ${newState}`);

    if (oldState === "speaking" && newState === "listening") {
      this.isAudioPlaying = false;
      this.audioPlayingStartTime = null;
      logger.info(`🎵 [PIPECAT-BRIDGE] TTS stopped, sending tts_stop`);
      setTimeout(() => {
        this.sendTtsStopMessage();
      }, 500);

      // Handle ending phase
      if (this.connection && this.connection.isEnding && !this.connection.goodbyeSent) {
        this.connection.goodbyeSent = true;
        this.connection.sendMqttMessage(JSON.stringify({
          type: "goodbye",
          session_id: this.connection.sessionInfo?.sessionId || null,
          reason: "inactivity_timeout",
          timestamp: Date.now(),
        }));
        logger.info(`📤 [PIPECAT-BRIDGE] Sent goodbye message`);

        setTimeout(() => {
          if (this.connection) {
            this.connection.close();
          }
        }, 500);
      }
    } else if (oldState === "listening" && newState === "thinking") {
      logger.info(`🤔 [PIPECAT-BRIDGE] Agent thinking`);
    }
  }

  /**
   * Send TTS start message to device
   */
  sendTtsStartMessage(text = "") {
    if (!this.connection) return;

    const message = {
      type: "tts",
      state: "start",
      session_id: this.connection.sessionInfo?.sessionId,
    };

    if (text) {
      message.text = text;
    }

    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Send TTS stop message to device
   */
  sendTtsStopMessage() {
    if (!this.connection) {
      logger.warn(`⚠️ [PIPECAT-BRIDGE] No connection, cannot send tts stop`);
      return;
    }

    const message = {
      type: "tts",
      state: "stop",
      session_id: this.connection.sessionInfo?.sessionId,
    };

    logger.info(`📤 [PIPECAT-BRIDGE] Sending TTS stop`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Send emotion message to device
   */
  sendEmotionMessage(emoji, emotion) {
    if (!this.connection) return;

    const message = {
      type: "llm",
      text: emoji,
      emotion: emotion,
      session_id: this.connection.sessionInfo?.sessionId,
    };

    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Send message to device via MQTT
   */
  sendToDevice(message) {
    if (!this.connection) return;

    message.session_id = message.session_id || this.connection.sessionInfo?.sessionId;
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Handle function call from Pipecat (MCP commands, etc.)
   */
  async handleFunctionCall(functionData) {
    if (!this.connection) return;

    const functionCall = functionData.function_call;
    if (!functionCall || !functionCall.name) {
      return;
    }

    // Handle volume adjustments
    if (functionCall.name === "self_volume_up" || functionCall.name === "self_volume_down") {
      try {
        const action = functionCall.name === "self_volume_up" ? "up" : "down";
        const step = functionCall.arguments?.step || 10;
        await this.debouncedAdjustVolume(action, step, 300);
      } catch (error) {
        logger.error(`❌ [PIPECAT-BRIDGE] Volume adjust error: ${error.message}`);
      }
      return;
    }

    // Map function names to MCP tool names
    const functionToMcpToolMap = {
      self_set_volume: "self.audio_speaker.set_volume",
      self_get_volume: "self.get_device_status",
      self_mute: "self.audio_speaker.mute",
      self_unmute: "self.audio_speaker.unmute",
      self_set_light_color: "self.led.set_color",
      self_get_battery_status: "self.battery.get_status",
      self_set_light_mode: "self.led.set_mode",
    };

    const mcpToolName = functionToMcpToolMap[functionCall.name];
    if (!mcpToolName) {
      this.sendMcpMessage(functionCall.name, functionCall.arguments || {});
      return;
    }

    // Send MCP message to device
    const requestId = parseInt(functionData.request_id?.replace("req_", "") || Date.now());
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: mcpToolName,
          arguments: functionCall.arguments || {},
        },
        id: requestId,
      },
      session_id: this.connection.sessionInfo?.sessionId,
      timestamp: functionData.timestamp || new Date().toISOString(),
      request_id: `req_${requestId}`,
    };

    logger.info(`📤 [PIPECAT-BRIDGE] MCP: ${mcpToolName}`);
    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Send MCP tool call message to device
   */
  sendMcpMessage(toolName, toolArgs = {}) {
    if (!this.connection) return;

    const requestId = Date.now();
    const message = {
      type: "mcp",
      payload: {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: toolArgs,
        },
        id: requestId,
      },
      session_id: this.connection.sessionInfo?.sessionId,
      timestamp: new Date().toISOString(),
      request_id: `req_${requestId}`,
    };

    this.connection.sendMqttMessage(JSON.stringify(message));
  }

  /**
   * Send MCP command and wait for response
   */
  async sendMcpAndWait(toolName, args = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const requestId = this.mcpRequestCounter++;

      const timeoutId = setTimeout(() => {
        this.pendingMcpRequests.delete(requestId);
        reject(new Error(`MCP request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingMcpRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      const mcpMessage = {
        type: "mcp",
        payload: {
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
          id: requestId,
        },
        session_id: this.connection.sessionInfo?.sessionId,
        timestamp: new Date().toISOString(),
        request_id: `req_${requestId}`,
      };

      this.connection.sendMqttMessage(JSON.stringify(mcpMessage));
    });
  }

  /**
   * Debounced volume adjustment
   */
  debouncedAdjustVolume(action, step = 10, debounceMs = 300) {
    return new Promise((resolve, reject) => {
      if (this.volumeDebounceTimer) {
        clearTimeout(this.volumeDebounceTimer);
      }

      if (this.pendingVolumeAction && this.pendingVolumeAction.action === action) {
        this.pendingVolumeAction.step += step;
        this.pendingVolumeAction.resolvers.push(resolve);
      } else {
        this.pendingVolumeAction = {
          action,
          step,
          resolvers: [resolve],
        };
      }

      this.volumeDebounceTimer = setTimeout(async () => {
        const { action: finalAction, step: finalStep, resolvers } = this.pendingVolumeAction;
        this.pendingVolumeAction = null;
        this.volumeDebounceTimer = null;

        try {
          const result = await this.adjustVolume(finalAction, finalStep);
          resolvers.forEach((r) => r(result));
        } catch (error) {
          resolvers.forEach((r) => r(null));
        }
      }, debounceMs);
    });
  }

  /**
   * Adjust volume
   */
  async adjustVolume(action, step = 10) {
    return new Promise((resolve, reject) => {
      this.volumeAdjustmentQueue.push({ action, step, resolve, reject });
      this.processVolumeQueue();
    });
  }

  /**
   * Process volume adjustment queue
   */
  async processVolumeQueue() {
    if (this.isAdjustingVolume || this.volumeAdjustmentQueue.length === 0) {
      return;
    }

    this.isAdjustingVolume = true;
    const request = this.volumeAdjustmentQueue.shift();
    const { action, step, resolve, reject } = request;

    try {
      let currentVolume;

      if (this.lastKnownVolume !== null) {
        currentVolume = this.lastKnownVolume;
      } else {
        const statusResult = await this.sendMcpAndWait("self.get_device_status", {}, 3000);
        let deviceStatus;
        if (typeof statusResult === "string") {
          deviceStatus = JSON.parse(statusResult);
        } else {
          deviceStatus = statusResult;
        }
        currentVolume = deviceStatus?.audio_speaker?.volume || 50;
        this.lastKnownVolume = currentVolume;
      }

      let newVolume;
      if (action === "up") {
        newVolume = Math.min(100, currentVolume + step);
      } else {
        newVolume = Math.max(0, currentVolume - step);
      }

      await this.sendMcpAndWait("self.audio_speaker.set_volume", { volume: newVolume }, 3000);
      this.lastKnownVolume = newVolume;
      resolve(newVolume);
    } catch (error) {
      this.lastKnownVolume = null;
      resolve(null);
    } finally {
      this.isAdjustingVolume = false;
      if (this.volumeAdjustmentQueue.length > 0) {
        setImmediate(() => this.processVolumeQueue());
      }
    }
  }

  /**
   * Forward MCP response to Pipecat (if needed)
   */
  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    if (!this.isConnected || !this.pcId) {
      return false;
    }

    try {
      const responseMessage = {
        type: "mcp",
        payload: mcpPayload,
        session_id: sessionId,
        request_id: requestId,
        timestamp: new Date().toISOString(),
      };

      await sendAppMessage(this.pcId, responseMessage);
      logger.info(`✅ [PIPECAT-BRIDGE] Forwarded MCP response to Pipecat`);
      return true;
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Failed to forward MCP response: ${error.message}`);
      return false;
    }
  }

  /**
   * Wait for agent join (no-op for Pipecat - agent is always ready)
   */
  async waitForAgentJoin(timeoutMs = 4000) {
    return true; // Pipecat agent is always running
  }

  /**
   * Send ready for greeting (triggers Pipecat auto-greeting)
   */
  async sendReadyForGreeting() {
    if (!this.isConnected || !this.pcId) {
      logger.warn(`⚠️ [PIPECAT-BRIDGE] Cannot send greeting - not connected`);
      return;
    }

    try {
      const greetingMessage = {
        type: "ready_for_greeting",
        metadata: buildGreetingMetadata({
          macAddress: this.macAddress,
          deviceId: this.connection.deviceId,
          character: this.currentCharacter,
          childProfile: this.childProfile,
          memories: this.mem0Memories,
          sessionId: this.sessionId,
        }),
        timestamp: Date.now(),
      };

      await sendAppMessage(this.pcId, greetingMessage);
      logger.info(`📤 [PIPECAT-BRIDGE] Sent ready_for_greeting`);
    } catch (error) {
      logger.error(`❌ [PIPECAT-BRIDGE] Failed to send greeting: ${error.message}`);
    }
  }

  /**
   * Close the Pipecat connection
   */
  async close() {
    logger.info(`[PIPECAT-BRIDGE] Closing connection for: ${this.macAddress}`);

    // Clear audio state
    this.isAudioPlaying = false;
    this.audioPlayingStartTime = null;

    // Terminate Pipecat session
    if (this.pcId) {
      try {
        await terminateSession(this.pcId);
        logger.info(`✅ [PIPECAT-BRIDGE] Session terminated: ${this.pcId}`);
      } catch (error) {
        logger.warn(`⚠️ [PIPECAT-BRIDGE] Terminate error: ${error.message}`);
      }
    }

    this.isConnected = false;
    this.pcId = null;
    this.sdpAnswer = null;
  }
}

module.exports = { PipecatBridge, setConfigManager };
