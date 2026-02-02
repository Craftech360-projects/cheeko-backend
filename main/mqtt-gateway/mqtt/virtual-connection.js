/**
 * Virtual MQTT Connection
 *
 * Represents a per-device MQTT session.
 * Manages Pipecat WebRTC signaling and MQTT control messages.
 *
 * NOTE: Audio bridging removed. ESP32 devices connect directly to Pipecat
 * via WebRTC for real-time audio streaming. Gateway only handles
 * MQTT-based control messages and session management.
 */

const axios = require("axios");
const crypto = require("crypto");
const {
  PipecatBridge,
  setConfigManager: setPipecatConfigManager,
} = require("../pipecat/pipecat-bridge");
const {
  MEDIA_API_BASE,
  mediaAxiosConfig,
} = require("../core/media-api-client");
const logger = require("../utils/logger");
const { fetchMemoriesWithTimeout, buildDispatchMetadata } = require("../core/mem0-integration");

// MAC address regex
const MacAddressRegex = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

// Global config manager and debug reference (injected by gateway)
let configManager = null;
let debug = null;

function setConfigManager(cm) {
  configManager = cm;
  // Setup debug logger
  const debugModule = require("debug");
  debug = debugModule("mqtt-server");
  // Initialize Pipecat bridge with config
  setPipecatConfigManager(cm);
}

class VirtualMQTTConnection {
  constructor(deviceId, connectionId, gateway, helloPayload, workerPool) {
    this.deviceId = deviceId;
    this.connectionId = connectionId;
    this.gateway = gateway;
    this.workerPool = workerPool;
    this.clientId = helloPayload.clientId || deviceId;
    this.username = helloPayload.username;
    this.password = helloPayload.password;
    this.fullClientId = helloPayload.clientId;

    this.bridge = null;
    this.roomType = null; // Track room type (conversation, music, story)
    this.language = null; // Track language for music/story filtering

    // Session tracking
    this.sessionInfo = {
      sessionId: null,
      startTime: null,
    };
    this.closing = false;

    // Inactivity timeout tracking
    this.lastActivityTime = Date.now();
    this.inactivityTimeoutMs = 2 * 60 * 1000; // 2 minutes
    this.isEnding = false;
    this.endPromptSentTime = null;

    // Session duration tracking (max 60 minutes)
    this.sessionStartTime = Date.now();
    this.maxSessionDurationMs = 60 * 60 * 1000;
    this.maxAudioPlayingDurationMs = 90 * 1000;
    this.lastPttMode = "manual";

    // Target toy for mobile connections
    this.targetToyMac = null;
    this.isMobileConnection = false;

    // Parse device info from hello message
    if (helloPayload.clientId) {
      const parts = helloPayload.clientId.split("@@@");
      if (parts.length === 3) {
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = parts[2];
        this.userData = null;

        console.log(`   - Group ID: ${this.groupId}`);
        console.log(`   - MAC Address: ${this.macAddress}`);
        console.log(`   - UUID: ${this.uuid}`);

        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }
      } else if (parts.length === 2) {
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = `virtual-${Date.now()}`;
        this.userData = null;

        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }
      } else {
        console.error(`❌ [VIRTUAL] Invalid clientId format: ${helloPayload.clientId}`);
        this.close();
        return;
      }

      this.replyTo = `devices/p2p/${parts[1]}`;
    } else {
      console.error(`❌ [VIRTUAL] No clientId provided in hello payload`);
      this.close();
      return;
    }

    debug(`Virtual connection created for device: ${this.deviceId}`);
  }

  updateActivityTime(messageType = null) {
    if (this.closing) {
      console.log(`⚠️ [TIMER-IGNORE] Ignoring activity during cleanup: ${this.deviceId}`);
      return;
    }

    this.lastActivityTime = Date.now();

    const allowedDuringEnding = ["playback_control", "playing", "status"];

    if (this.isEnding && (!messageType || !allowedDuringEnding.includes(messageType))) {
      console.log(`🔄 [ENDING-IGNORE] Activity during goodbye sequence ignored: ${this.deviceId}`);
      return;
    }

    if (this.isEnding && messageType) {
      console.log(`🔄 [ENDING-RESET] Timer reset for message type '${messageType}': ${this.deviceId}`);
      this.isEnding = false;
      this.endPromptSentTime = null;
    }

    console.log(`⏰ [TIMER-RESET] Device ${this.deviceId} activity timer reset`);
  }

  handlePublish(publishData) {
    console.log(`📨 [ACTIVITY] MQTT message received from device ${this.deviceId}`);

    let messageType = null;
    try {
      const json = JSON.parse(publishData.payload);
      messageType = json.type || json.msg;
    } catch (error) {
      console.log(`⚠️ [PARSE] Could not parse message type: ${error.message}`);
    }

    this.updateActivityTime(messageType);

    try {
      const json = JSON.parse(publishData.payload);
      if (json.type === "hello") {
        if (json.version !== 3 && json.version !== 4) {
          debug("Unsupported protocol version:", json.version);
          this.close();
          return;
        }

        this.parseHelloMessage(json).catch((error) => {
          console.error(`❌ [HELLO-ERROR] Failed for ${this.deviceId}:`, error);
          debug("Failed to process hello message:", error);
          this.close();
        });
      } else {
        this.parseOtherMessage(json).catch((error) => {
          debug("Failed to process other message:", error);
          this.close();
        });
      }
    } catch (error) {
      debug("Error parsing message:", error);
    }
  }

  sendMqttMessage(payload) {
    debug(`Sending message to ${this.deviceId}: ${payload}`);

    try {
      const parsedPayload = JSON.parse(payload);
      this.gateway.publishToDevice(this.fullClientId, parsedPayload);
    } catch (error) {
      console.error(`❌ [VIRTUAL] Error in sendMqttMessage: ${error}`);
    }
  }

  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    console.log(`🔋 [MCP-FORWARD] Forwarding MCP response for ${this.deviceId}`);

    if (!this.bridge || !this.bridge.isConnected) {
      console.error(`❌ [MCP-FORWARD] No Pipecat connection for ${this.deviceId}`);
      return false;
    }

    try {
      await this.bridge.forwardMcpResponse(mcpPayload, sessionId, requestId);
      console.log(`✅ [MCP-FORWARD] Successfully forwarded to Pipecat`);
      return true;
    } catch (error) {
      console.error(`❌ [MCP-FORWARD] Error forwarding:`, error);
      return false;
    }
  }

  async parseHelloMessage(json) {
    console.log(`🔍 [PARSE-HELLO] Starting for ${this.deviceId}`);
    console.log(`🔍 [PARSE-HELLO] Version: ${json.version}, has SDP: ${!!json.sdp}`);

    // Query database for device mode
    const macAddress = this.deviceId.replace(/:/g, "").toLowerCase();

    try {
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const apiUrl = `${baseUrl}/toy/device/${macAddress}/mode`;

      console.log(`🔍 [ROOM-TYPE] Querying mode for device ${this.deviceId}...`);
      const response = await axios.get(apiUrl, { timeout: 5000 });

      if (response.data.code === 0) {
        this.roomType = response.data.data;
        console.log(`✅ [ROOM-TYPE] Mode from DB: ${this.roomType}`);
      } else {
        console.warn(`⚠️ [ROOM-TYPE] API error, using 'conversation'`);
        this.roomType = "conversation";
      }
    } catch (error) {
      console.error(`❌ [ROOM-TYPE] Error querying mode: ${error.message}`);
      this.roomType = "conversation";
    }

    this.language = json.language || null;
    console.log(`📱 [ROOM-TYPE] Final: ${this.roomType}, language: ${this.language || "N/A"}`);

    if (!["conversation", "music", "story"].includes(this.roomType)) {
      console.error(`❌ [ROOM-TYPE] Invalid: ${this.roomType}, using 'conversation'`);
      this.roomType = "conversation";
    }

    // Fetch PTT mode
    this.deviceMode = "manual";
    try {
      const deviceModeUrl = `${process.env.MANAGER_API_URL.replace("/toy", "")}/toy/device/${macAddress}/device-mode`;
      console.log(`🔍 [DEVICE-MODE] Querying PTT mode...`);
      const deviceModeResponse = await axios.get(deviceModeUrl, { timeout: 5000 });

      if (deviceModeResponse.data.code === 0) {
        this.deviceMode = deviceModeResponse.data.data;
        console.log(`✅ [DEVICE-MODE] PTT mode: ${this.deviceMode}`);
      }
    } catch (error) {
      console.error(`❌ [DEVICE-MODE] Error: ${error.message}, using 'manual'`);
    }

    if (!["auto", "manual"].includes(this.deviceMode)) {
      this.deviceMode = "manual";
    }

    // Fetch character, child profile, and memories for conversation mode
    this.currentCharacter = null;
    this.childProfile = null;
    this.mem0Memories = null;

    if (this.roomType === "conversation") {
      const [character, childProfile, memoryData] = await Promise.all([
        this.fetchCurrentCharacter(this.deviceId),
        this.fetchChildProfile(this.deviceId),
        fetchMemoriesWithTimeout(this.deviceId)
      ]);
      this.currentCharacter = character;
      this.childProfile = childProfile;
      this.mem0Memories = memoryData;

      logger.info(`🎭 [CHARACTER] Using: "${this.currentCharacter}"`);
      if (this.childProfile) {
        logger.info(`👶 [CHILD-PROFILE] Name: "${this.childProfile.name}", age: ${this.childProfile.age}`);
      }
      if (this.mem0Memories?.memories?.length > 0) {
        logger.info(`🧠 [MEM0] Retrieved ${this.mem0Memories.memories.length} memories`);
      }
    }

    // Initialize session
    this.sessionInfo.startTime = Date.now();

    if (this.bridge) {
      debug(`${this.deviceId} duplicate hello, closing previous bridge`);
      await this.bridge.close();
      this.bridge = null;
    }

    // Generate session ID
    const newSessionUuid = crypto.randomUUID();
    const macForRoom = this.macAddress.replace(/:/g, "");
    const sessionId = `${newSessionUuid}_${macForRoom}_${this.roomType}`;
    this.sessionInfo.sessionId = sessionId;

    console.log(`🏠 [SESSION] ID: ${sessionId}`);

    // Reset activity timer
    this.lastActivityTime = Date.now();

    // For conversation mode with Pipecat
    if (this.roomType === "conversation") {
      console.log(`🔗 [PIPECAT] Creating Pipecat bridge for conversation`);

      // Create Pipecat bridge
      this.bridge = new PipecatBridge(
        this,
        json.version,
        this.deviceId,
        newSessionUuid,
        this.userData,
        this.workerPool,
        { connectionMode: "direct" }
      );

      // Setup bridge close handler
      this.bridge.on("close", () => {
        console.log(`Call ended: ${this.deviceId}`);
        this.sendMqttMessage(JSON.stringify({
          type: "goodbye",
          session_id: this.sessionInfo.sessionId
        }));
        this.bridge = null;
      });

      try {
        // Check if device sent SDP offer (WebRTC capable)
        if (json.sdp) {
          console.log(`🔗 [PIPECAT] Device sent SDP offer, proxying to Pipecat`);

          // Connect to Pipecat with device's SDP offer
          const connectionResult = await this.bridge.connect(
            json.audio_params,
            json.features,
            json.sdp // Pass device SDP offer
          );

          console.log(`✅ [PIPECAT] Connected, pc_id: ${connectionResult.pc_id}`);

          // Send mode_update to device
          const modeUpdateMsg = {
            type: "mode_update",
            mode: this.roomType,
            listening_mode: this.deviceMode,
            character: this.currentCharacter,
            session_id: sessionId,
            timestamp: Date.now(),
          };
          this.sendMqttMessage(JSON.stringify(modeUpdateMsg));

          // Build hello response with Pipecat SDP answer
          const helloResponseMsg = {
            type: "hello",
            version: json.version,
            mode: this.roomType,
            character: this.currentCharacter,
            session_id: sessionId,
            timestamp: Date.now(),
            transport: "pipecat",
            // Pipecat SDP answer for WebRTC connection
            sdp_answer: connectionResult.sdp_answer,
            pc_id: connectionResult.pc_id,
            audio_params: {
              sample_rate: 24000,
              channels: 1,
              frame_duration: 60,
              format: "opus",
            },
          };
          this.sendMqttMessage(JSON.stringify(helloResponseMsg));
          console.log(`📤 [HELLO] Sent response with Pipecat SDP answer`);

          // Pipecat agent auto-greets, no manual dispatch needed
          console.log(`🤖 [PIPECAT] Agent ready (auto-greeting enabled)`);
        } else {
          // Device doesn't support WebRTC, use fallback
          console.log(`⚠️ [PIPECAT] No SDP from device, legacy mode not supported`);
          this.sendMqttMessage(JSON.stringify({
            type: "error",
            message: "Device must provide SDP offer for Pipecat connection",
          }));
        }
      } catch (error) {
        console.error(`❌ [PIPECAT] Connection failed: ${error.message}`);
        this.sendMqttMessage(JSON.stringify({
          type: "error",
          message: "Failed to connect to Pipecat",
        }));
      }
    } else if (this.roomType === "music") {
      console.log(`🎵 [MUSIC] Spawning music bot...`);
      await this.spawnMusicBot(sessionId);

      const modeUpdateMsg = {
        type: "mode_update",
        mode: this.roomType,
        listening_mode: this.deviceMode,
        session_id: sessionId,
        timestamp: Date.now(),
      };
      this.sendMqttMessage(JSON.stringify(modeUpdateMsg));

      const helloResponseMsg = {
        type: "hello",
        version: json.version,
        mode: this.roomType,
        session_id: sessionId,
        timestamp: Date.now(),
        transport: "media_bot",
        audio_params: {
          sample_rate: 24000,
          channels: 1,
          frame_duration: 60,
          format: "opus",
        },
      };
      this.sendMqttMessage(JSON.stringify(helloResponseMsg));
    } else if (this.roomType === "story") {
      console.log(`📖 [STORY] Spawning story bot...`);
      await this.spawnStoryBot(sessionId);

      const modeUpdateMsg = {
        type: "mode_update",
        mode: this.roomType,
        listening_mode: this.deviceMode,
        session_id: sessionId,
        timestamp: Date.now(),
      };
      this.sendMqttMessage(JSON.stringify(modeUpdateMsg));

      const helloResponseMsg = {
        type: "hello",
        version: json.version,
        mode: this.roomType,
        session_id: sessionId,
        timestamp: Date.now(),
        transport: "media_bot",
        audio_params: {
          sample_rate: 24000,
          channels: 1,
          frame_duration: 60,
          format: "opus",
        },
      };
      this.sendMqttMessage(JSON.stringify(helloResponseMsg));
    }
  }

  async fetchPlaylist(mode) {
    try {
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const playlistUrl = `${baseUrl}/toy/device/${this.deviceId}/playlist/${mode}`;

      console.log(`📋 [PLAYLIST] Fetching ${mode} playlist...`);
      const response = await axios.get(playlistUrl, { timeout: 5000 });

      if (response.data?.code === 0 && response.data?.data) {
        const playlist = response.data.data;
        console.log(`✅ [PLAYLIST] Got ${playlist.length} ${mode} items`);
        return playlist;
      }
      return [];
    } catch (error) {
      console.error(`❌ [PLAYLIST] Failed: ${error.message}`);
      return [];
    }
  }

  async fetchCurrentCharacter(macAddress) {
    try {
      const cleanMac = macAddress.replace(/:/g, "").toLowerCase();
      const apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${cleanMac}/current-character`;

      logger.info(`🎭 [CHARACTER] Fetching for device: ${macAddress}`);
      const response = await axios.get(apiUrl, { timeout: 5000 });

      if (response.data?.code === 0 && response.data?.data) {
        let character;
        if (typeof response.data.data === 'string') {
          character = response.data.data;
        } else if (response.data.data.characterName) {
          character = response.data.data.characterName;
        } else {
          character = "Cheeko";
        }
        logger.info(`🎭 [CHARACTER] ✅ Got: "${character}"`);
        return character;
      }
      return "Cheeko";
    } catch (error) {
      logger.error(`🎭 [CHARACTER] ❌ Failed: ${error.message}`);
      return "Cheeko";
    }
  }

  async fetchChildProfile(macAddress) {
    try {
      const cleanMac = macAddress.replace(/:/g, "").toLowerCase();
      const apiUrl = `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`;
      const serverSecret = process.env.MANAGER_API_SECRET;

      logger.info(`👶 [CHILD-PROFILE] Fetching for device: ${macAddress}`);

      const response = await axios.post(
        apiUrl,
        { macAddress: cleanMac },
        {
          timeout: 5000,
          headers: {
            'secret': serverSecret,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data?.code === 0 && response.data?.data) {
        const profile = response.data.data;
        logger.info(`👶 [CHILD-PROFILE] ✅ Got: name="${profile.name}", age=${profile.age}`);
        return profile;
      }
      return null;
    } catch (error) {
      logger.error(`👶 [CHILD-PROFILE] ❌ Failed: ${error.message}`);
      return null;
    }
  }

  async spawnMusicBot(roomName, playlist = null) {
    try {
      console.log(`🎵 [MUSIC-BOT] Spawning for room: ${roomName}`);

      if (!playlist) {
        playlist = await this.fetchPlaylist("music");
      }

      const url = `${MEDIA_API_BASE}/start-music-bot`;

      const response = await axios.post(
        url,
        {
          room_name: roomName,
          device_mac: this.macAddress,
          language: this.language,
          playlist: playlist,
        },
        mediaAxiosConfig()
      );

      if (response.data?.status === "started") {
        console.log(`✅ [MUSIC-BOT] Spawned successfully`);

        const deviceInfo = this.gateway.deviceConnections.get(this.macAddress);
        if (deviceInfo) {
          deviceInfo.currentRoomName = roomName;
          deviceInfo.currentMode = "music";
        }
      }
    } catch (error) {
      console.error(`❌ [MUSIC-BOT] Failed: ${error.message}`);
    }
  }

  async spawnStoryBot(roomName, playlist = null) {
    try {
      console.log(`📖 [STORY-BOT] Spawning for room: ${roomName}`);

      if (!playlist) {
        playlist = await this.fetchPlaylist("story");
      }

      const url = `${MEDIA_API_BASE}/start-story-bot`;

      const response = await axios.post(
        url,
        {
          room_name: roomName,
          device_mac: this.macAddress,
          age_group: this.userData?.ageGroup || null,
          playlist: playlist,
        },
        mediaAxiosConfig()
      );

      if (response.data?.status === "started") {
        console.log(`✅ [STORY-BOT] Spawned successfully`);

        const deviceInfo = this.gateway.deviceConnections.get(this.macAddress);
        if (deviceInfo) {
          deviceInfo.currentRoomName = roomName;
          deviceInfo.currentMode = "story";
        }
      }
    } catch (error) {
      console.error(`❌ [STORY-BOT] Failed: ${error.message}`);
    }
  }

  async parseOtherMessage(json) {
    if (!this.bridge) {
      if (json.type !== "goodbye") {
        this.sendMqttMessage(JSON.stringify({
          type: "goodbye",
          session_id: json.session_id
        }));
      }
      return;
    }

    if (json.type === "goodbye") {
      console.log(`🔌 [DISCONNECT] Received goodbye from device: ${this.deviceId}`);

      if (this.bridge && this.bridge.isConnected) {
        try {
          await this.bridge.close();
          console.log(`✅ [DISCONNECT] Pipecat session closed`);
        } catch (error) {
          console.error(`❌ [DISCONNECT] Error closing Pipecat: ${error}`);
        }
      }
      return;
    }

    // Handle abort message
    if (json.type === "abort") {
      try {
        console.log(`🛑 [ABORT] Received from device: ${this.deviceId}`);
        await this.bridge.sendAbortSignal(json.session_id);
        console.log(`✅ [ABORT] Forwarded to Pipecat`);
        this.bridge.sendTtsStopMessage();
      } catch (error) {
        console.error(`❌ [ABORT] Failed: ${error}`);
      }
      return;
    }

    // Handle ready_for_greeting
    if (json.type === "ready_for_greeting") {
      console.log(`🎤 [GREETING-TRIGGER] Device ${this.deviceId} ready`);
      try {
        await this.bridge.sendReadyForGreeting();
        console.log(`✅ [GREETING-TRIGGER] Forwarded to Pipecat`);
      } catch (error) {
        console.error(`❌ [GREETING-TRIGGER] Failed: ${error}`);
      }
      return;
    }

    // Handle function_call from mobile app
    if (json.type === "function_call" && json.source === "mobile_app") {
      try {
        console.log(`🎵 [MOBILE] Function call: ${json.function_call?.name}`);
        await this.bridge.handleFunctionCall(json);
      } catch (error) {
        console.error(`❌ [MOBILE] Failed: ${error}`);
      }
      return;
    }

    // Handle PTT events
    if (json.type === "listen") {
      const state = json.state;
      if (json.mode) {
        this.lastPttMode = json.mode;
      }
      const mode = json.mode || this.lastPttMode || "manual";

      console.log(`🎤 [PTT] State: ${state}, Mode: ${mode}`);

      // Forward to Pipecat
      const pttMessage = {
        type: "ptt_event",
        action: state === "start" ? "press" : "release",
        state: state,
        mode: mode,
        device_id: this.macAddress,
        session_id: this.sessionInfo.sessionId,
        timestamp: Date.now(),
      };

      try {
        await this.bridge.forwardMessage(pttMessage);
        console.log(`✅ [PTT] Forwarded ${state} to Pipecat`);
      } catch (error) {
        console.error(`❌ [PTT] Failed: ${error}`);
      }
      return;
    }

    debug("Received other message:", json);
  }

  async checkKeepAlive() {
    console.log("timer 2");
    if (this.closing) {
      return;
    }

    const now = Date.now();

    // Check max session duration
    const sessionDuration = now - this.sessionStartTime;
    if (sessionDuration > this.maxSessionDurationMs) {
      console.log(`⏰ [MAX-DURATION] Session exceeded limit: ${this.deviceId}`);
      this.close();
      return;
    }

    // If ending, check for final timeout
    if (this.isEnding && this.endPromptSentTime) {
      const timeSinceEndPrompt = now - this.endPromptSentTime;
      const maxEndWaitTime = 30 * 1000;

      if (timeSinceEndPrompt > maxEndWaitTime) {
        console.log(`🕒 [END-TIMEOUT] Force closing: ${this.deviceId}`);

        try {
          this.sendMqttMessage(JSON.stringify({
            type: "goodbye",
            session_id: this.sessionInfo.sessionId,
            reason: "end_prompt_timeout",
            timestamp: Date.now(),
          }));
        } catch (error) {
          console.error(`Failed to send goodbye: ${error.message}`);
        }

        this.close();
        return;
      }
      return;
    }

    // Check inactivity
    const timeSinceLastActivity = now - this.lastActivityTime;

    if (this.bridge && this.bridge.isAudioPlaying) {
      const audioPlayingDuration = this.bridge.audioPlayingStartTime
        ? now - this.bridge.audioPlayingStartTime
        : 0;

      if (audioPlayingDuration < this.maxAudioPlayingDurationMs) {
        console.log(`🎵 [AUDIO-ACTIVE] Skipping timeout check: ${this.deviceId}`);
        return;
      } else {
        console.log(`⚠️ [AUDIO-STUCK] Clearing stuck audio flag: ${this.deviceId}`);
        this.bridge.isAudioPlaying = false;
        this.bridge.audioPlayingStartTime = null;
      }
    }

    if (timeSinceLastActivity > this.inactivityTimeoutMs) {
      if (!this.isEnding && this.bridge) {
        this.isEnding = true;
        this.endPromptSentTime = now;
        console.log(`👋 [END-PROMPT] Sending goodbye: ${this.deviceId}`);

        try {
          this.goodbyeSent = false;
          await this.bridge.sendEndPrompt(this.sessionInfo.sessionId);
        } catch (error) {
          console.error(`Failed to send end prompt: ${error.message}`);
          this.close();
        }
        return;
      } else {
        console.log(`🕒 [TIMEOUT] Closing due to inactivity: ${this.deviceId}`);

        try {
          this.sendMqttMessage(JSON.stringify({
            type: "goodbye",
            session_id: this.sessionInfo.sessionId,
            reason: "inactivity_timeout",
            timestamp: Date.now(),
          }));
        } catch (error) {
          console.error(`Failed to send goodbye: ${error.message}`);
        }

        this.close();
        return;
      }
    }
  }

  async close() {
    if (this.closing) {
      console.log(`⚠️ [CLEANUP] Already closing ${this.deviceId}`);
      return;
    }

    const stack = new Error().stack;
    const callerLine = stack.split("\n")[2]?.trim() || "Unknown";

    console.log(`🛑 [CLEANUP] Starting cleanup: ${this.deviceId}`);
    console.log(`📍 [CLEANUP-TRACE] Called from: ${callerLine}`);
    this.closing = true;

    // Stop media bot if music/story
    if (this.roomType === "music" || this.roomType === "story") {
      try {
        console.log(`🛑 [CLEANUP] Stopping ${this.roomType} bot`);
        await axios.post(
          `${MEDIA_API_BASE}/stop-bot`,
          { room_name: this.sessionInfo.sessionId },
          mediaAxiosConfig({ timeout: 3000 })
        );
        console.log(`✅ [CLEANUP] Bot stopped`);
      } catch (error) {
        console.warn(`⚠️ [CLEANUP] Failed to stop bot: ${error.message}`);
      }
    }

    // Close Pipecat bridge
    if (this.bridge) {
      await this.bridge.close();
      this.bridge = null;
    }

    // Remove from connections
    this.gateway.connections.delete(this.connectionId);
    console.log(`🗑️ [CLEANUP] Removed connectionId ${this.connectionId}`);

    setTimeout(() => {
      this.gateway.deviceConnections.delete(this.deviceId);
      console.log(`🗑️ [CLEANUP] Removed ${this.deviceId} from deviceConnections`);
    }, 2000);
  }

  isAlive() {
    return this.bridge && this.bridge.isAlive();
  }
}

module.exports = { VirtualMQTTConnection, setConfigManager };
