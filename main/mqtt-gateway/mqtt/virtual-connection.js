/**
 * Virtual MQTT Connection
 *
 * Represents a per-device MQTT session.
 * Manages UDP encryption, LiveKit bridge lifecycle, and device communication.
 */

const axios = require("axios");
const crypto = require("crypto");
const {
  LiveKitBridge,
  setConfigManager: setLivekitConfigManager,
} = require("../livekit/livekit-bridge");
const { streamingCrypto } = require("../core/streaming-crypto");
const {
  MEDIA_API_BASE,
  mediaAxiosConfig,
} = require("../core/media-api-client");
const logger = require("../utils/logger");
const { fetchMemoriesWithTimeout, buildDispatchMetadata } = require("../core/mem0-integration");

// Character to Agent name mapping for multi-agent dispatch
const CHARACTER_AGENT_MAP = {
  "Cheeko": "cheeko-agent",
  "Math Tutor": "math-tutor-agent",
  "Riddle Solver": "riddle-solver-agent",
  "Word Ladder": "word-ladder-agent",
};

// MAC address regex
const MacAddressRegex = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;

// Global config manager and debug reference (injected by gateway)
let configManager = null;
let debug = null;

function setConfigManager(cm) {
  configManager = cm;
  // Setup debug logger
  const debugModule = require("debug");
  debug = debugModule("mqtt-server");
}
class VirtualMQTTConnection {
  constructor(deviceId, connectionId, gateway, helloPayload, workerPool) {
    this.deviceId = deviceId;
    this.connectionId = connectionId;
    this.gateway = gateway;
    this.workerPool = workerPool; // Shared WorkerPoolManager instance
    this.clientId = helloPayload.clientId || deviceId;
    this.username = helloPayload.username;
    this.password = helloPayload.password;
    this.fullClientId = helloPayload.clientId;

    this.bridge = null;
    this.roomType = null; // ADD: Track room type (conversation, music, story)
    this.language = null; // ADD: Track language for music/story filtering
    this.udp = {
      remoteAddress: null,
      cookie: null,
      localSequence: 0,
      remoteSequence: 0,
    };
    this.headerBuffer = Buffer.alloc(16);
    this.closing = false;

    // Add inactivity timeout tracking
    this.lastActivityTime = Date.now();
    this.inactivityTimeoutMs = 2 * 60 * 1000; // 2 minutes in milliseconds
    this.isEnding = false; // Track if end prompt has been sent
    this.endPromptSentTime = null; // Track when end prompt was sent

    // Session duration tracking (max 60 minutes)
    this.sessionStartTime = Date.now();
    this.maxSessionDurationMs = 60 * 60 * 1000; // 60 minutes max session duration
    this.maxAudioPlayingDurationMs = 90 * 1000; // 90 seconds max before considering audio stuck
    this.lastPttMode = "manual"; // Default PTT mode

    // Track target toy for mobile-initiated connections
    this.targetToyMac = null; // MAC address of the toy to route audio to
    this.isMobileConnection = false; // Flag to identify mobile connections

    // Pipeline audio capture state (UDP → assembled pipeline_request)
    this.pipelineCapturing = false;
    this.pipelineAudioBuffer = [];
    this.pipelineContext = null;
    this.pipelineRequestId = null;
    this.pipelineSilenceTimer = null;
    this.pipelineAbsoluteTimer = null;
    this.pipelineSilenceTimeoutMs = 700;   // ms of no UDP frames = done recording
    this.pipelineMaxCaptureMs = 10000;     // 10s absolute max capture

    // Parse device info from hello message
    if (helloPayload.clientId) {
      const parts = helloPayload.clientId.split("@@@");
      if (parts.length === 3) {
        // GID_test@@@mac_address@@@uuid format
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = parts[2];
        this.userData = null; // Set to null since we don't have user data

        console.log(`   - Group ID: ${this.groupId}`);
        console.log(`   - MAC Address: ${this.macAddress}`);
        console.log(`   - UUID: ${this.uuid}`);

        // Validate MAC address format
        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }

        // For virtual connections, we can skip the full credential validation
        // since we're working with EMQX and not the original MQTT protocol
      } else if (parts.length === 2) {
        this.groupId = parts[0];
        this.macAddress = parts[1].replace(/_/g, ":");
        this.uuid = `virtual-${Date.now()}`; // Generate a virtual UUID
        this.userData = null;

        if (!MacAddressRegex.test(this.macAddress)) {
          console.error(`❌ [VIRTUAL] Invalid macAddress: ${this.macAddress}`);
          this.close();
          return;
        }
      } else {
        console.error(
          `❌ [VIRTUAL] Invalid clientId format: ${helloPayload.clientId}`
        );
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
    // CRITICAL FIX: Don't reset timer if connection is closing
    if (this.closing) {
      console.log(
        `⚠️ [TIMER-IGNORE] Ignoring activity during cleanup for virtual device: ${this.deviceId}`
      );
      return;
    }

    this.lastActivityTime = Date.now();

    // Allow timer reset for certain message types even during ending
    const allowedDuringEnding = ["playback_control", "playing", "status"];

    if (
      this.isEnding &&
      (!messageType || !allowedDuringEnding.includes(messageType))
    ) {
      console.log(
        `� [[ENDING-IGNORE] Activity during goodbye sequence ignored for virtual device: ${this.deviceId}`
      );
      return; // Don't log timer reset during ending
    }

    // If we reach here, either not ending OR it's an allowed message type
    if (this.isEnding && messageType) {
      console.log(
        `🔄 [ENDING-RESET] Timer reset allowed for message type '${messageType}' during ending: ${this.deviceId}`
      );
      // Reset ending state since device is still active
      this.isEnding = false;
      this.endPromptSentTime = null;
    }

    console.log(
      `⏰ [TIMER-RESET] Virtual device ${this.deviceId} activity timer reset`
    );
  }

  handlePublish(publishData) {
    // Update activity timestamp on any MQTT message receipt
    console.log(
      `📨 [ACTIVITY] MQTT message received from virtual device ${this.deviceId}, resetting inactivity timer`
    );

    // Parse message to get type before updating activity
    let messageType = null;
    try {
      const json = JSON.parse(publishData.payload);
      messageType = json.type || json.msg; // Handle both 'type' and 'msg' fields
    } catch (error) {
      console.log(
        `⚠️ [PARSE] Could not parse message type for timer reset: ${error.message}`
      );
    }

    this.updateActivityTime(messageType);

    try {
      const json = JSON.parse(publishData.payload);
      if (json.type === "hello") {
        if (json.version !== 3) {
          debug(
            "Unsupported protocol version:",
            json.version,
            "closing connection"
          );
          this.close();
          return;
        }

        this.parseHelloMessage(json).catch((error) => {
          console.error(
            `❌ [HELLO-ERROR] Failed to process hello message for ${this.deviceId}:`,
            error
          );
          console.error(`❌ [HELLO-ERROR] Error stack:`, error.stack);
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
      console.error(
        `❌ [VIRTUAL] Error in sendMqttMessage for device ${this.deviceId}:`,
        error
      );
    }
  }

  // Forward MCP response to LiveKit agent
  async forwardMcpResponse(mcpPayload, sessionId, requestId) {
    console.log(
      `🔋 [MCP-FORWARD] Forwarding MCP response for device ${this.deviceId}`
    );

    if (
      !this.bridge ||
      !this.bridge.room ||
      !this.bridge.room.localParticipant
    ) {
      console.error(
        `❌ [MCP-FORWARD] No LiveKit room available for device ${this.deviceId}`
      );
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

      const messageString = JSON.stringify(responseMessage);
      const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));

      await this.bridge.room.localParticipant.publishData(messageData, {
        reliable: true,
      });

      console.log(
        `✅ [MCP-FORWARD] Successfully forwarded MCP response to LiveKit agent`
      );
      console.log(`✅ [MCP-FORWARD] Request ID: ${requestId}`);
      return true;
    } catch (error) {
      console.error(`❌ [MCP-FORWARD] Error forwarding MCP response:`, error);
      return false;
    }
  }

  sendUdpMessage(payload, timestamp) {
    // Direct UDP implementation for virtual devices
    if (!this.udp.remoteAddress) {
      // console.log(`⚠️ [UDP-DROP] Virtual device ${this.deviceId} UDP remoteAddress is null, dropping ${payload.length} bytes`);
      return;
    }

    this.udp.localSequence++;
    const header = this.generateUdpHeader(
      payload.length,
      timestamp,
      this.udp.localSequence
    );

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    const encryptedPayload = streamingCrypto.encrypt(
      payload,
      this.udp.encryption,
      this.udp.key,
      header
    );
    const message = Buffer.concat([header, encryptedPayload]);
    this.gateway.sendUdpMessage(message, this.udp.remoteAddress);
  }

  // ─── Pipeline capture methods ───────────────────────────────────────

  startPipelineCapture(context, requestId) {
    this.pipelineCapturing = true;
    this.pipelineContext = context;
    this.pipelineRequestId = requestId;
    this.pipelineAudioBuffer = [];
    this.clearPipelineTimers();

    console.log(
      `🎙️ [PIPELINE-CAPTURE] Starting audio capture for ${this.deviceId} (req=${requestId})`
    );

    // Absolute timeout — safety valve to prevent infinite capture
    this.pipelineAbsoluteTimer = setTimeout(() => {
      if (this.pipelineCapturing) {
        if (this.pipelineAudioBuffer.length > 0) {
          console.log(
            `⏰ [PIPELINE-CAPTURE] Absolute timeout (${this.pipelineMaxCaptureMs}ms) — finalizing with ${this.pipelineAudioBuffer.length} frames`
          );
          this.finalizePipelineCapture();
        } else {
          this.abortPipelineCapture("absolute timeout with no frames");
        }
      }
    }, this.pipelineMaxCaptureMs);

    // Initial wait timeout — if no UDP frames arrive within 3s, abort
    this.pipelineSilenceTimer = setTimeout(() => {
      if (this.pipelineCapturing && this.pipelineAudioBuffer.length === 0) {
        this.abortPipelineCapture("no UDP frames received within 3s");
      }
    }, 3000);
  }

  finalizePipelineCapture() {
    const frameCount = this.pipelineAudioBuffer.length;
    const context = this.pipelineContext;
    const requestId = this.pipelineRequestId;

    // Concat all buffered Opus frames into a single blob
    const assembledAudio = Buffer.concat(this.pipelineAudioBuffer);
    const audioBase64 = assembledAudio.toString("base64");

    // Reset state
    this.clearPipelineTimers();
    this.pipelineCapturing = false;
    this.pipelineAudioBuffer = [];
    this.pipelineContext = null;
    this.pipelineRequestId = null;

    console.log(
      `✅ [PIPELINE-CAPTURE] Silence detected after ${frameCount} frames (${assembledAudio.length} bytes) — publishing assembled request`
    );

    // Publish to internal/server-ingest for custom_pipeline.py
    const envelope = {
      sender_client_id: this.fullClientId,
      orginal_payload: {
        type: "pipeline_request",
        context: context,
        audio: audioBase64,
        audio_format: "opus",
        sample_rate: 16000,
        request_id: requestId,
        _gateway_assembled: true,
      },
    };

    this.gateway.mqttPublish(
      "internal/server-ingest",
      JSON.stringify(envelope)
    );

    console.log(
      `📤 [PIPELINE-CAPTURE] Published assembled pipeline_request (${frameCount} frames, ${assembledAudio.length} bytes) for ${this.deviceId}`
    );
  }

  abortPipelineCapture(reason) {
    const frameCount = this.pipelineAudioBuffer.length;
    this.clearPipelineTimers();
    this.pipelineCapturing = false;
    this.pipelineAudioBuffer = [];
    this.pipelineContext = null;
    this.pipelineRequestId = null;

    console.warn(
      `⚠️ [PIPELINE-CAPTURE] Aborted for ${this.deviceId}: ${reason} (had ${frameCount} frames)`
    );
  }

  clearPipelineTimers() {
    if (this.pipelineSilenceTimer) {
      clearTimeout(this.pipelineSilenceTimer);
      this.pipelineSilenceTimer = null;
    }
    if (this.pipelineAbsoluteTimer) {
      clearTimeout(this.pipelineAbsoluteTimer);
      this.pipelineAbsoluteTimer = null;
    }
  }

  // ─── End pipeline capture methods ─────────────────────────────────

  generateUdpHeader(length, timestamp, sequence) {
    this.headerBuffer.writeUInt8(1, 0);
    this.headerBuffer.writeUInt8(0, 1);
    this.headerBuffer.writeUInt16BE(length, 2);
    this.headerBuffer.writeUInt32BE(this.connectionId, 4);
    this.headerBuffer.writeUInt32BE(timestamp, 8);
    this.headerBuffer.writeUInt32BE(sequence, 12);
    return Buffer.from(this.headerBuffer);
  }

  async parseHelloMessage(json) {
    console.log(
      `🔍 [PARSE-HELLO] Starting parseHelloMessage for ${this.deviceId}`
    );
    console.log(
      `🔄 [UDP-CHECK] Before UDP recreation, remoteAddress: ${this.udp.remoteAddress
        ? `${this.udp.remoteAddress.address}:${this.udp.remoteAddress.port}`
        : "null"
      }`
    );
    console.log(
      `🔍 [PARSE-HELLO] JSON version: ${json.version}, has bridge: ${!!this
        .bridge}`
    );

    // ADD: Query database for device mode instead of reading from hello message
    const macAddress = this.deviceId.replace(/:/g, "").toLowerCase();
    const axios = require("axios");

    try {
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const apiUrl = `${baseUrl}/toy/device/${macAddress}/mode`;

      console.log(
        `🔍 [ROOM-TYPE] Querying database for device ${this.deviceId} mode...`
      );
      const response = await axios.get(apiUrl, { timeout: 5000 });

      if (response.data.code === 0) {
        this.roomType = response.data.data;
        console.log(
          `✅ [ROOM-TYPE] Device ${this.deviceId} mode from DB: ${this.roomType}`
        );
      } else {
        console.warn(
          `⚠️ [ROOM-TYPE] API returned error: ${response.data.msg}, using default 'conversation'`
        );
        this.roomType = "conversation";
      }
    } catch (error) {
      console.error(
        `❌ [ROOM-TYPE] Error querying mode from DB: ${error.message}, using default 'conversation'`
      );
      this.roomType = "conversation";
    }

    // Extract language from hello message
    this.language = json.language || null;
    console.log(
      `📱 [ROOM-TYPE] Final room type: ${this.roomType}, language: ${this.language || "N/A"
      }`
    );

    // Validate room type
    if (!["conversation", "music", "story"].includes(this.roomType)) {
      console.error(
        `❌ [ROOM-TYPE] Invalid room_type from DB: ${this.roomType}, using 'conversation'`
      );
      this.roomType = "conversation";
    }

    // Fetch device_mode (PTT mode: auto/manual) from database
    this.deviceMode = "manual"; // Default to manual (push-to-talk)
    try {
      const deviceModeUrl = `${process.env.MANAGER_API_URL.replace("/toy", "")}/toy/device/${macAddress}/device-mode`;
      console.log(`🔍 [DEVICE-MODE] Querying PTT mode for device ${this.deviceId}...`);
      const deviceModeResponse = await axios.get(deviceModeUrl, { timeout: 5000 });

      if (deviceModeResponse.data.code === 0) {
        this.deviceMode = deviceModeResponse.data.data;
        console.log(`✅ [DEVICE-MODE] Device ${this.deviceId} PTT mode from DB: ${this.deviceMode}`);
      } else {
        console.warn(`⚠️ [DEVICE-MODE] API returned error: ${deviceModeResponse.data.msg}, using default 'manual'`);
      }
    } catch (error) {
      console.error(`❌ [DEVICE-MODE] Error querying PTT mode from DB: ${error.message}, using default 'manual'`);
    }

    // Validate device_mode
    if (!["auto", "manual"].includes(this.deviceMode)) {
      console.warn(`⚠️ [DEVICE-MODE] Invalid device_mode: ${this.deviceMode}, using 'manual'`);
      this.deviceMode = "manual";
    }

    // Fetch current character, child profile, and Mem0 memories for conversation mode
    this.currentCharacter = null;
    this.childProfile = null;
    this.mem0Memories = null;
    if (this.roomType === "conversation") {
      // Fetch character, child profile, and Mem0 memories in parallel for faster initialization
      const [character, childProfile, memoryData] = await Promise.all([
        this.fetchCurrentCharacter(this.deviceId),
        this.fetchChildProfile(this.deviceId),
        fetchMemoriesWithTimeout(this.deviceId)  // Mem0 memories with 2s timeout
      ]);
      this.currentCharacter = character;
      this.childProfile = childProfile;
      this.mem0Memories = memoryData;
      logger.info(`🎭 [CHARACTER] Conversation mode - using character: "${this.currentCharacter}"`);
      if (this.childProfile) {
        logger.info(`👶 [CHILD-PROFILE] Child: "${this.childProfile.name}", age: ${this.childProfile.age}`);
      }
      if (this.mem0Memories && this.mem0Memories.memories && this.mem0Memories.memories.length > 0) {
        logger.info(`🧠 [MEM0] Retrieved ${this.mem0Memories.memories.length} long-term memories`);
      }
    }

    // ── Quota gate: check quota before creating LiveKit room ──
    if (this.roomType === "conversation") {
      try {
        const quotaUrl = `${process.env.MANAGER_API_URL}/subscription/quota/${this.macAddress}`;
        console.log(`🔍 [QUOTA-GATE] Checking quota for device ${this.deviceId}...`);
        const quotaResponse = await axios.get(quotaUrl, {
          headers: { "X-Service-Key": process.env.MANAGER_API_SECRET || "" },
          timeout: 5000,
        });

        const quotaData = quotaResponse.data?.data;
        if (quotaData && quotaData.isExhausted) {
          console.log(`🚫 [QUOTA-GATE] Quota exhausted for ${this.deviceId}`);
          this.sendMqttMessage(JSON.stringify({
            type: "quota_exhausted",
            mac_address: this.macAddress,
            timestamp: Date.now(),
          }));
          return;
        }
        console.log(`✅ [QUOTA-GATE] Quota OK for ${this.deviceId} (remaining: ${quotaData?.remaining})`);
      } catch (error) {
        console.warn(`⚠️ [QUOTA-GATE] Quota check failed (fail-open): ${error.message}`);
      }
    }

    this.udp = {
      ...this.udp,
      key: crypto.randomBytes(16),
      nonce: this.generateUdpHeader(0, 0, 0),
      encryption: "aes-128-ctr",
      remoteSequence: 0,
      localSequence: 0,
      startTime: Date.now(),
    };
    console.log(
      `🔄 [UDP-CHECK] After UDP recreation, remoteAddress: ${this.udp.remoteAddress
        ? `${this.udp.remoteAddress.address}:${this.udp.remoteAddress.port}`
        : "null"
      }`
    );

    if (this.bridge) {
      debug(
        `${this.deviceId} received duplicate hello message, closing previous bridge`
      );
      await this.bridge.close(); // FIXED: await the async close() to ensure room is deleted
      this.bridge = null;
    }

    // Generate new UUID for session
    const newSessionUuid = crypto.randomUUID();
    console.log(`🔄 [NEW-SESSION] Generated UUID: ${newSessionUuid}`);

    // Generate session_id for room WITH ROOM TYPE
    const macForRoom = this.macAddress.replace(/:/g, "");
    const futureSessionId = `${newSessionUuid}_${macForRoom}_${this.roomType}`;
    this.udp.session_id = futureSessionId;

    console.log(`🏠 [ROOM-NAME] Room will be: ${futureSessionId}`);

    console.log(
      `🏗️ [HELLO] Creating LiveKit room and connecting gateway (NO agent deployment yet)`
    );

    // Clean up ALL old sessions for this device BEFORE creating new room
    // This prevents ghost rooms with agents from causing duplicate joins
    if (this.gateway.roomService) {
      const newRoomName = `${newSessionUuid}_${macForRoom}_${this.roomType}`;
      console.log(
        `🧹 [CLEANUP] Cleaning up old sessions for device: ${this.deviceId}`
      );
      try {
        await LiveKitBridge.cleanupOldSessionsForDevice(
          this.deviceId,
          this.gateway.roomService,
          newRoomName
        );
        console.log(`✅ [CLEANUP] Old sessions cleaned up`);
      } catch (err) {
        console.warn(`⚠️ [CLEANUP] Cleanup error (non-fatal):`, err.message);
        // Continue anyway - don't block room creation
      }
    }

    // Create bridge after cleanup completes
    this.bridge = new LiveKitBridge(
      this,
      json.version,
      this.deviceId,
      newSessionUuid,
      this.userData,
      this.workerPool
    );

    // Mark bridge as waiting for agent deployment
    this.bridge.agentDeployed = false;

    // Setup bridge close handler
    this.bridge.on("close", () => {
      const seconds = (Date.now() - this.udp.startTime) / 1000;
      console.log(`Call ended: ${this.deviceId} Duration: ${seconds}s`);
      this.sendMqttMessage(
        JSON.stringify({ type: "goodbye", session_id: this.udp.session_id })
      );
      this.bridge = null;
    });

    // Reset activity timer
    this.lastActivityTime = Date.now();

    try {
      // Connect to LiveKit room (gateway joins, but agent doesn't deploy yet)
      const roomCreationStart = Date.now();
      await this.bridge.connect(
        json.audio_params,
        json.features,
        this.server?.roomService || this.gateway?.roomService
      );
      const roomCreationTime = Date.now() - roomCreationStart;
      console.log(
        `✅ [HELLO] Room created and gateway connected in ${roomCreationTime}ms`
      );

      // Send mode_update to device firmware (includes listening_mode for PTT)
      console.log(`📤 [HELLO] Sending mode_update to device...`);
      const modeUpdateMsg = {
        type: "mode_update",
        mode: this.roomType,
        listening_mode: this.deviceMode,
        ...(this.roomType === "conversation" && this.currentCharacter
          ? { character: this.currentCharacter }
          : {}),
        session_id: futureSessionId,
        timestamp: Date.now(),
      };
      this.sendMqttMessage(JSON.stringify(modeUpdateMsg));
      console.log(
        `✅ [HELLO] Sent mode_update (${this.roomType}, listening_mode: ${this.deviceMode}${this.currentCharacter ? ", character: " + this.currentCharacter : ""
        }) to device`
      );

      // ADD: Room type-specific initialization
      if (this.roomType === "conversation") {
        console.log(`🗣️ [CONVERSATION] Waiting for agent dispatch...`);
        // Agent dispatched separately
      } else if (this.roomType === "music") {
        console.log(`🎵 [MUSIC] Spawning music bot via Python API...`);
        await this.spawnMusicBot(futureSessionId);
      } else if (this.roomType === "story") {
        console.log(`📖 [STORY] Spawning story bot via Python API...`);
        await this.spawnStoryBot(futureSessionId);
      }

      console.log(
        `⏰ [HELLO] Room will auto-close if no participants join within 60 seconds (LiveKit emptyTimeout)`
      );

      // Send hello response with UDP session details
      // this.sendMqttMessage(JSON.stringify({
      //   type: "mode_update",
      //   mode: this.roomType,
      //   session_id: futureSessionId,
      //   timestamp: Date.now()
      // }));
      const helloResponseMsg = {
        type: "hello",
        version: json.version,
        mode: this.roomType,
        ...(this.roomType === "conversation" && this.currentCharacter
          ? { character: this.currentCharacter }
          : {}),
        session_id: this.udp.session_id,
        timestamp: Date.now(),
        transport: "udp",
        udp: {
          server: this.gateway.publicIp,
          port: this.gateway.udpPort,
          encryption: this.udp.encryption,
          key: this.udp.key.toString("hex"),
          nonce: this.udp.nonce.toString("hex"),
          connection_id: this.connectionId,
          cookie: this.connectionId,
        },
        audio_params: {
          sample_rate: 24000,
          channels: 1,
          frame_duration: 60,
          format: "opus",
        },
      };
      this.sendMqttMessage(JSON.stringify(helloResponseMsg));
      console.log(`📤 [HELLO] Sent hello response with mode: ${this.roomType}`);

      // AUTO-DEPLOY AGENT: Dispatch agent immediately for conversation mode
      // Agent will auto-greet via on_enter lifecycle hook - no gateway greeting trigger needed
      if (
        this.roomType === "conversation" &&
        this.gateway?.agentDispatchClient
      ) {
        // Guard: Skip if agent already deployed (prevent duplicate dispatches)
        if (this.bridge?.agentDeployed) {
          logger.warn(`[AUTO-DEPLOY] Agent already deployed, skipping duplicate dispatch`);
          return;
        }

        const roomName = this.bridge?.room?.name || this.udp.session_id;

        // Use currentCharacter (fetched from DB earlier) to dispatch correct agent
        const agentName = CHARACTER_AGENT_MAP[this.currentCharacter] || "cheeko-agent";
        logger.info(`🚀 [AUTO-DEPLOY] Character: "${this.currentCharacter}" → Agent: "${agentName}"`);
        logger.info(`🚀 [AUTO-DEPLOY] Dispatching ${agentName} to room: ${roomName}`);

        try {
          // CRITICAL: Set flag BEFORE dispatch to prevent race conditions
          this.bridge.agentDeployed = true;

          await this.gateway.agentDispatchClient.createDispatch(
            roomName,
            agentName,
            {
              metadata: buildDispatchMetadata({
                macAddress: this.macAddress,
                deviceId: this.deviceId,
                character: this.currentCharacter,
                childProfile: this.childProfile,
                memoryData: this.mem0Memories
              }),
            }
          );
          logger.info(`✅ [AUTO-DEPLOY] Agent "${agentName}" dispatched to room: ${roomName}`);
          // Agent will greet user via on_enter lifecycle hook
        } catch (dispatchError) {
          // Reset flag on failure so retry can work
          this.bridge.agentDeployed = false;
          logger.error(`❌ [AUTO-DEPLOY] Failed to dispatch agent: ${dispatchError.message}`);
        }
      } else if (this.roomType !== "conversation") {
        // For music/story modes, no agent needed
        console.log(
          `🎵 [MODE] ${this.roomType} mode - no agent deployment needed`
        );
      } else {
        // Fallback: Send ready_for_greeting if no dispatch client available
        console.log(
          `⚠️ [FALLBACK] No agentDispatchClient, sending ready_for_greeting`
        );
        this.sendMqttMessage(
          JSON.stringify({
            type: "ready_for_greeting",
            session_id: this.udp.session_id,
            timestamp: Date.now(),
          })
        );
      }
    } catch (error) {
      this.sendMqttMessage(
        JSON.stringify({
          type: "error",
          message: "Failed to create room",
        })
      );
      console.error(`${this.deviceId} failed to create room: ${error}`);
    }
  }

  async fetchPlaylist(mode) {
    try {
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const playlistUrl = `${baseUrl}/toy/device/${this.deviceId}/playlist/${mode}`;

      console.log(
        `📋 [PLAYLIST] Fetching ${mode} playlist from: ${playlistUrl}`
      );
      const response = await axios.get(playlistUrl, { timeout: 5000 });

      if (response.data && response.data.code === 0 && response.data.data) {
        const playlist = response.data.data;
        console.log(
          `✅ [PLAYLIST] Fetched ${playlist.length} ${mode} items for device ${this.deviceId}`
        );
        return playlist;
      } else {
        console.log(
          `ℹ️ [PLAYLIST] No ${mode} playlist found for device ${this.deviceId}`
        );
        return [];
      }
    } catch (error) {
      console.error(
        `❌ [PLAYLIST] Failed to fetch ${mode} playlist: ${error.message}`
      );
      return []; // Return empty playlist on error
    }
  }

  async fetchCurrentCharacter(macAddress) {
    try {
      const cleanMac = macAddress.replace(/:/g, "").toLowerCase();
      const apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${cleanMac}/current-character`;

      logger.info(`🎭 [CHARACTER] Fetching character for device: ${macAddress}`);
      logger.info(`🎭 [CHARACTER] API URL: ${apiUrl}`);

      const response = await axios.get(apiUrl, { timeout: 5000 });
      logger.info(`🎭 [CHARACTER] API Response: ${JSON.stringify(response.data)}`);

      // Handle both response formats:
      // Format 1: { code: 0, data: "Math Tutor" }
      // Format 2: { code: 0, data: { characterName: "Math Tutor" } }
      if (response.data && response.data.code === 0 && response.data.data) {
        let character;
        if (typeof response.data.data === 'string') {
          character = response.data.data;
        } else if (response.data.data.characterName) {
          character = response.data.data.characterName;
        } else {
          character = "Cheeko";
        }
        logger.info(`🎭 [CHARACTER] ✅ Got character from DB: "${character}"`);
        return character;
      } else {
        logger.warn(`🎭 [CHARACTER] ⚠️ No character in response, using default: "Cheeko"`);
        return "Cheeko";
      }
    } catch (error) {
      logger.error(`🎭 [CHARACTER] ❌ Failed to fetch: ${error.message}`);
      logger.warn(`🎭 [CHARACTER] Using default: "Cheeko"`);
      return "Cheeko"; // Default fallback
    }
  }

  async fetchChildProfile(macAddress) {
    try {
      const cleanMac = macAddress.replace(/:/g, "").toLowerCase();
      const apiUrl = `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`;
      const serverSecret = process.env.MANAGER_API_SECRET;

      logger.info(`👶 [CHILD-PROFILE] Fetching profile for device: ${macAddress}, secret: ${serverSecret ? 'SET(' + serverSecret.substring(0,8) + '...)' : 'NOT SET'}`);

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
      logger.info(`👶 [CHILD-PROFILE] API Response: ${JSON.stringify(response.data)}`);

      if (response.data && response.data.code === 0 && response.data.data) {
        const profile = response.data.data;
        logger.info(`👶 [CHILD-PROFILE] ✅ Got profile: name="${profile.name}", age=${profile.age}`);
        return profile;
      } else {
        logger.warn(`👶 [CHILD-PROFILE] ⚠️ No profile in response`);
        return null;
      }
    } catch (error) {
      logger.error(`👶 [CHILD-PROFILE] ❌ Failed to fetch: ${error.message}`);
      return null;
    }
  }

  // async spawnMusicBot(roomName, playlist = null) {
  //   try {
  //     console.log(`🎵 [MUSIC-BOT] Calling Python API: ${roomName}`);

  //     // If no playlist provided, fetch it
  //     if (!playlist) {
  //       playlist = await this.fetchPlaylist("music");
  //     }

  //     const response = await axios.post(
  //       "http://10.0.215.150:8003/start-music-bot",
  //       {
  //         room_name: roomName,
  //         device_mac: this.deviceId,
  //         language: this.language,
  //         playlist: playlist, // Pass playlist to bot
  //       },
  //       { timeout: 5000 }
  //     );

  //     if (response.data && response.data.status === "started") {
  //       console.log(`✅ [MUSIC-BOT] Music bot spawned successfully`);
  //       console.log(
  //         `🎵 [MUSIC-BOT] Language: ${
  //           response.data.language
  //         }, Playlist items: ${playlist?.length || 0}`
  //       );

  //       // Store room info for control messages
  //       const deviceInfo = this.gateway.deviceConnections.get(this.deviceId);
  //       if (deviceInfo) {
  //         deviceInfo.currentRoomName = roomName;
  //         deviceInfo.currentMode = "music";
  //         console.log(
  //           `✅ [CONTROL] Stored room info - Room: ${roomName}, Mode: music`
  //         );
  //       }
  //     }
  //   } catch (error) {
  //     console.error(`❌ [MUSIC-BOT] Failed: ${error.message}`);
  //   }
  // }
  async spawnMusicBot(roomName, playlist = null) {
    try {
      console.log(
        `🎵 [MUSIC-BOT] Calling Python API to spawn music bot for room: ${roomName}`
      );

      // If no playlist provided, fetch it
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
          playlist: playlist, // Pass playlist to bot
        },
        mediaAxiosConfig()
      );

      if (response.data && response.data.status === "started") {
        console.log(
          `✅ [MUSIC-BOT] Music bot spawned successfully for room: ${roomName}`
        );
        console.log(
          `🎵 [MUSIC-BOT] Language: ${response.data.language
          }, Playlist items: ${playlist?.length || 0}`
        );

        // Store room info for control messages
        const deviceInfo = this.gateway.deviceConnections.get(this.macAddress);
        if (deviceInfo) {
          deviceInfo.currentRoomName = roomName;
          deviceInfo.currentMode = "music";
          console.log(
            `✅ [CONTROL] Stored room info - Room: ${roomName}, Mode: music`
          );
        }
      } else if (response.data && response.data.status === "already_active") {
        console.log(
          `ℹ️ [MUSIC-BOT] Music bot already active for room: ${roomName}`
        );
      } else {
        console.log(
          `⚠️ [MUSIC-BOT] Unexpected response from Media API:`,
          response.data
        );
      }
    } catch (error) {
      console.error(
        `❌ [MUSIC-BOT] Failed to spawn music bot: ${error.message}`
      );
      if (error.response) {
        console.error(`❌ [MUSIC-BOT] API response:`, error.response.data);
      }
      // Don't throw - let the connection continue even if bot spawn fails
    }
  }

  async spawnStoryBot(roomName, playlist = null) {
    try {
      console.log(
        `📖 [STORY-BOT] Calling Python API to spawn story bot for room: ${roomName}`
      );

      // If no playlist provided, fetch it
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

      if (response.data && response.data.status === "started") {
        console.log(
          `✅ [STORY-BOT] Story bot spawned successfully for room: ${roomName}`
        );
        console.log(`📖 [STORY-BOT] Playlist items: ${playlist?.length || 0}`);

        const deviceInfo = this.gateway.deviceConnections.get(this.macAddress);
        if (deviceInfo) {
          deviceInfo.currentRoomName = roomName;
          deviceInfo.currentMode = "story";
          console.log(
            `✅ [CONTROL] Stored room info - Room: ${roomName}, Mode: story`
          );
        }
      } else if (response.data && response.data.status === "already_active") {
        console.log(
          `ℹ️ [STORY-BOT] Story bot already active for room: ${roomName}`
        );
      } else {
        console.log(
          `⚠️ [STORY-BOT] Unexpected response from Media API:`,
          response.data
        );
      }
    } catch (error) {
      console.error(
        `❌ [STORY-BOT] Failed to spawn story bot: ${error.message}`
      );
      if (error.response) {
        console.error(`❌ [STORY-BOT] API response:`, error.response.data);
      }
      // Don't throw - let the connection continue even if bot spawn fails
    }
  }

  async parseOtherMessage(json) {
    if (!this.bridge) {
      if (json.type !== "goodbye") {
        this.sendMqttMessage(
          JSON.stringify({ type: "goodbye", session_id: json.session_id })
        );
      }
      return;
    }

    if (json.type === "goodbye") {
      console.log(
        `🔌 [DISCONNECT-AGENT] Received goodbye from device: ${this.deviceId} - disconnecting agent but keeping room alive`
      );

      // Disconnect agent participant but keep room alive
      if (
        this.bridge &&
        this.bridge.room &&
        this.bridge.room.localParticipant
      ) {
        try {
          // Send disconnect message to agent via data channel
          const disconnectMessage = {
            type: "disconnect_agent",
            session_id: json.session_id,
            timestamp: Date.now(),
            source: "mqtt_gateway",
          };

          const messageString = JSON.stringify(disconnectMessage);
          const messageData = new Uint8Array(
            Buffer.from(messageString, "utf8")
          );

          await this.bridge.room.localParticipant.publishData(messageData, {
            reliable: true,
          });

          console.log(`✅ [DISCONNECT-AGENT] Sent disconnect signal to agent`);

          // Mark agent as not joined so it can rejoin
          this.bridge.agentJoined = false;
          this.bridge.agentDeployed = false;

          // Reset agent join promise for next join
          this.bridge.agentJoinPromise = new Promise((resolve) => {
            this.bridge.agentJoinResolve = resolve;
          });

          console.log(
            `🏠 [DISCONNECT-AGENT] Room remains alive, agent can rejoin on 's' press`
          );
        } catch (error) {
          console.error(
            `❌ [DISCONNECT-AGENT] Failed to disconnect agent:`,
            error
          );
        }
      }

      // Keep bridge and room alive - agent can rejoin with 's'
      return;
    }

    // Handle abort message - forward to LiveKit agent via data channel
    if (json.type === "abort") {
      try {
        console.log(
          `🛑 [ABORT] Received abort signal from device: ${this.deviceId}`
        );
        await this.bridge.sendAbortSignal(json.session_id);
        console.log(
          `✅ [ABORT] Successfully forwarded abort signal to LiveKit agent`
        );

        // Send TTS stop to device to return it to listening mode (red light)
        this.bridge.sendTtsStopMessage();
        console.log(
          `🛑 [ABORT] Sent TTS stop message to device: ${this.deviceId}`
        );
      } catch (error) {
        console.error(
          `❌ [ABORT] Failed to forward abort signal to LiveKit:`,
          error
        );
      }
      return;
    }

    // Handle ready_for_greeting message - forward to LiveKit agent via data channel
    if (json.type === "ready_for_greeting") {
      console.log(
        `🎤 [GREETING-TRIGGER] Device ${this.deviceId} ready for greeting`
      );

      try {
        // Forward to LiveKit agent via data channel
        const greetingMessage = {
          type: "ready_for_greeting",
          session_id: json.session_id,
          timestamp: Date.now(),
        };

        const messageString = JSON.stringify(greetingMessage);
        const messageData = new Uint8Array(
          Buffer.from(messageString, "utf8")
        );

        await this.bridge.room.localParticipant.publishData(messageData, {
          reliable: true,
        });

        console.log(`✅ [GREETING-TRIGGER] Forwarded to agent`);
      } catch (error) {
        console.error(
          `❌ [GREETING-TRIGGER] Failed to forward to agent:`,
          error
        );
      }
      return;
    }

    // Handle function_call from mobile app
    if (json.type === "function_call" && json.source === "mobile_app") {
      try {
        console.log(
          `🎵 [MOBILE] Function call received from mobile app: ${this.deviceId}`
        );
        console.log(`   🎯 Function: ${json.function_call?.name}`);
        console.log(
          `   📝 Arguments: ${JSON.stringify(json.function_call?.arguments)}`
        );

        const functionName = json.function_call?.name;

        // Handle volume controls directly via MCP (bypass agent for faster response)
        if (
          functionName === "self_volume_up" ||
          functionName === "self_volume_down"
        ) {
          console.log(
            `🎛️ [MOBILE-MCP] Volume control detected, using direct MCP adjust logic`
          );

          if (!this.bridge) {
            console.error(`❌ [MOBILE-MCP] No bridge available`);
            return;
          }

          try {
            const action = functionName === "self_volume_up" ? "up" : "down";
            const step = json.function_call.arguments?.step || 10;

            const newVolume = await this.bridge.debouncedAdjustVolume(
              action,
              step,
              300
            );
            console.log(
              `✅ [MOBILE-MCP] Volume adjusted successfully to ${newVolume}`
            );
          } catch (error) {
            console.error(`❌ [MOBILE-MCP] Failed to adjust volume:`, error);
          }

          return;
        }

        // Define MCP query functions that should be handled directly by gateway
        const mcpQueryFunctions = [
          "self_get_battery_status",
          "self_get_volume",
          "self_get_device_status",
        ];

        // For Music/Story modes, handle MCP query functions directly via gateway
        // Music/Story bots don't support function calls - they only stream audio
        if (
          this.roomType &&
          (this.roomType === "music" || this.roomType === "story")
        ) {
          if (mcpQueryFunctions.includes(functionName)) {
            console.log(
              `🔋 [MOBILE-MCP] ${this.roomType} mode detected - handling MCP query directly via gateway`
            );

            if (!this.bridge) {
              console.error(`❌ [MOBILE-MCP] No bridge available`);
              return;
            }

            // Use bridge's handleFunctionCall to send MCP request to device
            await this.bridge.handleFunctionCall({
              function_call: json.function_call,
              timestamp: json.timestamp || new Date().toISOString(),
              request_id: json.request_id || `mobile_req_${Date.now()}`,
            });

            console.log(
              `✅ [MOBILE-MCP] MCP query sent directly to device (bypassing agent)`
            );
            return;
          }
        }

        // For non-volume, non-MCP-query functions, forward to LiveKit agent (conversation mode only)
        console.log(`🎵 [MOBILE] Forwarding to LiveKit agent for processing`);

        // Check if bridge and room are available
        if (
          !this.bridge ||
          !this.bridge.room ||
          !this.bridge.room.localParticipant
        ) {
          console.error(
            `❌ [MOBILE] No bridge/room available to handle function call`
          );
          return;
        }

        // Only send abort signal for playback-related functions
        // Don't send abort for query functions like battery status
        const playbackFunctions = [
          "play_music",
          "play_story",
          "next_song",
          "previous_song",
          "skip_song",
        ];

        if (playbackFunctions.includes(functionName)) {
          console.log(`🛑 [MOBILE] Sending abort signal before new playback`);
          await this.bridge.sendAbortSignal(this.udp.session_id);
          // Wait a moment for abort to process
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          console.log(
            `ℹ️ [MOBILE] Query function detected, skipping abort signal`
          );
        }

        // Then forward the new function call to LiveKit agent
        const messageString = JSON.stringify({
          type: "function_call",
          function_call: json.function_call,
          source: "mobile_app",
          timestamp: json.timestamp || Date.now(),
          request_id: json.request_id || `mobile_req_${Date.now()}`,
        });
        const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));

        await this.bridge.room.localParticipant.publishData(messageData, {
          reliable: true,
        });

        console.log(`✅ [MOBILE] Function call forwarded to LiveKit agent`);
      } catch (error) {
        console.error(`❌ [MOBILE] Failed to handle function call:`, error);
      }
      return;
    }

    // Handle mobile music request - forward to LiveKit bridge (legacy support)
    if (json.type === "mobile_music_request") {
      try {
        console.log(
          `🎵 [MOBILE] Mobile music request received from virtual device: ${this.deviceId}`
        );
        console.log(`   🎵 Song: ${json.song_name}`);
        console.log(`   🗂️ Type: ${json.content_type}`);
        console.log(`   🌐 Language: ${json.language || "Not specified"}`);

        // Mark this as a mobile-initiated connection
        this.isMobileConnection = true;
        console.log(
          `   📱 Marked as mobile connection for MAC: ${this.macAddress}`
        );

        // Check if bridge and room are available
        if (
          !this.bridge ||
          !this.bridge.room ||
          !this.bridge.room.localParticipant
        ) {
          console.error(
            `❌ [MOBILE] No bridge/room available to handle music request`
          );
          return;
        }

        // Convert to function_call format for LiveKit agent
        const functionName =
          json.content_type === "story" ? "play_story" : "play_music";
        const functionArguments = {};

        if (json.content_type === "music") {
          // For music: song_name and language
          if (json.song_name) {
            functionArguments.song_name = json.song_name;
          }
          if (json.language) {
            functionArguments.language = json.language;
          }
        } else if (json.content_type === "story") {
          // For stories: story_name and category
          if (json.song_name) {
            functionArguments.story_name = json.song_name;
          }
          if (json.language) {
            functionArguments.category = json.language;
          }
        }

        // Create function call message for LiveKit agent
        const functionCallMessage = {
          type: "function_call",
          function_call: {
            name: functionName,
            arguments: functionArguments,
          },
          source: "mobile_app",
          timestamp: Date.now(),
          request_id: `mobile_req_${Date.now()}`,
        };

        // Forward to LiveKit agent via data channel
        const messageString = JSON.stringify(functionCallMessage);
        const messageData = new Uint8Array(Buffer.from(messageString, "utf8"));

        await this.bridge.room.localParticipant.publishData(messageData, {
          reliable: true,
        });

        console.log(`✅ [MOBILE] Music request forwarded to LiveKit agent`);
        console.log(`   🎯 Function: ${functionName}`);
        console.log(`   📝 Arguments: ${JSON.stringify(functionArguments)}`);
      } catch (error) {
        console.error(
          `❌ [MOBILE] Failed to handle mobile music request:`,
          error
        );
      }
      return;
    }

    // Handle push-to-talk messages and forward to LiveKit agent for custom turn detection
    if (json.type === "listen") {
      const state = json.state; // "start" or "stop"

      // Preserve PTT mode (manual/vad) if missing in message (common in stop messages)
      if (json.mode) {
        this.lastPttMode = json.mode;
      }
      const mode = json.mode || this.lastPttMode || "manual";

      console.log(`🎤 [PTT] Listen message - State: ${state}, Mode: ${mode}`);

      // Forward PTT event to LiveKit agent for custom turn detection
      const pttMessage = {
        type: "ptt_event",
        action: state === "start" ? "press" : "release",
        state: state,
        mode: mode,
        device_id: this.macAddress,
        session_id: this.udp?.session_id || "unknown",
        timestamp: Date.now(),
        source: "device_firmware",
      };

      try {
        if (this.bridge?.room?.localParticipant) {
          const messageData = new Uint8Array(
            Buffer.from(JSON.stringify(pttMessage), "utf8")
          );

          await this.bridge.room.localParticipant.publishData(messageData, {
            reliable: true,
          });

          console.log(`✅ [PTT] Forwarded ${state} event to LiveKit agent`);
        } else {
          console.warn(`⚠️ [PTT] Cannot forward - no LiveKit connection`);
        }
      } catch (error) {
        console.error(`❌ [PTT] Failed to forward event:`, error);
      }

      return;
    }

    debug("Received other message, not forwarding to LiveKit:", json);
  }

  onUdpMessage(rinfo, message, payloadLength, timestamp, sequence) {
    // UDP messages do not reset inactivity timer - only MQTT messages do

    // Always track remote address (needed for pipeline response streaming)
    if (this.udp.remoteAddress !== rinfo) {
      this.udp.remoteAddress = rinfo;
    }

    if (sequence < this.udp.remoteSequence) {
      return;
    }
    this.udp.remoteSequence = sequence;

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    const header = message.slice(0, 16);
    const encryptedPayload = message.slice(16, 16 + payloadLength);
    const payload = streamingCrypto.decrypt(
      encryptedPayload,
      this.udp.encryption,
      this.udp.key,
      header
    );

    const payloadStr = payload.toString();
    if (payloadStr.startsWith("ping:")) {
      console.log(
        `🏓 [UDP PING] Received ping: ${payloadStr} from ${rinfo.address}:${rinfo.port}`
      );
      return;
    }

    // Pipeline capture: buffer Opus frames instead of forwarding to LiveKit
    if (this.pipelineCapturing) {
      this.pipelineAudioBuffer.push(Buffer.from(payload));

      // Reset silence timer on each frame
      if (this.pipelineSilenceTimer) {
        clearTimeout(this.pipelineSilenceTimer);
      }
      this.pipelineSilenceTimer = setTimeout(() => {
        if (this.pipelineCapturing && this.pipelineAudioBuffer.length > 0) {
          this.finalizePipelineCapture();
        }
      }, this.pipelineSilenceTimeoutMs);

      return; // Don't forward to LiveKit bridge during capture
    }

    if (!this.bridge) {
      return;
    }

    this.bridge.sendAudio(payload, timestamp);
  }

  async checkKeepAlive() {
    // Don't check keepalive if connection is closing
    console.log("timer 2");
    if (this.closing) {
      return;
    }

    const now = Date.now();

    // Check max session duration (60 minutes absolute limit)
    const sessionDuration = now - this.sessionStartTime;
    if (sessionDuration > this.maxSessionDurationMs) {
      console.log(
        `⏰ [MAX-DURATION] Session exceeded ${Math.round(
          this.maxSessionDurationMs / 60000
        )} minutes - forcing close: ${this.deviceId}`
      );
      this.close();
      return;
    }

    // If we're in ending phase, check for final timeout
    if (this.isEnding && this.endPromptSentTime) {
      const timeSinceEndPrompt = now - this.endPromptSentTime;
      const maxEndWaitTime = 30 * 1000; // 30 seconds max wait for end prompt audio

      if (timeSinceEndPrompt > maxEndWaitTime) {
        console.log(
          `🕒 [END-TIMEOUT] End prompt timeout reached, force closing virtual connection: ${this.deviceId
          } (waited ${Math.round(timeSinceEndPrompt / 1000)}s)`
        );

        // Send goodbye MQTT message before force closing
        try {
          this.sendMqttMessage(
            JSON.stringify({
              type: "goodbye",
              session_id: this.udp ? this.udp.session_id : null,
              reason: "end_prompt_timeout",
              timestamp: Date.now(),
            })
          );
          console.log(
            `👋 [GOODBYE-MQTT] Sent goodbye MQTT message to virtual device on timeout: ${this.deviceId}`
          );
        } catch (error) {
          console.error(
            `Failed to send goodbye MQTT message: ${error.message}`
          );
        }

        this.close();
        return;
      }

      // Show countdown for end prompt completion
      if (timeSinceEndPrompt % 5000 < 1000) {
        const remainingSeconds = Math.round(
          (maxEndWaitTime - timeSinceEndPrompt) / 1000
        );
        console.log(
          `⏳ [END-WAIT] Virtual device ${this.deviceId}: ${remainingSeconds}s until force disconnect`
        );
      }
      return; // Don't do normal timeout check while ending
    }

    // Check for inactivity timeout (2 minutes of no communication)
    const timeSinceLastActivity = now - this.lastActivityTime;

    // Check if audio is actively playing (but with stuck detection)
    if (this.bridge && this.bridge.isAudioPlaying) {
      // Check if audio has been playing for too long (stuck state detection)
      const audioPlayingDuration = this.bridge.audioPlayingStartTime
        ? now - this.bridge.audioPlayingStartTime
        : 0;

      if (audioPlayingDuration < this.maxAudioPlayingDurationMs) {
        // Audio is playing normally - skip timeout check
        console.log(
          `🎵 [AUDIO-ACTIVE] Audio is playing for virtual device: ${this.deviceId
          } (${Math.round(
            audioPlayingDuration / 1000
          )}s) - skipping timeout check`
        );
        return;
      } else {
        // Audio has been "playing" for too long - likely stuck
        console.log(
          `⚠️ [AUDIO-STUCK] Audio playing for ${Math.round(
            audioPlayingDuration / 1000
          )}s (>${Math.round(
            this.maxAudioPlayingDurationMs / 1000
          )}s) for device: ${this.deviceId} - proceeding with timeout check`
        );
        // Force clear the stuck audio flag
        this.bridge.isAudioPlaying = false;
        this.bridge.audioPlayingStartTime = null;
      }
    }

    if (timeSinceLastActivity > this.inactivityTimeoutMs) {
      // Send end prompt instead of immediate close
      if (!this.isEnding && this.bridge) {
        this.isEnding = true;
        this.endPromptSentTime = now;
        console.log(
          `👋 [END-PROMPT] Sending goodbye message before timeout: ${this.deviceId
          } (inactive for ${Math.round(
            timeSinceLastActivity / 1000
          )}s) - Last activity: ${new Date(
            this.lastActivityTime
          ).toISOString()}, Now: ${new Date(now).toISOString()}`
        );

        try {
          // Send end prompt to agent for voice goodbye (TTS "Time flies fast...")
          // Note: Goodbye MQTT will be sent AFTER TTS finishes (in agent_state_changed handler)
          this.goodbyeSent = false; // Flag to track if goodbye MQTT was sent
          await this.bridge.sendEndPrompt(this.udp.session_id);
          console.log(
            `👋 [END-PROMPT-SENT] Waiting for TTS goodbye to complete before sending goodbye MQTT: ${this.deviceId}`
          );
        } catch (error) {
          console.error(`Failed to send end prompt: ${error.message}`);
          // If end prompt fails, close immediately
          this.close();
        }
        return;
      } else {
        // No bridge available, send goodbye message and close immediately
        console.log(
          `🕒 [TIMEOUT] Closing virtual connection due to 2-minute inactivity: ${this.deviceId
          } (inactive for ${Math.round(timeSinceLastActivity / 1000)}s)`
        );

        // Send goodbye MQTT message before closing
        try {
          this.sendMqttMessage(
            JSON.stringify({
              type: "goodbye",
              session_id: this.udp ? this.udp.session_id : null,
              reason: "inactivity_timeout",
              timestamp: Date.now(),
            })
          );
          console.log(
            `👋 [GOODBYE-MQTT] Sent goodbye MQTT message to virtual device: ${this.deviceId}`
          );
        } catch (error) {
          console.error(
            `Failed to send goodbye MQTT message: ${error.message}`
          );
        }

        this.close();
        return;
      }
    }

    // Log remaining time until timeout (only show every 30 seconds to avoid spam)
    if (timeSinceLastActivity % 30000 < 1000) {
      const remainingSeconds = Math.round(
        (this.inactivityTimeoutMs - timeSinceLastActivity) / 1000
      );
      console.log(
        `⏰ [TIMER-CHECK] Virtual device ${this.deviceId}: ${remainingSeconds}s until timeout`
      );
    }

    // Virtual connections don't need traditional keep-alive since EMQX handles it
  }

  async close() {
    // Prevent duplicate close calls
    if (this.closing) {
      console.log(
        `⚠️ [CLEANUP] Already closing ${this.deviceId}, skipping duplicate close`
      );
      return;
    }

    // Capture stack trace to identify who called close()
    const stack = new Error().stack;
    const callerLine = stack.split("\n")[2]?.trim() || "Unknown caller";

    console.log(
      `🛑 [CLEANUP] Starting cleanup for virtual device: ${this.deviceId}`
    );
    console.log(`📍 [CLEANUP-TRACE] close() called from: ${callerLine}`);
    this.closing = true;

    // Clean up pipeline capture if active
    this.clearPipelineTimers();
    if (this.pipelineCapturing) {
      console.log(`🛑 [CLEANUP] Discarding in-progress pipeline capture (${this.pipelineAudioBuffer.length} frames)`);
      this.pipelineCapturing = false;
      this.pipelineAudioBuffer = [];
      this.pipelineContext = null;
      this.pipelineRequestId = null;
    }

    // ADD: Stop media bot if music/story room
    if (
      this.bridge &&
      this.bridge.room &&
      (this.roomType === "music" || this.roomType === "story")
    ) {
      const roomName = this.bridge.room.name;
      try {
        console.log(
          `🛑 [CLEANUP] Stopping ${this.roomType} bot for room: ${roomName}`
        );
        await axios.post(
          `${MEDIA_API_BASE}/stop-bot`,
          {
            room_name: roomName,
          },
          mediaAxiosConfig({ timeout: 3000 })
        );
        console.log(`✅ [CLEANUP] ${this.roomType} bot stopped`);
      } catch (error) {
        console.warn(`⚠️ [CLEANUP] Failed to stop bot:`, error.message);
      }
    }

    if (this.bridge) {
      await this.bridge.close(); // FIXED: await to ensure room is deleted from LiveKit
      this.bridge = null;
    }

    // Remove from connections map immediately
    this.gateway.connections.delete(this.connectionId);
    console.log(
      `🗑️ [CLEANUP] Removed connectionId ${this.connectionId} from connections map`
    );

    // CRITICAL FIX: Only remove from deviceConnections if this entry still belongs
    // to THIS connection. When a device reconnects, handleDeviceHello closes the old
    // connection and creates a new one. Without this guard, the old connection's
    // delayed delete would remove the NEW connection's entry (race condition).
    const myConnectionId = this.connectionId;
    const myDeviceId = this.deviceId;
    setTimeout(() => {
      const current = this.gateway.deviceConnections.get(myDeviceId);
      if (current && current.connectionId === myConnectionId) {
        this.gateway.deviceConnections.delete(myDeviceId);
        console.log(
          `🗑️ [CLEANUP] Removed ${myDeviceId} from deviceConnections map (conn: ${myConnectionId})`
        );
      } else {
        console.log(
          `🔒 [CLEANUP] Skipped removing ${myDeviceId} from deviceConnections — entry belongs to a newer connection`
        );
      }
    }, 2000);
  }

  isAlive() {
    return this.bridge && this.bridge.isAlive();
  }
}

module.exports = { VirtualMQTTConnection, setConfigManager };
