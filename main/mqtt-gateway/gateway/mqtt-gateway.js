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

// Character to Agent name mapping for multi-agent dispatch
const CHARACTER_AGENT_MAP = {
  "Cheeko": "cheeko-xai",
  "Math Tutor": "math-tutor-agent",
  "Riddle Solver": "riddle-solver-agent",
  "Word Ladder": "word-ladder-agent",
  "Cheeko Magic": "cheeko-magic-agent",
  "Cheeko Astronaut": "cheeko-astronaut-agent",
  "Cheeko German": "cheeko-german-agent",
};

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

/**
 * Encode spaces in URL path while preserving the URL structure.
 * Handles URLs with spaces in filenames for proper HTTP requests.
 * @param {string} url - The URL to encode
 * @returns {string} URL with path segments properly encoded
 */
function encodeUrlPath(url) {
  if (!url) return url;
  // Simply encode spaces in the URL path
  // Don't use URL object assignment as it double-encodes
  return url.replace(/ /g, '%20');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postCardTapHandshake(tapPayload, { maxAttempts = 3, timeoutMs = 5000 } = {}) {
  const baseUrl = (process.env.MANAGER_API_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("MANAGER_API_URL is not configured");
  }

  const tapUrl = `${baseUrl}/admin/rfid/card/tap`;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await axios.post(tapUrl, tapPayload, { timeout: timeoutMs });
      if (response?.data?.code === 0 && response?.data?.data) {
        return response.data.data;
      }
      throw new Error(response?.data?.msg || "Tap handshake failed");
    } catch (error) {
      lastError = error;
      logger.warn(
        `[RFID-TAP] Tap handshake attempt ${attempt}/${maxAttempts} failed for uid=${tapPayload.rfid_uid}: ${error.message}`
      );
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
      }
    }
  }

  throw lastError || new Error("Tap handshake failed");
}

/**
 * Lookup RFID card mapping from Manager API.
 *   GET /toy/admin/rfid/card/lookup/{rfidUid}
 *
 * Returns object with:
 *   - contentType: card type (story_pack, rhyme_pack, habit_pack, prompt, prompt_pack)
 *   - title: Content title
 *   - contentText: Text to speak directly (for read_only mode)
 *   - promptText: Text to send to LLM (for prompt mode, backward compatible)
 */
async function fetchRfidContentFromManagerApi(rfidUid, sequence) {
  try {
    const trimmedUid = (rfidUid || "").trim();
    if (!trimmedUid) {
      logger.warn(`⚠️ [RFID-LOOKUP] Empty rfidUid provided`);
      return null;
    }

    const baseUrl = process.env.MANAGER_API_URL || "";
    if (!baseUrl) {
      logger.warn(
        `⚠️ [RFID-LOOKUP] MANAGER_API_URL not set, cannot look up RFID content for UID ${trimmedUid}`
      );
      return null;
    }

    // Always fetch full card data (no sequence param).
    // The gateway handles sequence selection locally from the items array.
    let apiUrl = `${baseUrl.replace(/\/$/, "")}/admin/rfid/card/lookup/${encodeURIComponent(
      trimmedUid
    )}`;

    logger.info(
      `🔍 [RFID-LOOKUP] Looking up content for RFID UID ${trimmedUid}, sequence=${sequence} via ${apiUrl}`
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

    const data = body.data;
    const contentType = data.contentType || "prompt";
    const title = (data.title || data.packName || "").trim();
    const contentText = (data.contentText || "").trim();
    const promptText = (data.promptText || "").trim();
    const hasPack = Array.isArray(data.items) && data.items.length > 0;
    const hasStories = Array.isArray(data.stories) && data.stories.length > 0;
    const hasContent = hasPack || hasStories;

    // Validation: only enforce text requirements for non-pack types
    if (!hasContent) {
      if (contentType === "read_only" && !contentText) {
        logger.warn(
          `⚠️ [RFID-LOOKUP] read_only mode but no contentText for UID ${trimmedUid}, sequence=${sequence}`
        );
        return null;
      }
      if (contentType === "prompt" && !promptText) {
        logger.warn(
          `⚠️ [RFID-LOOKUP] prompt mode but no promptText for UID ${trimmedUid}`
        );
        return null;
      }
    }

    const itemCount = hasPack ? data.items.length : (hasStories ? data.stories.length + ' stories' : 0);
    const displayText = contentType === "read_only" ? contentText : (promptText || title);
    logger.info(
      `✅ [RFID-LOOKUP] Resolved UID ${trimmedUid} (seq=${sequence}) -> contentType=${contentType}, title="${title}", items=${itemCount}, text="${displayText.slice(
        0,
        80
      )}${displayText.length > 80 ? "..." : ""}"`
    );

    return {
      contentType,
      title,
      contentText,
      promptText,
      packCode: data.packCode,
      packName: data.packName,
      language: data.language,
      version: data.version,
      items: data.items || null,
      stories: data.stories || null,
      audioUrl: data.audioUrl || null,
      allowCaching: data.allowCaching,
    };
  } catch (error) {
    logger.error(
      `❌ [RFID-LOOKUP] Error looking up RFID UID ${rfidUid}: ${error.message}`
    );
    return null;
  }
}


/**
 * Fetch unified content download manifest from Manager API.
 * This is the new unified endpoint that works for all content types (habits, rhymes, etc.)
 * Uses the content download endpoint:
 *   GET /toy/admin/rfid/card/content/download/{rfidUid}
 *
 * @param {string} rfidUid - RFID card UID
 * @returns {Object|null} Content download manifest or null if not found
 */
async function fetchContentDownloadManifest(rfidUid) {
  try {
    const trimmedUid = (rfidUid || "").trim();
    if (!trimmedUid) {
      logger.warn(`⚠️ [CONTENT-DOWNLOAD] Empty rfidUid provided`);
      return null;
    }

    const baseUrl = process.env.MANAGER_API_URL || "";
    if (!baseUrl) {
      logger.warn(
        `⚠️ [CONTENT-DOWNLOAD] MANAGER_API_URL not set, cannot fetch content manifest for UID ${trimmedUid}`
      );
      return null;
    }

    const apiUrl = `${baseUrl.replace(/\/$/, "")}/admin/rfid/card/content/download/${encodeURIComponent(
      trimmedUid
    )}`;

    logger.info(
      `🔍 [CONTENT-DOWNLOAD] Fetching content manifest for RFID UID ${trimmedUid} via ${apiUrl}`
    );

    const response = await axios.get(apiUrl, { timeout: 10000 });
    const body = response.data;

    if (!body || body.code !== 0) {
      logger.warn(
        `⚠️ [CONTENT-DOWNLOAD] Fetch failed for UID ${trimmedUid}: code=${body && body.code}, msg=${body && body.msg}`
      );
      return null;
    }

    // data can be null if no content pack is linked to this card
    if (!body.data) {
      logger.info(`📦 [CONTENT-DOWNLOAD] No content linked to RFID UID ${trimmedUid}`);
      return null;
    }

    const manifest = body.data;
    logger.info(
      `✅ [CONTENT-DOWNLOAD] Got manifest for UID ${trimmedUid} -> type=${manifest.contentType}, pack=${manifest.packCode}, version=${manifest.version}, items=${manifest.totalItems}`
    );

    return manifest;
  } catch (error) {
    logger.error(
      `❌ [CONTENT-DOWNLOAD] Error fetching content manifest for RFID UID ${rfidUid}: ${error.message}`
    );
    return null;
  }
}

async function postDeviceSyncEvent(path, payload, timeoutMs = 5000) {
  const baseUrl = (process.env.MANAGER_API_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("MANAGER_API_URL not configured");
  }

  const serviceKey = process.env.MANAGER_API_SECRET || process.env.SERVICE_SECRET_KEY;
  if (!serviceKey) {
    throw new Error("MANAGER_API_SECRET/SERVICE_SECRET_KEY not configured");
  }

  const url = `${baseUrl}${path}`;
  logger.info(`[SETTINGS-SYNC][GW->API] POST ${path} mac=${payload?.mac_address || "na"} sender=${payload?.sender_client_id || "na"}`);
  const response = await axios.post(url, payload, {
    timeout: timeoutMs,
    headers: {
      "X-Service-Key": serviceKey,
    },
  });

  logger.info(`[SETTINGS-SYNC][GW->API] Response ${path} code=${response?.data?.code}`);

  return response.data;
}

class MQTTGateway {
  constructor(workerPool) {
    // Shared worker pool for all LiveKit bridges / audio processing
    this.workerPool = workerPool;
    this.udpPort = parseInt(process.env.UDP_PORT) || 1883;
    this.publicIp = process.env.PUBLIC_IP || "127.0.0.1";
    this.connections = new Map(); // clientId -> VirtualMQTTConnection
    this.keepAliveTimer = null;
    this.keepAliveCheckInterval = 15000; // Check every 15 seconds
    this.ghostCleanupTimer = null;
    this.ghostCleanupInterval = 5 * 60 * 1000; // Clean up ghost rooms every 5 minutes
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
        this.roomService = null;
        logger.warn(
          "⚠️ [INIT] LiveKit credentials incomplete, clients not initialized"
        );
      } else {
        // Initialize LiveKit clients with valid credentials
        this.roomService = new RoomServiceClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        this.agentDispatchClient = new AgentDispatchClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        logger.info("✅ [INIT] LiveKit clients initialized successfully");
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

    // Start ghost room/session cleanup timer (every 5 minutes)
    this.setupGhostCleanupTimer();
  }

  /**
   * Set up ghost room/session cleanup timer (every 5 minutes)
   * Cleans up:
   * - LiveKit rooms with no participants or only stale agents
   * - Stale entries in deviceConnections and connections maps
   */
  setupGhostCleanupTimer() {
    // Clear existing timer
    this.clearGhostCleanupTimer();

    logger.info(`🧹 [GHOST-CLEANUP] Starting ghost cleanup timer (interval: ${this.ghostCleanupInterval / 1000}s)`);

    // Run cleanup immediately on startup (after 30 seconds to let things stabilize)
    setTimeout(() => {
      this.cleanupGhostRoomsAndSessions().catch(err => {
        logger.error(`❌ [GHOST-CLEANUP] Initial cleanup failed:`, err.message);
      });
    }, 30000);

    // Set recurring timer
    this.ghostCleanupTimer = setInterval(async () => {
      try {
        await this.cleanupGhostRoomsAndSessions();
      } catch (error) {
        logger.error(`❌ [GHOST-CLEANUP] Cleanup cycle failed:`, error.message);
      }
    }, this.ghostCleanupInterval);
  }

  /**
   * Clear ghost cleanup timer
   */
  clearGhostCleanupTimer() {
    if (this.ghostCleanupTimer) {
      clearInterval(this.ghostCleanupTimer);
      this.ghostCleanupTimer = null;
    }
  }

  /**
   * Clean up ghost rooms and stale sessions
   * - Lists all LiveKit rooms and removes empty/stale ones
   * - Cleans up deviceConnections entries without active connections
   * - Cleans up connections map entries that are dead
   */
  async cleanupGhostRoomsAndSessions() {
    const startTime = Date.now();
    const memBefore = process.memoryUsage();

    let roomsCleaned = 0;
    let sessionsCleaned = 0;
    let connectionsCleaned = 0;

    logger.info(`🧹 [GHOST-CLEANUP] Starting cleanup cycle...`);

    // 1. Clean up ghost LiveKit rooms
    if (this.roomService) {
      try {
        const rooms = await this.roomService.listRooms();
        logger.info(`🧹 [GHOST-CLEANUP] Found ${rooms.length} LiveKit rooms to check`);

        for (const room of rooms) {
          try {
            const roomName = room.name;
            const numParticipants = room.numParticipants || 0;
            const creationTime = room.creationTime ? Number(room.creationTime) * 1000 : Date.now();
            const roomAge = Date.now() - creationTime;
            const roomAgeMinutes = Math.round(roomAge / 60000);

            // Get detailed participant info
            let participants = [];
            try {
              participants = await this.roomService.listParticipants(roomName);
            } catch (err) {
              // Room might have been deleted already
              logger.warn(`⚠️ [GHOST-CLEANUP] Could not list participants for ${roomName}: ${err.message}`);
            }

            // Check if room should be cleaned up
            const hasRealDevice = participants.some(p =>
              p.identity && !p.identity.toLowerCase().includes('agent') && p.identity !== "cheeko-xai" && !p.identity.toLowerCase().includes('gateway')
            );
            const hasOnlyAgents = participants.length > 0 && !hasRealDevice;
            const isEmpty = participants.length === 0;

            // Clean up if:
            // - Room is empty and older than 2 minutes (empty timeout)
            // - Room only has agents (no device) and older than 5 minutes
            // - Room is older than 60 minutes (absolute max)
            const shouldCleanup =
              (isEmpty && roomAge > 2 * 60 * 1000) ||
              (hasOnlyAgents && roomAge > 5 * 60 * 1000) ||
              (roomAge > 60 * 60 * 1000);

            if (shouldCleanup) {
              const reason = isEmpty ? 'empty' : hasOnlyAgents ? 'only-agents' : 'too-old';
              logger.info(`🗑️ [GHOST-CLEANUP] Deleting ${reason} room: ${roomName} (age: ${roomAgeMinutes}min, participants: ${numParticipants})`);

              // Stop any media bots first
              if (roomName.includes('_music') || roomName.includes('_story')) {
                try {
                  await axios.post(`${MEDIA_API_BASE}/stop-bot`, { room_name: roomName }, mediaAxiosConfig({ timeout: 3000 }));
                } catch (botErr) {
                  // Ignore bot stop errors
                }
              }

              await this.roomService.deleteRoom(roomName);
              roomsCleaned++;
              logger.info(`✅ [GHOST-CLEANUP] Deleted ghost room: ${roomName}`);
            }
          } catch (roomError) {
            logger.warn(`⚠️ [GHOST-CLEANUP] Error processing room ${room.name}: ${roomError.message}`);
          }
        }
      } catch (error) {
        logger.error(`❌ [GHOST-CLEANUP] Failed to list/cleanup LiveKit rooms:`, error.message);
      }
    }

    // 2. Clean up stale deviceConnections entries
    const staleDevices = [];
    const now = Date.now();
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
    const MIN_AGE_FOR_CLEANUP = 60 * 1000; // 60 seconds grace period for new connections

    for (const [deviceId, deviceInfo] of this.deviceConnections.entries()) {
      const connection = deviceInfo?.connection;

      // Never clean up connections that were created recently (bridge may still be initializing)
      const connectionAge = now - (connection?.lastActivityTime || now);
      if (connectionAge < MIN_AGE_FOR_CLEANUP) {
        continue;
      }

      // Check if connection is dead or closing (fixed: proper isAlive check)
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
      logger.info(`🗑️ [GHOST-CLEANUP] Removing stale deviceConnection: ${deviceId}`);
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

      // Remove from map
      if (deviceInfo?.connectionId) {
        this.connections.delete(deviceInfo.connectionId);
      }
      this.deviceConnections.delete(deviceId);
      sessionsCleaned++;
    }

    // 3. Clean up stale connections map entries
    const staleConnectionIds = [];
    for (const [connectionId, connection] of this.connections.entries()) {
      // Never clean up connections younger than 60 seconds
      const connAge = now - (connection?.lastActivityTime || now);
      if (connAge < MIN_AGE_FOR_CLEANUP) {
        continue;
      }

      const isStaleConn = !connection || connection.closing ||
        (typeof connection.isAlive === 'function' && !connection.isAlive());
      if (isStaleConn) {
        staleConnectionIds.push(connectionId);
      }
    }

    for (const connectionId of staleConnectionIds) {
      // Don't double-count if already cleaned via deviceConnections
      if (!staleDevices.some(d => this.deviceConnections.get(d)?.connectionId === connectionId)) {
        logger.info(`🗑️ [GHOST-CLEANUP] Removing stale connection: ${connectionId}`);
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

    // 4. Clean up stale clientConnections entries (these are never cleaned otherwise)
    let clientConnectionsCleaned = 0;
    for (const [clientId, info] of this.clientConnections.entries()) {
      const deviceId = info?.deviceId;
      // Remove if no deviceId or device no longer exists in deviceConnections
      if (!deviceId || !this.deviceConnections.has(deviceId)) {
        this.clientConnections.delete(clientId);
        clientConnectionsCleaned++;
      }
    }
    if (clientConnectionsCleaned > 0) {
      logger.info(`🗑️ [GHOST-CLEANUP] Cleaned ${clientConnectionsCleaned} stale clientConnections entries`);
    }

    const duration = Date.now() - startTime;
    const memAfter = process.memoryUsage();
    const heapDiff = (memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024;

    logger.info(`✅ [GHOST-CLEANUP] Cleanup complete in ${duration}ms - Rooms: ${roomsCleaned}, Sessions: ${sessionsCleaned}, Connections: ${connectionsCleaned}, ClientConns: ${clientConnectionsCleaned}`);
    logger.info(`📊 [GHOST-CLEANUP] Memory: Heap ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB, Released: ${heapDiff.toFixed(1)}MB | Active: ${this.connections.size}, Devices: ${this.deviceConnections.size}`);
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
      this.mqttClient.subscribe(["internal/server-ingest", "devices/+/data"], (err) => {
        if (err)
          logger.error(
            "Failed to subscribe to MQTT topics:",
            err
          );
        else logger.info("📡 Subscribed to internal/server-ingest, devices/+/data");
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
      const rawMessage = message.toString();
      const rawPreview =
        rawMessage.length > 1200
          ? rawMessage.substring(0, 1200) + "..."
          : rawMessage;
      logger.info(`[MQTT-IN][RAW] topic=${topic} payload=${rawPreview}`);
      const payload = JSON.parse(rawMessage);

      // Handle devices/{macAddress}/data topic
      if (topic.startsWith("devices/") && topic.endsWith("/data")) {
        const topicParts = topic.split("/");
        const macAddress = topicParts[1]; // e.g. D0:CF:13:04:15:58
        logger.info(`📨 [MQTT-IN] ${macAddress}: data (direct topic)`);
        const deviceInfo = this.deviceConnections.get(macAddress);
        if (deviceInfo && deviceInfo.connection) {
          deviceInfo.connection.handlePublish({ payload: JSON.stringify(payload) });
        } else {
          logger.warn(`⚠️ [MQTT-IN] Received data for unknown device: ${macAddress}`);
        }
        return;
      }

      // All device messages come through internal/server-ingest via EMQX republish rule
      if (topic === "internal/server-ingest") {
        // Extract client ID and original payload from EMQX republish rule
        const clientId = payload.sender_client_id;
        const originalPayload = payload.orginal_payload || payload.original_payload;
        const originalPayloadStr =
          originalPayload && typeof originalPayload === "object"
            ? JSON.stringify(originalPayload)
            : String(originalPayload || "");
        const originalPreview =
          originalPayloadStr.length > 1200
            ? originalPayloadStr.substring(0, 1200) + "..."
            : originalPayloadStr;
        logger.info(
          `[MQTT-IN][DEVICE] sender=${clientId || "na"} payload=${originalPreview}`
        );

        if (!clientId || !originalPayload) {
          logger.error(
            `❌ [MQTT IN] Invalid republished message format - missing clientId or originalPayload`
          );
          return;
        }
        if (typeof originalPayload !== "object" || Array.isArray(originalPayload)) {
          logger.error(`❌ [MQTT IN] Invalid original payload type from ${clientId}`);
          return;
        }

        // Extract device MAC from client ID
        let deviceId = "unknown-device";
        const parts = clientId.split("@@@");
        if (parts.length >= 2) {
          deviceId = parts[1].replace(/_/g, ":").toUpperCase(); // Convert MAC format
        }

        this.clientConnections.set(clientId, {
          deviceId,
          lastSeen: Date.now(),
        });

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

      if (originalPayload.type === "settings_get") {
        logger.info(`[SETTINGS-SYNC][GW-IN] settings_get mac=${deviceId} sender=${clientId} current_version=${originalPayload.current_version ?? "na"}`);
        await this.handleSettingsGet(deviceId, originalPayload, clientId);
        return;
      }
      if (originalPayload.type === "settings_ack") {
        logger.info(`[SETTINGS-SYNC][GW-IN] settings_ack mac=${deviceId} sender=${clientId} status=${originalPayload.status || "na"} version=${originalPayload.version ?? "na"}`);
        await this.handleSettingsAck(deviceId, originalPayload, clientId);
        return;
      }
      if (originalPayload.type === "device_state") {
        logger.info(`[SETTINGS-SYNC][GW-IN] device_state mac=${deviceId} sender=${clientId} reason=${originalPayload.reason || "na"}`);
        await this.handleDeviceState(deviceId, originalPayload, clientId);
        return;
      }
      if (originalPayload.type === "settings_changed") {
        logger.info(`[SETTINGS-SYNC][GW-IN] settings_changed mac=${deviceId} sender=${clientId} reason=${originalPayload.reason || "na"}`);
        await this.handleSettingsChanged(deviceId, originalPayload, clientId);
        return;
      }
      if (originalPayload.type === "analytics_event") {
        logger.info(`[ANALYTICS][GW-IN] analytics_event mac=${deviceId} sender=${clientId} event_id=${originalPayload.event_id || "na"} event=${originalPayload.event || "na"}`);
        await this.handleAnalyticsEvent(deviceId, originalPayload, clientId);
        return;
      }

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

      // Handle mode-change messages from device
      if (originalPayload.type === "mode-change") {
        const mode = originalPayload.mode;
        if (mode) {
          await this.handleModeChange(deviceId, mode, clientId);
          return;
        } else {
          // No mode specified - use cycle mode (conversation → music → story → conversation)
          logger.info(`🔄 [MODE-CHANGE] No mode specified, using cycle mode for ${deviceId}`);
          await this.handleDeviceModeChange(deviceId, originalPayload);
          return;
        }
      }

      // Handle content download requests from device (for SD card content)
      // Unified handler for all content types (habits, rhymes, etc.)
      // Supports: download_request (new), habit_download_request (legacy), rhyme_download_request (legacy)
      if (originalPayload.type === "download_request" ||
        originalPayload.type === "habit_download_request" ||
        originalPayload.type === "rhyme_download_request") {
        await this.handleContentDownloadRequest(deviceId, originalPayload, clientId);
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
        // Special handling for start_greeting - legacy path (no-op in new flow)

        let greetingSent = false;

        // Check for virtual device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (deviceInfo && deviceInfo.connection) {
          const connection = deviceInfo.connection;

          // Room should already exist from parseHelloMessage
          if (connection.bridge) {
            const bridge = connection.bridge;
            const roomName = bridge.room ? bridge.room.name : null;

            if (!roomName) {
              logger.error(
                `❌ [START-GREETING] Cannot dispatch agent - room name not available`
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
      } else if (
        originalPayload.type === "start_greeting_text" ||
        originalPayload.type === "card_lookup"
      ) {
        // RFID Card Scan: look up card mapping and route to Content Pack (device) or Q&A (agent)
        const rfidUid =
          originalPayload.rfid_uid ||
          originalPayload.rfidUid ||
          null;
        const sequence =
          originalPayload.sequence ||
          originalPayload.seq ||
          originalPayload.sl_no ||
          null;

        if (!rfidUid) {
          logger.warn(`[RFID-SCAN] No RFID UID in payload from device ${deviceId}, ignoring`);
          return;
        }

        const sessionId = originalPayload.session_id || null;
        const fallbackEventId =
          originalPayload.event_id ||
          `lookup_${sessionId || "nosession"}_${rfidUid}_${originalPayload.tap_ts || Date.now()}`;
        const tapPayload = {
          event_id: fallbackEventId,
          session_id: sessionId,
          mac_address: originalPayload.mac_address || deviceId,
          rfid_uid: rfidUid,
          local_skill_id: originalPayload.local_skill_id || null,
          local_version: originalPayload.local_version || null,
          local_content_hash: originalPayload.local_content_hash || null,
          tap_ts: originalPayload.tap_ts || new Date().toISOString(),
          source: "gateway_card_lookup_router",
        };

        let tapAck = null;
        try {
          tapAck = await postCardTapHandshake(tapPayload);
        } catch (tapErr) {
          logger.warn(`[RFID-TAP] Failed to persist card_lookup tap for uid=${rfidUid}: ${tapErr.message}`);
        }

        const isContentUpToDate =
          tapAck &&
          tapAck.recognized &&
          tapAck.cardType === "content" &&
          tapAck.updateRequired === false;

        if (isContentUpToDate) {
          this.mqttPublish(`devices/p2p/${clientId}`, {
            type: "card_up_to_date",
            rfid_uid: rfidUid,
            skill_id: tapAck.skillId || tapAck.contentPackCode || null,
            latest_version: tapAck.latestVersion || null,
            latest_content_hash: tapAck.latestContentHash || null,
            update_required: false,
            download_manifest_path: tapAck.downloadManifestPath || null,
            server_ts: new Date().toISOString(),
          });
          logger.info(
            `[RFID-ROUTING] Content already up to date for uid=${rfidUid}, sent card_up_to_date to device ${deviceId}`
          );
          return;
        }

        logger.info(`[RFID-SCAN] Card scanned on device ${deviceId}: uid=${rfidUid}, sequence=${sequence}`);

        const rfidContent = await fetchRfidContentFromManagerApi(rfidUid, sequence);
        if (!rfidContent) {
          // Send card_unknown response to device (Phase 9 format)
          const unknownResponse = {
            type: "card_unknown",
            rfid_uid: rfidUid
          };
          this.mqttPublish(`devices/p2p/${clientId}`, unknownResponse);
          logger.warn(`[RFID-SCAN] Unknown card ${rfidUid}, sent card_unknown to device ${deviceId}`);
          return;
        }

        // Determine text for agent path (content packs use title as placeholder)
        let textToSend;
        const hasItemsArr = rfidContent.items && rfidContent.items.length > 0;
        const hasStoriesArr = rfidContent.stories && rfidContent.stories.length > 0;
        if (hasItemsArr || hasStoriesArr) {
          textToSend = rfidContent.title || "pack content";
        } else {
          textToSend = rfidContent.promptText || rfidContent.contentText;
        }

        if (!textToSend) {
          logger.warn(`[RFID-SCAN] Card found but no usable content for uid=${rfidUid}`);
          return;
        }

        // ====== RFID SMART ROUTING ======
        // Classify card type by DATA SHAPE, not contentType string.
        // This handles any content_type value (tts, story_pack, rhyme, habit, etc.)
        const hasItems = rfidContent && Array.isArray(rfidContent.items) && rfidContent.items.length > 0;
        const hasStories = rfidContent && Array.isArray(rfidContent.stories) && rfidContent.stories.length > 0;

        // Branch A: Content Pack — items with audioUrl OR grouped stories => send manifest to device
        const isContentPack = hasStories || (hasItems && rfidContent.items.some(item => item.audioUrl));
        // Branch B: Q&A Pack — items with promptText => send prompt to agent
        const isQaPack = hasItems && !isContentPack && rfidContent.items.some(item => item.promptText);

        // ====== BRANCH A: CONTENT PACK — send card_content directly via MQTT (no LiveKit needed) ======
        if (isContentPack) {
          // Grouped content — stories[] present from API
          if (hasStories) {
            logger.info(
              `📦 [RFID-ROUTING] Grouped Content Pack detected (${rfidContent.contentType}, ${rfidContent.stories.length} stories). ` +
              `Sending card_content with stories[] to device, bypassing Agent.`
            );

            const stories = rfidContent.stories.map(story => ({
              index: story.index,
              title: story.title,
              audio: (story.audio || []).map(a => ({ index: a.index, url: encodeUrlPath(a.url) })),
              images: (story.images || []).map(i => ({ index: i.index, url: i.url })),
            }));

            const manifest = {
              type: "card_content",
              rfid_uid: rfidUid,
              skill_id: rfidContent.packCode,
              skill_name: rfidContent.title || rfidContent.packName,
              version: parseInt(rfidContent.version) || 1,
              content_type: rfidContent.contentType || null,
              stories: stories,
              update_required: tapAck ? Boolean(tapAck.updateRequired) : true,
              latest_version: tapAck?.latestVersion || (rfidContent.version != null ? String(rfidContent.version) : null),
              latest_content_hash: tapAck?.latestContentHash || null,
              download_manifest_path: tapAck?.downloadManifestPath || null,
              replace_mode: "safe_background_refresh",
            };

            logger.info(
              `📦 [RFID-ROUTING] Sending grouped card_content: skill=${manifest.skill_id}, v=${manifest.version}, ` +
              `stories=${stories.length} to device ${deviceId}`
            );

            this.mqttPublish(`devices/p2p/${clientId}`, manifest);
            return;
          }

          // Flat content — existing behavior
          logger.info(
            `📦 [RFID-ROUTING] Flat Content Pack detected (${rfidContent.contentType}, ${rfidContent.items.length} items). ` +
            `Sending card_content directly to device, bypassing Agent.`
          );

          const audio = [];
          const images = [];
          for (const item of rfidContent.items) {
            const seq = item.sequence;
            if (item.audioUrl) {
              audio.push({ index: seq, url: encodeUrlPath(item.audioUrl) });
            }
            if (item.imageUrl) {
              images.push({ index: seq, url: item.imageUrl });
            }
          }

          const manifest = {
            type: "card_content",
            rfid_uid: rfidUid,
            skill_id: rfidContent.packCode,
            skill_name: rfidContent.title || rfidContent.packName,
            version: parseInt(rfidContent.version) || 1,
            content_type: rfidContent.contentType || null,
            audio: audio,
            images: images,
            update_required: tapAck ? Boolean(tapAck.updateRequired) : true,
            latest_version: tapAck?.latestVersion || (rfidContent.version != null ? String(rfidContent.version) : null),
            latest_content_hash: tapAck?.latestContentHash || null,
            download_manifest_path: tapAck?.downloadManifestPath || null,
            replace_mode: "safe_background_refresh",
          };

          logger.info(
            `📦 [RFID-ROUTING] Sending card_content: skill=${manifest.skill_id}, v=${manifest.version}, ` +
            `audio=${audio.length}, images=${images.length} to device ${deviceId}`
          );

          this.mqttPublish(`devices/p2p/${clientId}`, manifest);
          return;
        }

        // ====== BRANCH C: AI PROMPT CARD — send prompt text directly via MQTT (no LiveKit needed) ======
        const isAiPromptCard = !hasItems && rfidContent.contentType === "prompt";
        if (isAiPromptCard) {
          const deviceInfo = this.deviceConnections.get(deviceId);
          const hasConnection = deviceInfo && deviceInfo.connection && deviceInfo.connection.bridge;

          if (hasConnection && deviceInfo.connection.roomType === "conversation") {
            // If there IS an active connection, check if this card maps to a different agent
            const cardAgentName = rfidContent.agentName || null;
            const currentCharacter = deviceInfo.connection.currentCharacter || "Cheeko";
            const targetCharacter = cardAgentName
              ? (Object.entries(CHARACTER_AGENT_MAP).find(([, a]) => a === cardAgentName)?.[0] || null)
              : null;

            if (targetCharacter && targetCharacter !== currentCharacter) {
              // Card maps to a different agent — trigger character switch
              logger.info(
                `🎴 [RFID-ROUTING] AI card wants agent "${targetCharacter}" but current is "${currentCharacter}" — switching`
              );
              await this.handleDeviceCharacterChange(deviceId, { characterName: targetCharacter });
              return;
            }

            // Same agent or no agent mapped — route prompt to current agent
            logger.info(
              `🤖 [RFID-ROUTING] AI Prompt card with active connection, routing to agent for device ${deviceId}`
            );
          } else {
            // No active connection — send card_ai to set device into conversation mode
            // Include agent_name so firmware can pass it back during session creation
            const cardAgentName = rfidContent.agentName || null;
            logger.info(
              `🤖 [RFID-ROUTING] AI Prompt card (no active connection). Sending card_ai to device ${deviceId}, agent=${cardAgentName || 'default'}`
            );

            this.mqttPublish(`devices/p2p/${clientId}`, {
              type: "card_ai",
              rfid_uid: rfidUid,
              ...(cardAgentName ? { agent_name: cardAgentName } : {}),
            });
            return;
          }
        }

        // ====== BRANCH B: Q&A — requires LiveKit connection ======
        const deviceInfo = this.deviceConnections.get(deviceId);
        if (!deviceInfo || !deviceInfo.connection || !deviceInfo.connection.bridge) {
          logger.warn(`[RFID-SCAN] No active connection for device ${deviceId}`);
          return;
        }

        const connection = deviceInfo.connection;
        const bridge = connection.bridge;

        if (connection.roomType !== "conversation") {
          logger.info(`[RFID-SCAN] Ignoring scan in non-conversation mode for device ${deviceId}`);
          return;
        }

        const room = bridge.room;
        if (!room || !room.localParticipant) {
          logger.warn(`[RFID-SCAN] No LiveKit room for device ${deviceId}`);
          return;
        }

        try {
          // Abort existing playback if needed
          if (bridge.isAudioPlaying) {
            logger.info(`[RFID-SCAN] Aborting current playback on device ${deviceId}`);
            try {
              const currentSessionId = connection.udp?.session_id || null;
              if (currentSessionId) {
                await bridge.sendAbortSignal(currentSessionId);
              }
              bridge.sendTtsStopMessage();
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (abortErr) {
              logger.error(`[RFID-SCAN] Abort failed for device ${deviceId}: ${abortErr.message}`);
            }
          }

          // Build message for LiveKit Agent
          const userTextMsg = {
            type: "user_text",
            text: textToSend,
            device_id: deviceId,
            // Prefer gateway-known session; ignore any session_id sent by device
            session_id: connection.udp?.session_id || null,
            source: "rfid",
            timestamp: Date.now(),
          };

          // Add RFID-specific fields
          if (rfidUid) {
            userTextMsg.rfid_uid = rfidUid;
          }
          if (sequence !== null && sequence !== undefined) {
            userTextMsg.sequence = sequence;
          }

          // ====== Q&A PACK or SINGLE PROMPT — route to LiveKit Agent ======
          let selectedItem = null;
          if (isQaPack) {
            // Q&A Pack: find the specific question by sequence
            const targetSeq = sequence || 1;
            selectedItem = rfidContent.items.find(
              item => item.sequence === targetSeq || item.itemNumber === targetSeq
            );
            if (!selectedItem) {
              logger.warn(
                `⚠️ [RFID-ROUTING] Q&A Pack sequence ${targetSeq} not found in ${rfidContent.items.length} items. Falling back to first.`
              );
              selectedItem = rfidContent.items[0];
            }
          }

          // Extract prompt and optional cached audio
          const promptText = selectedItem
            ? (selectedItem.promptText || selectedItem.title)
            : (rfidContent?.promptText || textToSend);
          const cachedAudio = selectedItem
            ? selectedItem.audioUrl
            : (rfidContent?.audioUrl || null);

          logger.info(
            `[RFID-ROUTING] Q&A selected -> seq=${sequence || 1}, ` +
            `question="${selectedItem?.title || 'N/A'}", ` +
            `prompt="${promptText.substring(0, 80)}", ` +
            `audioUrl=${cachedAudio || 'none'}`
          );

          // Update message for Agent
          userTextMsg.text = promptText;
          userTextMsg.content_type = "prompt";
          if (cachedAudio) {
            userTextMsg.audio_url = cachedAudio;
          }
          if (selectedItem?.systemPromptOverride) {
            userTextMsg.system_prompt_override = selectedItem.systemPromptOverride;
          }

          const payloadStr = JSON.stringify(userTextMsg);
          const data = new Uint8Array(Buffer.from(payloadStr, "utf8"));

          await room.localParticipant.publishData(data, { reliable: true });
          logger.info(
            `[RFID-ROUTING] Sent to LiveKit Agent -> device=${deviceId}, seq=${sequence || 1}, hasAudio=${!!cachedAudio}`
          );
        } catch (err) {
          logger.error(
            `[RFID-SCAN] Error processing card for device ${deviceId}: ${err.message}`
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

        // Check if this participant is an agent (identity contains 'agent' or is 'cheeko-xai')
        if (
          participant.identity &&
          (participant.identity.toLowerCase().includes("agent") ||
            participant.identity === "cheeko-xai")
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

  resolveSenderClientIdByMac(macAddress) {
    for (const [clientId, info] of this.clientConnections.entries()) {
      if ((info?.deviceId || "").toUpperCase() === (macAddress || "").toUpperCase()) {
        return clientId;
      }
    }
    return null;
  }

  async handleSettingsGet(deviceId, payload, clientId) {
    try {
      const response = await postDeviceSyncEvent("/device-sync/settings-get", {
        mac_address: deviceId,
        sender_client_id: clientId,
        device_id: payload.device_id || null,
        current_version: payload.current_version,
        payload,
      });

      const data = response?.data;
      if (data?.shouldPublish && data?.mqttMessage) {
        logger.info(
          `[SETTINGS-SYNC][GW-OUT] publish settings_update mac=${deviceId} sender=${clientId} version=${data?.mqttMessage?.version ?? "na"} topic=devices/p2p/${clientId} payload=${JSON.stringify(data.mqttMessage)}`
        );
        this.mqttPublish(`devices/p2p/${clientId}`, data.mqttMessage);
      } else {
        logger.info(`[SETTINGS-SYNC][GW-OUT] no publish needed mac=${deviceId} sender=${clientId}`);
      }
    } catch (error) {
      logger.error(`[SETTINGS-SYNC] settings_get handling failed for ${deviceId}: ${error.message}`);
    }
  }

  async handleSettingsAck(deviceId, payload, clientId) {
    try {
      await postDeviceSyncEvent("/device-sync/settings-ack", {
        mac_address: deviceId,
        sender_client_id: clientId,
        device_id: payload.device_id || null,
        version: payload.version,
        status: payload.status,
        applied_version: payload.applied_version,
        reason: payload.reason,
        payload,
      });
      logger.info(`[SETTINGS-SYNC][GW] forwarded settings_ack mac=${deviceId} sender=${clientId}`);
    } catch (error) {
      logger.error(`[SETTINGS-SYNC] settings_ack handling failed for ${deviceId}: ${error.message}`);
    }
  }

  async handleDeviceState(deviceId, payload, clientId) {
    try {
      await postDeviceSyncEvent("/device-sync/device-state", {
        mac_address: deviceId,
        sender_client_id: clientId,
        device_id: payload.device_id || null,
        payload,
      });
      logger.info(`[SETTINGS-SYNC][GW] forwarded device_state mac=${deviceId} sender=${clientId}`);
    } catch (error) {
      logger.error(`[SETTINGS-SYNC] device_state handling failed for ${deviceId}: ${error.message}`);
    }
  }

  async handleSettingsChanged(deviceId, payload, clientId) {
    try {
      const response = await postDeviceSyncEvent("/device-sync/settings-changed", {
        mac_address: deviceId,
        sender_client_id: clientId,
        device_id: payload.device_id || null,
        payload,
      });

      const data = response?.data;
      if (data?.shouldPublish && data?.mqttMessage) {
        logger.info(
          `[SETTINGS-SYNC][GW-OUT] publish settings_update (settings_changed) mac=${deviceId} sender=${clientId} version=${data?.mqttMessage?.version ?? "na"} topic=devices/p2p/${clientId} payload=${JSON.stringify(data.mqttMessage)}`
        );
        this.mqttPublish(`devices/p2p/${clientId}`, data.mqttMessage);
      } else {
        logger.info(`[SETTINGS-SYNC][GW-OUT] no publish needed after settings_changed mac=${deviceId} sender=${clientId}`);
      }
    } catch (error) {
      logger.error(`[SETTINGS-SYNC] settings_changed handling failed for ${deviceId}: ${error.message}`);
    }
  }

  async handleAnalyticsEvent(deviceId, payload, clientId) {
    try {
      const response = await postDeviceSyncEvent("/device-sync/analytics-event", {
        mac_address: deviceId,
        sender_client_id: clientId,
        device_id: payload.device_id || null,
        payload,
      });
      logger.info(
        `[ANALYTICS][GW->API] stored mac=${deviceId} sender=${clientId} deduplicated=${response?.data?.deduplicated === true}`
      );
    } catch (error) {
      logger.error(`[ANALYTICS][GW] analytics_event handling failed for ${deviceId}: ${error.message}`);
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
        // Send data channel message to LiveKit agent
        const room = deviceInfo.connection?.bridge?.room;
        if (!room) {
          logger.error(`❌ [CONTROL] No room available for ${macAddress}`);
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

        // Send playback control via LiveKit data channel
        const playbackMessage = JSON.stringify({
          type: "playback_control",
          action: "next",
        });
        await room.localParticipant.publishData(
          new TextEncoder().encode(playbackMessage),
          { reliable: true }
        );
        const label = mode === "music" ? "song" : "story";
        logger.info(
          `✅ [CONTROL] Sent 'next' command via data channel to ${roomName}`
        );

        // Send TTS start message
        if (clientId) {
          const controlTopic = `devices/p2p/${clientId}`;
          const ttsStartMsg = {
            type: "tts",
            state: "start",
            text: `Skipping to next ${label}`,
            session_id: deviceInfo.connection?.udp?.session_id || null,
          };
          this.mqttPublish(controlTopic, ttsStartMsg);
        }
      } else {
        // Other modes not supported
        logger.warn(
          `⚠️ [CONTROL] Next/Previous not supported for mode: ${mode}`
        );
        return;
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

    logger.info(`⏮️ [CONTROL] Previous requested for device: ${macAddress}`);

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
        // Send data channel message to LiveKit agent
        const room = deviceInfo.connection?.bridge?.room;
        if (!room) {
          logger.error(`❌ [CONTROL] No room available for ${macAddress}`);
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

        // Send playback control via LiveKit data channel
        const playbackMessage = JSON.stringify({
          type: "playback_control",
          action: "previous",
        });
        await room.localParticipant.publishData(
          new TextEncoder().encode(playbackMessage),
          { reliable: true }
        );
        const label = mode === "music" ? "song" : "story";
        logger.info(
          `✅ [CONTROL] Sent 'previous' command via data channel to ${roomName}`
        );

        // Send TTS start message
        if (clientId) {
          const controlTopic = `devices/p2p/${clientId}`;
          const ttsStartMsg = {
            type: "tts",
            state: "start",
            text: `Going to previous ${label}`,
            session_id: deviceInfo.connection?.udp?.session_id || null,
          };
          this.mqttPublish(controlTopic, ttsStartMsg);
        }
      } else {
        // Other modes not supported
        logger.warn(`⚠️ [CONTROL] Previous not supported for mode: ${mode}`);
        return;
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

  /**
   * Handle content download request from device (unified handler).
   * Uses the unified content download endpoint that works for all content types.
   * Responds with content_type so device knows what it's downloading (habit, rhyme, story, etc.)
   * @param {string} deviceId - Device MAC address
   * @param {Object} payload - Request payload with rfid_uid
   * @param {string} clientId - MQTT client ID for response
   */
  async handleContentDownloadRequest(deviceId, payload, clientId) {
    const rfidUid = payload.rfid_uid;
    const currentVersion = payload.current_version || payload.version;

    logger.info(`📥 [CONTENT-DOWNLOAD] Device ${deviceId} requesting content for RFID: ${rfidUid}`);

    try {
      // Fetch unified content manifest (works for habits, rhymes, stories, etc.)
      const manifest = await fetchContentDownloadManifest(rfidUid);

      if (!manifest) {
        // No content linked to this card
        logger.info(`📦 [CONTENT-DOWNLOAD] No content linked to RFID UID ${rfidUid}`);
        this.mqttPublish(`devices/p2p/${clientId}`, {
          type: "download_response",
          status: "not_found",
          rfid_uid: rfidUid,
          message: "No downloadable content linked to this RFID card"
        });
        return;
      }

      const contentType = manifest.contentType || "unknown";
      logger.info(`📦 [CONTENT-DOWNLOAD] RFID ${rfidUid} is a ${contentType.toUpperCase()} card`);

      // Check if device already has this version
      if (currentVersion && manifest.version && currentVersion === manifest.version) {
        logger.info(`✅ [CONTENT-DOWNLOAD] Device already has version ${currentVersion}`);
        this.mqttPublish(`devices/p2p/${clientId}`, {
          type: "download_response",
          status: "up_to_date",
          rfid_uid: rfidUid,
          pack_code: manifest.packCode,
          version: manifest.version
        });
        return;
      }

      // Check if grouped content (stories[] present)
      if (Array.isArray(manifest.stories) && manifest.stories.length > 0) {
        // Grouped download — build per-story file maps
        const stories = manifest.stories.map(story => {
          const storyFiles = {};
          for (const item of story.items || []) {
            const itemNum = item.itemNumber;
            if (item.audio && item.audio.url) {
              storyFiles[`audio_${itemNum}`] = encodeUrlPath(item.audio.url);
            }
            if (item.images && item.images.length > 0 && item.images[0].url) {
              storyFiles[`image_${itemNum}`] = item.images[0].url;
            }
          }
          return {
            index: story.index,
            title: story.title,
            files: storyFiles
          };
        });

        const totalFiles = stories.reduce((sum, s) => sum + Object.keys(s.files).length, 0);
        logger.info(`📦 [CONTENT-DOWNLOAD] Sending grouped ${contentType} download links for ${manifest.packCode} v${manifest.version} (${stories.length} stories, ${totalFiles} files)`);
        this.mqttPublish(`devices/p2p/${clientId}`, {
          type: "download_response",
          status: "download_required",
          rfid_uid: rfidUid,
          pack_code: manifest.packCode,
          pack_name: manifest.packName,
          version: manifest.version,
          total_items: manifest.totalItems,
          stories: stories
        });
      } else {
        // Flat download — existing behavior
        const files = {};
        for (const item of manifest.items || []) {
          const itemNum = item.itemNumber;

          // Add audio URL (URL-encoded for proper HTTP requests)
          if (item.audio && item.audio.url) {
            files[`audio_${itemNum}`] = encodeUrlPath(item.audio.url);
          }

          // Add image URL if present (for habits)
          if (item.images && item.images.length > 0 && item.images[0].url) {
            files[`image_${itemNum}`] = item.images[0].url;
          }
        }

        // Send unified download response with content_type
        logger.info(`📦 [CONTENT-DOWNLOAD] Sending ${contentType} download links for ${manifest.packCode} v${manifest.version} (${Object.keys(files).length} files)`);
        this.mqttPublish(`devices/p2p/${clientId}`, {
          type: "download_response",
          status: "download_required",
          rfid_uid: rfidUid,
          pack_code: manifest.packCode,
          pack_name: manifest.packName,
          version: manifest.version,
          total_items: manifest.totalItems,
          files: files
        });
      }

    } catch (error) {
      logger.error(`❌ [CONTENT-DOWNLOAD] Error handling request: ${error.message}`);
      this.mqttPublish(`devices/p2p/${clientId}`, {
        type: "download_response",
        status: "error",
        rfid_uid: rfidUid,
        message: "Server error processing request"
      });
    }
  }

  /**
   * Handle mode-change messages from device
   * Switches between conversation, music, and story modes
   * @param {string} deviceId - Device MAC address
   * @param {string} mode - Target mode: "conversation", "music", or "story"
   * @param {string} clientId - MQTT client ID
   */
  async handleModeChange(deviceId, mode, clientId = null) {
    const validModes = ["conversation", "music", "story"];

    if (!validModes.includes(mode)) {
      logger.warn(`⚠️ [MODE-CHANGE] Invalid mode: ${mode}, valid modes: ${validModes.join(", ")}`);
      return;
    }

    logger.info(`🔄 [MODE-CHANGE] Device ${deviceId} requesting mode: ${mode}`);

    try {
      const deviceInfo = this.deviceConnections.get(deviceId);
      if (!deviceInfo) {
        logger.warn(`⚠️ [MODE-CHANGE] Device not found: ${deviceId}`);
        return;
      }

      const connection = deviceInfo.connection;
      if (!connection) {
        logger.warn(`⚠️ [MODE-CHANGE] No connection for device: ${deviceId}`);
        return;
      }

      // Check if already in the same mode
      if (connection.roomType === mode) {
        logger.info(`ℹ️ [MODE-CHANGE] Device ${deviceId} already in ${mode} mode, skipping`);
        return;
      }

      const previousMode = connection.roomType || null;
      logger.info(`🔄 [MODE-CHANGE] Switching from ${previousMode} to ${mode}`);

      // Step 1: Cleanup old room/agent if exists
      if (connection.bridge) {
        logger.info(`🧹 [MODE-CHANGE] Cleaning up previous ${previousMode} session`);
        await this.performRobustAgentCleanup(connection, 'mode_change');
      }

      // Step 2: Generate new room name
      const newSessionUuid = require("crypto").randomUUID();
      const macForRoom = deviceId.replace(/:/g, "");
      const newRoomName = `${newSessionUuid}_${macForRoom}_${mode}`;
      logger.info(`🏠 [MODE-CHANGE] New room: ${newRoomName}`);

      // Step 3: Update connection state
      connection.roomType = mode;
      connection.udp = connection.udp || {};
      connection.udp.session_id = newRoomName;
      deviceInfo.currentMode = mode;

      // Step 4: Create new LiveKit bridge and connect
      const newBridge = new LiveKitBridge(
        connection,
        connection.protocolVersion || 1,
        deviceId,                      // macAddress
        newSessionUuid,                // uuid
        connection.userData || {},     // userData
        this.workerPool                // workerPool for audio encoding/decoding
      );

      try {
        await newBridge.connect();
        connection.bridge = newBridge;
        logger.info(`✅ [MODE-CHANGE] Bridge connected to room: ${newRoomName}`);
      } catch (bridgeError) {
        logger.error(`❌ [MODE-CHANGE] Failed to connect bridge: ${bridgeError.message}`);
        return;
      }

      // Step 5: Dispatch agent/bot based on mode
      if (mode === "conversation") {
        // Dispatch conversation agent
        if (this.agentDispatchClient) {
          try {
            // Fetch character name
            const macAddress = deviceId.replace(/:/g, "").toLowerCase();
            let characterName = "Cheeko";
            let childProfile = null;

            try {
              const [charResponse, profileResponse] = await Promise.all([
                axios.get(`${process.env.MANAGER_API_URL}/agent/device/${macAddress}/current-character`, { timeout: 5000 }),
                axios.post(
                  `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`,
                  { macAddress },
                  { timeout: 5000, headers: { 'secret': process.env.MANAGER_API_SECRET } }
                )
              ]);

              if (charResponse.data?.code === 0 && charResponse.data?.data?.characterName) {
                characterName = charResponse.data.data.characterName;
              }
              if (profileResponse.data?.code === 0 && profileResponse.data?.data) {
                childProfile = profileResponse.data.data;
              }
            } catch (fetchError) {
              logger.warn(`⚠️ [MODE-CHANGE] Fetch error: ${fetchError.message}`);
            }

            const agentName = CHARACTER_AGENT_MAP[characterName] || "cheeko-xai";
            logger.info(`🚀 [MODE-CHANGE] Dispatching: ${characterName} → ${agentName}`);

            newBridge.agentDeployed = true;

            await this.agentDispatchClient.createDispatch(newRoomName, agentName, {
              metadata: JSON.stringify({
                device_mac: deviceId,
                character: characterName,
                child_profile: childProfile,
                session_language_code: connection?.sessionConfig?.languageCode || null,
                session_language_name: connection?.sessionConfig?.languageName || null,
                session_voice_id: connection?.sessionConfig?.voiceId || null,
                session_agent_name: connection?.sessionConfig?.agentName || null,
                timestamp: Date.now(),
              }),
            });

            connection.currentCharacter = characterName;
            logger.info(`✅ [MODE-CHANGE] Agent ${agentName} dispatched to ${newRoomName}`);
          } catch (dispatchError) {
            newBridge.agentDeployed = false;
            logger.error(`❌ [MODE-CHANGE] Failed to dispatch agent: ${dispatchError.message}`);
          }
        } else {
          logger.error(`❌ [MODE-CHANGE] AgentDispatchClient not initialized`);
        }
      } else if (mode === "music") {
        // Start music bot - must call /start-music-bot to create bot first
        const apiUrl = `${MEDIA_API_BASE}/start-music-bot`;
        const macAddress = deviceId.replace(/:/g, "").toLowerCase();
        try {
          const response = await axios.post(
            apiUrl,
            {
              room_name: newRoomName,
              device_mac: macAddress,
              language: null,  // Use all languages
              playlist: null   // Auto-generate playlist
            },
            mediaAxiosConfig({ timeout: 10000 })
          );
          if (response.data?.status === "started" || response.data?.status === "already_active") {
            logger.info(`✅ [MODE-CHANGE] Music bot started for ${newRoomName}`);
          }
        } catch (error) {
          logger.error(`❌ [MODE-CHANGE] Failed to start music bot: ${error.message}`);
        }
      } else if (mode === "story") {
        // Start story bot - must call /start-story-bot to create bot first
        const apiUrl = `${MEDIA_API_BASE}/start-story-bot`;
        const macAddress = deviceId.replace(/:/g, "").toLowerCase();
        try {
          const response = await axios.post(
            apiUrl,
            {
              room_name: newRoomName,
              device_mac: macAddress,
              age_group: null,  // Use all age groups
              playlist: null    // Auto-generate playlist
            },
            mediaAxiosConfig({ timeout: 10000 })
          );
          if (response.data?.status === "started" || response.data?.status === "already_active") {
            logger.info(`✅ [MODE-CHANGE] Story bot started for ${newRoomName}`);
          }
        } catch (error) {
          logger.error(`❌ [MODE-CHANGE] Failed to start story bot: ${error.message}`);
        }
      }

      // Step 6: Send mode_update confirmation to device
      if (clientId) {
        const modeUpdateMsg = {
          type: "mode_update",
          mode: mode,
          session_id: newRoomName,
          previous_mode: previousMode,
          timestamp: Date.now(),
        };

        const responseTopic = `devices/p2p/${clientId}`;
        this.mqttPublish(responseTopic, modeUpdateMsg);
        logger.info(`📤 [MODE-CHANGE] Sent mode_update to device: ${mode}`);
      }

      logger.info(`✅ [MODE-CHANGE] Successfully switched device ${deviceId} to ${mode} mode`);

    } catch (error) {
      logger.error(`❌ [MODE-CHANGE] Error: ${error.message}`, { stack: error.stack });
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
          // Guard: Skip if agent already deployed (prevent duplicate dispatches)
          if (connection.bridge?.agentDeployed) {
            logger.info(`[START-AGENT] Agent already deployed, skipping duplicate dispatch`);
            return;
          }

          const agentCheck = await this.checkAgentInRoom(roomName);

          if (!agentCheck.exists) {
            if (!isModeSwitch) {
              // Fresh boot: dispatch agent now
              if (this.agentDispatchClient) {
                try {
                  // Fetch current character and child profile from database
                  const macAddress = deviceId.replace(/:/g, "").toLowerCase();
                  let characterName = "Cheeko";
                  let childProfile = null;

                  // Fetch character and child profile in parallel
                  logger.info(`[START-AGENT] Fetching character and child profile for device: ${deviceId}`);
                  try {
                    const [charResponse, profileResponse] = await Promise.all([
                      axios.get(`${process.env.MANAGER_API_URL}/agent/device/${macAddress}/current-character`, { timeout: 5000 }),
                      axios.post(
                        `${process.env.MANAGER_API_URL}/config/child-profile-by-mac`,
                        { macAddress },
                        { timeout: 5000, headers: { 'secret': process.env.MANAGER_API_SECRET } }
                      )
                    ]);

                    if (charResponse.data?.code === 0 && charResponse.data?.data?.characterName) {
                      characterName = charResponse.data.data.characterName;
                      logger.info(`[START-AGENT] ✅ Character from DB: "${characterName}"`);
                    }

                    if (profileResponse.data?.code === 0 && profileResponse.data?.data) {
                      childProfile = profileResponse.data.data;
                      logger.info(`[START-AGENT] ✅ Child profile: "${childProfile.name}", age: ${childProfile.age}`);
                    }
                  } catch (fetchError) {
                    logger.warn(`[START-AGENT] ⚠️ Fetch error: ${fetchError.message}`);
                  }

                  const agentName = CHARACTER_AGENT_MAP[characterName] || "cheeko-xai";
                  logger.info(`[START-AGENT] 🚀 Dispatching: Character "${characterName}" → Agent "${agentName}"`);

                  // CRITICAL: Set flag BEFORE dispatch to prevent race conditions
                  connection.bridge.agentDeployed = true;

                  const dispatch =
                    await this.agentDispatchClient.createDispatch(
                      roomName,
                      agentName,
                      {
                        metadata: JSON.stringify({
                          device_mac: connection.macAddress,
                          device_uuid: deviceId,
                          character: characterName,
                          child_profile: childProfile,
                          session_language_code: connection?.sessionConfig?.languageCode || null,
                          session_language_name: connection?.sessionConfig?.languageName || null,
                          session_voice_id: connection?.sessionConfig?.voiceId || null,
                          session_agent_name: connection?.sessionConfig?.agentName || null,
                          timestamp: Date.now(),
                        }),
                      }
                    );
                  connection.currentCharacter = characterName;
                  // Agent will greet via on_enter lifecycle hook
                } catch (dispatchError) {
                  // Reset flag on failure so retry can work
                  connection.bridge.agentDeployed = false;
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
          // Agent will greet user via on_enter lifecycle hook
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
   * Send shutdown signal to agent and wait for acknowledgment
   * @param {Room} room - LiveKit room instance
   * @param {string} sessionId - Session ID
   * @param {number} timeoutMs - Timeout in milliseconds (default: 3000)
   * @returns {Promise<boolean>} - True if acknowledged, false if timeout
   */
  async sendAgentShutdownWithAck(room, sessionId, timeoutMs = 3000) {
    return new Promise(async (resolve) => {
      let ackReceived = false;
      let timeoutId = null;
      let ackHandler = null;

      // Setup listener for acknowledgment
      ackHandler = (data_packet) => {
        try {
          const message = JSON.parse(Buffer.from(data_packet.data).toString('utf-8'));
          if (message.type === 'shutdown_ack' && message.session_id === sessionId) {
            ackReceived = true;
            if (timeoutId) clearTimeout(timeoutId);
            room.off('data_received', ackHandler);
            logger.info(`[CLEANUP] Received shutdown_ack from agent`);
            resolve(true);
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      room.on('data_received', ackHandler);

      // Send shutdown signal
      try {
        const shutdownMessage = {
          type: 'shutdown_request',
          session_id: sessionId,
          timestamp: Date.now(),
          source: 'mqtt_gateway',
          require_ack: true
        };

        const messageData = new Uint8Array(Buffer.from(JSON.stringify(shutdownMessage), 'utf8'));
        await room.localParticipant.publishData(messageData, { reliable: true });
        logger.info(`[CLEANUP] Sent shutdown_request, waiting for ack...`);
      } catch (e) {
        logger.warn(`[CLEANUP] Failed to send shutdown_request: ${e.message}`);
        room.off('data_received', ackHandler);
        resolve(false);
        return;
      }

      // Set timeout
      timeoutId = setTimeout(() => {
        if (!ackReceived) {
          logger.warn(`[CLEANUP] Shutdown ack timeout after ${timeoutMs}ms`);
          room.off('data_received', ackHandler);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  /**
   * Remove agent participant explicitly using LiveKit API
   * @param {string} roomName - Room name
   * @returns {Promise<boolean>} - True if removed, false otherwise
   */
  async removeAgentParticipant(roomName) {
    try {
      if (!this.roomService) {
        logger.warn(`[CLEANUP] RoomService not available`);
        return false;
      }

      const participants = await this.roomService.listParticipants(roomName);

      for (const participant of participants) {
        // Identify agent participants (identity contains 'agent')
        const identity = participant.identity || '';
        if (identity.toLowerCase().includes('agent') ||
          identity === "cheeko-xai" ||
          identity.startsWith('agent-')) {
          logger.info(`[CLEANUP] Removing agent participant: ${identity}`);
          try {
            await this.roomService.removeParticipant(roomName, identity);
            logger.info(`[CLEANUP] Successfully removed: ${identity}`);
          } catch (removeErr) {
            logger.warn(`[CLEANUP] Failed to remove ${identity}: ${removeErr.message}`);
          }
        }
      }

      return true;
    } catch (error) {
      logger.warn(`[CLEANUP] Error listing/removing agents: ${error.message}`);
      return false;
    }
  }

  /**
   * Verify room has no agents remaining
   * @param {string} roomName - Room name
   * @param {number} maxWaitMs - Max wait time (default: 2000)
   * @param {number} pollIntervalMs - Poll interval (default: 200)
   * @returns {Promise<boolean>} - True if room is agent-free
   */
  async verifyRoomAgentFree(roomName, maxWaitMs = 2000, pollIntervalMs = 200) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const agentCheck = await this.checkAgentInRoom(roomName);
        if (!agentCheck.exists) {
          logger.info(`[CLEANUP] Room ${roomName} is agent-free`);
          return true;
        }
        logger.info(`[CLEANUP] Agent still in room, waiting...`);
      } catch (error) {
        // Room might be deleted already, that's okay
        logger.info(`[CLEANUP] Room check error (may be deleted): ${error.message}`);
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    logger.warn(`[CLEANUP] Room ${roomName} still has agent after ${maxWaitMs}ms`);
    return false;
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

    const roomName = bridge.room?.name || bridge.roomName;
    const sessionId = connection.udp?.session_id;

    logger.info(`[CLEANUP] Starting robust cleanup for ${roomName} (reason: ${reason})`);

    // Step 1: Stop audio forwarding immediately
    bridge.stopAudioForwarding = true;
    if (typeof bridge.clearAudioBuffers === 'function') {
      bridge.clearAudioBuffers();
    }

    // Step 2: Send shutdown signal with acknowledgment (wait up to 3s)
    let shutdownAcked = false;
    if (bridge.room?.localParticipant && bridge.room.state === 'connected') {
      shutdownAcked = await this.sendAgentShutdownWithAck(bridge.room, sessionId, 3000);
      logger.info(`[CLEANUP] Shutdown ack result: ${shutdownAcked}`);
    }

    // Step 3: If no ack, forcefully remove agent via API
    if (!shutdownAcked && roomName) {
      logger.info(`[CLEANUP] No ack received, removing agent via API`);
      await this.removeAgentParticipant(roomName);
    }

    // Step 4: Verify room is agent-free (poll for up to 2s)
    if (roomName) {
      await this.verifyRoomAgentFree(roomName, 2000, 200);
    }

    // Step 5: Disconnect gateway from room
    if (bridge.room) {
      try {
        await bridge.room.disconnect();
        logger.info(`[CLEANUP] Disconnected from room: ${roomName}`);
      } catch (error) {
        logger.warn(`[CLEANUP] Disconnect error: ${error.message}`);
      }
    }

    // Step 6: Delete room from LiveKit server
    if (roomName && this.roomService) {
      try {
        await this.roomService.deleteRoom(roomName);
        logger.info(`[CLEANUP] Deleted room: ${roomName}`);
      } catch (error) {
        logger.warn(`[CLEANUP] Delete room error: ${error.message}`);
      }
    }

    // Step 7: Clear bridge reference
    connection.bridge = null;

    // Step 8: Cleanup worker-pool session codecs (if any) for this connection
    if (this.workerPool && sessionId && this.workerPool.cleanupSession) {
      this.workerPool.cleanupSession(sessionId);
    }

    logger.info(`[CLEANUP] Robust cleanup complete for ${roomName}`);
  }

  async handleDeviceCharacterChange(deviceId, payload) {
    try {
      const characterName =
        payload.characterName || payload.character_name || null;
      const macAddress = deviceId.replace(/:/g, "").toLowerCase();
      const crypto = require("crypto");

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
        logger.info(`[CHARACTER-CHANGE] Switching to: ${newModeName}`);

        // Step 1: Get agent name for the new character
        const agentName = CHARACTER_AGENT_MAP[newModeName] || "cheeko-xai";
        logger.info(`[CHARACTER-CHANGE] Dispatching agent: ${agentName}`);

        // Step 2: Get device connection
        const deviceInfo = this.deviceConnections.get(deviceId);
        const connection = deviceInfo?.connection;

        if (!connection) {
          logger.error(`[CHARACTER-CHANGE] No connection found for device: ${deviceId}`);
          return;
        }

        // Step 3: Robust cleanup of old room and agent
        await this.performRobustAgentCleanup(connection, 'character_change');

        // Step 4: Generate new room name
        const newSessionUuid = crypto.randomUUID();
        const macForRoom = deviceId.replace(/:/g, "");
        const newRoomName = `${newSessionUuid}_${macForRoom}_conversation`;

        // Step 4.5: Clean up ALL old sessions for this device (prevents ghost rooms)
        if (this.roomService) {
          try {
            await LiveKitBridge.cleanupOldSessionsForDevice(
              deviceId,
              this.roomService,
              newRoomName
            );
            logger.info(`[CHARACTER-CHANGE] Cleaned up old sessions for device`);
          } catch (err) {
            logger.warn(`[CHARACTER-CHANGE] Cleanup error (non-fatal): ${err.message}`);
          }
        }

        // Step 5: Create new room
        if (this.roomService) {
          try {
            await this.roomService.createRoom({
              name: newRoomName,
              emptyTimeout: 60,
              maxParticipants: 3,
            });
            logger.info(`[CHARACTER-CHANGE] Created new room: ${newRoomName}`);
          } catch (error) {
            logger.error(`[CHARACTER-CHANGE] Failed to create room: ${error.message}`);
            return;
          }
        }

        // Step 6: Update connection state
        connection.udp.session_id = newRoomName;
        connection.currentCharacter = newModeName;
        connection.isEnding = false;
        connection.endPromptSentTime = null;
        connection.goodbyeSent = false;
        connection.lastActivityTime = Date.now();

        // Step 7: Create new LiveKitBridge and connect (MUST be before dispatch)
        const newBridge = new LiveKitBridge(
          connection,
          connection.protocolVersion || 1,
          deviceId,
          newSessionUuid,
          connection.userData || {},
          this.workerPool  // Pass workerPool for audio encoding/decoding
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
        logger.info(`[CHARACTER-CHANGE] New bridge connected to room: ${newRoomName}`);

        // Step 8: Fetch child profile and dispatch named agent to the new room
        let childProfile = null;
        try {
          const macAddress = deviceId.replace(/:/g, "").toLowerCase();
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

        // Step 9: Dispatch agent to new room
        if (this.agentDispatchClient) {
          try {
            // CRITICAL: Set flag BEFORE dispatch to prevent race conditions
            newBridge.agentDeployed = true;

            await this.agentDispatchClient.createDispatch(newRoomName, agentName, {
              metadata: JSON.stringify({
                device_mac: deviceId,
                character: newModeName,
                child_profile: childProfile,
                session_language_code: connection?.sessionConfig?.languageCode || null,
                session_language_name: connection?.sessionConfig?.languageName || null,
                session_voice_id: connection?.sessionConfig?.voiceId || null,
                session_agent_name: connection?.sessionConfig?.agentName || null,
                timestamp: Date.now(),
              }),
            });
            logger.info(`[CHARACTER-CHANGE] Dispatched ${agentName} to ${newRoomName}`);
          } catch (error) {
            // Reset flag on failure so retry can work
            newBridge.agentDeployed = false;
            logger.error(`[CHARACTER-CHANGE] Failed to dispatch agent: ${error.message}`);
          }
        }

        // Step 9: Load and play audio feedback
        const fs = require("fs");
        const path = require("path");
        const audioMapPath = path.join(
          __dirname,
          "audio",
          "character_change",
          "audio_map.json"
        );

        if (fs.existsSync(audioMapPath)) {
          const audioMap = JSON.parse(fs.readFileSync(audioMapPath, "utf8"));
          const audioFileName = audioMap.modes[newModeName] || audioMap.default;
          const pcmFileName = audioFileName.replace(".opus", ".pcm");
          const audioFilePath = path.join(
            __dirname,
            "audio",
            "character_change",
            pcmFileName
          );

          if (fs.existsSync(audioFilePath)) {
            // Stream audio without sending goodbye (we're staying connected)
            await this.streamAudioViaUdp(deviceId, audioFilePath, newModeName, false);
          } else {
            logger.warn(`[CHARACTER-CHANGE] Audio file not found: ${audioFilePath}`);
          }
        }

        // Step 10: Send mode_update to device firmware
        const clientId = connection.clientId;
        if (clientId) {
          const modeUpdateMsg = {
            type: "mode_update",
            mode: "conversation",
            listening_mode: connection.deviceMode || "manual",
            character: newModeName,
            agent: agentName,
            session_id: newRoomName,
            timestamp: Date.now(),
            transport: "udp",
            udp: {
              server: this.publicIp,
              port: this.udpPort,
              encryption: connection.udp.encryption,
            },
          };
          const controlTopic = `devices/p2p/${clientId}`;
          this.mqttPublish(controlTopic, modeUpdateMsg);
          logger.info(`[CHARACTER-CHANGE] Sent mode_update to device (listening_mode: ${connection.deviceMode || "manual"})`);
        }

        logger.info(`[CHARACTER-CHANGE] Successfully switched to ${newModeName} (${agentName})`);
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
        const oldRoomName = existingConnection.bridge.room?.name;

        logger.info(`[MODE-CHANGE] Step 2: Old mode: ${oldMode}, Old room: ${oldRoomName}`);

        if ((oldMode === "music" || oldMode === "story") && oldRoomName) {
          try {
            logger.info(`[MODE-CHANGE] Stopping ${oldMode} bot for room: ${oldRoomName}`);
            const axios = require("axios");
            await axios.post(
              `${MEDIA_API_BASE}/stop-bot`,
              { room_name: oldRoomName },
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

      if (response.data.code === 0 && response.data.data) {
        const newMode = response.data.data.newMode || response.data.data.mode;
        const oldMode = response.data.data.oldMode || response.data.data.previousMode;
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

        // Clean up ALL old sessions for this device (prevents ghost rooms)
        if (this.roomService) {
          try {
            await LiveKitBridge.cleanupOldSessionsForDevice(
              deviceId,
              this.roomService,
              newRoomName
            );
            logger.info(`[MODE-CHANGE] Cleaned up old sessions for device`);
          } catch (err) {
            logger.warn(`[MODE-CHANGE] Cleanup error (non-fatal): ${err.message}`);
          }
        }

        connection.udp.session_id = newRoomName;
        connection.isEnding = false;
        connection.endPromptSentTime = null;
        connection.goodbyeSent = false;
        connection.lastActivityTime = Date.now();

        logger.info(`[MODE-CHANGE] Step 7: Creating new LiveKitBridge`);
        // Create new LiveKitBridge with workerPool
        const newBridge = new LiveKitBridge(
          connection,
          connection.protocolVersion || 1,
          deviceId,
          newSessionUuid,
          connection.userData || {},
          this.workerPool  // CRITICAL: Pass workerPool to prevent "Cannot read properties of undefined (reading 'initializeWorker')" error
        );
        connection.bridge = newBridge;

        newBridge.on("close", () => {
          connection.bridge = null;
        });

        logger.info(`[MODE-CHANGE] Step 8: Connecting to LiveKit room`);
        await newBridge.connect(
          connection.audio_params || { sample_rate: 24000, channels: 1 },
          connection.features || {},
          this.roomService
        );
        logger.info(`[MODE-CHANGE] ✅ Connected to LiveKit`);

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
        // Send mode_update to device firmware
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
        logger.info(`[MODE-CHANGE] Sent mode_update (listening_mode: ${connection.deviceMode || "manual"})`);

        // Handle mode-specific startup
        logger.info(`[MODE-CHANGE] Step 11: Starting ${newMode} mode`);
        if (newMode === "music") {
          await connection.spawnMusicBot(newRoomName);
        } else if (newMode === "story") {
          await connection.spawnStoryBot(newRoomName);
        } else if (newMode === "conversation") {
          if (this.agentDispatchClient) {
            try {
              // Use currentCharacter (already fetched above via connection.fetchCurrentCharacter)
              logger.info(`[MODE-CHANGE] Character from DB: "${currentCharacter || 'null'}"`);
              const agentName = CHARACTER_AGENT_MAP[currentCharacter] || "cheeko-xai";
              logger.info(`[MODE-CHANGE] 🚀 Dispatching: Character "${currentCharacter || 'Cheeko'}" → Agent "${agentName}"`)

              // CRITICAL: Set flag BEFORE dispatch to prevent race conditions
              newBridge.agentDeployed = true;

              await this.agentDispatchClient.createDispatch(
                newRoomName,
                agentName,
                {
                  metadata: JSON.stringify({
                    device_mac: connection.macAddress,
                    device_uuid: deviceId,
                    character: currentCharacter || "Cheeko",
                    child_profile: childProfile,
                    session_language_code: connection?.sessionConfig?.languageCode || null,
                    session_language_name: connection?.sessionConfig?.languageName || null,
                    session_voice_id: connection?.sessionConfig?.voiceId || null,
                    session_agent_name: connection?.sessionConfig?.agentName || null,
                    timestamp: Date.now(),
                  }),
                }
              );
              logger.info(`[MODE-CHANGE] ✅ Agent dispatched successfully`);
              // Agent will greet via on_enter lifecycle hook
            } catch (error) {
              // Reset flag on failure so retry can work
              newBridge.agentDeployed = false;
              logger.error(
                `❌ [MODE-CHANGE] Failed to dispatch agent:`,
                error.message
              );
              logger.error(`[MODE-CHANGE] Agent dispatch error stack:`, error.stack);
            }
          } else {
            logger.error(
              `❌ [MODE-CHANGE] AgentDispatchClient not initialized`
            );
          }
        }

        logger.info(`✅ [MODE-CHANGE] Complete: ${oldMode} → ${newMode}`);
      } else {
        logger.error(`❌ [MODE-CHANGE] API error - Code: ${response.data?.code}, Data: ${JSON.stringify(response.data?.data)}`);
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
      `📤 [MQTT-OUT] ${deviceInfo || topic} | topic: ${topic} | type: ${msgType}${msgState ? ` | state: ${msgState}` : ""
      }${sessionId ? ` | session: ${sessionId.substring(0, 20)}...` : ""}`
    );

    // Log full payload for debugging (truncate if too long)
    const payloadPreview =
      payloadStr.length > 500
        ? payloadStr.substring(0, 500) + "..."
        : payloadStr;
    const isDeviceTopic = topicParts[0] === "devices" && topicParts[1] === "p2p";
    const isSettingsSyncType = [
      "settings_get",
      "settings_update",
      "settings_ack",
      "settings_ping",
    ].includes(msgType);
    if (isDeviceTopic && isSettingsSyncType) {
      logger.info(
        `[SETTINGS-SYNC][GW-OUT][MQTT] topic=${topic} payload=${payloadPreview}`
      );
    }
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


