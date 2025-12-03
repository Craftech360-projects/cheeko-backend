/**
 * MQTT Gateway
 * 
 * Main orchestrator class that manages all device connections.
 * Handles EMQX broker, UDP server, LiveKit rooms, and agent dispatch.
 */

const dgram = require('dgram');
const mqtt = require('mqtt');
const axios = require('axios');
const { RoomServiceClient, AgentDispatchClient } = require('livekit-server-sdk');
const { VirtualMQTTConnection, setConfigManager: setVirtualConnectionConfigManager } = require('../mqtt/virtual-connection');
const { ConfigManager } = require('../utils/config-manager');
const { LiveKitBridge, setConfigManager: setLivekitConfigManager } = require('../livekit/livekit-bridge');
const { MEDIA_API_BASE, mediaAxiosConfig } = require('../core/media-api-client');
const logger = require('../utils/logger');

// Global config manager and debug reference (injected by app.js)
let configManager = null;
let debug = null;

function setConfigManager(cm) {
  configManager = cm;
  // Setup debug logger
  const debugModule = require('debug');
  debug = debugModule('mqtt-server');
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
      const livekitConfig = configManager.get("livekit");
      if (
        livekitConfig &&
        livekitConfig.url &&
        livekitConfig.api_key &&
        livekitConfig.api_secret
      ) {
        this.roomService = new RoomServiceClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        logger.info(
          "✅ [INIT] RoomServiceClient initialized for session cleanup"
        );

        // Initialize AgentDispatchClient for explicit agent dispatch
        this.agentDispatchClient = new AgentDispatchClient(
          livekitConfig.url,
          livekitConfig.api_key,
          livekitConfig.api_secret
        );
        logger.info(
          "✅ [INIT] AgentDispatchClient initialized for explicit agent dispatch"
        );
      } else {
        logger.warn(
          "⚠️ [INIT] LiveKit config incomplete, room cleanup will be skipped"
        );
        this.roomService = null;
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
    const brokerConfig = configManager.get("mqtt_broker");
    if (!brokerConfig) {
      logger.error("MQTT broker configuration not found in config");
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
        if (err) {
          logger.error("Failed to subscribe to device hello topic:", err);
        } else {
          logger.info("📡 Subscribed to devices/+/hello");
        }
      });
      this.mqttClient.subscribe("devices/+/data", (err) => {
        if (err) {
          logger.error("Failed to subscribe to device data topic:", err);
        } else {
          logger.info("📡 Subscribed to devices/+/data");
        }
      });
      // Subscribe to the internal topic where EMQX republishes with client info
      this.mqttClient.subscribe("internal/server-ingest", (err) => {
        if (err) {
          logger.error(
            "Failed to subscribe to internal/server-ingest topic:",
            err
          );
        } else {
          logger.info("📡 Subscribed to internal/server-ingest");
        }
      });
    });

    this.mqttClient.on("error", (err) => {
      logger.error("MQTT connection error:", err);
    });

    this.mqttClient.on("offline", () => {
      logger.warn("MQTT client went offline");
    });

    this.mqttClient.on("reconnect", () => {
      logger.info("MQTT client reconnecting...");
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

      logger.info(
        `📨 [MQTT IN] Parsed payload:`,
        JSON.stringify(payload, null, 2)
      );

      if (topic === "internal/server-ingest") {
        // Handle messages republished by EMQX with client ID info

        // Extract client ID and original payload from EMQX republish rule
        const clientId = payload.sender_client_id;
        const originalPayload = payload.orginal_payload;

        logger.info(
          `🔍 [DEBUG] Received message - Topic: ${topic}, ClientId: ${clientId}`
        );

        if (!clientId || !originalPayload) {
          logger.error(
            `❌ [MQTT IN] Invalid republished message format - missing clientId or originalPayload`
          );
          return;
        }

        logger.info(
          `📨 [MQTT IN] Original payload:`,
          JSON.stringify(originalPayload, null, 2)
        );

        // Extract device MAC from client ID
        let deviceId = "unknown-device";
        const parts = clientId.split("@@@");
        if (parts.length >= 2) {
          deviceId = parts[1].replace(/_/g, ":"); // Convert MAC format
        }

        logger.info(
          `📨 [MQTT IN] Device message from internal/server-ingest - Device: ${deviceId}, Message type: ${originalPayload.type}`
        );

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
          logger.info(
            `⏭️ [PLAYBACK-CONTROL] Next action received from topic: ${topic}`
          );
          await this.handleNextControl(topic, clientId);
          return;
        } else if (
          originalPayload.type === "playback_control" &&
          originalPayload.action === "previous"
        ) {
          logger.info(
            `⏮️ [PLAYBACK-CONTROL] Previous action received from topic: ${topic}`
          );
          await this.handlePreviousControl(topic, clientId);
          return;
        } else if (
          originalPayload.type === "playback_control" &&
          originalPayload.action === "start_agent"
        ) {
          logger.info(
            `▶️ [PLAYBACK-CONTROL] Start agent action received from topic: ${topic}`
          );
          await this.handleStartAgentControl(deviceId, originalPayload, clientId);
          return;
        }

        // Handle specific content playback requests (play_music / play_story)
        if (originalPayload.type === "function_call") {
          const functionName = originalPayload.function_call?.name;

          if (functionName === "play_music") {
            logger.info(
              `🎵 [SPECIFIC-MUSIC] Music request from ${deviceId}`
            );
            await this.handleSpecificMusicRequest(deviceId, originalPayload, clientId);
            return;
          } else if (functionName === "play_story") {
            logger.info(
              `📖 [SPECIFIC-STORY] Story request from ${deviceId}`
            );
            await this.handleSpecificStoryRequest(deviceId, originalPayload, clientId);
            return;
          }
        }

        // Handle MCP responses - check for pending promises first, then forward to LiveKit agent
        if (
          originalPayload.type === "mcp" &&
          originalPayload.payload &&
          (originalPayload.payload.result || originalPayload.payload.error)
        ) {
          logger.info(
            `🔋 [MCP-RESPONSE] Processing MCP response from device ${deviceId}`
          );

          // Find the device connection
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection) {
            const mcpRequestId = originalPayload.payload.id;

            // Check if there's a pending promise for this request (volume adjust logic)
            // Note: pendingMcpRequests is on the bridge (LiveKitBridge), not the connection
            const bridge = deviceInfo.connection.bridge;
            if (bridge && bridge.pendingMcpRequests) {
              const pendingRequest = bridge.pendingMcpRequests.get(mcpRequestId);
              if (pendingRequest) {
                logger.info(
                  `✅ [MCP-RESPONSE] Resolving pending MCP request ID: ${mcpRequestId}`
                );

                // Resolve or reject the promise
                if (originalPayload.payload.error) {
                  const errorMsg = originalPayload.payload.error.message || 'Unknown MCP error';
                  pendingRequest.reject(new Error(errorMsg));
                } else {
                  // Extract the actual result from MCP response format
                  const result = originalPayload.payload.result;
                  let actualResult = result;

                  // If result has content array with text field, extract it
                  if (result && result.content && Array.isArray(result.content) && result.content.length > 0) {
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
          } else {
            logger.warn(
              `⚠️ [MCP-RESPONSE] No connection found for device ${deviceId}, cannot forward response`
            );
          }
        }

        if (originalPayload.type === "hello") {
          logger.info(
            `👋 [HELLO] Processing hello message from internal/server-ingest: ${deviceId}`
          );
          this.handleDeviceHello(deviceId, enhancedPayload);
        } else if (originalPayload.type === "character-change") {
          logger.info(
            `🔘 [CHARACTER-CHANGE] Processing character change from internal/server-ingest: ${deviceId}`
          );
          this.handleDeviceCharacterChange(deviceId, enhancedPayload);
        } else if (originalPayload.type === "mode-change") {
          logger.info(
            `🔄 [MODE-CHANGE] Processing mode change from internal/server-ingest: ${deviceId}`
          );
          this.handleDeviceModeChange(deviceId, enhancedPayload);
        } else if (originalPayload.type === "abort") {
          // Special handling for abort messages - send to virtual device
          logger.info(
            `🛑 [ABORT] Processing abort message from internal/server-ingest: ${deviceId}`
          );

          // Send abort to virtual device connection
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection) {
            logger.info(
              `🛑 [ABORT] Routing abort to virtual device: ${deviceId}`
            );
            deviceInfo.connection.handlePublish({
              payload: JSON.stringify(originalPayload),
            });
          } else {
            logger.info(
              `⚠️ [ABORT] No connection found for device: ${deviceId}, abort cannot be processed`
            );
          }
        } else if (originalPayload.type === "start_greeting") {
          // Special handling for start_greeting - CREATE ROOM and deploy agent, then trigger greeting
          logger.info(
            `👋 [START-GREETING] Processing start_greeting from internal/server-ingest: ${deviceId}`
          );

          let greetingSent = false;

          // Check for virtual device connection
          const deviceInfo = this.deviceConnections.get(deviceId);
          if (deviceInfo && deviceInfo.connection) {
            const connection = deviceInfo.connection;

            // Room should already exist from parseHelloMessage, explicitly dispatch agent
            if (connection.bridge) {
              logger.info(
                `👋 [START-GREETING] Room exists, explicitly dispatching agent...`
              );

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
                logger.info(
                  `ℹ️ [AGENT-DISPATCH] Skipping agent dispatch for ${connection.roomType} room`
                );

                // For music/story rooms, send TTS start message to trigger UDP connection
                logger.info(
                  `🎵 [${connection.roomType.toUpperCase()}] Sending TTS start message to establish UDP connection`
                );

                connection.sendMqttMessage(
                  JSON.stringify({
                    type: "tts",
                    state: "start",
                    session_id: connection.udp.session_id,
                  })
                );

                logger.info(
                  `✅ [${connection.roomType.toUpperCase()}] TTS start sent, device should now send UDP packet`
                );
                return; // Don't dispatch agent for music/story rooms
              }

              // For conversation mode, skip sending greeting here
              // The start_agent handler already sends it with the correct is_mode_switch flag
              logger.info(
                `ℹ️ [START-GREETING] Skipping duplicate greeting for conversation mode (handled by start_agent)`
              );
              return;

              // FIRST: Check LiveKit API for actual agent presence (most reliable)
              const agentCheck = await this.checkAgentInRoom(roomName);

              if (agentCheck.exists) {
                logger.info(
                  `✅ [START-GREETING] Agent already in room (verified via LiveKit API): ${agentCheck.identity}`
                );
                // Sync local flags with actual state
                bridge.agentJoined = true;
                bridge.agentDeployed = true;
              } else if (bridge.agentJoined) {
                // Local flag says joined but API says not - trust API, reset flags
                logger.info(
                  `⚠️ [START-GREETING] Local flag says agent joined, but not found in room - resetting flags`
                );
                bridge.agentJoined = false;
                bridge.agentDeployed = false;
              }

              // Now check flags and dispatch if needed
              if (bridge.agentJoined) {
                logger.info(
                  `✅ [START-GREETING] Agent already joined, skipping dispatch`
                );
              } else if (bridge.agentDeployed) {
                logger.info(
                  `⏳ [START-GREETING] Agent already being deployed, waiting for it to join...`
                );
              } else {
                // Explicitly dispatch agent using AgentDispatchClient
                logger.info(
                  `🤖 [AGENT-DISPATCH] Dispatching AI agent for conversation room...`
                );
                if (this.agentDispatchClient) {
                  bridge.agentDeployed = true; // Mark as deployed immediately to prevent duplicates
                  this.agentDispatchClient
                    .createDispatch(roomName, "cheeko-agent", {
                      metadata: JSON.stringify({
                        device_mac: connection.macAddress,
                        device_uuid: deviceId,
                        timestamp: Date.now(),
                      }),
                    })
                    .then((dispatch) => {
                      logger.info(
                        `✅ [START-GREETING] Agent dispatch created:`,
                        dispatch.id
                      );
                      logger.info(
                        `📤 [START-GREETING] Agent 'cheeko-agent' dispatched to room: ${roomName}`
                      );
                    })
                    .catch((error) => {
                      logger.error(
                        `❌ [START-GREETING] Failed to dispatch agent:`,
                        error.message
                      );
                      bridge.agentDeployed = false; // Reset on failure
                    });
                } else {
                  logger.warn(
                    `⚠️ [START-GREETING] AgentDispatchClient not initialized, agent may not join`
                  );
                }
              }

              // Wait for agent to join the room
              bridge
                .waitForAgentJoin(4000)
                .then((agentReady) => {
                  const waitTime = Date.now() - startTime;
                  logger.info(
                    `⏱️ [START-GREETING] Agent join wait took ${waitTime}ms`
                  );

                  if (agentReady) {
                    logger.info(
                      `✅ [START-GREETING] Agent ready, sending initial greeting...`
                    );
                    // Mark agent as deployed
                    bridge.agentDeployed = true;
                    return bridge.sendInitialGreeting();
                  } else {
                    logger.warn(
                      `⚠️ [START-GREETING] Agent join timeout, trying to send greeting anyway...`
                    );
                    bridge.agentDeployed = true;
                    return bridge.sendInitialGreeting();
                  }
                })
                .then(() => {
                  logger.info(
                    `✅ [START-GREETING] Successfully triggered initial greeting for device: ${deviceId}`
                  );
                })
                .catch((error) => {
                  logger.error(
                    `❌ [START-GREETING] Error triggering greeting for ${deviceId}:`,
                    error
                  );
                });

              greetingSent = true;
            } else {
              logger.error(
                `❌ [START-GREETING] No bridge found for device ${deviceId} - room should have been created during hello!`
              );
              logger.info(
                `⚠️ [START-GREETING] This shouldn't happen. Client may need to reconnect.`
              );
            }
          }

          if (!greetingSent) {
            logger.info(
              `⚠️ [START-GREETING] No bridge found for device: ${deviceId}, greeting cannot be triggered`
            );
            logger.info(
              `⚠️ [START-GREETING] DeviceInfo exists: ${!!deviceInfo}, Connection exists: ${!!(
                deviceInfo && deviceInfo.connection
              )}, Bridge exists: ${!!(
                deviceInfo &&
                deviceInfo.connection &&
                deviceInfo.connection.bridge
              )}`
            );
          }
        } else {
          // Route to virtual device connection
          const deviceInfo = this.deviceConnections.get(deviceId);

          if (deviceInfo && deviceInfo.connection) {
            logger.info(
              `📊 [DATA] Routing to virtual device connection: ${deviceId}`
            );

            // Send success message to mobile app
            const successMessage = {
              type: "device_status",
              status: "connected",
              message: "song is playing",
              deviceId: deviceId,
              timestamp: Date.now(),
            };

            // Publish to app/p2p/{macAddress}
            const appTopic = `app/p2p/${deviceId}`;
            logger.info(
              `✅ [MOBILE-RESPONSE] Sending device connected status to ${appTopic}`
            );

            if (this.mqttClient && this.mqttClient.connected) {
              this.mqttClient.publish(
                appTopic,
                JSON.stringify(successMessage),
                (err) => {
                  if (err) {
                    logger.error(
                      `❌ [MOBILE-RESPONSE] Failed to send success to mobile app:`,
                      err
                    );
                  } else {
                    logger.info(
                      `✅ [MOBILE-RESPONSE] Device connected status sent to mobile app`
                    );
                  }
                }
              );
            }

            this.handleDeviceData(deviceId, enhancedPayload);
          } else {
            logger.info(
              `⚠️ [DATA] No connection found for device: ${deviceId}, message type: ${originalPayload.type}`
            );

            // Send device not connected message to mobile app
            const errorMessage = {
              type: "device_status",
              status: "not_connected",
              message: "Device is not connected",
              deviceId: deviceId,
              timestamp: Date.now(),
            };

            // Publish to app/p2p/{macAddress}
            const appTopic = `app/p2p/${deviceId}`;
            logger.info(
              `❌ [MOBILE-RESPONSE] Sending device not connected status to ${appTopic}`
            );

            if (this.mqttClient && this.mqttClient.connected) {
              this.mqttClient.publish(
                appTopic,
                JSON.stringify(errorMessage),
                (err) => {
                  if (err) {
                    logger.error(
                      `❌ [MOBILE-RESPONSE] Failed to send error to mobile app:`,
                      err
                    );
                  } else {
                    logger.info(
                      `✅ [MOBILE-RESPONSE] Device not connected status sent to mobile app`
                    );
                  }
                }
              );
            }
          }
        }
      } else if (topicParts.length >= 3 && topicParts[0] === "devices") {
        const deviceId = topicParts[1];
        const messageType = topicParts[2];

        logger.info(
          `📨 [MQTT IN] Device message - Device: ${deviceId}, Type: ${messageType}`
        );
        debug(
          `📨 Received MQTT message from device ${deviceId}: ${messageType}`
        );

        if (messageType === "hello") {
          logger.info(
            `👋 [HELLO] Processing hello message from device: ${deviceId}`
          );
          this.handleDeviceHello(deviceId, payload);
        } else if (messageType === "data") {
          logger.info(
            `📊 [DATA] Processing data message from device: ${deviceId}`
          );
          this.handleDeviceData(deviceId, payload);
        } else {
          logger.info(
            `❓ [UNKNOWN] Unknown message type '${messageType}' from device: ${deviceId}`
          );
        }
      } else {
        logger.info(
          `❓ [MQTT IN] Message on unexpected topic format: ${topic}`
        );
      }
    } catch (error) {
      logger.error("❌ [MQTT IN] Error processing MQTT message:", error);
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
        logger.warn(`⚠️ [AGENT-CHECK] RoomService not available, cannot check participants`);
        return { exists: false, identity: null };
      }


      const participants = await this.roomService.listParticipants(roomName);


      for (const participant of participants) {
        logger.info(`   - Participant: ${participant.identity} (state: ${participant.state})`);

        // Check if this participant is an agent (identity contains 'agent' or is 'cheeko-agent')
        if (participant.identity &&
          (participant.identity.toLowerCase().includes('agent') ||
            participant.identity === 'cheeko-agent')) {
          logger.info(`✅ [AGENT-CHECK] Found existing agent: ${participant.identity}`);
          return { exists: true, identity: participant.identity };
        }
      }

      return { exists: false, identity: null };

    } catch (error) {
      logger.error(`❌ [AGENT-CHECK] Error checking room participants:`, error.message);
      // On error, return false to allow dispatch attempt (fail-safe)
      return { exists: false, identity: null };
    }
  }

  setupControlTopics(macAddress) {
    // Subscribe to control topics for next/previous
    const nextTopic = `cheeko/${macAddress}/playback_control/next`;
    const previousTopic = `cheeko/${macAddress}/playback_control/previous`;

    this.mqttClient.subscribe(nextTopic, (err) => {
      if (!err) {
        logger.info(`✅ [CONTROL] Subscribed to: ${nextTopic}`);
      } else {
        logger.error(`❌ [CONTROL] Failed to subscribe to ${nextTopic}:`, err);
      }
    });

    this.mqttClient.subscribe(previousTopic, (err) => {
      if (!err) {
        logger.info(`✅ [CONTROL] Subscribed to: ${previousTopic}`);
      } else {
        logger.error(
          `❌ [CONTROL] Failed to subscribe to ${previousTopic}:`,
          err
        );
      }
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
    logger.info(
      `🔍 [CONTROL] Available devices:`,
      Array.from(this.deviceConnections.keys())
    );

    // Find device info
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo) {
      logger.warn(`⚠️ [CONTROL] Device not found: ${macAddress}`);
      logger.warn(
        `⚠️ [CONTROL] Available devices:`,
        Array.from(this.deviceConnections.keys())
      );
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

    let apiUrl = null; // Declare outside try block to ensure scope accessibility

    try {
      if (mode === "music") {
        apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/next`;
      } else if (mode === "story") {
        apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/next`;
      } else {
        logger.warn(
          `⚠️ [CONTROL] Next/Previous not supported for mode: ${mode}. Device is in '${mode}' mode, but controls only work for 'music' or 'story' modes.`
        );
        logger.warn(
          `💡 [CONTROL] To use playback controls, the device needs to be in music or story mode, not conversation mode.`
        );
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

        this.mqttClient.publish(
          controlTopic,
          JSON.stringify(ttsStopMsg),
          (err) => {
            if (err) {
              logger.error(`❌ [CONTROL] Failed to send TTS stop:`, err);
            } else {
              logger.info(
                `🛑 [CONTROL] TTS stop sent to ${macAddress} before skip`
              );
            }
          }
        );
      }

      logger.info(`⏭️ [CONTROL] Sending next skip request to: ${apiUrl}`);
      const response = await axios.post(apiUrl, {}, mediaAxiosConfig({ timeout: 5000 }));

      logger.info(`✅ [CONTROL] Next skip successful:`, response.data);
      logger.info(`✅ [CONTROL] Response status:`, response.status);

      // Log current status for debugging
      if (response.data && response.data.current_status) {
        const status = response.data.current_status;
        logger.info(`🎵 [CONTROL] Current playback status after next skip:`, {
          mode: status.mode,
          current_index: status.current_index,
          playlist_length: status.playlist_length,
          current_song: status.current_song || status.current_story
        });
      }

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

        this.mqttClient.publish(
          controlTopic,
          JSON.stringify(ttsStartMsg),
          (err) => {
            if (err) {
              logger.error(
                `❌ [CONTROL] Failed to send skip TTS notification:`,
                err
              );
            } else {
              logger.info(
                `🎵 [CONTROL] Skip TTS notification sent to ${macAddress}`
              );
            }
          }
        );
      } else {
        logger.warn(
          `⚠️ [CONTROL] No clientId available, cannot send TTS notification`
        );
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to next:`, error.message);

      // Log additional error details for debugging
      if (error.response) {
        logger.error(`❌ [CONTROL] API Response Error:`, {
          status: error.response.status,
          data: error.response.data,
          url: apiUrl || 'URL not set'
        });
      } else if (error.request) {
        logger.error(`❌ [CONTROL] Network Error - No response received from:`, apiUrl || 'URL not set');
      } else {
        logger.error(`❌ [CONTROL] Request Setup Error:`, error.message);
      }

      // Send error notification to device if possible
      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Skip failed, please try again",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };

        this.mqttClient.publish(errorTopic, JSON.stringify(errorMsg), (err) => {
          if (!err) {
            logger.info(`📤 [CONTROL] Error notification sent to ${macAddress}`);
          }
        });
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
    logger.info(
      `🔍 [CONTROL] Available devices:`,
      Array.from(this.deviceConnections.keys())
    );

    // Find device info
    const deviceInfo = this.deviceConnections.get(macAddress);
    if (!deviceInfo) {
      logger.warn(`⚠️ [CONTROL] Device not found: ${macAddress}`);
      logger.warn(
        `⚠️ [CONTROL] Available devices:`,
        Array.from(this.deviceConnections.keys())
      );
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

    let apiUrl = null; // Declare outside try block to ensure scope accessibility

    try {
      if (mode === "music") {
        apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/previous`;
      } else if (mode === "story") {
        apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/previous`;
      } else {
        logger.warn(
          `⚠️ [CONTROL] Next/Previous not supported for mode: ${mode}. Device is in '${mode}' mode, but controls only work for 'music' or 'story' modes.`
        );
        logger.warn(
          `💡 [CONTROL] To use playback controls, the device needs to be in music or story mode, not conversation mode.`
        );
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

        this.mqttClient.publish(
          controlTopic,
          JSON.stringify(ttsStopMsg),
          (err) => {
            if (err) {
              logger.error(`❌ [CONTROL] Failed to send TTS stop:`, err);
            } else {
              logger.info(
                `🛑 [CONTROL] TTS stop sent to ${macAddress} before previous`
              );
            }
          }
        );
      }

      logger.info(`⏮️ [CONTROL] Sending previous skip request to: ${apiUrl}`);
      const response = await axios.post(apiUrl, {}, mediaAxiosConfig());

      logger.info(`✅ [CONTROL] Previous skip successful:`, response.data);
      logger.info(`✅ [CONTROL] Response status:`, response.status);

      // Log current status for debugging
      if (response.data && response.data.current_status) {
        const status = response.data.current_status;
        logger.info(`🎵 [CONTROL] Current playback status after previous skip:`, {
          mode: status.mode,
          current_index: status.current_index,
          playlist_length: status.playlist_length,
          current_song: status.current_song || status.current_story
        });
      }

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

        this.mqttClient.publish(
          controlTopic,
          JSON.stringify(ttsStartMsg),
          (err) => {
            if (err) {
              logger.error(
                `❌ [CONTROL] Failed to send previous TTS notification:`,
                err
              );
            } else {
              logger.info(
                `🎵 [CONTROL] Previous TTS notification sent to ${macAddress}`
              );
            }
          }
        );
      } else {
        logger.warn(
          `⚠️ [CONTROL] No clientId available, cannot send TTS notification`
        );
      }
    } catch (error) {
      logger.error(`❌ [CONTROL] Failed to skip to previous:`, error.message);

      // Log additional error details for debugging
      if (error.response) {
        logger.error(`❌ [CONTROL] API Response Error:`, {
          status: error.response.status,
          data: error.response.data,
          url: apiUrl || 'URL not set'
        });
      } else if (error.request) {
        logger.error(`❌ [CONTROL] Network Error - No response received from:`, apiUrl || 'URL not set');
      } else {
        logger.error(`❌ [CONTROL] Request Setup Error:`, error.message);
      }

      // Send error notification to device if possible
      if (clientId) {
        const errorTopic = `devices/p2p/${clientId}`;
        const errorMsg = {
          type: "tts",
          state: "start",
          text: "Previous skip failed, please try again",
          session_id: deviceInfo.connection?.udp?.session_id || null,
        };

        this.mqttClient.publish(errorTopic, JSON.stringify(errorMsg), (err) => {
          if (!err) {
            logger.info(`📤 [CONTROL] Error notification sent to ${macAddress}`);
          }
        });
      }
    }


  }

  async handleStartAgentControl(deviceId, payload, clientId = null) {
    try {
      // Extract session_id which contains room info: uuid_mac_mode
      const sessionId = payload.session_id;
      if (!sessionId) {
        logger.warn(`⚠️ [START-AGENT] No session_id in payload`);
        return;
      }

      // Parse session_id to get room type (format: uuid_mac_mode)
      const parts = sessionId.split('_');
      if (parts.length < 3) {
        logger.warn(`⚠️ [START-AGENT] Invalid session_id format: ${sessionId}`);
        return;
      }

      const roomType = parts[parts.length - 1]; // Last part is the mode (music/story/conversation)
      const roomName = sessionId; // The full session_id is the room name

      logger.info(`▶️ [START-AGENT] Processing start_agent for mode: ${roomType}, room: ${roomName}`);

      // Find device info
      const deviceInfo = this.deviceConnections.get(deviceId);
      if (!deviceInfo) {
        logger.warn(`⚠️ [START-AGENT] Device not found: ${deviceId}`);
        return;
      }

      // Detect if this is a mode switch or fresh boot
      // Use previousMode if available (set during mode change), otherwise use currentMode
      const previousMode = deviceInfo.previousMode || deviceInfo.currentMode || null;
      const isModeSwitch = previousMode !== null && previousMode !== roomType;


      // Clear previousMode after detection to avoid false positives
      if (deviceInfo.previousMode) {
        delete deviceInfo.previousMode;
      }


      if (roomType === "music") {
        // Call Media API to start music playback
        const apiUrl = `${MEDIA_API_BASE}/music-bot/${roomName}/start`;
        logger.info(`🎵 [START-AGENT] Starting music bot playback: ${apiUrl}`);

        try {
          const response = await axios.post(
            apiUrl,
            { is_mode_switch: isModeSwitch },  // Pass mode switch flag
            mediaAxiosConfig({ timeout: 5000 })
          );
          logger.info(`✅ [START-AGENT] Music bot started:`, response.data);

          // Only send TTS start when bot actually starts playing (mode switch)
          // On fresh boot, bot returns "ready" and waits for next/previous button press
          if (response.data && response.data.status === "started") {
            logger.info(`📤 [START-AGENT] Bot started playing, sending TTS start to firmware...`);
            const connection = deviceInfo.connection;
            if (connection) {
              connection.sendMqttMessage(
                JSON.stringify({
                  type: "tts",
                  state: "start",
                  session_id: roomName,
                })
              );
              logger.info(`✅ [START-AGENT] TTS start sent to firmware`);
            } else {
              logger.error(`❌ [START-AGENT] No connection found to send TTS start`);
            }
          } else {
            logger.info(`ℹ️ [START-AGENT] Bot is ready but not playing yet (fresh boot - waiting for user interaction)`);
          }
        } catch (error) {
          logger.error(`❌ [START-AGENT] Failed to start music bot:`, error.message);
          if (error.response) {
            logger.error(`❌ [START-AGENT] API Response:`, error.response.status, error.response.data);
          }
        }

      } else if (roomType === "story") {
        // Call Media API to start story playback
        const apiUrl = `${MEDIA_API_BASE}/story-bot/${roomName}/start`;
        logger.info(`📖 [START-AGENT] Starting story bot playback: ${apiUrl}`);

        try {
          const response = await axios.post(
            apiUrl,
            { is_mode_switch: isModeSwitch },  // Pass mode switch flag
            mediaAxiosConfig({ timeout: 5000 })
          );
          logger.info(`✅ [START-AGENT] Story bot started:`, response.data);

          // Only send TTS start when bot actually starts playing (mode switch)
          // On fresh boot, bot returns "ready" and waits for next/previous button press
          if (response.data && response.data.status === "started") {
            logger.info(`📤 [START-AGENT] Bot started playing, sending TTS start to firmware...`);
            const connection = deviceInfo.connection;
            if (connection) {
              connection.sendMqttMessage(
                JSON.stringify({
                  type: "tts",
                  state: "start",
                  session_id: roomName,
                })
              );
              logger.info(`✅ [START-AGENT] TTS start sent to firmware`);
            } else {
              logger.error(`❌ [START-AGENT] No connection found to send TTS start`);
            }
          } else {
            logger.info(`ℹ️ [START-AGENT] Bot is ready but not playing yet (fresh boot - waiting for user interaction)`);
          }
        } catch (error) {
          logger.error(`❌ [START-AGENT] Failed to start story bot:`, error.message);
          if (error.response) {
            logger.error(`❌ [START-AGENT] API Response:`, error.response.status, error.response.data);
          }
        }

      } else if (roomType === "conversation") {
        // Handle conversation mode - dispatch agent if needed, then trigger greeting
        logger.info(`💬 [START-AGENT] Triggering agent greeting for conversation mode`);

        const connection = deviceInfo.connection;
        if (connection && connection.bridge && connection.bridge.room && connection.bridge.room.localParticipant) {

          // Step 1: Check if agent is already in the room
          const agentCheck = await this.checkAgentInRoom(roomName);

          if (!agentCheck.exists) {
            // Agent not in room yet
            if (isModeSwitch) {
              // Mode switch: agent was already dispatched by handleDeviceModeChange()
              // Just wait for it to join, don't dispatch again
              logger.info(`⏳ [START-AGENT] Mode switch - agent already dispatched, waiting for it to join...`);
            } else {
              // Fresh boot: need to dispatch agent now
              logger.info(`🚀 [START-AGENT] Fresh boot - dispatching agent now...`);

              if (this.agentDispatchClient) {
                try {
                  const dispatch = await this.agentDispatchClient.createDispatch(
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
                  logger.info(`✅ [START-AGENT] Agent dispatched successfully: ${dispatch.id}`);

                  // Mark bridge as having agent deployed
                  connection.bridge.agentDeployed = true;

                } catch (dispatchError) {
                  logger.error(`❌ [START-AGENT] Failed to dispatch agent:`, dispatchError.message);
                  // Send error to device
                  connection.sendMqttMessage(JSON.stringify({
                    type: "error",
                    code: "AGENT_DISPATCH_FAILED",
                    message: "Failed to start conversation agent",
                    timestamp: Date.now()
                  }));
                  return;
                }
              } else {
                logger.error(`❌ [START-AGENT] AgentDispatchClient not initialized`);
                return;
              }
            }
          } else {
            logger.info(`✅ [START-AGENT] Agent already in room: ${agentCheck.identity}`);
            connection.bridge.agentJoined = true;
            connection.bridge.agentDeployed = true;
          }

          // Step 3: Wait for agent to join the room (if just dispatched, wait for it to connect)
          logger.info(`⏳ [START-AGENT] Waiting for agent to be ready...`);

          // Wait for agent join with timeout
          const maxWaitTime = 10000; // 10 seconds max
          const startTime = Date.now();

          while (Date.now() - startTime < maxWaitTime) {
            const check = await this.checkAgentInRoom(roomName);
            if (check.exists) {
              logger.info(`✅ [START-AGENT] Agent is ready in room`);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms
          }

          // Step 4: Send greeting trigger to agent
          logger.info(`✅ [START-AGENT] Sending greeting message to agent`);

          const greetingMessage = {
            type: "start_greeting",
            session_id: sessionId,
            is_mode_switch: isModeSwitch,  // Pass mode switch flag to agent
            timestamp: Date.now()
          };
          const messageString = JSON.stringify(greetingMessage);
          const messageData = new TextEncoder().encode(messageString);

          await connection.bridge.room.localParticipant.publishData(messageData, {
            reliable: true
          });

          logger.info(`✅ [START-AGENT] Greeting trigger sent to LiveKit agent (is_mode_switch: ${isModeSwitch})`);
        } else {
          logger.error(`❌ [START-AGENT] No active LiveKit room for device: ${deviceId}`);
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
      const language = payload.function_call.arguments.language;
      const loopEnabled = payload.function_call.arguments.loop_enabled || false;

      logger.info(`🎵 [SPECIFIC-MUSIC] Request for device: ${macAddress}`);
      logger.info(`🎵 [SPECIFIC-MUSIC] Song: "${songName}", Language: ${language || 'Any'}`);

      // Find device connection using MAC address
      const deviceInfo = this.deviceConnections.get(macAddress);
      if (!deviceInfo || !deviceInfo.connection) {
        logger.warn(`⚠️ [SPECIFIC-MUSIC] Device not connected: ${macAddress}`);
        await this.sendErrorResponse(clientId, "Device not connected", macAddress);
        return;
      }

      // Validate device is in music mode or conversation mode (conversation mode allows all content types)
      if (deviceInfo.currentMode !== "music" && deviceInfo.currentMode !== "conversation") {
        logger.warn(`⚠️ [SPECIFIC-MUSIC] Device ${macAddress} not in music/conversation mode (current: ${deviceInfo.currentMode})`);
        await this.sendErrorResponse(clientId, `Device is in ${deviceInfo.currentMode} mode, cannot play music`, macAddress);
        return;
      }

      // Forward to LiveKit room via data channel
      const connection = deviceInfo.connection;
      if (connection.bridge && connection.bridge.room && connection.bridge.room.localParticipant) {
        // Forward the raw function_call payload to LiveKit
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now()
        };
        const messageString = JSON.stringify(functionCallMessage);
        const messageData = new TextEncoder().encode(messageString);

        await connection.bridge.room.localParticipant.publishData(messageData, {
          reliable: true
        });

        logger.info(`✅ [SPECIFIC-MUSIC] Request forwarded to LiveKit room for ${macAddress}`);

        // Send acknowledgment to mobile app
        await this.sendSuccessResponse(clientId, `Playing "${songName}"`, macAddress);

      } else {
        logger.error(`❌ [SPECIFIC-MUSIC] No active LiveKit room for device: ${macAddress}`);
        await this.sendErrorResponse(clientId, "No active audio session", macAddress);
      }

    } catch (error) {
      logger.error(`❌ [SPECIFIC-MUSIC] Error processing request: ${error.message}`);
      await this.sendErrorResponse(clientId, "Failed to process music request", payload.session_id);
    }
  }

  async handleSpecificStoryRequest(deviceId, payload, clientId = null) {
    try {
      const macAddress = payload.session_id;
      const storyName = payload.function_call.arguments.story_name;
      const category = payload.function_call.arguments.category;
      const loopEnabled = payload.function_call.arguments.loop_enabled || false;

      logger.info(`📖 [SPECIFIC-STORY] Request for device: ${macAddress}`);
      logger.info(`📖 [SPECIFIC-STORY] Story: "${storyName}", Category: ${category || 'Any'}`);

      // Find device connection using MAC address
      const deviceInfo = this.deviceConnections.get(macAddress);
      if (!deviceInfo || !deviceInfo.connection) {
        logger.warn(`⚠️ [SPECIFIC-STORY] Device not connected: ${macAddress}`);
        await this.sendErrorResponse(clientId, "Device not connected", macAddress);
        return;
      }

      // Validate device is in story mode or conversation mode (conversation mode allows all content types)
      if (deviceInfo.currentMode !== "story" && deviceInfo.currentMode !== "conversation") {
        logger.warn(`⚠️ [SPECIFIC-STORY] Device ${macAddress} not in story/conversation mode (current: ${deviceInfo.currentMode})`);
        await this.sendErrorResponse(clientId, `Device is in ${deviceInfo.currentMode} mode, cannot play story`, macAddress);
        return;
      }

      // Forward to LiveKit room via data channel
      const connection = deviceInfo.connection;
      if (connection.bridge && connection.bridge.room && connection.bridge.room.localParticipant) {
        // Forward the raw function_call payload to LiveKit (same as music bot)
        const functionCallMessage = {
          type: "function_call",
          function_call: payload.function_call,
          source: payload.source || "mobile_app",
          session_id: macAddress,
          timestamp: Date.now()
        };
        const messageString = JSON.stringify(functionCallMessage);
        const messageData = new TextEncoder().encode(messageString);

        await connection.bridge.room.localParticipant.publishData(messageData, {
          reliable: true
        });

        logger.info(`✅ [SPECIFIC-STORY] Request forwarded to LiveKit room for ${macAddress}`);

        // Send acknowledgment to mobile app
        await this.sendSuccessResponse(clientId, `Playing "${storyName}"`, macAddress);

      } else {
        logger.error(`❌ [SPECIFIC-STORY] No active LiveKit room for device: ${macAddress}`);
        await this.sendErrorResponse(clientId, "No active audio session", macAddress);
      }

    } catch (error) {
      logger.error(`❌ [SPECIFIC-STORY] Error processing request: ${error.message}`);
      await this.sendErrorResponse(clientId, "Failed to process story request", payload.session_id);
    }
  }

  async forwardSpecificContentRequest(room, requestData) {
    try {
      const messageString = JSON.stringify(requestData);
      const messageData = new TextEncoder().encode(messageString);

      await room.localParticipant.publishData(messageData, {
        reliable: true,
        topic: "specific_content"
      });

      logger.info(`📡 [DATA-CHANNEL] Forwarded specific content request to LiveKit room`);
      logger.info(`📡 [DATA-CHANNEL] Content: ${requestData.content_name} (${requestData.content_type})`);

    } catch (error) {
      logger.error(`❌ [DATA-CHANNEL] Failed to forward request: ${error.message}`);
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
      timestamp: Date.now()
    };

    const responseTopic = `devices/p2p/${clientId}`;
    this.mqttClient.publish(responseTopic, JSON.stringify(successMessage), (err) => {
      if (err) {
        logger.error(`❌ [RESPONSE] Failed to send success response:`, err);
      } else {
        logger.info(`✅ [RESPONSE] Success sent to ${macAddress}: ${message}`);
      }
    });
  }

  async sendErrorResponse(clientId, errorMessage, macAddress) {
    if (!clientId) return;

    const errorResponse = {
      type: "specific_content_response",
      status: "error",
      message: errorMessage,
      device_mac: macAddress,
      timestamp: Date.now()
    };

    const responseTopic = `devices/p2p/${clientId}`;
    this.mqttClient.publish(responseTopic, JSON.stringify(errorResponse), (err) => {
      if (err) {
        logger.error(`❌ [RESPONSE] Failed to send error response:`, err);
      } else {
        logger.info(`❌ [RESPONSE] Error sent to ${macAddress}: ${errorMessage}`);
      }
    });
  }

  handleDeviceHello(deviceId, payload) {
    logger.info(`📱 [HELLO] handleDeviceHello called for device: ${deviceId}`);

    // Close and remove old connection if exists (prevents timer conflicts)
    const existingDeviceInfo = this.deviceConnections.get(deviceId);
    if (existingDeviceInfo) {
      const oldConnection = existingDeviceInfo.connection;
      const oldConnectionId = existingDeviceInfo.connectionId;

      logger.info(
        `📱 [HELLO] Closing old connection for ${deviceId} (connectionId: ${oldConnectionId})`
      );

      // Remove from connections map first
      this.connections.delete(oldConnectionId);
      logger.info(`🗑️ [HELLO] Removed old connectionId ${oldConnectionId} from connections map`);

      // Close the old connection (this will clean up timers and bridge)
      if (oldConnection && !oldConnection.closing) {
        oldConnection.closing = true; // Prevent duplicate close
        oldConnection.close();
        logger.info(`🗑️ [HELLO] Closed old connection for device: ${deviceId}`);
      }
    }

    // Create a virtual connection for this device
    const connectionId = this.generateNewConnectionId();
    logger.info(`📱 [HELLO] Generated connection ID: ${connectionId}`);

    const virtualConnection = new VirtualMQTTConnection(
      deviceId,
      connectionId,
      this,
      payload
    );
    logger.info(
      `📱 [HELLO] Created VirtualMQTTConnection for device: ${deviceId}`
    );

    this.connections.set(connectionId, virtualConnection);
    this.deviceConnections.set(deviceId, {
      connectionId,
      connection: virtualConnection,
    });

    // Subscribe to control topics for this device
    this.setupControlTopics(deviceId);

    logger.info(`📱 [HELLO] Device ${deviceId} connected via EMQX`);
    logger.info(
      `📱 [HELLO] Now calling handlePublish to process hello message...`
    );

    // Manually trigger the hello message processing
    try {
      virtualConnection.handlePublish({ payload: JSON.stringify(payload) });
      logger.info(
        `📱 [HELLO] Successfully called handlePublish for device: ${deviceId}`
      );
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
      logger.info(`✅ [DEBUG] Connection found for ${deviceId}, state: ending=${deviceInfo.connection.isEnding}, closing=${deviceInfo.connection.closing}`);
      deviceInfo.connection.handlePublish({ payload: JSON.stringify(payload) });
    } else {
      logger.info(`❌ [DEBUG] No connection found for device: ${deviceId}`);

      // Try to find similar device IDs (in case of format mismatch)
      const similarDevices = Array.from(this.deviceConnections.keys()).filter(key =>
        key.replace(/[_:]/g, '') === deviceId.replace(/[_:]/g, '')
      );

      if (similarDevices.length > 0) {
      }

      logger.warn(`📱 Received data from unknown device: ${deviceId}`);
    }
  }

  async handleDeviceCharacterChange(deviceId, payload) {
    try {
      // Extract character name from payload if provided
      const characterName =
        payload.characterName || payload.character_name || null;

      if (characterName) {
        logger.info(
          `🔘 [CHARACTER-CHANGE] Device ${deviceId} requesting character: ${characterName}`
        );
      } else {
        logger.info(
          `🔘 [CHARACTER-CHANGE] Device ${deviceId} requesting character cycle`
        );
      }

      // Extract MAC address (remove colons for API call)
      const macAddress = deviceId.replace(/:/g, "").toLowerCase();

      // Call Manager API
      const axios = require("axios");
      let apiUrl, requestBody;

      if (characterName) {
        // Set specific character
        apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${macAddress}/set-character`;
        requestBody = { characterName: characterName };
      } else {
        // Cycle to next character
        apiUrl = `${process.env.MANAGER_API_URL}/agent/device/${macAddress}/cycle-character`;
        requestBody = {};
      }

      logger.info(`📡 [CHARACTER-CHANGE] Calling API: ${apiUrl}`);
      const response = await axios.post(apiUrl, requestBody, {
        timeout: 10000,
      });

      if (response.data.code === 0 && response.data.data.success) {
        const { newModeName, oldModeName, agentId } = response.data.data;
        logger.info(
          `✅ [CHARACTER-CHANGE] Mode updated: ${oldModeName} → ${newModeName}`
        );

        // Load audio map
        const fs = require("fs");
        const path = require("path");
        const audioMapPath = path.join(
          __dirname,
          "audio",
          "character_change",
          "audio_map.json"
        );
        const audioMap = JSON.parse(fs.readFileSync(audioMapPath, "utf8"));

        // Get audio file for mode (use PCM extension instead of Opus)
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

        logger.info(`🎵 [CHARACTER-CHANGE] Streaming audio: ${pcmFileName}`);

        // Stream audio via UDP and send goodbye after
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
      const path = require("path");
      const connection = this.deviceConnections.get(deviceId)?.connection;

      if (!connection) {
        logger.error(
          `❌ [AUDIO-STREAM] No active connection for device: ${deviceId}`
        );
        return;
      }

      // Get client ID for publishing MQTT messages
      const clientId = connection.clientId;
      if (!clientId) {
        logger.error(
          `❌ [AUDIO-STREAM] No client ID found for device: ${deviceId}`
        );
        return;
      }

      // Check if we need to convert Opus file to PCM first
      const pcmFilePath = audioFilePath.replace(".opus", ".pcm");

      if (!fs.existsSync(pcmFilePath)) {
        logger.info(
          `⚠️ [CHARACTER-CHANGE] PCM file not found. Please convert Opus to PCM:`
        );
        logger.info(
          `   ffmpeg -i ${audioFilePath} -f s16le -ar 24000 -ac 1 ${pcmFilePath}`
        );
        logger.error(`❌ [CHARACTER-CHANGE] Cannot stream without PCM file`);
        return;
      }

      // Read PCM file (24kHz, mono, 16-bit signed)
      const pcmData = fs.readFileSync(pcmFilePath);
      logger.info(
        `📦 [CHARACTER-CHANGE] Loaded ${pcmData.length} bytes PCM from ${pcmFilePath}`
      );

      const controlTopic = `devices/p2p/${clientId}`;

      // Send TTS start via MQTT
      const ttsStartMsg = {
        type: "tts",
        state: "start",
        text: `Switched to ${modeName} mode`,
        timestamp: Date.now(),
      };
      this.mqttClient.publish(
        controlTopic,
        JSON.stringify(ttsStartMsg),
        (err) => {
          if (err) {
            logger.error(
              `❌ [CHARACTER-CHANGE] Failed to publish TTS start:`,
              err
            );
          } else {
            logger.info(
              `📤 [CHARACTER-CHANGE] TTS start sent to ${deviceId} via ${controlTopic}`
            );
          }
        }
      );

      // Wait a bit for TTS start to be processed
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stream PCM in 60ms frames, encode to Opus, send via UDP
      // Same as LiveKit audio: 24kHz, 60ms = 1440 samples = 2880 bytes PCM
      const FRAME_SIZE_SAMPLES = 1440; // 24000 Hz * 0.06s
      const FRAME_SIZE_BYTES = FRAME_SIZE_SAMPLES * 2; // 2 bytes per sample
      let offset = 0;
      let frameCount = 0;

      // Calculate relative timestamp
      const startTime = connection.udp?.startTime || Date.now();
      let baseTimestamp = (Date.now() - startTime) & 0xffffffff;

      while (offset < pcmData.length) {
        const frameData = pcmData.slice(
          offset,
          Math.min(offset + FRAME_SIZE_BYTES, pcmData.length)
        );

        // Pad last frame if incomplete
        let frameTosend = frameData;
        if (frameData.length < FRAME_SIZE_BYTES) {
          frameTosend = Buffer.alloc(FRAME_SIZE_BYTES);
          frameData.copy(frameTosend);
          // Rest is zeros (silence padding)
        }

        // Calculate timestamp for this frame
        const timestamp = (baseTimestamp + frameCount * 60) & 0xffffffff;

        // Encode to Opus (same as LiveKit audio streaming)
        if (opusEncoder) {
          try {
            const opusBuffer = opusEncoder.encode(
              frameTosend,
              FRAME_SIZE_SAMPLES
            );

            if (frameCount % 20 === 0) {
              logger.info(
                `🎵 [CHARACTER-CHANGE] Frame ${frameCount}: PCM ${frameTosend.length}B → Opus ${opusBuffer.length}B`
              );
            }

            // Send via UDP (will be encrypted automatically)
            connection.sendUdpMessage(opusBuffer, timestamp);
          } catch (err) {
            logger.error(
              `❌ [CHARACTER-CHANGE] Opus encode error:`,
              err.message
            );
            // Fallback to PCM
            connection.sendUdpMessage(frameTosend, timestamp);
          }
        } else {
          // No Opus encoder available, send PCM directly
          logger.warn(`⚠️ [CHARACTER-CHANGE] No Opus encoder, sending PCM`);
          connection.sendUdpMessage(frameTosend, timestamp);
        }

        offset += FRAME_SIZE_BYTES;
        frameCount++;

        // Wait 60ms for next frame (match frame duration)
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      logger.info(
        `📦 [CHARACTER-CHANGE] Streamed ${frameCount} frames (${pcmData.length} bytes PCM)`
      );

      // Wait a bit before sending TTS stop
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send TTS stop
      const ttsStopMsg = {
        type: "tts",
        state: "stop",
        timestamp: Date.now(),
      };
      this.mqttClient.publish(
        controlTopic,
        JSON.stringify(ttsStopMsg),
        (err) => {
          if (err) {
            logger.error(
              `❌ [CHARACTER-CHANGE] Failed to publish TTS stop:`,
              err
            );
          } else {
            logger.info(
              `📤 [CHARACTER-CHANGE] TTS stop sent to ${deviceId} via ${controlTopic}`
            );
          }
        }
      );

      // Wait a bit to ensure TTS stop is processed
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Send goodbye message ONLY if requested (for character-change, not mode-change)
      if (sendGoodbye) {
        const goodbyeMsg = {
          type: "goodbye",
          session_id: connection.udp?.session_id || null,
          reason: "character_change",
          timestamp: Date.now(),
        };

        this.mqttClient.publish(
          controlTopic,
          JSON.stringify(goodbyeMsg),
          (err) => {
            if (err) {
              logger.error(
                `❌ [CHARACTER-CHANGE] Failed to publish goodbye:`,
                err
              );
            } else {
              logger.info(
                `👋 [CHARACTER-CHANGE] Goodbye sent to ${deviceId} - LiveKit session will close`
              );
            }
          }
        );
      } else {
        logger.info(`ℹ️ [AUDIO-STREAM] Goodbye NOT sent (sendGoodbye=false)`);
      }
    } catch (error) {
      logger.error(`❌ [AUDIO-STREAM] Audio streaming error:`, error.message);
      logger.error(error.stack);
    }
  }

  async handleDeviceModeChange(deviceId, payload) {
    try {
      logger.info(`🔄 [MODE-CHANGE] Device ${deviceId} requesting mode change`);

      // Extract MAC address (remove colons for API call)
      const macAddress = deviceId.replace(/:/g, "").toLowerCase();
      const crypto = require("crypto");

      // Check for existing virtual connection
      const deviceInfo = this.deviceConnections.get(deviceId);
      let existingConnection = null;
      if (deviceInfo && deviceInfo.connection) {
        existingConnection = deviceInfo.connection;
      }

      // STEP 0a: Clear audio buffers IMMEDIATELY to prevent old audio from playing
      logger.info(`🧹 [MODE-CHANGE] Step 0a: Clearing audio buffers...`);
      if (existingConnection && existingConnection.bridge) {
        existingConnection.bridge.clearAudioBuffers();
        logger.info(`✅ [MODE-CHANGE] Audio buffers cleared`);
      }

      // STEP 0b: Stop old bot (if music/story mode)
      logger.info(`🛑 [MODE-CHANGE] Step 0b: Checking for old bot to stop...`);
      if (
        existingConnection &&
        existingConnection.roomType &&
        existingConnection.bridge
      ) {
        const oldMode = existingConnection.roomType;
        const oldRoomName = existingConnection.bridge.room
          ? existingConnection.bridge.room.name
          : null;

        if ((oldMode === "music" || oldMode === "story") && oldRoomName) {
          logger.info(
            `🛑 [MODE-CHANGE] Stopping old ${oldMode} bot for room: ${oldRoomName}...`
          );

          try {
            const axios = require("axios");
            const stopResponse = await axios.post(
              `${MEDIA_API_BASE}/stop-bot`,
              {
                room_name: oldRoomName,
              },
              mediaAxiosConfig()
            );


            if (stopResponse.data && stopResponse.data.status === "stopped") {
              logger.info(
                `✅ [MODE-CHANGE] Old ${oldMode} bot stopped successfully`
              );
            } else if (
              stopResponse.data &&
              stopResponse.data.status === "not_found"
            ) {
              logger.info(
                `ℹ️ [MODE-CHANGE] Old ${oldMode} bot was not running`
              );
            }

            // Wait a moment for bot to fully stop
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch (error) {
            logger.error(
              `⚠️ [MODE-CHANGE] Failed to stop old ${oldMode} bot: ${error.message}`
            );
            logger.info(
              `⚠️ [MODE-CHANGE] Continuing with mode change anyway...`
            );
            // Continue anyway - room deletion will disconnect bot
          }
        } else {
          logger.info(
            `ℹ️ [MODE-CHANGE] Old mode is '${oldMode}', no bot to stop`
          );
        }
      } else {
        logger.info(
          `ℹ️ [MODE-CHANGE] No existing connection or bridge found, skipping bot stop`
        );
      }

      // STEP 1: Delete existing room
      logger.info(`🗑️ [MODE-CHANGE] Step 1: Deleting existing room...`);

      if (existingConnection && existingConnection.bridge) {
        const oldBridge = existingConnection.bridge;
        const oldRoomName = oldBridge.room ? oldBridge.room.name : null;

        if (oldRoomName && this.roomService) {
          try {
            await this.roomService.deleteRoom(oldRoomName);
            logger.info(`✅ [MODE-CHANGE] Deleted old room: ${oldRoomName}`);
          } catch (error) {
            logger.error(
              `❌ [MODE-CHANGE] Failed to delete old room: ${error.message}`
            );
          }
        }

        // Disconnect old bridge without closing the connection (we're reusing it)
        if (oldBridge) {
          // CRITICAL: Stop audio forwarding immediately to prevent ghost audio
          oldBridge.stopAudioForwarding = true;
          logger.info(`🛑 [MODE-CHANGE] Stopped audio forwarding on old bridge`);

          // Disconnect from LiveKit room without triggering connection cleanup
          if (oldBridge.room) {
            try {
              await oldBridge.room.disconnect();
              logger.info(`✅ [MODE-CHANGE] Disconnected old bridge from LiveKit room`);
            } catch (error) {
              logger.warn(`⚠️ [MODE-CHANGE] Error disconnecting old bridge:`, error.message);
            }
          }
          existingConnection.bridge = null;
          logger.info(`✅ [MODE-CHANGE] Old bridge reference cleared (connection preserved)`);
          // NOTE: Don't call oldBridge.close() - it would delete the connection from deviceConnections!
        }
      } else {
        logger.info(`ℹ️ [MODE-CHANGE] No existing room to delete`);
      }

      // STEP 2: Update mode in DB
      logger.info(`📡 [MODE-CHANGE] Step 2: Updating mode in DB...`);
      const axios = require("axios");
      const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");
      const apiUrl = `${baseUrl}/toy/device/${macAddress}/cycle-mode`;

      const response = await axios.post(apiUrl, {}, { timeout: 10000 });

      if (response.data.code === 0 && response.data.data.success) {
        const { newMode, oldMode } = response.data.data;
        logger.info(
          `✅ [MODE-CHANGE] Mode updated in DB: ${oldMode} → ${newMode}`
        );

        // Store previousMode for mode switch detection in start_agent
        if (deviceInfo) {
          deviceInfo.previousMode = oldMode;
        }

        // STEP 3: Handle mode-specific flow
        logger.info(
          `🏗️ [MODE-CHANGE] Step 3: Preparing for mode: ${newMode}...`
        );

        // Find virtual connection
        let connection = null;

        // Check virtual connections (mobile app)
        if (deviceInfo && deviceInfo.connection) {
          connection = deviceInfo.connection;
          logger.info(
            `✅ [MODE-CHANGE] Found virtual connection for device: ${deviceId}`
          );
        }

        if (!connection) {
          logger.error(
            `❌ [MODE-CHANGE] No connection found for device: ${deviceId}`
          );
          logger.error(
            `❌ [MODE-CHANGE] Device must send 'hello' message first before mode-change`
          );

          // Send error response to device via MQTT (if we can find the client ID)
          const senderClientId = payload.clientId; // clientId is added to enhancedPayload from sender_client_id
          if (senderClientId) {
            const errorMsg = {
              type: "error",
              code: "NO_SESSION",
              message: "Please send 'hello' message first to establish session",
              timestamp: Date.now(),
            };
            this.publishToDevice(senderClientId, errorMsg);
            logger.info(
              `📤 [MODE-CHANGE] Sent error message to device: ${senderClientId}`
            );
          }

          return;
        }

        // Create room for all modes (conversation/music/story)
        logger.info(`🏠 [MODE-CHANGE] Creating room for ${newMode} mode...`);

        // Update connection room type
        connection.roomType = newMode;
        logger.info(
          `✅ [MODE-CHANGE] Updated connection.roomType to: ${newMode}`
        );

        // Generate new UUID and session
        const newSessionUuid = crypto.randomUUID();
        const macForRoom = deviceId.replace(/:/g, "");
        const newRoomName = `${newSessionUuid}_${macForRoom}_${newMode}`;

        logger.info(`🏠 [MODE-CHANGE] New room name: ${newRoomName}`);

        // Update connection session
        connection.udp.session_id = newRoomName;

        // Reset ending-related flags to prevent old timeouts from killing new session
        connection.isEnding = false;
        connection.endPromptSentTime = null;
        connection.goodbyeSent = false;
        connection.lastActivityTime = Date.now(); // Reset activity timer
        logger.info(
          `🔄 [MODE-CHANGE] Reset ending flags and activity timer for fresh session`
        );

        // Create new LiveKitBridge
        const newBridge = new LiveKitBridge(
          connection,
          connection.protocolVersion || 1,
          deviceId,
          newSessionUuid,
          connection.userData || {}
        );

        connection.bridge = newBridge;

        // Setup bridge close handler
        newBridge.on("close", () => {
          logger.info(`🔒 [MODE-CHANGE] Bridge closed for: ${deviceId}`);
          connection.bridge = null;
        });

        // Connect to LiveKit room
        await newBridge.connect(
          connection.audio_params || { sample_rate: 24000, channels: 1 },
          connection.features || {},
          this.roomService
        );

        logger.info(
          `✅ [MODE-CHANGE] New room created and gateway connected: ${newRoomName}`
        );

        // Fetch character for conversation mode
        let currentCharacter = null;
        if (newMode === "conversation") {
          currentCharacter = await connection.fetchCurrentCharacter(macAddress);
          connection.currentCharacter = currentCharacter;
          logger.info(`🎭 [MODE-CHANGE] Fetched character for conversation: ${currentCharacter}`);
        }

        // Send mode_update to device firmware
        logger.info(`📤 [MODE-CHANGE] Sending mode_update to device...`);
        const modeUpdateMsg = {
          type: "mode_update",
          mode: newMode,
          ...(newMode === "conversation" && currentCharacter ? { character: currentCharacter } : {}),
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
        logger.info(`✅ [MODE-CHANGE] Sent mode_update (${newMode}${currentCharacter ? ', character: ' + currentCharacter : ''}) to device with UDP details`);

        // STEP 4: Handle mode-specific startup
        logger.info(`🎬 [MODE-CHANGE] Step 4: Starting ${newMode} flow...`);

        if (newMode === "music") {
          logger.info(`🎵 [MODE-CHANGE] Spawning music bot...`);
          await connection.spawnMusicBot(newRoomName);
          logger.info(`✅ [MODE-CHANGE] Music bot spawned`);
          logger.info(`ℹ️ [MODE-CHANGE] TTS start will be sent after firmware sends start_agent signal`);
        } else if (newMode === "story") {
          logger.info(`📖 [MODE-CHANGE] Spawning story bot...`);
          await connection.spawnStoryBot(newRoomName);
          logger.info(`✅ [MODE-CHANGE] Story bot spawned`);
          logger.info(`ℹ️ [MODE-CHANGE] TTS start will be sent after firmware sends start_agent signal`);
        } else if (newMode === "conversation") {
          logger.info(
            `🗣️ [MODE-CHANGE] Conversation mode - auto-dispatching agent...`
          );

          // Auto-dispatch agent immediately (device already connected during mode change)
          if (this.agentDispatchClient) {
            try {
              const dispatch = await this.agentDispatchClient.createDispatch(
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

              logger.info(
                `✅ [MODE-CHANGE] Agent dispatched successfully:`,
                dispatch.id
              );

              // Mark bridge as having agent deployed
              newBridge.agentDeployed = true;

              logger.info(`ℹ️ [MODE-CHANGE] Agent will auto-greet when ready (no manual trigger needed)`);
            } catch (error) {
              logger.error(
                `❌ [MODE-CHANGE] Failed to dispatch agent or send greeting:`,
                error.message
              );
            }
          } else {
            logger.error(
              `❌ [MODE-CHANGE] AgentDispatchClient not initialized, cannot dispatch agent`
            );
          }
        }

        logger.info(
          `✅ [MODE-CHANGE] Mode change complete! ${oldMode} → ${newMode}`
        );
      } else {
        logger.error(`❌ [MODE-CHANGE] API error:`, response.data);
      }
    } catch (error) {
      logger.error(`❌ [MODE-CHANGE] Error:`, error.message);
      logger.error(error.stack);
    }
  }

  publishToDevice(clientIdOrDeviceId, message) {
    logger.info(
      `📤 [MQTT OUT] publishToDevice called - Client/Device: ${clientIdOrDeviceId}`
    );

    if (this.mqttClient && this.mqttClient.connected) {
      // Use the full client ID directly in the topic
      const topic = `devices/p2p/${clientIdOrDeviceId}`;

      this.mqttClient.publish(topic, JSON.stringify(message), (err) => {
        if (err) {
          logger.error(
            `❌ [MQTT OUT] Failed to publish to client ${clientIdOrDeviceId}:`,
            err
          );
        } else {
          logger.info(
            `✅ [MQTT OUT] Successfully published to client ${clientIdOrDeviceId} on topic ${topic}`
          );
          debug(
            `📤 Published to client ${clientIdOrDeviceId}: ${JSON.stringify(
              message
            )}`
          );
        }
      });
    } else {
      logger.error(
        "❌ [MQTT OUT] MQTT client not connected, cannot publish message"
      );
      logger.info(
        `📊 [MQTT OUT] Client connected: ${this.mqttClient ? this.mqttClient.connected : "null"
        }`
      );
    }
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
    // message format: [type: 1u, flag: 1u, payloadLength: 2u, cookie: 4u, timestamp: 4u, sequence: 4u, payload: n]
    if (message.length < 16) {
      logger.warn(
        `📡 [UDP SERVER] Received incomplete UDP header from ${rinfo.address}:${rinfo.port}, length=${message.length}`
      );
      return;
    }

    try {
      const type = message.readUInt8(0);
      if (type !== 1) {
        logger.warn(
          `📡 [UDP SERVER] Invalid packet type: ${type} from ${rinfo.address}:${rinfo.port}`
        );
        return;
      }

      const payloadLength = message.readUInt16BE(2);
      if (message.length < 16 + payloadLength) {
        logger.warn(
          `📡 [UDP SERVER] Incomplete message from ${rinfo.address}:${rinfo.port}, expected=${16 + payloadLength}, got=${message.length}`
        );
        return;
      }

      const connectionId = message.readUInt32BE(4);
      const connection = this.connections.get(connectionId);
      if (!connection) {
        logger.warn(`📡 [UDP SERVER] No connection found for ID: ${connectionId} from ${rinfo.address}:${rinfo.port}`);
        return;
      }

      const timestamp = message.readUInt32BE(8);
      const sequence = message.readUInt32BE(12);

      // logger.info(
      //   `📡 [UDP SERVER] Routing message to connection ${connectionId} (${connection.clientId})`
      // );
      connection.onUdpMessage(
        rinfo,
        message,
        payloadLength,
        timestamp,
        sequence
      );
    } catch (error) {
      logger.error(
        `📡 [UDP SERVER] Message processing error from ${rinfo.address}:${rinfo.port}:`,
        error
      );
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




