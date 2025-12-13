/**
 * MQTT Gateway
 *
 * Main orchestrator class that manages all device connections.
 * Handles EMQX broker, UDP server, LiveKit rooms, and agent dispatch.
 */

const dgram = require("dgram");
const mqtt = require("mqtt");
const axios = require("axios");
const {
  RoomServiceClient,
  AgentDispatchClient,
} = require("livekit-server-sdk");
const {
  VirtualMQTTConnection,
  setConfigManager: setVirtualConnectionConfigManager,
} = require("../mqtt/virtual-connection");
const { ConfigManager } = require("../utils/config-manager");
const {
  LiveKitBridge,
  setConfigManager: setLivekitConfigManager,
} = require("../livekit/livekit-bridge");
const {
  MEDIA_API_BASE,
  mediaAxiosConfig,
} = require("../core/media-api-client");
const logger = require("../utils/logger");

// Global config manager and debug reference (injected by app.js)
let configManager = null;
let debug = null;

function setConfigManager(cm) {
  configManager = cm;
  // Setup debug logger
  const debugModule = require("debug");
  debug = debugModule("mqtt-server");
  // Cascade to all dependent modules
  setLivekitConfigManager(cm);
  setVirtualConnectionConfigManager(cm);
}

class MQTTGateway {
  constructor() {
    this.udpPort = parseInt(process.env.UDP_PORT) || 1883;
    this.publicIp = process.env.PUBLIC_IP || "127.0.0.1";
    this.connections = new Map(); // clientId -> VirtualMQTTConnection
    this.keepAliveTimer = null;
    this.keepAliveCheckInterval = 15000; // Check every 15 seconds
    this.headerBuffer = Buffer.alloc(16);
    this.mqttClient = null;
    this.deviceConnections = new Map(); // deviceId -> connection info
    this.clientConnections = new Map(); // clientId -> device info (for tracking EMQX clients)

    // Initialize LiveKit RoomServiceClient for room management
    try {
      let livekitConfig = configManager.get("livekit") || {};

      // Override with environment variables if present
      if (process.env.LIVEKIT_URL) livekitConfig.url = process.env.LIVEKIT_URL;
      if (process.env.LIVEKIT_API_KEY)
        livekitConfig.api_key = process.env.LIVEKIT_API_KEY;
      if (process.env.LIVEKIT_API_SECRET)
        livekitConfig.api_secret = process.env.LIVEKIT_API_SECRET;

      if (
        !livekitConfig.url ||
        !livekitConfig.api_key ||
        !livekitConfig.api_secret
      ) {
        this.agentDispatchClient = null;
      }
    } catch (error) {
      logger.error(
        "❌ [INIT] Failed to initialize LiveKit clients:",
        error.message
      );
      this.roomService = null;
      this.agentDispatchClient = null;
    }
  }

  generateNewConnectionId() {
    // Generate a unique 32-bit integer
    let id;
    do {
      id = Math.floor(Math.random() * 0xffffffff);
    } while (this.connections.has(id));
    return id;
  }

  start() {
    // Connect to EMQX broker
    this.connectToEmqxBroker();

    this.udpServer = dgram.createSocket("udp4");
    this.udpServer.on("message", this.onUdpMessage.bind(this));
    this.udpServer.on("error", (err) => {
      logger.error("UDP error", err);
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    this.udpServer.bind(this.udpPort, () => {
      logger.warn(`UDP server listening on ${this.publicIp}:${this.udpPort}`);
    });

    // Start global heartbeat check timer
    this.setupKeepAliveTimer();
  }

  connectToEmqxBroker() {
    let brokerConfig = configManager.get("mqtt_broker") || {}; // Initialize with default object if undefined

    // Override with environment variables if present
    if (process.env.EMQX_HOST) brokerConfig.host = process.env.EMQX_HOST;
    if (process.env.EMQX_PORT)
      brokerConfig.port = parseInt(process.env.EMQX_PORT);
    if (process.env.EMQX_PROTOCOL)
      brokerConfig.protocol = process.env.EMQX_PROTOCOL;

    if (!brokerConfig.host || !brokerConfig.port) {
      logger.error("MQTT broker configuration not found in config or env vars");
      process.exit(1);
    }

    const clientId = `mqtt-gateway-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const brokerUrl = `${brokerConfig.protocol}://${brokerConfig.host}:${brokerConfig.port}`;

    logger.info(`Connecting to EMQX broker: ${brokerUrl}`);

    this.mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId,
      keepalive: brokerConfig.keepalive || 60,
      clean: brokerConfig.clean !== false,
      reconnectPeriod: brokerConfig.reconnectPeriod || 1000,
      connectTimeout: brokerConfig.connectTimeout || 30000,
    });

    this.mqttClient.on("connect", () => {
      logger.info(`✅ Connected to EMQX broker: ${brokerUrl}`);
      // Subscribe to gateway control topics
      this.mqttClient.subscribe("devices/+/hello", (err) => {
        if (err)
          logger.error("Failed to subscribe to device hello topic:", err);
        // else logger.info("📡 Subscribed to devices/+/hello");
      });
      this.mqttClient.subscribe("devices/+/data", (err) => {
        if (err) logger.error("Failed to subscribe to device data topic:", err);
        // else logger.info("📡 Subscribed to devices/+/data");
      });
      // Subscribe to the internal topic where EMQX republishes with client info
      this.mqttClient.subscribe("internal/server-ingest", (err) => {
        if (err)
          logger.error(
            "Failed to subscribe to internal/server-ingest topic:",
            err
          );
        // else logger.info("📡 Subscribed to internal/server-ingest");
      });
    });

    this.mqttClient.on("error", (err) => {
      logger.error("MQTT connection error:", err);
    });

    this.mqttClient.on("offline", () => {
      logger.warn("MQTT client went offline");
    });

    this.mqttClient.on("reconnect", () => {
      // logger.info("MQTT client reconnecting...");
    });

    this.mqttClient.on("message", (topic, message) => {
      this.handleMqttMessage(topic, message);
    });
  }

  async handleMqttMessage(topic, message) {
    // Add detailed logging for all incoming MQTT messages

    try {
      // Check if this is a control message first (before parsing)
      // if (topic.includes('/playback_control/next')) {
      //   await this.handleNextControl
      // (topic);
      //   return;
      // } else if (topic.includes('/playback_control/previous')) {
      //   await this.handlePreviousControl(topic);
      //   return;
      // }

      const payload = JSON.parse(message.toString());
      const topicParts = topic.split("/");

      // logger.info(`📨 [MQTT IN] Parsed payload:`, JSON.stringify(payload, null, 2));

      if (topic === "internal/server-ingest") {
        // Handle messages republished by EMQX with client ID info
        
        // Extract client ID and original payload from EMQX republish rule
        const clientId = payload.sender_client_id;
        const originalPayload = payload.orginal_payload;

        if (!clientId || !originalPayload) {
          logger.error(
            `❌ [MQTT IN] Invalid republished message format - missing clientId or originalPayload`
          );
          return;
        }

        // Extract device MAC from client ID
        let deviceId = "unknown-device";
        const parts = clientId.split("@@@");
        if (parts.length >= 2) {
          deviceId = parts[1].replace(/_/g, ":"); // Convert MAC format
        }

        logger.info(`📨 [MQTT-IN] ${deviceId}: ${originalPayload.type}`);
        
        // Use the common processing logic
        await this.processIngestLogic(deviceId, originalPayload, clientId);

      } else if (topicParts.length >= 3 && topicParts[0] === "devices") {
        const deviceId = topicParts[1];
        const messageType = topicParts[2]; // 'hello' or 'data' or others

        debug(
          `📨 Received MQTT message from device ${deviceId}: ${messageType}`
        );

        if (messageType === "hello") {
          this.handleDeviceHello(deviceId, payload);
          return;
        }
        
        // For other messages (data, etc), we treat them as potential control messages too.
        // Synthesize a client ID for compatibility with older logic
        // Format: mock_client@@@68_25_dd_bb_f3_a0@@@uuid
        const synthezisedClientId = `mock_client@@@${deviceId.replace(/:/g, "_")}@@@uuid`;
        
        // Process through the main logic
        await this.processIngestLogic(deviceId, payload, synthezisedClientId);
      } else {
        // logger.info(`❓ [MQTT IN] Message on unexpected topic format: ${topic}`);
      }
    } catch (error) {
      logger.error(
        "❌ [MQTT IN] Error processing MQTT message:",
        error.message
      );
    }
  }

  // Extracted logic from the internal/server-ingest handler
  async processIngestLogic(deviceId, originalPayload, clientId) {
    try {
      // Create enhanced payload with client connection info for VirtualMQTTConnection
      const enhancedPayload = {
        ...originalPayload,
        clientId: clientId,
        username: "extracted_from_emqx",
        password: "extracted_from_emqx",
      };

      if (
        originalPayload.type === "playback_control" &&
        originalPayload.action === "next"
      ) {
        // logger.info(`⏭️ [PLAYBACK-CONTROL] Next action received from topic: ${topic}`);
        // Topic is not available here easily if we want to be pure, but handleNextControl consumes topic primarily for Mac extraction if clientId is missing.
        // We pass clientId, so topic is ignored for Mac extraction.
        await this.handleNextControl("topic/ignored", clientId);
        return;
      } else if (
        originalPayload.type === "playback_control" &&
        originalPayload.action === "previous"
      ) {
        await this.handlePreviousControl("topic/ignored", clientId);
        return;
      } else if (
        originalPayload.type === "playback_control" &&
        originalPayload.action === "start_agent"
      ) {
        await this.handleStartAgentControl(
          deviceId,
          originalPayload,
          clientId
        );
        return;
      }

      // Handle specific content playback requests (play_music / play_story)
      if (originalPayload.type === "function_call") {
        const functionName = originalPayload.function_call?.name;

        if (functionName === "play_music") {
          await this.handleSpecificMusicRequest(
            deviceId,
            originalPayload,
            clientId
          );
          return;
        } else if (functionName === "play_story") {
          await this.handleSpecificStoryRequest(
            deviceId,
            originalPayload,
            clientId
          );
          return;
        }
      }

      // Handle MCP responses - check for pending promises first, then forward to LiveKit agent
      if (
        originalPayload.type === "mcp" &&
        originalPayload.payload &&
        (originalPayload.payload.result || originalPayload.payload.error)
      ) {
        // Find the device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (deviceInfo && deviceInfo.connection) {
          const mcpRequestId = originalPayload.payload.id;

          // Check if there's a pending promise for this request (volume adjust logic)
          const bridge = deviceInfo.connection.bridge;
          if (bridge && bridge.pendingMcpRequests) {
            const pendingRequest =
              bridge.pendingMcpRequests.get(mcpRequestId);
            if (pendingRequest) {
              // Resolve or reject the promise
              if (originalPayload.payload.error) {
                const errorMsg =
                  originalPayload.payload.error.message ||
                  "Unknown MCP error";
                pendingRequest.reject(new Error(errorMsg));
              } else {
                // Extract the actual result from MCP response format
                const result = originalPayload.payload.result;
                let actualResult = result;

                if (
                  result &&
                  result.content &&
                  Array.isArray(result.content) &&
                  result.content.length > 0
                ) {
                  const contentItem = result.content[0];
                  if (contentItem.type === "text" && contentItem.text) {
                    actualResult = contentItem.text;
                  }
                }

                pendingRequest.resolve(actualResult);
              }

              // Clean up
              bridge.pendingMcpRequests.delete(mcpRequestId);
              return; // Don't forward to agent, this was handled by gateway logic
            }
          }

          // If no pending promise, forward to LiveKit agent (normal flow)
          const requestId = `req_${mcpRequestId}`;
          await deviceInfo.connection.forwardMcpResponse(
            originalPayload.payload,
            originalPayload.session_id,
            requestId
          );
        }
      }

      if (originalPayload.type === "hello") {
        this.handleDeviceHello(deviceId, enhancedPayload);
      } else if (originalPayload.type === "character-change") {
        this.handleDeviceCharacterChange(deviceId, enhancedPayload);
      } else if (originalPayload.type === "mode-change") {
        this.handleDeviceModeChange(deviceId, enhancedPayload);
      } else if (originalPayload.type === "abort") {
        // Send abort to virtual device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (deviceInfo && deviceInfo.connection) {
          deviceInfo.connection.handlePublish({
            payload: JSON.stringify(originalPayload),
          });
        }
      } else if (originalPayload.type === "start_greeting") {
        // Special handling for start_greeting - CREATE ROOM and deploy agent, then trigger greeting

        let greetingSent = false;

        // Check for virtual device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (deviceInfo && deviceInfo.connection) {
          const connection = deviceInfo.connection;

          // Room should already exist from parseHelloMessage, explicitly dispatch agent
          if (connection.bridge) {
            const bridge = connection.bridge;
            const startTime = Date.now();
            const roomName = bridge.room ? bridge.room.name : null;

            if (!roomName) {
              logger.error(
                `❌ [START-GREETING] Cannot dispatch agent - room name not available`
              );
              return;
            }

            // ADD: ONLY dispatch agent for conversation rooms
            if (connection.roomType !== "conversation") {
              // For music/story rooms, send TTS start message to trigger UDP connection
              connection.sendMqttMessage(
                JSON.stringify({
                  type: "tts",
                  state: "start",
                  session_id: connection.udp.session_id,
                })
              );
              return; // Don't dispatch agent for music/story rooms
            }

            // For conversation mode, skip sending greeting here
            return;

            // (Old start_greeting logic was here, removed as it was effectively unreachable or commented out/redundant in new flow)
            // If you need to restore the agent dispatch logic, it should go here if the conversation mode check didn't return.
          } else {
            logger.error(
              `❌ [START-GREETING] No bridge found for device ${deviceId} - room should have been created during hello!`
            );
          }
        }

        if (!greetingSent) {
          // logger.info(`⚠️ [START-GREETING] No bridge found or triggered`);
        }
      } else {
        // Route to virtual device connection (Default handling for 'data' messages etc)
        const deviceInfo = this.deviceConnections.get(deviceId);

        if (deviceInfo && deviceInfo.connection) {
          // Send success message to mobile app
          const successMessage = {
            type: "device_status",
            status: "connected",
            message: "song is playing",
            deviceId: deviceId,
            timestamp: Date.now(),
          };

          const appTopic = `app/p2p/${deviceId}`;
          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttPublish(appTopic, successMessage);
          }

          this.handleDeviceData(deviceId, enhancedPayload);
        } else {
          // Send device not connected message to mobile app
          const errorMessage = {
            type: "device_status",
            status: "not_connected",
            message: "Device is not connected",
            deviceId: deviceId,
            timestamp: Date.now(),
          };

          const appTopic = `app/p2p/${deviceId}`;
          if (this.mqttClient && this.mqttClient.connected) {
            this.mqttPublish(appTopic, errorMessage);
          }
        }
      }
    } catch (error) {
      logger.error(
        "❌ [MQTT IN] Error processing MQTT message:",
        error.message
      );
    }
  }

  /**
   * Check if an agent is already present in a LiveKit room
   * Uses LiveKit Server API to get actual participants (more reliable than local flags)
   * @param {string} roomName - The LiveKit room name to check
   * @returns {Promise<{exists: boolean, identity: string|null}>} - Whether agent exists and its identity
   */
  async checkAgentInRoom(roomName) {
    try {
      if (!this.roomService) {
        // logger.warn(`⚠️ [AGENT-CHECK] RoomService not available, cannot check participants`);
        return { exists: false, identity: null };
      }

      const participants = await this.roomService.listParticipants(roomName);

      for (const participant of participants) {
        // logger.info(`   - Participant: ${participant.identity} (state: ${participant.state})`);

        // Check if this participant is an agent (identity contains 'agent' or is 'cheeko-agent')
        if (
          participant.identity &&
          (participant.identity.toLowerCase().includes("agent") ||
            participant.identity === "cheeko-agent")
        ) {
          // logger.info(`✅ [AGENT-CHECK] Found existing agent: ${participant.identity}`);
          return { exists: true, identity: participant.identity };
        }
      }

      return { exists: false, identity: null };
    } catch (error) {
      logger.error(
        `❌ [AGENT-CHECK] Error checking room participants:`,
        error.message
      );
      // On error, return false to allow dispatch attempt (fail-safe)
      return { exists: false, identity: null };
    }
  }

  setupControlTopics(macAddress) {
    // Subscribe to control topics for next/previous
    const nextTopic = `cheeko/${macAddress}/playback_control/next`;
    const previousTopic = `cheeko/${macAddress}/playback_control/previous`;

    this.mqttClient.subscribe(nextTopic, (err) => {
      if (err) {
        logger.error(`❌ [CONTROL] Failed to subscribe to ${nextTopic}:`, err);
      }
      // else logger.info(`✅ [CONTROL] Subscribed to: ${nextTopic}`);
    });

    this.mqttClient.subscribe(previousTopic, (err) => {
      if (err) {
        logger.error(
          `❌ [CONTROL] Failed to subscribe to ${previousTopic}:`,
          err
        );
      }
      // else logger.info(`✅ [CONTROL] Subscribed to: ${previousTopic}`);
    });
  }

  async handleNextControl(topic, clientId = null) {
    let macAddress;

    if (clientId) {
      // Extract MAC from clientId format: GID_test@@@68_25_dd_bb_f3_a0@@@uuid
      const clientParts = clientId.split("@@@");
      if (clientParts.length >= 2) {
        macAddress = clientParts[1].replace(/_/g, ":");
      }
    } else {
      // Fallback: Extract MAC address from topic: cheeko/{macAddress}/control/next
      const topicParts = topic.split("/");
      macAddress = topicParts[1];
    }

    // logger.info(`⏭️ [CONTROL] Next requested for device: ${macAddress}`);

    // Find device info
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo) {
      logger.warn(`⚠️ [CONTROL] Device not found: ${macAddress}`);
      return;
    }

    const roomName = deviceInfo.currentRoomName;
    const mode = deviceInfo.currentMode;

    if (!roomName || !mode) {
      logger.warn(
        `⚠️ [CONTROL] No active room or mode for device: ${macAddress}`
      );
      return;
    }

    let apiUrl = null;

    try {
      if (mode === "music") {
        apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/next`;
      } else if (mode === "story") {
        apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/next`;
      } else {
        // logger.warn(`⚠️ [CONTROL] Next/Previous not supported for mode: ${mode}`);
        return;
      }

      // Send TTS stop message first
      if (clientId) {
        const controlTopic = `devices/p2p/${clientId}`;
        const ttsStopMsg = {
          type: "tts",
          state: "stop",
          timestamp: Date.now(),
        };

        this.mqttPublish(controlTopic, ttsStopMsg);
      }

      // logger.info(`⏭️ [CONTROL] Sending next skip request to: ${apiUrl}`);
      const response = await axios.post(
        apiUrl,
        {},
        mediaAxiosConfig({ timeout: 5000 })
      );
      // logger.info(`✅ [CONTROL] Next skip successful`);

      // Send TTS start message after successful skip
      if (clientId) {
        const controlTopic = `devices/p2p/${clientId}`;
        const ttsStartMsg = {
          type: "tts",
          state: "start",
          text:
            mode === "music"
              ? "Skipping to next song"
              : "Skipping to next story",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };

        this.mqttPublish(controlTopic, ttsStartMsg);
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to next:`, error.message);

      // Send error notification to device if possible
      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Skip failed, please try again",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };
        this.mqttPublish(errorTopic, errorMsg);
      }
    }
  }

  async handlePreviousControl(topic, clientId = null) {
    let macAddress;

    if (clientId) {
      // Extract MAC from clientId format: GID_test@@@68_25_dd_bb_f3_a0@@@uuid
      const clientParts = clientId.split("@@@");
      if (clientParts.length >= 2) {
        macAddress = clientParts[1].replace(/_/g, ":");
      }
    } else {
      // Fallback: Extract MAC address from topic: cheeko/{macAddress}/control/previous
      const topicParts = topic.split("/");
      macAddress = topicParts[1];
    }

    // logger.info(`⏮️ [CONTROL] Previous requested for device: ${macAddress}`);

    // Find device info
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo) {
      logger.warn(`⚠️ [CONTROL] Device not found: ${macAddress}`);
      return;
    }

    const roomName = deviceInfo.currentRoomName;
    const mode = deviceInfo.currentMode;

    if (!roomName || !mode) {
      logger.warn(
        `⚠️ [CONTROL] No active room or mode for device: ${macAddress}`
      );
      return;
    }

    let apiUrl = null;

    try {
      if (mode === "music") {
        apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/previous`;
      } else if (mode === "story") {
        apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/previous`;
      } else {
        // logger.warn(`⚠️ [CONTROL] Next/Previous not supported for mode: ${mode}`);
        return;
      }

      // Send TTS stop message first
      if (clientId) {
        const controlTopic = `devices/p2p/${clientId}`;
        const ttsStopMsg = {
          type: "tts",
          state: "stop",
          timestamp: Date.now(),
        };

        this.mqttPublish(controlTopic, ttsStopMsg);
      }

      // logger.info(`⏮️ [CONTROL] Sending previous skip request to: ${apiUrl}`);
      const response = await axios.post(apiUrl, {}, mediaAxiosConfig());
      // logger.info(`✅ [CONTROL] Previous skip successful`);

      // Send TTS start message after successful skip
      if (clientId) {
        const controlTopic = `devices/p2p/${clientId}`;
        const ttsStartMsg = {
          type: "tts",
          state: "start",
          text:
            mode === "music"
              ? "Going to previous song"
              : "Going to previous story",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };

        this.mqttPublish(controlTopic, ttsStartMsg);
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to previous:`, error.message);

      // Send error notification to device if possible
      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Previous skip failed, please try again",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };
        this.mqttPublish(errorTopic, errorMsg);
      }
    }
  }

  async handleStartAgentControl(deviceId, payload, clientId = null) {
    try {
      const sessionId = payload.session_id;
      if (!sessionId) {
        logger.warn(`⚠️ [START-AGENT] No session_id in payload`);
        return;
      }

      const parts = sessionId.split("_");
      if (parts.length < 3) {
        logger.warn(`⚠️ [START-AGENT] Invalid session_id format: ${sessionId}`);
        return;
      }

      const roomType = parts[parts.length - 1];
      const roomName = sessionId;

      // logger.info(`▶️ [START-AGENT] Processing start_agent for mode: ${roomType}`);

      const deviceInfo = this.deviceConnections.get(deviceId);
      if (!deviceInfo) {
        logger.warn(`⚠️ [START-AGENT] Device not found: ${deviceId}`);
        return;
      }

      const previousMode =
        deviceInfo.previousMode || deviceInfo.currentMode || null;
      const isModeSwitch = previousMode !== null && previousMode !== roomType;

      if (deviceInfo.previousMode) {
        delete deviceInfo.previousMode;
      }

      if (roomType === "music") {
        const apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/start`;

        try {
          const response = await axios.post(
            apiUrl,
            { is_mode_switch: isModeSwitch },
            mediaAxiosConfig({ timeout: 5000 })
          );

          if (response.data && response.data.status === "started") {
            const connection = deviceInfo.connection;
            if (connection) {
              connection.sendMqttMessage(
                JSON.stringify({
                  type: "tts",
                  state: "start",
                  session_id: roomName,
                })
              );
            }
          }
        } catch (error) {
          logger.error(
            `❌ [START-AGENT] Failed to start music bot:`,
            error.message
          );
        }
      } else if (roomType === "story") {
        const apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/start`;

        try {
          const response = await axios.post(
            apiUrl,
            { is_mode_switch: isModeSwitch },
            mediaAxiosConfig({ timeout: 5000 })
          );

          if (response.data && response.data.status === "started") {
            const connection = deviceInfo.connection;
            if (connection) {
              connection.sendMqttMessage(
                JSON.stringify({
                  type: "tts",
                  state: "start",
                  session_id: roomName,
                })
              );
            }
          }
        } catch (error) {
          logger.error(
            `❌ [START-AGENT] Failed to start story bot:`,
            error.message
          );
        }
      } else if (roomType === "conversation") {
        const connection = deviceInfo.connection;
        if (
          connection &&
          connection.bridge &&
          connection.bridge.room &&
          connection.bridge.room.localParticipant
        ) {
          const agentCheck = await this.checkAgentInRoom(roomName);

          if (!agentCheck.exists) {
            if (!isModeSwitch) {
              // Fresh boot: dispatch agent now
              if (this.agentDispatchClient) {
                try {
                  const dispatch =
                    await this.agentDispatchClient.createDispatch(
                      roomName,
                      "cheeko-agent",
                      {
                        metadata: JSON.stringify({
                          device_mac: connection.macAddress,
                          device_uuid: deviceId,
                          timestamp: Date.now(),
                        }),
                      }
                    );
                  connection.bridge.agentDeployed = true;
                } catch (dispatchError) {
                  logger.error(
                    `❌ [START-AGENT] Failed to dispatch agent:`,
                    dispatchError.message
                  );
                  connection.sendMqttMessage(
                    JSON.stringify({
                      type: "error",
                      code: "AGENT_DISPATCH_FAILED",
                      message: "Failed to start conversation agent",
                      timestamp: Date.now(),
                    })
                  );
                  return;
                }
              } else {
                logger.error(
                  `❌ [START-AGENT] AgentDispatchClient not initialized`
                );
                return;
              }
            }
          } else {
            connection.bridge.agentJoined = true;
            connection.bridge.agentDeployed = true;
          }

          // Wait for agent to join
          const maxWaitTime = 10000;
          const startTime = Date.now();
          while (Date.now() - startTime < maxWaitTime) {
            const check = await this.checkAgentInRoom(roomName);
            if (check.exists) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          // Send greeting trigger to agent
          const greetingMessage = {
            type: "start_greeting",
            session_id: sessionId,
            is_mode_switch: isModeSwitch,
            timestamp: Date.now(),
          };
          const messageData = new TextEncoder().encode(
            JSON.stringify(greetingMessage)
          );
          await connection.bridge.room.localParticipant.publishData(
            messageData,
            { reliable: true }
          );
        } else {
          logger.error(
            `❌ [START-AGENT] No active LiveKit room for device: ${deviceId}`
          );
        }
      } else {
        logger.warn(`⚠️ [START-AGENT] Unknown room type: ${roomType}`);
      }
    } catch (error) {
      logger.error(`❌ [START-AGENT] Error:`, error.message);
    }
  }

  async handleSpecificMusicRequest(deviceId, payload, clientId = null) {
    try {
      const macAddress = payload.session_id;
      const songName = payload.function_call.arguments.song_name;
      const loopEnabled = payload.function_call.arguments.loop_enabled || false;

      const deviceInfo = this.deviceConnections.get(macAddress);
      if (!deviceInfo || !deviceInfo.connection) {
        await this.sendErrorResponse(
          clientId,
          "Device not connected",
          macAddress
        );
        return;
      }

      if (
        deviceInfo.currentMode !== "music" &&
        deviceInfo.currentMode !== "conversation"
      ) {
        await this.sendErrorResponse(
          clientId,
          `Device is in ${deviceInfo.currentMode} mode, cannot play music`,
          macAddress
        );
        return;
      }

      const connection = deviceInfo.connection;
      if (
        connection.bridge &&
        connection.bridge.room &&
        connection.bridge.room.localParticipant
      ) {
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now(),
        };
        const messageData = new TextEncoder().encode(
          JSON.stringify(functionCallMessage)
        );
        await connection.bridge.room.localParticipant.publishData(messageData, {
          reliable: true,
        });
        await this.sendSuccessResponse(
          clientId,
          `Playing "${songName}"`,
          macAddress
        );
      } else {
        logger.error(
          `❌ [SPECIFIC-MUSIC] No active LiveKit room for device: ${macAddress}`
        );
        await this.sendErrorResponse(
          clientId,
          "No active audio session",
          macAddress
        );
      }
    } catch (error) {
      logger.error(
        `❌ [SPECIFIC-MUSIC] Error processing request: ${error.message}`
      );
      await this.sendErrorResponse(
        clientId,
        "Failed to process music request",
        payload.session_id
      );
    }
  }

  async handleSpecificStoryRequest(deviceId, payload, clientId = null) {
    try {
      const macAddress = payload.session_id;
      const storyName = payload.function_call.arguments.story_name;
      const loopEnabled = payload.function_call.arguments.loop_enabled || false;

      const deviceInfo = this.deviceConnections.get(macAddress);
      if (!deviceInfo || !deviceInfo.connection) {
        await this.sendErrorResponse(
          clientId,
          "Device not connected",
          macAddress
        );
        return;
      }

      if (
        deviceInfo.currentMode !== "story" &&
        deviceInfo.currentMode !== "conversation"
      ) {
        await this.sendErrorResponse(
          clientId,
          `Device is in ${deviceInfo.currentMode} mode, cannot play story`,
          macAddress
        );
        return;
      }

      const connection = deviceInfo.connection;
      if (
        connection.bridge &&
        connection.bridge.room &&
        connection.bridge.room.localParticipant
      ) {
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now(),
        };
        const messageData = new TextEncoder().encode(
          JSON.stringify(functionCallMessage)
        );
        await connection.bridge.room.localParticipant.publishData(messageData, {
          reliable: true,
        });
        await this.sendSuccessResponse(
          clientId,
          `Playing "${storyName}"`,
          macAddress
        );
      } else {
        logger.error(
          `❌ [SPECIFIC-STORY] No active LiveKit room for device: ${macAddress}`
        );
        await this.sendErrorResponse(
          clientId,
          "No active audio session",
          macAddress
        );
      }
    } catch (error) {
      logger.error(
        `❌ [SPECIFIC-STORY] Error processing request: ${error.message}`
      );
      await this.sendErrorResponse(
        clientId,
        "Failed to process story request",
        payload.session_id
      );
    }
  }

  async forwardSpecificContentRequest(room, requestData) {
    try {
      const messageData = new TextEncoder().encode(JSON.stringify(requestData));
      await room.localParticipant.publishData(messageData, {
        reliable: true,
        topic: "specific_content",
      });
    } catch (error) {
      logger.error(
        `❌ [DATA-CHANNEL] Failed to forward request: ${error.message}`
      );
      throw error;
    }
  }

  async sendSuccessResponse(clientId, message, macAddress) {
    if (!clientId) return;

    const successMessage = {
      type: "specific_content_response",
      status: "success",
      message: message,
      device_mac: macAddress,
      timestamp: Date.now(),
    };

    const responseTopic = `devices/p2p/${clientId}`;
    this.mqttPublish(responseTopic, successMessage);
  }

  async sendErrorResponse(clientId, errorMessage, macAddress) {
    if (!clientId) return;

    const errorResponse = {
      type: "specific_content_response",
      status: "error",
      message: errorMessage,
      device_mac: macAddress,
      timestamp: Date.now(),
    };

    const responseTopic = `devices/p2p/${clientId}`;
    this.mqttPublish(responseTopic, errorResponse);
  }

  handleDeviceHello(deviceId, payload) {
    // logger.info(`📱 [HELLO] Device: ${deviceId}`);

    // Close and remove old connection if exists
    const existingDeviceInfo = this.deviceConnections.get(deviceId);
    if (existingDeviceInfo) {
      const oldConnection = existingDeviceInfo.connection;
      const oldConnectionId = existingDeviceInfo.connectionId;
      this.connections.delete(oldConnectionId);
      if (oldConnection && !oldConnection.closing) {
        oldConnection.closing = true;
        oldConnection.close();
      }
    }

    const connectionId = this.generateNewConnectionId();
    const virtualConnection = new VirtualMQTTConnection(
      deviceId,
      connectionId,
      this,
      payload
    );

    this.connections.set(connectionId, virtualConnection);
    this.deviceConnections.set(deviceId, {
      connectionId,
      connection: virtualConnection,
    });
    this.setupControlTopics(deviceId);

    try {
      virtualConnection.handlePublish({ payload: JSON.stringify(payload) });
    } catch (error) {
      logger.error(
        `❌ [HELLO] Error in handlePublish for device ${deviceId}:`,
        error
      );
    }
  }

  handleDeviceData(deviceId, payload) {
    const deviceInfo = this.deviceConnections.get(deviceId);

    if (deviceInfo && deviceInfo.connection) {
      deviceInfo.connection.handlePublish({ payload: JSON.stringify(payload) });
    } else {
      logger.warn(`📱 Received data from unknown device: ${deviceId}`);
    }
  }

  async handleDeviceCharacterChange(deviceId, payload) {
    try {
      const characterName =
        payload.characterName || payload.character_name || null;
      const macAddress = deviceId.replace(/:/g, "").toLowerCase();

      const axios = require("axios");
      let apiUrl, requestBody;

      if (characterName) {
        apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${macAddress}/set-character`;
        requestBody = { characterName: characterName };
      } else {
        apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${macAddress}/cycle-character`;
        requestBody = {};
      }

      const response = await axios.post(apiUrl, requestBody, {
        timeout: 10000,
      });

      if (response.data.code === 0 && response.data.data.success) {
        const { newModeName } = response.data.data;

        const fs = require("fs");
        const path = require("path");
        const audioMapPath = path.join(
          __dirname,
          "audio",
          "character_change",
          "audio_map.json"
        );
        const audioMap = JSON.parse(fs.readFileSync(audioMapPath, "utf8"));

        const audioFileName = audioMap.modes[newModeName] || audioMap.default;
        const pcmFileName = audioFileName.replace(".opus", ".pcm");
        const audioFilePath = path.join(
          __dirname,
          "audio",
          "character_change",
          pcmFileName
        );

        if (!fs.existsSync(audioFilePath)) {
          logger.error(
            `❌ [CHARACTER-CHANGE] Audio file not found: ${audioFilePath}`
          );
          return;
        }

        await this.streamAudioViaUdp(
          deviceId,
          audioFilePath,
          newModeName,
          true
        );
      } else {
        logger.error(`❌ [CHARACTER-CHANGE] API error:`, response.data);
      }
    } catch (error) {
      logger.error(`❌ [CHARACTER-CHANGE] Error:`, error.message);
    }
  }

  async streamAudioViaUdp(
    deviceId,
    audioFilePath,
    modeName,
    sendGoodbye = false
  ) {
    try {
      const fs = require("fs");
      const connection = this.deviceConnections.get(deviceId)?.connection;

      if (!connection) {
        logger.error(
          `❌ [AUDIO-STREAM] No active connection for device: ${deviceId}`
        );
        return;
      }

      const clientId = connection.clientId;
      if (!clientId) {
        logger.error(
          `❌ [AUDIO-STREAM] No client ID found for device: ${deviceId}`
        );
        return;
      }

      const pcmFilePath = audioFilePath.replace(".opus", ".pcm");
      if (!fs.existsSync(pcmFilePath)) {
        logger.error(`❌ [AUDIO-STREAM] PCM file not found: ${pcmFilePath}`);
        return;
      }

      const pcmData = fs.readFileSync(pcmFilePath);
      const controlTopic = `devices/p2p/${clientId}`;

      // Send TTS start via MQTT
      const ttsStartMsg = {
        type: "tts",
        state: "start",
        text: `Switched to ${modeName} mode`,
        timestamp: Date.now(),
      };
      this.mqttPublish(controlTopic, ttsStartMsg);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stream PCM in 60ms frames
      const FRAME_SIZE_SAMPLES = 1440;
      const FRAME_SIZE_BYTES = FRAME_SIZE_SAMPLES * 2;
      let offset = 0;
      let frameCount = 0;

      const startTime = connection.udp?.startTime || Date.now();
      let baseTimestamp = (Date.now() - startTime) & 0xffffffff;

      while (offset < pcmData.length) {
        const frameData = pcmData.slice(
          offset,
          Math.min(offset + FRAME_SIZE_BYTES, pcmData.length)
        );

        let frameTosend = frameData;
        if (frameData.length < FRAME_SIZE_BYTES) {
          frameTosend = Buffer.alloc(FRAME_SIZE_BYTES);
          frameData.copy(frameTosend);
        }

        const timestamp = (baseTimestamp + frameCount * 60) & 0xffffffff;

        if (opusEncoder) {
          try {
            const opusBuffer = opusEncoder.encode(
              frameTosend,
              FRAME_SIZE_SAMPLES
            );
            connection.sendUdpMessage(opusBuffer, timestamp);
          } catch (err) {
            connection.sendUdpMessage(frameTosend, timestamp);
          }
        } else {
          connection.sendUdpMessage(frameTosend, timestamp);
        }

        offset += FRAME_SIZE_BYTES;
        frameCount++;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send TTS stop
      const ttsStopMsg = { type: "tts", state: "stop", timestamp: Date.now() };
      this.mqttPublish(controlTopic, ttsStopMsg);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Send goodbye if requested
      if (sendGoodbye) {
        const goodbyeMsg = {
          type: "goodbye",
          session_id: connection.udp?.session_id || null,
          reason: "character_change",
          timestamp: Date.now(),
        };
        this.mqttPublish(controlTopic, goodbyeMsg);
      }
    } catch (error) {
      logger.error(`❌ [AUDIO-STREAM] Audio streaming error:`, error.message);
    }
  }

  async handleDeviceModeChange(deviceId, payload) {
    try {
      // logger.info(`🔄 [MODE-CHANGE] Device ${deviceId} requesting mode change`);

      const macAddress = deviceId.replace(/:/g, "").toLowerCase();
      const crypto = require("crypto");

      const deviceInfo = this.deviceConnections.get(deviceId);
      let existingConnection = deviceInfo?.connection || null;

      // Clear audio buffers
      if (existingConnection && existingConnection.bridge) {
        existingConnection.bridge.clearAudioBuffers();
      }

      // Stop old bot (if music/story mode)
      if (existingConnection?.roomType && existingConnection?.bridge) {
        const oldMode = existingConnection.roomType;
        const oldRoomName = existingConnection.bridge.room?.name;

        if ((oldMode === "music" || oldMode === "story") && oldRoomName) {
          try {
            const axios = require("axios");
            await axios.post(
              `${MEDIA_API_BASE}/stop-bot`,
              { room_name: oldRoomName },
              mediaAxiosConfig()
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            // Continue anyway
          }
        }
      }

      // Delete existing room
      if (existingConnection && existingConnection.bridge) {
        const oldBridge = existingConnection.bridge;
        const oldRoomName = oldBridge.room?.name;

        if (oldRoomName && this.roomService) {
          try {
            await this.roomService.deleteRoom(oldRoomName);
          } catch (error) {
            logger.error(
              `❌ [MODE-CHANGE] Failed to delete old room: ${error.message}`
            );
          }
        }

        if (oldBridge) {
          oldBridge.stopAudioForwarding = true;
          if (oldBridge.room) {
            try {
              await oldBridge.room.disconnect();
            } catch (error) {
              // Ignore disconnect errors
            }
          }
          existingConnection.bridge = null;
        }
      }

      // Update mode in DB
      const axios = require("axios");
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const apiUrl = `${baseUrl}/toy/device/${macAddress}/cycle-mode`;

      const response = await axios.post(apiUrl, {}, { timeout: 10000 });

      if (response.data.code === 0 && response.data.data.success) {
        const { newMode, oldMode } = response.data.data;
        // logger.info(`✅ [MODE-CHANGE] ${oldMode} → ${newMode}`);

        if (deviceInfo) {
          deviceInfo.previousMode = oldMode;
        }

        let connection = deviceInfo?.connection;
        if (!connection) {
          logger.error(
            `❌ [MODE-CHANGE] No connection found for device: ${deviceId}`
          );
          const senderClientId = payload.clientId;
          if (senderClientId) {
            this.publishToDevice(senderClientId, {
              type: "error",
              code: "NO_SESSION",
              message: "Please send 'hello' message first",
              timestamp: Date.now(),
            });
          }
          return;
        }

        // Update connection room type
        connection.roomType = newMode;

        // Generate new UUID and session
        const newSessionUuid = crypto.randomUUID();
        const macForRoom = deviceId.replace(/:/g, "");
        const newRoomName = `${newSessionUuid}_${macForRoom}_${newMode}`;

        connection.udp.session_id = newRoomName;
        connection.isEnding = false;
        connection.endPromptSentTime = null;
        connection.goodbyeSent = false;
        connection.lastActivityTime = Date.now();

        // Create new LiveKitBridge
        const newBridge = new LiveKitBridge(
          connection,
          connection.protocolVersion || 1,
          deviceId,
          newSessionUuid,
          connection.userData || {}
        );
        connection.bridge = newBridge;

        newBridge.on("close", () => {
          connection.bridge = null;
        });

        await newBridge.connect(
          connection.audio_params || { sample_rate: 24000, channels: 1 },
          connection.features || {},
          this.roomService
        );

        // Fetch character for conversation mode
        let currentCharacter = null;
        if (newMode === "conversation") {
          currentCharacter = await connection.fetchCurrentCharacter(macAddress);
          connection.currentCharacter = currentCharacter;
        }

        // Send mode_update to device firmware
        const modeUpdateMsg = {
          type: "mode_update",
          mode: newMode,
          ...(newMode === "conversation" && currentCharacter
            ? { character: currentCharacter }
            : {}),
          session_id: newRoomName,
          timestamp: Date.now(),
          transport: "udp",
          udp: {
            server: this.publicIp,
            port: this.udpPort,
            encryption: connection.udp.encryption,
            key: connection.udp.key.toString("hex"),
            nonce: connection.udp.nonce.toString("hex"),
          },
          audio_params: {
            sample_rate: 24000,
            channels: 1,
            frame_duration: 60,
            format: "opus",
          },
        };
        connection.sendMqttMessage(JSON.stringify(modeUpdateMsg));

        // Handle mode-specific startup
        if (newMode === "music") {
          await connection.spawnMusicBot(newRoomName);
        } else if (newMode === "story") {
          await connection.spawnStoryBot(newRoomName);
        } else if (newMode === "conversation") {
          if (this.agentDispatchClient) {
            try {
              await this.agentDispatchClient.createDispatch(
                newRoomName,
                "cheeko-agent",
                {
                  metadata: JSON.stringify({
                    device_mac: connection.macAddress,
                    device_uuid: deviceId,
                    timestamp: Date.now(),
                  }),
                }
              );
              newBridge.agentDeployed = true;
            } catch (error) {
              logger.error(
                `❌ [MODE-CHANGE] Failed to dispatch agent:`,
                error.message
              );
            }
          } else {
            logger.error(
              `❌ [MODE-CHANGE] AgentDispatchClient not initialized`
            );
          }
        }

        // logger.info(`✅ [MODE-CHANGE] Complete: ${oldMode} → ${newMode}`);
      } else {
        logger.error(`❌ [MODE-CHANGE] API error:`, response.data);
      }
    } catch (error) {
      logger.error(`❌ [MODE-CHANGE] Error:`, error.message);
    }
  }

  /**
   * Central MQTT publish method with detailed logging
   * All outgoing MQTT messages should go through this method
   */
  mqttPublish(topic, payload, options = {}, callback = null) {
    if (!this.mqttClient || !this.mqttClient.connected) {
      logger.error(
        `❌ [MQTT-OUT] MQTT client not connected - Cannot publish to: ${topic}`
      );
      if (callback) callback(new Error("MQTT client not connected"));
      return;
    }

    // Parse payload for logging (handle both string and object)
    let payloadStr =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    let payloadObj;
    try {
      payloadObj = typeof payload === "string" ? JSON.parse(payload) : payload;
    } catch (e) {
      payloadObj = { raw: payloadStr.substring(0, 200) };
    }

    // Extract device info from topic
    const topicParts = topic.split("/");
    let deviceInfo = "";
    if (
      topicParts[0] === "devices" &&
      topicParts[1] === "p2p" &&
      topicParts[2]
    ) {
      // Extract MAC from clientId format: GID_test@@@68_25_dd_bb_f3_a0@@@uuid
      const clientId = topicParts[2];
      const parts = clientId.split("@@@");
      if (parts.length >= 2) {
        deviceInfo = parts[1].replace(/_/g, ":");
      } else {
        deviceInfo = clientId;
      }
    } else if (topicParts[0] === "app" && topicParts[1] === "p2p") {
      deviceInfo = topicParts[2] || "unknown";
    }

    // Log outgoing message with details
    const msgType = payloadObj.type || "unknown";
    const msgState = payloadObj.state || "";
    const sessionId = payloadObj.session_id || "";

    logger.info(
      `📤 [MQTT-OUT] ${deviceInfo || topic} | type: ${msgType}${
        msgState ? ` | state: ${msgState}` : ""
      }${sessionId ? ` | session: ${sessionId.substring(0, 20)}...` : ""}`
    );

    // Log full payload for debugging (truncate if too long)
    const payloadPreview =
      payloadStr.length > 500
        ? payloadStr.substring(0, 500) + "..."
        : payloadStr;
    logger.debug(`📤 [MQTT-OUT] Topic: ${topic} | Payload: ${payloadPreview}`);

    this.mqttClient.publish(topic, payloadStr, options, (err) => {
      if (err) {
        logger.error(
          `❌ [MQTT-OUT] Publish failed - Topic: ${topic} | Error: ${err.message}`
        );
      }
      if (callback) callback(err);
    });
  }

  publishToDevice(clientIdOrDeviceId, message) {
    const topic = `devices/p2p/${clientIdOrDeviceId}`;
    this.mqttPublish(topic, message);
  }

  /**
   * Set up global heartbeat check timer
   */
  setupKeepAliveTimer() {
    // Clear existing timer
    this.clearKeepAliveTimer();
    this.lastConnectionCount = 0;
    this.lastActiveConnectionCount = 0;

    // Set new timer
    this.keepAliveTimer = setInterval(async () => {
      // Check heartbeat status of all connections
      for (const connection of this.connections.values()) {
        await connection.checkKeepAlive();
      }

      const activeCount = Array.from(this.connections.values()).filter(
        (connection) => connection.isAlive()
      ).length;
      if (
        activeCount !== this.lastActiveConnectionCount ||
        this.connections.size !== this.lastConnectionCount
      ) {
        // logger.info(
        //   `Connections: ${this.connections.size}, Active: ${activeCount}`
        // );
        this.lastActiveConnectionCount = activeCount;
        this.lastConnectionCount = this.connections.size;
      }
    }, this.keepAliveCheckInterval);
  }

  /**
   * Clear heartbeat check timer
   */
  clearKeepAliveTimer() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  addConnection(connection) {
    // Check if a connection with the same clientId already exists
    for (const [key, value] of this.connections.entries()) {
      if (value.clientId === connection.clientId) {
        debug(
          `${connection.clientId} connection already exists, closing old connection`
        );
        value.close();
      }
    }
    this.connections.set(connection.connectionId, connection);
  }

  removeConnection(connection) {
    debug(`Closing connection: ${connection.connectionId}`);
    if (this.connections.has(connection.connectionId)) {
      this.connections.delete(connection.connectionId);
    }
  }

  sendUdpMessage(message, remoteAddress) {
    this.udpServer.send(message, remoteAddress.port, remoteAddress.address);
  }

  onUdpMessage(message, rinfo) {
    if (message.length < 16) return;

    try {
      const type = message.readUInt8(0);
      if (type !== 1) return;

      const payloadLength = message.readUInt16BE(2);
      if (message.length < 16 + payloadLength) return;

      const connectionId = message.readUInt32BE(4);
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const timestamp = message.readUInt32BE(8);
      const sequence = message.readUInt32BE(12);
      connection.onUdpMessage(
        rinfo,
        message,
        payloadLength,
        timestamp,
        sequence
      );
    } catch (error) {
      logger.error(`📡 [UDP] Message processing error:`, error);
    }
  }

  /**
   * Stop server
   */
  async stop() {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    // Clear heartbeat check timer
    this.clearKeepAliveTimer();

    if (this.connections.size > 0) {
      logger.warn(`Waiting for ${this.connections.size} connections to close`);
      for (const connection of this.connections.values()) {
        connection.close();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    debug("Waiting for connections to close");
    this.connections.clear();
    this.deviceConnections.clear();
    if (this.udpServer) {
      this.udpServer.close();
      this.udpServer = null;
      logger.warn("UDP server stopped");
    }

    // Close MQTT client
    if (this.mqttClient) {
      this.mqttClient.end();
      this.mqttClient = null;
      logger.warn("MQTT client disconnected");
    }

    process.exit(0);
  }
}

module.exports = { MQTTGateway, setConfigManager };
