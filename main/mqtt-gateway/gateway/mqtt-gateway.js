/**
 * MQTT Gateway
 *
 * Main orchestrator class that manages all device connections.
 * Handles EMQX broker, UDP server, and Pipecat session management.
 */

const dgram = require("dgram");
const mqtt = require("mqtt");
const axios = require("axios");
const {
  VirtualMQTTConnection,
  setConfigManager: setVirtualConnectionConfigManager,
} = require("../mqtt/virtual-connection");
const { ConfigManager } = require("../utils/config-manager");
const {
  PipecatBridge,
  setConfigManager: setPipecatConfigManager,
} = require("../pipecat/pipecat-bridge");
const {
  sendOffer,
  terminateSession,
  setConfigManager: setSignalingConfigManager,
} = require("../pipecat/pipecat-signaling");
const { buildGreetingMetadata } = require("../pipecat/message-adapter");
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
  setPipecatConfigManager(cm);
  setSignalingConfigManager(cm);
  setVirtualConnectionConfigManager(cm);
}

/**
 * Lookup RFID question prompt text from Manager API by RFID UID.
 * Uses the open device-tap endpoint in RfidCardMappingController:
 *   GET /toy/admin/rfid/card/lookup/{rfidUid}
 */
async function fetchRfidPromptTextFromManagerApi(rfidUid) {
  try {
    const trimmedUid = (rfidUid || "").trim();
    if (!trimmedUid) {
      logger.warn(`⚠️ [RFID-LOOKUP] Empty rfidUid provided`);
      return null;
    }

    const baseUrl = process.env.MANAGER_API_URL || "";
    if (!baseUrl) {
      logger.warn(
        `⚠️ [RFID-LOOKUP] MANAGER_API_URL not set, cannot look up RFID question for UID ${trimmedUid}`
      );
      return null;
    }

    const apiUrl = `${baseUrl.replace(/\/$/, "")}/admin/rfid/card/lookup/${encodeURIComponent(
      trimmedUid
    )}`;

    logger.info(
      `🔍 [RFID-LOOKUP] Looking up question for RFID UID ${trimmedUid} via ${apiUrl}`
    );

    const response = await axios.get(apiUrl, { timeout: 5000 });
    const body = response.data;

    if (!body || body.code !== 0 || !body.data) {
      logger.warn(
        `⚠️ [RFID-LOOKUP] Lookup failed for UID ${trimmedUid}: code=${body && body.code
        }, msg=${body && body.msg}`
      );
      return null;
    }

    const promptText = (body.data.promptText || "").trim();
    if (!promptText) {
      logger.warn(
        `⚠️ [RFID-LOOKUP] No promptText configured for UID ${trimmedUid}`
      );
      return null;
    }

    logger.info(
      `✅ [RFID-LOOKUP] Resolved UID ${trimmedUid} to promptText: "${promptText.slice(
        0,
        80
      )}${promptText.length > 80 ? "..." : ""}"`
    );

    return promptText;
  } catch (error) {
    logger.error(
      `❌ [RFID-LOOKUP] Error looking up RFID UID ${rfidUid}: ${error.message}`
    );
    return null;
  }
}

class MQTTGateway {
  constructor(workerPool) {
    // Shared worker pool for audio processing
    this.workerPool = workerPool;
    this.udpPort = parseInt(process.env.UDP_PORT) || 1883;
    this.publicIp = process.env.PUBLIC_IP || "127.0.0.1";
    this.connections = new Map(); // clientId -> VirtualMQTTConnection
    this.keepAliveTimer = null;
    this.keepAliveCheckInterval = 15000; // Check every 15 seconds
    this.sessionCleanupTimer = null;
    this.sessionCleanupInterval = 5 * 60 * 1000; // Clean up stale sessions every 5 minutes
    this.headerBuffer = Buffer.alloc(16);
    this.mqttClient = null;
    this.deviceConnections = new Map(); // deviceId -> connection info
    this.clientConnections = new Map(); // clientId -> device info (for tracking EMQX clients)

    // Pipecat session tracking
    this.pipecatSessions = new Map(); // deviceId -> { pc_id, sessionId, createdAt }

    // Initialize Pipecat configuration
    try {
      let pipecatConfig = configManager.get("pipecat") || {};

      // Override with environment variables if present
      if (process.env.PIPECAT_URL) pipecatConfig.url = process.env.PIPECAT_URL;

      if (!pipecatConfig.url) {
        logger.warn("⚠️ [INIT] Pipecat URL not configured, using default");
        pipecatConfig.url = "http://192.168.1.168:7860";
      }

      this.pipecatConfig = pipecatConfig;
      logger.info(`✅ [INIT] Pipecat configured: ${pipecatConfig.url}`);
    } catch (error) {
      logger.error("❌ [INIT] Failed to initialize Pipecat config:", error.message);
      this.pipecatConfig = { url: "http://192.168.1.168:7860" };
    }

    // Legacy LiveKit references (set to null for backward compatibility)
    this.roomService = null;
    this.agentDispatchClient = null;
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

    // Start session cleanup timer (every 5 minutes)
    this.setupSessionCleanupTimer();
  }

  /**
   * Set up session cleanup timer (every 5 minutes)
   * Cleans up:
   * - Stale Pipecat sessions
   * - Stale entries in deviceConnections and connections maps
   */
  setupSessionCleanupTimer() {
    // Clear existing timer
    this.clearSessionCleanupTimer();

    logger.info(`🧹 [SESSION-CLEANUP] Starting cleanup timer (interval: ${this.sessionCleanupInterval / 1000}s)`);

    // Run cleanup immediately on startup (after 30 seconds to let things stabilize)
    setTimeout(() => {
      this.cleanupStaleSessions().catch(err => {
        logger.error(`❌ [SESSION-CLEANUP] Initial cleanup failed:`, err.message);
      });
    }, 30000);

    // Set recurring timer
    this.sessionCleanupTimer = setInterval(async () => {
      try {
        await this.cleanupStaleSessions();
      } catch (error) {
        logger.error(`❌ [SESSION-CLEANUP] Cleanup cycle failed:`, error.message);
      }
    }, this.sessionCleanupInterval);
  }

  /**
   * Clear session cleanup timer
   */
  clearSessionCleanupTimer() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }
  }

  /**
   * Clean up stale sessions and connections
   * - Cleans up stale Pipecat sessions
   * - Cleans up deviceConnections entries without active connections
   * - Cleans up connections map entries that are dead
   */
  async cleanupStaleSessions() {
    const startTime = Date.now();
    const memBefore = process.memoryUsage();

    let pipecatSessionsCleaned = 0;
    let sessionsCleaned = 0;
    let connectionsCleaned = 0;

    logger.info(`🧹 [SESSION-CLEANUP] Starting cleanup cycle...`);

    // 1. Clean up stale Pipecat sessions
    const now = Date.now();
    const PIPECAT_SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour max session

    for (const [deviceId, sessionInfo] of this.pipecatSessions.entries()) {
      const sessionAge = now - (sessionInfo.createdAt || 0);

      // Check if session is stale (older than 1 hour or device disconnected)
      const deviceInfo = this.deviceConnections.get(deviceId);
      const isDeviceDisconnected = !deviceInfo || !deviceInfo.connection || deviceInfo.connection.closing;

      if (sessionAge > PIPECAT_SESSION_TIMEOUT || isDeviceDisconnected) {
        logger.info(`🗑️ [SESSION-CLEANUP] Terminating stale Pipecat session: ${deviceId} (age: ${Math.round(sessionAge / 60000)}min)`);

        try {
          if (sessionInfo.pc_id) {
            await terminateSession(sessionInfo.pc_id);
          }
        } catch (err) {
          // Ignore termination errors
        }

        this.pipecatSessions.delete(deviceId);
        pipecatSessionsCleaned++;
      }
    }

    // 2. Clean up stale deviceConnections entries
    const staleDevices = [];
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    for (const [deviceId, deviceInfo] of this.deviceConnections.entries()) {
      const connection = deviceInfo?.connection;

      // Check if connection is dead or closing
      const isDead = !connection || connection.closing ||
        (typeof connection.isAlive === 'function' && !connection.isAlive());

      // Check for stale activity (connected but silent for too long)
      const lastActivity = connection?.lastActivityTime || 0;
      const isInactive = (now - lastActivity) > STALE_THRESHOLD;

      // Clean up if dead OR (inactive and no bridge)
      if (isDead || (isInactive && connection?.bridge === null)) {
        staleDevices.push(deviceId);
      }
    }

    for (const deviceId of staleDevices) {
      logger.info(`🗑️ [SESSION-CLEANUP] Removing stale deviceConnection: ${deviceId}`);
      const deviceInfo = this.deviceConnections.get(deviceId);

      // Try to close the connection properly first
      if (deviceInfo?.connection && !deviceInfo.connection.closing) {
        try {
          deviceInfo.connection.closing = true;
          await deviceInfo.connection.close();
        } catch (err) {
          // Ignore close errors
        }
      }

      // Remove from maps
      if (deviceInfo?.connectionId) {
        this.connections.delete(deviceInfo.connectionId);
      }
      this.deviceConnections.delete(deviceId);
      this.pipecatSessions.delete(deviceId);
      sessionsCleaned++;
    }

    // 3. Clean up stale connections map entries
    const staleConnectionIds = [];
    for (const [connectionId, connection] of this.connections.entries()) {
      const isStaleConn = !connection || connection.closing ||
        (typeof connection.isAlive === 'function' && !connection.isAlive());
      if (isStaleConn) {
        staleConnectionIds.push(connectionId);
      }
    }

    for (const connectionId of staleConnectionIds) {
      // Don't double-count if already cleaned via deviceConnections
      if (!staleDevices.some(d => this.deviceConnections.get(d)?.connectionId === connectionId)) {
        logger.info(`🗑️ [SESSION-CLEANUP] Removing stale connection: ${connectionId}`);
        const connection = this.connections.get(connectionId);
        if (connection && !connection.closing) {
          try {
            connection.closing = true;
            await connection.close();
          } catch (err) {
            // Ignore close errors
          }
        }
        this.connections.delete(connectionId);
        connectionsCleaned++;
      }
    }

    // 4. Clean up stale clientConnections entries
    let clientConnectionsCleaned = 0;
    for (const [clientId, info] of this.clientConnections.entries()) {
      const deviceId = info?.deviceId;
      if (!deviceId || !this.deviceConnections.has(deviceId)) {
        this.clientConnections.delete(clientId);
        clientConnectionsCleaned++;
      }
    }
    if (clientConnectionsCleaned > 0) {
      logger.info(`🗑️ [SESSION-CLEANUP] Cleaned ${clientConnectionsCleaned} stale clientConnections entries`);
    }

    const duration = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const heapDiff = (memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024;

    logger.info(`✅ [SESSION-CLEANUP] Complete in ${duration}ms - Pipecat: ${pipecatSessionsCleaned}, Sessions: ${sessionsCleaned}, Connections: ${connectionsCleaned}`);
    logger.info(`📊 [SESSION-CLEANUP] Memory: Heap ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB | Active: ${this.connections.size}, Devices: ${this.deviceConnections.size}, Pipecat: ${this.pipecatSessions.size}`);
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
      // Subscribe to the internal topic where EMQX republishes with client info
      // All device messages (hello, data, etc.) come through this single topic via EMQX republish rule
      this.mqttClient.subscribe("internal/server-ingest", (err) => {
        if (err)
          logger.error(
            "Failed to subscribe to internal/server-ingest topic:",
            err
          );
        else logger.info("📡 Subscribed to internal/server-ingest (all device messages)");
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
    try {
      const payload = JSON.parse(message.toString());

      // All device messages come through internal/server-ingest via EMQX republish rule
      if (topic === "internal/server-ingest") {
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

        // Process the message
        await this.processIngestLogic(deviceId, originalPayload, clientId);
      }
    } catch (error) {
      logger.error(
        `❌ [MQTT IN] Error processing MQTT message: ${error.message}`,
        { stack: error.stack }
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
        await this.handleStartAgentControl(deviceId, originalPayload, clientId);
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

      // Handle MCP responses - check for pending promises first, then forward to Pipecat agent
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
            const pendingRequest = bridge.pendingMcpRequests.get(mcpRequestId);
            if (pendingRequest) {
              // Resolve or reject the promise
              if (originalPayload.payload.error) {
                const errorMsg =
                  originalPayload.payload.error.message || "Unknown MCP error";
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

          // If no pending promise, forward to Pipecat agent (normal flow)
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
        // Special handling for start_greeting - legacy path (no-op in new flow)

        let greetingSent = false;

        // Check for virtual device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (deviceInfo && deviceInfo.connection) {
          const connection = deviceInfo.connection;

          // Room should already exist from parseHelloMessage
          if (connection.bridge) {
            const bridge = connection.bridge;
            const sessionId = bridge.sessionId || connection.sessionId;

            if (!sessionId) {
              logger.error(
                `❌ [START-GREETING] Cannot dispatch agent - session ID not available`
              );
              return;
            }

            // ONLY dispatch TTS start for non-conversation rooms
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

            // For conversation mode, agent auto-greets via on_enter; nothing to do here
            return;
          } else {
            logger.error(
              `❌ [START-GREETING] No bridge found for device ${deviceId} - room should have been created during hello!`
            );
          }
        }

        if (!greetingSent) {
          // logger.info(`⚠️ [START-GREETING] No bridge found or triggered`);
        }
      } else if (originalPayload.type === "start_greeting_text") {
        // Handle RFID-based greeting: resolve question via Manager API then forward to Pipecat agent
        const rfidUid =
          originalPayload.rfid_uid ||
          originalPayload.rfidUid ||
          null;
        const legacyText = (originalPayload.text || "").trim();

        let textToSend = null;

        if (rfidUid) {
          logger.info(
            `✉️ [TEXT-GREETING] Received RFID UID from device ${deviceId}: "${rfidUid}"`
          );
          textToSend = await fetchRfidPromptTextFromManagerApi(rfidUid);

          if (!textToSend && legacyText) {
            logger.warn(
              `⚠️ [TEXT-GREETING] No promptText found for UID ${rfidUid}, falling back to legacy text from device ${deviceId}`
            );
            textToSend = legacyText;
          }
        } else if (legacyText) {
          // Backward compatibility: old firmware sending text directly
          logger.info(
            `✉️ [TEXT-GREETING] No RFID UID, using legacy text from device ${deviceId}`
          );
          textToSend = legacyText;
        }

        if (!textToSend) {
          logger.warn(
            `⚠️ [TEXT-GREETING] No RFID UID or usable text payload from device ${deviceId}, ignoring`
          );
          return;
        }

        const deviceInfo = this.deviceConnections.get(deviceId);
        if (!deviceInfo || !deviceInfo.connection || !deviceInfo.connection.bridge) {
          logger.warn(
            `⚠️ [TEXT-GREETING] No active connection/bridge for device ${deviceId}, cannot forward text`
          );
          return;
        }

        const connection = deviceInfo.connection;
        const bridge = connection.bridge;

        // Only support conversation rooms for now
        if (connection.roomType !== "conversation") {
          logger.info(
            `ℹ️ [TEXT-GREETING] Ignoring text greeting in non-conversation mode for device ${deviceId} (roomType=${connection.roomType})`
          );
          return;
        }

        // Check if bridge is connected to Pipecat
        if (!bridge.isConnected || !bridge.pcId) {
          logger.warn(
            `⚠️ [TEXT-GREETING] No Pipecat connection for device ${deviceId}`
          );
          return;
        }

        try {
          logger.info(
            `✉️ [TEXT-GREETING] Prepared prompt for device ${deviceId}: "${textToSend}"`
          );

          // Guard: if audio is currently playing, abort existing playback before new text
          if (bridge.isAudioPlaying) {
            logger.info(
              `🛑 [TEXT-GREETING] Audio currently playing for device ${deviceId}, sending abort before new text`
            );
            try {
              const currentSessionId = connection.udp?.session_id || connection.sessionId || null;
              if (currentSessionId) {
                await bridge.sendAbortSignal(currentSessionId);
              }
              // Notify device to return to listening state
              bridge.sendTtsStopMessage();
              // Small delay to let abort/stop propagate
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (abortErr) {
              logger.error(
                `❌ [TEXT-GREETING] Failed to send abort before new text for device ${deviceId}: ${abortErr.message}`
              );
            }
          }

          const userTextMsg = {
            type: "user_text",
            text: textToSend,
            device_id: deviceId,
            // Prefer gateway-known session; ignore any session_id sent by device
            session_id: connection.udp?.session_id || connection.sessionId || null,
            source: "rfid",
            timestamp: Date.now(),
          };

          if (rfidUid) {
            userTextMsg.rfid_uid = rfidUid;
          }

          // Forward to Pipecat via bridge
          await bridge.forwardMessage(userTextMsg);
          logger.info(
            `✅ [TEXT-GREETING] Forwarded RFID question to Pipecat for device ${deviceId}`
          );
        } catch (err) {
          logger.error(
            `❌ [TEXT-GREETING] Error while preparing/sending user_text for device ${deviceId}: ${err.message}`
          );
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
        `❌ [MQTT IN] Error in processIngestLogic: ${error.message}`,
        { stack: error.stack }
      );
    }
  }

  /**
   * Check if agent is active for a device
   * With Pipecat, agent is always running - check session state instead
   * @param {string} deviceId - The device ID to check
   * @returns {Promise<{exists: boolean, identity: string|null}>}
   */
  async checkAgentInRoom(deviceId) {
    // With Pipecat, agent is always running on the server
    // Check if we have an active session for this device
    const sessionInfo = this.pipecatSessions.get(deviceId);
    if (sessionInfo && sessionInfo.pc_id) {
      return { exists: true, identity: "pipecat-agent" };
    }
    return { exists: false, identity: null };
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

    logger.info(`⏭️ [CONTROL] Next requested for device: ${macAddress}`);

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

    try {
      if (mode === "music" || mode === "story") {
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

        // Send playback control via Media Bot API
        try {
          await axios.post(
            `${MEDIA_API_BASE}/playback-control`,
            {
              room_name: roomName,
              action: "next",
            },
            mediaAxiosConfig({ timeout: 3000 })
          );
          logger.info(`✅ [CONTROL] Sent 'next' command to media bot for ${roomName}`);
        } catch (apiError) {
          logger.error(`❌ [CONTROL] Media API error: ${apiError.message}`);
        }

        // Send TTS start message
        if (clientId) {
          const controlTopic = `devices/p2p/${clientId}`;
          const ttsStartMsg = {
            type: "tts",
            state: "start",
            text: "Skipping to next song",
            session_id: deviceInfo.connection?.sessionInfo?.sessionId || null,
          };
          this.mqttPublish(controlTopic, ttsStartMsg);
        }
      } else if (mode === "conversation") {
        // For conversation mode, forward to Pipecat via bridge
        const bridge = deviceInfo.connection?.bridge;
        if (bridge && bridge.isConnected) {
          await bridge.forwardMessage({
            type: "playback_control",
            action: "next",
          });
          logger.info(`✅ [CONTROL] Sent 'next' command to Pipecat`);
        }
      } else {
        logger.warn(`⚠️ [CONTROL] Next not supported for mode: ${mode}`);
        return;
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to next:`, error.message);

      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Skip failed, please try again",
          session_id: deviceInfo.connection?.sessionInfo?.sessionId || null,
        };
        this.mqttPublish(errorTopic, errorMsg);
      }
    }
  }

  async handlePreviousControl(topic, clientId = null) {
    let macAddress;

    if (clientId) {
      const clientParts = clientId.split("@@@");
      if (clientParts.length >= 2) {
        macAddress = clientParts[1].replace(/_/g, ":");
      }
    } else {
      const topicParts = topic.split("/");
      macAddress = topicParts[1];
    }

    logger.info(`⏮️ [CONTROL] Previous requested for device: ${macAddress}`);

    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo) {
      logger.warn(`⚠️ [CONTROL] Device not found: ${macAddress}`);
      return;
    }

    const roomName = deviceInfo.currentRoomName;
    const mode = deviceInfo.currentMode;

    if (!roomName || !mode) {
      logger.warn(`⚠️ [CONTROL] No active room or mode for device: ${macAddress}`);
      return;
    }

    try {
      if (mode === "music" || mode === "story") {
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

        // Send playback control via Media Bot API
        try {
          await axios.post(
            `${MEDIA_API_BASE}/playback-control`,
            {
              room_name: roomName,
              action: "previous",
            },
            mediaAxiosConfig({ timeout: 3000 })
          );
          logger.info(`✅ [CONTROL] Sent 'previous' command to media bot for ${roomName}`);
        } catch (apiError) {
          logger.error(`❌ [CONTROL] Media API error: ${apiError.message}`);
        }

        // Send TTS start message
        if (clientId) {
          const controlTopic = `devices/p2p/${clientId}`;
          const ttsStartMsg = {
            type: "tts",
            state: "start",
            text: "Going to previous song",
            session_id: deviceInfo.connection?.sessionInfo?.sessionId || null,
          };
          this.mqttPublish(controlTopic, ttsStartMsg);
        }
      } else if (mode === "conversation") {
        // For conversation mode, forward to Pipecat via bridge
        const bridge = deviceInfo.connection?.bridge;
        if (bridge && bridge.isConnected) {
          await bridge.forwardMessage({
            type: "playback_control",
            action: "previous",
          });
          logger.info(`✅ [CONTROL] Sent 'previous' command to Pipecat`);
        }
      } else {
        logger.warn(`⚠️ [CONTROL] Previous not supported for mode: ${mode}`);
        return;
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to previous:`, error.message);

      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Previous skip failed, please try again",
          session_id: deviceInfo.connection?.sessionInfo?.sessionId || null,
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
        // With Pipecat, check if bridge is connected (agent is always running on Pipecat server)
        if (connection && connection.bridge && connection.bridge.isConnected) {
          // Guard: Skip if agent already deployed (prevent duplicate dispatches)
          if (connection.bridge?.agentDeployed) {
            logger.info(`[START-AGENT] Pipecat agent already connected, skipping`);
            return;
          }

          const agentCheck = await this.checkAgentInRoom(roomName);

          if (!agentCheck.exists && !isModeSwitch) {
            // With Pipecat, the agent is always running - we just need to verify connection
            logger.info(`[START-AGENT] Pipecat connection verified, agent is ready`);
            connection.bridge.agentJoined = true;
            connection.bridge.agentDeployed = true;
            connection.currentCharacter = connection.bridge.currentCharacter || "Cheeko";
            // Pipecat agent will auto-greet based on metadata sent during SDP exchange
          } else {
            connection.bridge.agentJoined = true;
            connection.bridge.agentDeployed = true;
          }
          // Agent will greet user via Pipecat's on_enter lifecycle
        } else {
          logger.error(
            `❌ [START-AGENT] No active Pipecat connection for device: ${deviceId}`
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
      // Use Pipecat bridge to forward the function call
      if (connection.bridge && connection.bridge.isConnected) {
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now(),
        };
        await connection.bridge.forwardMessage(functionCallMessage);
        await this.sendSuccessResponse(
          clientId,
          `Playing "${songName}"`,
          macAddress
        );
      } else {
        logger.error(
          `❌ [SPECIFIC-MUSIC] No active Pipecat connection for device: ${macAddress}`
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
      // Use Pipecat bridge to forward the function call
      if (connection.bridge && connection.bridge.isConnected) {
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now(),
        };
        await connection.bridge.forwardMessage(functionCallMessage);
        await this.sendSuccessResponse(
          clientId,
          `Playing "${storyName}"`,
          macAddress
        );
      } else {
        logger.error(
          `❌ [SPECIFIC-STORY] No active Pipecat connection for device: ${macAddress}`
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

  /**
   * Forward specific content request via Pipecat bridge
   * @deprecated Use bridge.forwardMessage() directly
   */
  async forwardSpecificContentRequest(bridge, requestData) {
    try {
      if (bridge && bridge.isConnected) {
        await bridge.forwardMessage(requestData);
      } else {
        throw new Error("Bridge not connected");
      }
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
      payload,
      this.workerPool
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

  /**
   * Send shutdown signal to Pipecat agent via bridge
   * @param {PipecatBridge} bridge - Pipecat bridge instance
   * @param {string} sessionId - Session ID
   * @param {number} timeoutMs - Timeout in milliseconds (default: 3000)
   * @returns {Promise<boolean>} - True if sent successfully
   */
  async sendAgentShutdownWithAck(bridge, sessionId, timeoutMs = 3000) {
    // With Pipecat, we send a shutdown message via the bridge
    // No ack mechanism currently - just send the message
    if (!bridge || !bridge.isConnected) {
      logger.warn(`[CLEANUP] Bridge not connected, cannot send shutdown`);
      return false;
    }

    try {
      const shutdownMessage = {
        type: 'shutdown_request',
        session_id: sessionId,
        timestamp: Date.now(),
        source: 'mqtt_gateway',
      };

      await bridge.forwardMessage(shutdownMessage);
      logger.info(`[CLEANUP] Sent shutdown_request to Pipecat`);
      return true;
    } catch (e) {
      logger.warn(`[CLEANUP] Failed to send shutdown_request: ${e.message}`);
      return false;
    }
  }

  /**
   * Remove agent from Pipecat session (no-op for Pipecat)
   * With Pipecat, the agent is terminated when the session ends
   * @param {string} sessionId - Session ID
   * @returns {Promise<boolean>} - Always returns true
   */
  async removeAgentParticipant(sessionId) {
    // With Pipecat, agents are terminated when the session/pc_id is disconnected
    // This is a no-op - cleanup is handled by terminateSession()
    logger.info(`[CLEANUP] Agent cleanup for Pipecat session ${sessionId} - handled by session termination`);
    return true;
  }

  /**
   * Verify Pipecat session is cleaned up
   * @param {string} sessionId - Session ID
   * @param {number} maxWaitMs - Max wait time (default: 2000)
   * @param {number} pollIntervalMs - Poll interval (default: 200)
   * @returns {Promise<boolean>} - True if session is cleaned up
   */
  async verifyRoomAgentFree(sessionId, maxWaitMs = 2000, pollIntervalMs = 200) {
    // With Pipecat, once we call terminateSession, the session is immediately cleaned up
    // No need to poll - just return true
    logger.info(`[CLEANUP] Pipecat session ${sessionId} terminated`);
    return true;
  }

  /**
   * Complete cleanup sequence with fallbacks
   * @param {Object} connection - VirtualMQTTConnection instance
   * @param {string} reason - Cleanup reason (character_change, mode_change)
   * @returns {Promise<void>}
   */
  async performRobustAgentCleanup(connection, reason = 'cleanup') {
    const bridge = connection?.bridge;
    if (!bridge) {
      logger.info(`[CLEANUP] No bridge to clean up`);
      return;
    }

    const sessionId = connection.sessionInfo?.sessionId || bridge.sessionId;
    const pcId = bridge.pcId;

    logger.info(`[CLEANUP] Starting cleanup for session ${sessionId} (reason: ${reason})`);

    // Step 1: Clear audio playing state
    bridge.isAudioPlaying = false;
    bridge.audioPlayingStartTime = null;

    // Step 2: Terminate Pipecat session
    if (pcId) {
      try {
        await terminateSession(pcId);
        logger.info(`[CLEANUP] Terminated Pipecat session: ${pcId}`);
      } catch (error) {
        logger.warn(`[CLEANUP] Pipecat terminate error: ${error.message}`);
      }
    }

    // Step 3: Close bridge
    if (bridge.close) {
      try {
        await bridge.close();
        logger.info(`[CLEANUP] Bridge closed`);
      } catch (error) {
        logger.warn(`[CLEANUP] Bridge close error: ${error.message}`);
      }
    }

    // Step 4: Clear bridge reference
    connection.bridge = null;

    // Step 5: Remove from Pipecat sessions tracking
    const deviceId = connection.deviceId || connection.macAddress;
    if (deviceId) {
      this.pipecatSessions.delete(deviceId);
    }

    // Step 6: Cleanup worker-pool session codecs (if any)
    if (this.workerPool && sessionId && this.workerPool.cleanupSession) {
      this.workerPool.cleanupSession(sessionId);
    }

    logger.info(`[CLEANUP] Cleanup complete for session ${sessionId}`);
  }

  async handleDeviceCharacterChange(deviceId, payload) {
    try {
      const characterName =
        payload.characterName || payload.character_name || null;
      const macAddress = deviceId.replace(/:/g, "").toLowerCase();
      const crypto = require("crypto");
      const axios = require("axios");

      // Get clientId from payload (for Pipecat connections)
      const clientId = payload.clientId;
      if (!clientId) {
        logger.error(`[CHARACTER-CHANGE] No clientId in payload for device: ${deviceId}`);
        return;
      }

      // Step 1: Cycle character in database
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
        logger.info(`[CHARACTER-CHANGE] Switching to: ${newModeName}`);

        // Step 2: Get device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        const connection = deviceInfo?.connection;

        // Step 3: Generate new session ID
        const newSessionUuid = crypto.randomUUID();
        const macForRoom = deviceId.replace(/:/g, "");
        const newSessionId = `${newSessionUuid}_${macForRoom}_conversation`;

        // Step 4: Terminate existing Pipecat session
        const existingSession = this.pipecatSessions.get(deviceId);
        if (existingSession && existingSession.pc_id) {
          try {
            await terminateSession(existingSession.pc_id);
            logger.info(`[CHARACTER-CHANGE] Terminated old Pipecat session: ${existingSession.pc_id}`);
          } catch (err) {
            logger.warn(`[CHARACTER-CHANGE] Cleanup error (non-fatal): ${err.message}`);
          }
        }

        // Step 5: Close existing bridge if present
        if (connection && connection.bridge) {
          try {
            await connection.bridge.close();
            connection.bridge = null;
          } catch (err) {
            logger.warn(`[CHARACTER-CHANGE] Bridge close error: ${err.message}`);
          }
        }

        // Step 6: If connection exists, update state
        if (connection) {
          if (connection.sessionInfo) {
            connection.sessionInfo.sessionId = newSessionId;
          }
          connection.currentCharacter = newModeName;
          connection.isEnding = false;
          connection.endPromptSentTime = null;
          connection.goodbyeSent = false;
          connection.lastActivityTime = Date.now();
        }

        // Step 7: Fetch child profile for agent metadata
        let childProfile = null;
        try {
          const profileResponse = await axios.post(
            `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`,
            { macAddress },
            { timeout: 5000, headers: { 'secret': process.env.MANAGER_API_SECRET } }
          );
          if (profileResponse.data?.code === 0 && profileResponse.data?.data) {
            childProfile = profileResponse.data.data;
            logger.info(`[CHARACTER-CHANGE] ✅ Child profile: "${childProfile.name}", age: ${childProfile.age}`);
          }
        } catch (error) {
          logger.warn(`[CHARACTER-CHANGE] ⚠️ Failed to fetch child profile: ${error.message}`);
        }

        // Step 8: Send character-change-ready message to device
        // Device will need to send new SDP offer to establish new Pipecat session
        const characterChangeMsg = {
          type: "character_change_ready",
          version: connection?.protocolVersion || 4,
          mode: "conversation",
          character: newModeName,
          session_id: newSessionId,
          timestamp: Date.now(),
          transport: "pipecat",
          // Device needs to reconnect with new SDP offer
          requires_reconnect: true,
          metadata: {
            character: newModeName,
            child_profile: childProfile,
          },
          audio_params: {
            sample_rate: 24000,
            channels: 1,
            frame_duration: 60,
            format: "opus",
          },
        };

        const controlTopic = `devices/p2p/${clientId}`;
        this.mqttPublish(controlTopic, characterChangeMsg);
        logger.info(`[CHARACTER-CHANGE] Sent character_change_ready, device should reconnect with new SDP`);

        // Update Pipecat session tracking (will be fully populated when device reconnects)
        this.pipecatSessions.set(deviceId, {
          pc_id: null, // Will be set when device reconnects
          sessionId: newSessionId,
          character: newModeName,
          childProfile: childProfile,
          createdAt: Date.now(),
        });

        logger.info(`[CHARACTER-CHANGE] Successfully switched to ${newModeName}`);
      } else {
        logger.error(`[CHARACTER-CHANGE] API error:`, response.data);
      }
    } catch (error) {
      logger.error(`[CHARACTER-CHANGE] Error:`, error.message);
      if (error.stack) {
        logger.error(error.stack);
      }
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
        timestamp: Date.Now(),
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
      logger.info(`🔄 [MODE-CHANGE] START - Device ${deviceId} requesting mode change`);

      const macAddress = deviceId.replace(/:/g, "").toLowerCase();
      const crypto = require("crypto");

      const deviceInfo = this.deviceConnections.get(deviceId);
      let existingConnection = deviceInfo?.connection || null;

      logger.info(`[MODE-CHANGE] Step 1: Device info found: ${!!deviceInfo}, Connection exists: ${!!existingConnection}`);

      // Stop old media bot (if music/story mode) before cleanup
      if (existingConnection?.roomType && existingConnection?.bridge) {
        const oldMode = existingConnection.roomType;
        const oldSessionId = existingConnection.bridge.sessionId || existingConnection.sessionId;

        logger.info(`[MODE-CHANGE] Step 2: Old mode: ${oldMode}, Old session: ${oldSessionId}`);

        if ((oldMode === "music" || oldMode === "story") && oldSessionId) {
          try {
            logger.info(`[MODE-CHANGE] Stopping ${oldMode} bot for session: ${oldSessionId}`);
            const axios = require("axios");
            await axios.post(
              `${MEDIA_API_BASE}/stop-bot`,
              { room_name: oldSessionId },
              mediaAxiosConfig()
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            logger.info(`[MODE-CHANGE] ✅ ${oldMode} bot stopped`);
          } catch (error) {
            logger.warn(`[MODE-CHANGE] ⚠️ Failed to stop ${oldMode} bot: ${error.message}`);
            // Continue anyway
          }
        }
      }

      // Robust cleanup of old room and agent/bot
      if (existingConnection) {
        logger.info(`[MODE-CHANGE] Step 3: Performing robust cleanup`);
        await this.performRobustAgentCleanup(existingConnection, 'mode_change');
        logger.info(`[MODE-CHANGE] ✅ Cleanup complete`);
      }

      // Update mode in DB
      logger.info(`[MODE-CHANGE] Step 4: Calling cycle-mode API for MAC: ${macAddress}`);
      const axios = require("axios");
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const apiUrl = `${baseUrl}/toy/device/${macAddress}/cycle-mode`;

      logger.info(`[MODE-CHANGE] API URL: ${apiUrl}`);

      const response = await axios.post(apiUrl, {}, { timeout: 10000 });

      logger.info(`[MODE-CHANGE] API Response - Status: ${response.status}, Code: ${response.data?.code}`);
      logger.info(`[MODE-CHANGE] API Response Data:`, JSON.stringify(response.data));

      if (response.data.code === 0 && response.data.data.success) {
        const { newMode, oldMode } = response.data.data;
        logger.info(`[MODE-CHANGE] Step 5: Mode change approved - ${oldMode} → ${newMode}`);

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

        logger.info(`[MODE-CHANGE] Step 6: New room name: ${newRoomName}`);

        // Clean up stale Pipecat sessions for this device
        const existingSession = this.pipecatSessions.get(deviceId);
        if (existingSession) {
          try {
            await terminateSession(existingSession.pc_id);
            this.pipecatSessions.delete(deviceId);
            logger.info(`[MODE-CHANGE] Cleaned up old Pipecat session for device`);
          } catch (err) {
            logger.warn(`[MODE-CHANGE] Session cleanup error (non-fatal): ${err.message}`);
          }
        }

        // Handle both UDP bridge and direct Pipecat connection modes
        if (connection.udp) {
          connection.udp.session_id = newRoomName;
        }
        connection.sessionId = newRoomName;  // Also store at connection level for direct mode
        connection.isEnding = false;
        connection.endPromptSentTime = null;
        connection.goodbyeSent = false;
        connection.lastActivityTime = Date.now();

        logger.info(`[MODE-CHANGE] Step 7: Creating new PipecatBridge`);
        // Create new PipecatBridge with workerPool
        const newBridge = new PipecatBridge(
          connection,
          connection.protocolVersion || 1,
          deviceId,
          newSessionUuid,
          connection.userData || {},
          this.workerPool
        );
        connection.bridge = newBridge;

        newBridge.on("close", () => {
          connection.bridge = null;
        });

        // Note: For mode change, we may not have an SDP offer from the device yet
        // The device will need to send a new hello with SDP offer after mode change
        // For now, just prepare the bridge - actual connection happens when device sends SDP
        logger.info(`[MODE-CHANGE] Step 8: PipecatBridge prepared (connection pending SDP from device)`);

        // Fetch character and child profile for conversation mode
        let currentCharacter = null;
        let childProfile = null;
        if (newMode === "conversation") {
          logger.info(`[MODE-CHANGE] Step 9: Fetching character and child profile`);
          // Fetch character and child profile in parallel
          const [character, profile] = await Promise.all([
            connection.fetchCurrentCharacter(macAddress),
            connection.fetchChildProfile ? connection.fetchChildProfile(macAddress) : Promise.resolve(null)
          ]);
          currentCharacter = character;
          childProfile = profile;
          connection.currentCharacter = currentCharacter;
          if (childProfile) {
            logger.info(`[MODE-CHANGE] ✅ Child profile: "${childProfile.name}", age: ${childProfile.age}`);
          }
          logger.info(`[MODE-CHANGE] ✅ Character: ${currentCharacter || 'null'}`);
        }

        logger.info(`[MODE-CHANGE] Step 10: Sending mode_update to device`);

        // For Pipecat, device needs to reconnect with new SDP exchange
        // Send mode_update to notify device of the mode change
        // Device will respond with new hello containing SDP offer
        if (connection.udp) {
          // UDP bridge mode - send mode_update with UDP credentials
          const modeUpdateMsg = {
            type: "mode_update",
            mode: newMode,
            listening_mode: connection.deviceMode || "manual",
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
          logger.info(`[MODE-CHANGE] Sent mode_update (UDP mode, listening_mode: ${connection.deviceMode || "manual"})`);
        } else {
          // Direct Pipecat mode - send mode_update, device will reconnect with SDP
          const modeUpdateMsg = {
            type: "mode_update",
            mode: newMode,
            listening_mode: connection.deviceMode || "manual",
            ...(newMode === "conversation" && currentCharacter
              ? { character: currentCharacter }
              : {}),
            session_id: newRoomName,
            timestamp: Date.now(),
            transport: "pipecat",
            // Device should send new hello with SDP offer to establish Pipecat connection
            reconnect_required: true,
            audio_params: {
              sample_rate: 24000,
              channels: 1,
              frame_duration: 60,
              format: "opus",
            },
          };
          connection.sendMqttMessage(JSON.stringify(modeUpdateMsg));
          logger.info(`[MODE-CHANGE] Sent mode_update (Pipecat mode) - device should reconnect with SDP`);
        }

        // Handle mode-specific startup
        logger.info(`[MODE-CHANGE] Step 11: Starting ${newMode} mode`);
        if (newMode === "music") {
          await connection.spawnMusicBot(newRoomName);
        } else if (newMode === "story") {
          await connection.spawnStoryBot(newRoomName);
        } else if (newMode === "conversation") {
          // With Pipecat, the agent is always running on the Pipecat server
          // Character/profile metadata will be sent during SDP exchange when device reconnects
          newBridge.currentCharacter = currentCharacter || "Cheeko";
          newBridge.childProfile = childProfile;
          newBridge.agentDeployed = false; // Will be true after SDP exchange
          logger.info(`[MODE-CHANGE] Pipecat conversation mode - character: ${currentCharacter || 'Cheeko'}`);
          logger.info(`[MODE-CHANGE] Waiting for device to reconnect with SDP offer...`);
        }

        logger.info(`✅ [MODE-CHANGE] Complete: ${oldMode} → ${newMode}`);
      } else {
        logger.error(`❌ [MODE-CHANGE] API error - Code: ${response.data?.code}, Success: ${response.data?.data?.success}`);
        logger.error(`[MODE-CHANGE] Full API response:`, JSON.stringify(response.data));
      }
    } catch (error) {
      logger.error(`❌ [MODE-CHANGE] Error: ${error.message}`);
      logger.error(`[MODE-CHANGE] Error stack:`, error.stack);
      logger.error(`[MODE-CHANGE] Error details:`, {
        name: error.name,
        code: error.code,
        response: error.response?.data,
        config: error.config ? {
          url: error.config.url,
          method: error.config.method,
          timeout: error.config.timeout
        } : 'N/A'
      });
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
      `📤 [MQTT-OUT] ${deviceInfo || topic} | type: ${msgType}${msgState ? ` | state: ${msgState}` : ""
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

    // Clear ghost cleanup timer
    this.clearGhostCleanupTimer();
    logger.info("🧹 [GHOST-CLEANUP] Stopped periodic cleanup");

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
