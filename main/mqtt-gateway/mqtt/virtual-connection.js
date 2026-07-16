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
const { buildDispatchMetadata, DEFAULT_RUNTIME_AGENT } = require("../core/mem0-integration");
const { runImagine } = require("../imagine/imagine-orchestrator");
const { generateImagine } = require("../imagine/imagine-client");
const { uploadImagineJpeg } = require("../imagine/imagine-upload");
const { randomUUID } = require("crypto");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Verdict used whenever manager-api cannot answer. Never brick a toy because
// our subscription check is down (spec §5) — allow, and log loudly enough that
// the alert can be built on the string. `remaining` mirrors the endpoint's
// all-null shape so callers never have to special-case this path.
const FAIL_OPEN_VERDICT = Object.freeze({
  allowed: true,
  reason: "fail_open",
  remaining: Object.freeze({
    questions_month: null,
    questions_today: null,
    minutes_today: null,
    images_today: null,
  }),
});

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

// Character->Agent routing now comes from the Manager API (runtimeAgentName);
// the old hardcoded CHARACTER_AGENT_MAP + reverse lookup are gone. DEFAULT_RUNTIME_AGENT
// is the single fallback, imported from core/mem0-integration.

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
    this.sessionConfig = {
      languageCode: null,
      languageName: null,
      voiceId: null,
      agentName: null,
    };
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

        // Audio stats tracking
    this.audioStats = {
      packetCount: 0,
      totalBytes: 0,
      lastLogTime: Date.now(),
      logIntervalMs: 10000,
    };
    this.lastUdpSendFailureLogTime = 0;

    // Session duration tracking (max 60 minutes)
    this.sessionStartTime = Date.now();
    this.maxSessionDurationMs = 60 * 60 * 1000; // 60 minutes max session duration
    this.maxAudioPlayingDurationMs = 90 * 1000; // 90 seconds max before considering audio stuck
    this.lastPttMode = "manual"; // Default PTT mode

    // Track target toy for mobile-initiated connections
    this.targetToyMac = null; // MAC address of the toy to route audio to
    this.isMobileConnection = false; // Flag to identify mobile connections

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
      // Existing callers pass a JSON string; the imagine orchestrator passes an
      // already-built object. Accept both without changing string behavior.
      const parsedPayload =
        typeof payload === "string" ? JSON.parse(payload) : payload;
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
      const now = Date.now();
      if (now - this.lastUdpSendFailureLogTime > 5000) {
        this.lastUdpSendFailureLogTime = now;
        logger.warn(
          `❌ [LIVEKIT->UDP] Failed to send audio to device ${this.deviceId}: UDP remote address is not known yet ` +
            `(session=${this.udp?.session_id || "unknown"}, bytes=${payload.length}, timestamp=${timestamp}). ` +
            `Device has not sent a UDP packet for this session, so gateway cannot route audio.`
        );
      }
      return;
    }

    this.udp.localSequence++;
    const header = this.generateUdpHeader(
      payload.length,
      timestamp,
      this.udp.localSequence
    );

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    let encryptedPayload;
    try {
      encryptedPayload = streamingCrypto.encrypt(
        payload,
        this.udp.encryption,
        this.udp.key,
        header
      );
    } catch (error) {
      logger.error(
        `❌ [LIVEKIT->UDP] Failed to encrypt audio for device ${this.deviceId}: ${error.message} ` +
          `(session=${this.udp?.session_id || "unknown"}, bytes=${payload.length}, sequence=${this.udp.localSequence})`
      );
      return;
    }

    const message = Buffer.concat([header, encryptedPayload]);
    this.gateway.sendUdpMessage(message, this.udp.remoteAddress, {
      direction: "livekit_to_device_audio",
      deviceId: this.deviceId,
      sessionId: this.udp?.session_id,
      payloadBytes: payload.length,
      udpBytes: message.length,
      timestamp,
      sequence: this.udp.localSequence,
    });
  }

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

    const macAddress = this.deviceId.replace(/:/g, "").toLowerCase();

    // ═══════════════════════════════════════════════════════════
    // FAST PATH: Send hello response IMMEDIATELY (< 50ms)
    // Device exits "Connecting" state right away
    // ═══════════════════════════════════════════════════════════

    // Extract language from hello message
    this.language = json.language || null;

    // Use defaults — DB queries happen in background
    this.roomType = "conversation"; // Default, updated by deferred DB query
    this.deviceMode = "manual";     // Default, updated by deferred DB query

    // Generate UDP encryption keys immediately
    this.udp = {
      ...this.udp,
      key: crypto.randomBytes(16),
      nonce: this.generateUdpHeader(0, 0, 0),
      encryption: "aes-128-ctr",
      remoteSequence: 0,
      localSequence: 0,
      startTime: Date.now(),
    };

    // Generate new UUID for session (use "conversation" as default room type)
    const newSessionUuid = crypto.randomUUID();
    const macForRoom = this.macAddress.replace(/:/g, "");
    const futureSessionId = `${newSessionUuid}_${macForRoom}_${this.roomType}`;
    this.udp.session_id = futureSessionId;

    // AI Imagine: feature flag from hello (spec Option A — top-level json.feature).
    // When enabled, this session bypasses the LiveKit/chat pipeline entirely.
    this.imagineFeatureEnabled = json.feature === "ai_imagine";
    this.imagineInFlight = false;
    this.imagineFrames = [];

    console.log(`🚀 [FAST-HELLO] Sending hello response immediately to device ${this.deviceId}`);

    // Close old bridge if exists
    if (this.bridge) {
      debug(
        `${this.deviceId} received duplicate hello message, closing previous bridge`
      );
      // Don't await — let old bridge close in background
      const oldBridge = this.bridge;
      this.bridge = null;
      oldBridge.close().catch((err) => {
        console.warn(`⚠️ [OLD-BRIDGE] Close error (non-fatal):`, err.message);
      });
    }

    // Send hello response to device IMMEDIATELY — device exits "Connecting" now!
    const helloResponseMsg = {
      type: "hello",
      version: json.version,
      mode: this.roomType,
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
    console.log(`📤 [FAST-HELLO] Hello response sent in < 50ms — device can start streaming`);

    // Reset activity timer
    this.lastActivityTime = Date.now();

    // ═══════════════════════════════════════════════════════════
    // DEFERRED PATH: DB queries + LiveKit setup in background
    // Audio received before bridge is ready will be silently dropped
    // (acceptable: first 1-3s while user positions device)
    // ═══════════════════════════════════════════════════════════

    this.deferredSetupInProgress = true;
    this._deferredSetup(json, macAddress, newSessionUuid, macForRoom, futureSessionId)
      .catch((error) => {
        this.deferredSetupInProgress = false;
        console.error(`❌ [DEFERRED-SETUP] Background setup failed for ${this.deviceId}:`, error);
        // Send error to device so it knows something went wrong
        this.sendMqttMessage(
          JSON.stringify({
            type: "goodbye",
            session_id: this.udp?.session_id,
            reason: "setup_failed",
            timestamp: Date.now(),
          })
        );
        this.close();
      });
  }

  /**
   * Ask manager-api whether this device may start a session.
   *
   * Always resolves — on any error we fail open (SUB-1). SUB-2 adds the
   * refusal branch that skips LiveKit dispatch and streams the gate clip;
   * today the verdict is observed and logged only, so behavior is unchanged.
   *
   * @param {string} macAddress
   * @param {string} baseUrl - manager-api base URL, without the /toy suffix
   * @returns {Promise<{allowed: boolean, reason: string, remaining: Object}>}
   */
  async fetchSessionVerdict(macAddress, baseUrl) {
    const serviceKey = process.env.MANAGER_API_SECRET || process.env.SERVICE_SECRET_KEY;

    try {
      const response = await axios.get(
        `${baseUrl}/toy/device/${encodeURIComponent(macAddress)}/session-verdict`,
        { headers: { "X-Service-Key": serviceKey }, timeout: 5000 }
      );

      const verdict = response.data?.code === 0 ? response.data.data : null;
      if (!verdict) {
        throw new Error(`unexpected response code ${response.data?.code}`);
      }

      logger.info(
        `🎟️ [VERDICT] ${macAddress}: allowed=${verdict.allowed} reason=${verdict.reason}`
      );
      return verdict;
    } catch (error) {
      logger.warn(
        `🎟️ [VERDICT-FAIL-OPEN] ${macAddress}: ${error.message} — allowing session`
      );
      return FAIL_OPEN_VERDICT;
    }
  }

  /**
   * Deferred setup — runs in background after hello response is sent.
   * Handles DB queries, LiveKit room creation, and agent dispatch.
   */
  async _deferredSetup(json, macAddress, newSessionUuid, macForRoom, futureSessionId) {
    const deferredStart = Date.now();
    const baseUrl = process.env.MANAGER_API_URL.replace("/toy", "");

    // ── Step 1: ALL DB queries in parallel ──
    console.log(`🔄 [DEFERRED] Starting parallel DB queries for ${this.deviceId}...`);

    const [roomTypeResult, deviceModeResult, character, childProfile] = await Promise.allSettled([
      // Room type (conversation/music/story)
      axios.get(`${baseUrl}/toy/device/${macAddress}/mode`, { timeout: 5000 })
        .then((r) => r.data?.code === 0 ? r.data.data : "conversation")
        .catch(() => "conversation"),
      // PTT mode (auto/manual)
      axios.get(`${baseUrl}/toy/device/${macAddress}/device-mode`, { timeout: 5000 })
        .then((r) => r.data?.code === 0 ? r.data.data : "manual")
        .catch(() => "manual"),
      // Character
      this.fetchCurrentCharacter(this.deviceId),
      // Child profile
      this.fetchChildProfile(this.deviceId),
      // Subscription verdict — rides this batch so it costs no extra wall-clock.
      // Result is deliberately not destructured: SUB-1 only observes and logs
      // it. SUB-2 reads it here to skip dispatch and stream the gate clip.
      this.fetchSessionVerdict(macAddress, baseUrl),
    ]);

    // Extract results from settled promises
    this.roomType = roomTypeResult.status === "fulfilled" ? roomTypeResult.value : "conversation";
    this.deviceMode = deviceModeResult.status === "fulfilled" ? deviceModeResult.value : "manual";
    // fetchCurrentCharacter now returns the routing contract; keep currentCharacter as the
    // display name and store runtimeAgentName/characterId/language for dispatch + metadata.
    const characterResolution = character.status === "fulfilled" && character.value
      ? character.value
      : { characterName: "Cheeko", runtimeAgentName: DEFAULT_RUNTIME_AGENT, characterId: null, language: null };
    this.currentCharacter = characterResolution.characterName || "Cheeko";
    this.runtimeAgentName = characterResolution.runtimeAgentName || DEFAULT_RUNTIME_AGENT;
    this.characterId = characterResolution.characterId ?? null;
    if (characterResolution.language) this.language = characterResolution.language;
    this.childProfile = childProfile.status === "fulfilled" ? childProfile.value : null;

    // ── AI Card agent override ──
    // If the firmware hello includes rfid_uid (from a card tap that triggered the session),
    // look up the card in the DB to check if it maps to a specific agent.
    const helloRfidUid = json.rfid_uid || null;
    if (helloRfidUid) {
      try {
        const lookupUrl = `${process.env.MANAGER_API_URL}/admin/rfid/card/lookup/${encodeURIComponent(helloRfidUid)}`;
        this.sessionConfig = {
          languageCode: null,
          languageName: null,
          voiceId: null,
          agentName: null,
        };
        logger.info(`🎴 [AI-CARD] Hello contains rfid_uid=${helloRfidUid}, looking up agent mapping...`);
        const rfidResponse = await axios.get(lookupUrl, { timeout: 5000 });

        if (rfidResponse.data?.code === 0 && rfidResponse.data?.data) {
          const cardData = rfidResponse.data.data;
          this.sessionConfig.languageCode = cardData.languageCode || null;
          this.sessionConfig.languageName = cardData.languageName || null;
          this.sessionConfig.voiceId = cardData.voiceId || null;
          this.sessionConfig.agentName = cardData.agentName || null;
          const cardAgentName = cardData.agentName;
          if (cardAgentName) {
            // Manager's RFID resolver supplies characterName + runtimeAgentName directly.
            this.currentCharacter = cardData.characterName || cardAgentName;
            this.runtimeAgentName = cardData.runtimeAgentName || DEFAULT_RUNTIME_AGENT;
            this.characterId = cardData.characterId ?? this.characterId ?? null;
            logger.info(`🎴 [AI-CARD] Card override → character "${this.currentCharacter}", agent "${this.runtimeAgentName}"`);
          } else {
            logger.info(`🎴 [AI-CARD] Card ${helloRfidUid} has no agent mapping, using default character`);
          }
      }
      } catch (rfidErr) {
        logger.warn(`🎴 [AI-CARD] Failed to lookup rfid_uid=${helloRfidUid}: ${rfidErr.message}`);
      }
    }

    // Validate
    if (!["conversation", "music", "story"].includes(this.roomType)) {
      this.roomType = "conversation";
    }
    if (!["auto", "manual"].includes(this.deviceMode)) {
      this.deviceMode = "manual";
    }

    const dbTime = Date.now() - deferredStart;
    console.log(`✅ [DEFERRED] DB queries completed in ${dbTime}ms — roomType: ${this.roomType}, mode: ${this.deviceMode}, character: ${this.currentCharacter}`);

    // Update session_id if roomType changed from default
    if (this.roomType !== "conversation") {
      const updatedSessionId = `${newSessionUuid}_${macForRoom}_${this.roomType}`;
      this.udp.session_id = updatedSessionId;
      console.log(`🔄 [DEFERRED] Updated session_id for ${this.roomType}: ${updatedSessionId}`);
    }

    // Send mode_update to device with actual values from DB
    const modeUpdateMsg = {
      type: "mode_update",
      mode: this.roomType,
      listening_mode: this.deviceMode,
      ...(this.roomType === "conversation" && this.currentCharacter
        ? { character: this.currentCharacter }
        : {}),
      session_id: this.udp.session_id,
      timestamp: Date.now(),
    };
    this.sendMqttMessage(JSON.stringify(modeUpdateMsg));
    console.log(`📤 [DEFERRED] Sent mode_update: ${this.roomType}, listening_mode: ${this.deviceMode}`);

    if (this.currentCharacter) {
      logger.info(`🎭 [CHARACTER] Using character: "${this.currentCharacter}"`);
    }
    if (this.childProfile) {
      logger.info(`👶 [CHILD-PROFILE] Child: "${this.childProfile.name}", age: ${this.childProfile.age}`);
    }

    if (this.imagineFeatureEnabled) {
      // AI Imagine: no LiveKit bridge, no chat agent. Audio is forwarded to
      // line_art on end-of-utterance (speech_end / listen:stop) instead.
      this.deferredSetupInProgress = false;
      logger.info(`🖼️ [IMAGINE] session in ai_imagine mode; skipping LiveKit bridge for ${this.deviceId}`);
      const totalImagineDeferred = Date.now() - deferredStart;
      console.log(`✅ [DEFERRED] Imagine background setup completed in ${totalImagineDeferred}ms for ${this.deviceId}`);
      return;
    }

    // ── Step 2: LiveKit room setup ──
    console.log(`🏗️ [DEFERRED] Creating LiveKit room for ${this.deviceId}...`);

    // Clean up old sessions
    if (this.gateway.roomService) {
      try {
        await LiveKitBridge.cleanupOldSessionsForDevice(
          this.deviceId,
          this.gateway.roomService,
          this.udp.session_id
        );
        console.log(`✅ [CLEANUP] Old sessions cleaned up`);
      } catch (err) {
        console.warn(`⚠️ [CLEANUP] Cleanup error (non-fatal):`, err.message);
      }
    }

    // Create bridge
    this.bridge = new LiveKitBridge(
      this,
      json.version,
      this.deviceId,
      newSessionUuid,
      this.userData,
      this.workerPool
    );
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

    // ── Step 3: Connect bridge to LiveKit room ──
    const roomCreationStart = Date.now();
    await this.bridge.connect(
      json.audio_params,
      json.features,
      this.server?.roomService || this.gateway?.roomService
    );
    const roomCreationTime = Date.now() - roomCreationStart;
    this.deferredSetupInProgress = false;
    console.log(`✅ [DEFERRED] LiveKit room created in ${roomCreationTime}ms`);

    // Audio buffer is NOT flushed here — it continues buffering in onUdpMessage()
    // until the agent actually joins the room. The flush happens in livekit-bridge.js
    // ParticipantConnected handler to ensure the agent is present to receive the audio.
    if (this.audioBuffer && this.audioBuffer.length > 0) {
      console.log(`📦 [DEFERRED] ${this.audioBuffer.length} audio frames buffered — will flush when agent joins`);
    }

    // Room type-specific initialization
    if (this.roomType === "music") {
      console.log(`🎵 [MUSIC] Spawning music bot via Python API...`);
      await this.spawnMusicBot(this.udp.session_id);
    } else if (this.roomType === "story") {
      console.log(`📖 [STORY] Spawning story bot via Python API...`);
      await this.spawnStoryBot(this.udp.session_id);
    }

    // ── Step 4: Dispatch agent (conversation mode) ──
    if (
      this.roomType === "conversation" &&
      this.gateway?.agentDispatchClient
    ) {
      if (this.bridge?.agentDeployed) {
        logger.warn(`[AUTO-DEPLOY] Agent already deployed, skipping duplicate dispatch`);
        return;
      }

      const roomName = this.bridge?.room?.name || this.udp.session_id;
      const agentName = this.runtimeAgentName || DEFAULT_RUNTIME_AGENT;
      logger.info(`🚀 [AUTO-DEPLOY] Character: "${this.currentCharacter}" → Agent: "${agentName}"`);
      this.bridge.expectedAgentName = agentName;
      const dispatchMetadata = buildDispatchMetadata({
        macAddress: this.macAddress,
        deviceId: this.deviceId,
        character: this.currentCharacter,
        characterId: this.characterId,
        language: this.language,
        childProfile: this.childProfile,
        sessionConfig: this.sessionConfig,
      });
      const roomService = this.server?.roomService || this.gateway?.roomService;

      try {
        if (roomService) {
          try {
            await roomService.updateRoomMetadata(roomName, dispatchMetadata);
            logger.info(
              `🧩 [ROOM-METADATA] Updated room metadata (${dispatchMetadata.length} bytes) for room: ${roomName}`
            );
          } catch (roomMetadataError) {
            logger.warn(
              `⚠️ [ROOM-METADATA] Failed to update room metadata for room ${roomName}: ${roomMetadataError.message}`
            );
          }
        }

        this.bridge.agentDeployed = true;
        await this.gateway.agentDispatchClient.createDispatch(
          roomName,
          agentName,
          {
            metadata: dispatchMetadata,
          }
        );
        logger.info(`✅ [AUTO-DEPLOY] Agent "${agentName}" dispatched to room: ${roomName}`);

        // Set hard timeout — if agent doesn't join within 25s, notify device
        this.agentJoinFailsafeTimeout = setTimeout(() => {
          if (this.bridge && !this.bridge.agentJoined && !this.closing) {
            logger.error(`❌ [AGENT-TIMEOUT] Agent "${agentName}" didn't join within 25s`);
            this.sendMqttMessage(JSON.stringify({
              type: "goodbye",
              session_id: this.udp?.session_id,
              reason: "agent_timeout",
              timestamp: Date.now(),
            }));
            this.sendMqttMessage(JSON.stringify({
              type: "alert",
              status: "error",
              message: "Server is busy, please try again",
              emotion: "circle_xmark",
              session_id: this.udp?.session_id,
            }));
            this.close();
          }
        }, 25000);
      } catch (dispatchError) {
        this.bridge.agentDeployed = false;
        logger.error(`❌ [AUTO-DEPLOY] Failed to dispatch agent: ${dispatchError.message}`);
      }
    } else if (this.roomType !== "conversation") {
      console.log(`🎵 [MODE] ${this.roomType} mode - no agent deployment needed`);
    } else {
      console.log(`⚠️ [FALLBACK] No agentDispatchClient, sending ready_for_greeting`);
      this.sendMqttMessage(JSON.stringify({
        type: "ready_for_greeting",
        session_id: this.udp.session_id,
        timestamp: Date.now(),
      }));
    }

    const totalDeferredTime = Date.now() - deferredStart;
    console.log(`✅ [DEFERRED] Total background setup completed in ${totalDeferredTime}ms for ${this.deviceId}`)
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

      // Returns the routing contract. The display name stays for logs/firmware;
      // routing uses runtimeAgentName (Manager resolves NULL rows -> default).
      // Handles both legacy formats:
      //   Format 1: { code: 0, data: "Math Tutor" }            (name only -> default route)
      //   Format 2: { code: 0, data: { characterName, runtimeAgentName, characterId, language } }
      if (response.data && response.data.code === 0 && response.data.data) {
        const data = response.data.data;
        if (typeof data === 'string') {
          return { characterName: data, runtimeAgentName: DEFAULT_RUNTIME_AGENT, characterId: null, language: null };
        }
        const resolution = {
          characterName: data.characterName || "Cheeko",
          runtimeAgentName: data.runtimeAgentName || DEFAULT_RUNTIME_AGENT,
          characterId: data.characterId ?? null,
          language: data.language ?? null,
        };
        logger.info(`🎭 [CHARACTER] ✅ Got character from DB: "${resolution.characterName}" → agent "${resolution.runtimeAgentName}"`);
        return resolution;
      } else {
        logger.warn(`🎭 [CHARACTER] ⚠️ No character in response, using default route`);
        return { characterName: "Cheeko", runtimeAgentName: DEFAULT_RUNTIME_AGENT, characterId: null, language: null };
      }
    } catch (error) {
      logger.error(`🎭 [CHARACTER] ❌ Failed to fetch: ${error.message}`);
      logger.warn(`🎭 [CHARACTER] Using default route: "${DEFAULT_RUNTIME_AGENT}"`);
      return { characterName: "Cheeko", runtimeAgentName: DEFAULT_RUNTIME_AGENT, characterId: null, language: null };
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
    // AI Imagine: on end-of-utterance, hand the buffered Opus to the orchestrator.
    // Guarded so normal (chat/music/story) sessions are completely unaffected.
    // Placed before the `!this.bridge` guard because imagine sessions never have a bridge.
    if (
      this.imagineFeatureEnabled &&
      (json.type === "speech_end" ||
        (json.type === "listen" && json.state === "stop"))
    ) {
      // fire-and-forget; runImagine serializes + publishes image/image_status/image_error itself
      runImagine(this, {
        generateImagine,
        uploadImagineJpeg,
        lineArtWsUrl: process.env.LINE_ART_WS_URL,
        managerApiUrl: process.env.MANAGER_API_URL,
        serviceKey: process.env.MANAGER_API_SECRET,
        newRequestId: () => `img_${randomUUID().slice(0, 8)}`,
      }).catch((e) =>
        logger.error(`❌ [IMAGINE] runImagine failed: ${e?.message}`)
      );
      return;
    }

    // AI Imagine: a fresh knob-press (listen/start) begins a new utterance — drop any
    // stale audio buffered from a previous aborted press so prompts don't bleed together.
    if (this.imagineFeatureEnabled && json.type === "listen" && json.state === "start") {
      this.imagineFrames = [];
      return;
    }

    if (!this.bridge) {
      if (this.deferredSetupInProgress) {
        // Bridge not ready yet — deferred setup still running. Don't kill the session.
        console.log(`⏳ [DEFERRED] Message type=${json.type} received before bridge ready — ignoring`);
        return;
      }
      // AI Imagine sessions intentionally have NO bridge. Ordinary control messages
      // (e.g. listen/start) must NOT tear the session down — the image trigger
      // (speech_end / listen-stop) is handled above; ignore everything else here.
      if (this.imagineFeatureEnabled) {
        // Mark closed so an in-flight generation drops its result instead of uploading
        // and publishing to a session the device has already left.
        if (json.type === "goodbye") this.imagineClosed = true;
        console.log(`🖼️ [IMAGINE] ignoring ${json.type} (no bridge in imagine mode)`);
        return;
      }
      if (json.type !== "goodbye") {
        this.sendMqttMessage(
          JSON.stringify({ type: "goodbye", session_id: json.session_id })
        );
      }
      return;
    }

    if (json.type === "goodbye") {
      console.log(
        `🔌 [GOODBYE] Received goodbye from device: ${this.deviceId} - fully closing room`
      );

      // Clear agent join failsafe timeout
      if (this.agentJoinFailsafeTimeout) {
        clearTimeout(this.agentJoinFailsafeTimeout);
        this.agentJoinFailsafeTimeout = null;
      }

      // Notify agent of disconnect before closing room
      if (
        this.bridge &&
        this.bridge.room &&
        this.bridge.room.localParticipant
      ) {
        try {
          const disconnectMessage = {
            type: "disconnect_agent",
            session_id: json.session_id,
            timestamp: Date.now(),
            source: "mqtt_gateway",
            reason: "device_goodbye",
          };

          const messageString = JSON.stringify(disconnectMessage);
          const messageData = new Uint8Array(
            Buffer.from(messageString, "utf8")
          );

          await this.bridge.room.localParticipant.publishData(messageData, {
            reliable: true,
          });

          console.log(`✅ [GOODBYE] Sent disconnect signal to agent`);
        } catch (error) {
          console.warn(
            `⚠️ [GOODBYE] Could not notify agent (non-fatal):`,
            error.message
          );
        }
      }

      // Fully close bridge and room — MQTT gateway creates a new room per hello,
      // so keeping the room alive only creates ghost rooms in LiveKit
      if (this.bridge) {
        const bridgeToClose = this.bridge;
        this.bridge = null;
        bridgeToClose.close().catch((err) => {
          console.warn(`⚠️ [GOODBYE] Bridge close error (non-fatal):`, err.message);
        });
        console.log(`🗑️ [GOODBYE] Room fully closed for ${this.deviceId}`);
      }

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
        if (state === "stop" && this.bridge?.finalizeDeviceAudioCapture) {
          this.bridge.finalizeDeviceAudioCapture("ptt_stop");
        }

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

    // Handle RFID card_lookup messages - query Manager API and respond to device
    if (json.type === "card_lookup") {
      console.log(
        `🏷️ [RFID] Card lookup received: uid=${json.rfid_uid} from device ${this.deviceId}`
      );

      try {
        const rfidUid = json.rfid_uid;
        const baseUrl = process.env.MANAGER_API_URL;
        const sessionId = json.session_id || this.udp?.session_id || null;

        // Unified analytics + version handshake for every card_lookup tap.
        const fallbackEventId = json.event_id
          || `lookup_${sessionId || "nosession"}_${rfidUid}_${json.tap_ts || Date.now()}`;
        const tapPayload = {
          event_id: fallbackEventId,
          session_id: sessionId,
          mac_address: json.mac_address || this.macAddress,
          rfid_uid: rfidUid,
          local_skill_id: json.local_skill_id || null,
          local_version: json.local_version || null,
          local_content_hash: json.local_content_hash || null,
          tap_ts: json.tap_ts || new Date().toISOString(),
          source: "gateway_card_lookup",
        };

        let tapAck = null;
        try {
          tapAck = await postCardTapHandshake(tapPayload);
        } catch (tapErr) {
          logger.warn(`⚠️ [RFID-TAP] Failed to persist lookup tap for uid=${rfidUid}: ${tapErr.message}`);
        }

        const isContentUpToDate =
          tapAck &&
          tapAck.recognized &&
          tapAck.cardType === "content" &&
          tapAck.updateRequired === false;

        if (isContentUpToDate) {
          this.sendMqttMessage(
            JSON.stringify({
              type: "card_up_to_date",
              session_id: json.session_id,
              rfid_uid: rfidUid,
              skill_id: tapAck.skillId || tapAck.contentPackCode || null,
              latest_version: tapAck.latestVersion || null,
              latest_content_hash: tapAck.latestContentHash || null,
              update_required: false,
              download_manifest_path: tapAck.downloadManifestPath || null,
              server_ts: new Date().toISOString(),
            })
          );
          console.log(
            `📤 [RFID] Sent card_up_to_date response to device ${this.deviceId} for uid=${rfidUid}`
          );
          return;
        }

        // Call Manager API RFID lookup endpoint
        const lookupUrl = `${baseUrl}/admin/rfid/card/lookup/${encodeURIComponent(rfidUid)}`;
        console.log(`🔍 [RFID] Looking up card at: ${lookupUrl}`);

        const response = await axios.get(lookupUrl, { timeout: 5000 });

        if (response.data && response.data.code === 0 && response.data.data) {
          const cardData = response.data.data;
          console.log(
            `✅ [RFID] Card found: contentType=${cardData.contentType}, title="${cardData.title || cardData.packName || ""}"`
          );

          // Treat AI session-config cards as card_ai even though the lookup
          // payload uses contentType="prompt" for conversational flows.
          const isAiCard =
            cardData.contentType === "ai" ||
            cardData.type === "ai" ||
            Boolean(cardData.agentName) ||
            Boolean(cardData.languageCode) ||
            Boolean(cardData.languageName) ||
            cardData.actionType === "agent" ||
            cardData.actionType === "ai";

          const responseType = isAiCard ? "card_ai" : "card_content";

          // Send card response back to device
          const responsePayload = {
            type: responseType,
            session_id: json.session_id,
            rfid_uid: rfidUid,
            ...cardData,
          };
          if (responseType === "card_content") {
            responsePayload.update_required = tapAck ? Boolean(tapAck.updateRequired) : true;
            responsePayload.latest_version = tapAck?.latestVersion || responsePayload.version || null;
            responsePayload.latest_content_hash = tapAck?.latestContentHash || null;
            responsePayload.download_manifest_path = tapAck?.downloadManifestPath || null;
            responsePayload.replace_mode = "safe_background_refresh";
          }
          this.sendMqttMessage(JSON.stringify(responsePayload));
          console.log(
            `📤 [RFID] Sent ${responseType} response to device ${this.deviceId}`
          );
        } else {
          // Card not found in database
          console.log(
            `ℹ️ [RFID] No card mapping found for uid=${rfidUid}`
          );
          this.sendMqttMessage(
            JSON.stringify({
              type: "card_unknown",
              session_id: json.session_id,
              rfid_uid: rfidUid,
            })
          );
        }
      } catch (error) {
        console.error(
          `❌ [RFID] Card lookup failed: ${error.message}`
        );
        // Fallback: tell device card is unknown so it doesn't hang
        this.sendMqttMessage(
          JSON.stringify({
            type: "card_unknown",
            session_id: json.session_id,
            rfid_uid: json.rfid_uid,
            error: "lookup_failed",
          })
        );
      }
      return;
    }

    // Handle speech_end messages - forward to LiveKit agent for explicit turn detection
    if (json.type === "speech_end") {
      console.log(
        `🎤 [SPEECH-END] User finished speaking, device: ${this.deviceId}`
      );

      try {
        if (this.bridge?.finalizeDeviceAudioCapture) {
          this.bridge.finalizeDeviceAudioCapture("speech_end");
        }

        if (this.bridge?.room?.localParticipant) {
          const speechEndMessage = {
            type: "speech_end",
            session_id: json.session_id || this.udp?.session_id,
            device_id: this.macAddress,
            timestamp: Date.now(),
            source: "device_firmware",
          };

          const messageData = new Uint8Array(
            Buffer.from(JSON.stringify(speechEndMessage), "utf8")
          );

          await this.bridge.room.localParticipant.publishData(messageData, {
            reliable: true,
          });

          console.log(
            `✅ [SPEECH-END] Forwarded speech_end to LiveKit agent`
          );
        } else {
          console.warn(
            `⚠️ [SPEECH-END] Cannot forward - no LiveKit connection`
          );
        }
      } catch (error) {
        console.error(
          `❌ [SPEECH-END] Failed to forward speech_end: ${error.message}`
        );
      }
      return;
    }

    // Handle MCP response messages from device
    if (json.type === "mcp") {
      console.log(
        `🔋 [MCP] MCP message received from device ${this.deviceId}`
      );
      if (this.bridge) {
        const sessionId = json.session_id || this.udp?.session_id;
        const requestId = json.request_id;
        await this.forwardMcpResponse(json.payload || json, sessionId, requestId);
      }
      return;
    }

    debug("Received other message, not forwarding to LiveKit:", json);
  }

  onUdpMessage(rinfo, message, payloadLength, timestamp, sequence) {
    // UDP messages do not reset inactivity timer - only MQTT messages do

    if (!rinfo) {
      return;
    }

    if (this.udp.remoteAddress !== rinfo) {
      // console.log(`✅ [UDP-SAVE] Saved UDP remote address: ${rinfo.address}:${rinfo.port} for virtual device ${this.deviceId}`);
      this.udp.remoteAddress = rinfo;
    }

    if (sequence < this.udp.remoteSequence) {
      return;
    }

    // PHASE 1 OPTIMIZATION: Use StreamingCrypto for cipher caching
    const header = message.slice(0, 16);
    const encryptedPayload = message.slice(16, 16 + payloadLength);
    let payload;
    try {
      payload = streamingCrypto.decrypt(
        encryptedPayload,
        this.udp.encryption,
        this.udp.key,
        header
      );
    } catch (error) {
      logger.error(
        `❌ [UDP] Failed to decrypt UDP packet from ${rinfo.address}:${rinfo.port} for device ${this.deviceId}: ${error.message} ` +
          `(session=${this.udp?.session_id || "unknown"}, payloadLength=${payloadLength}, sequence=${sequence})`
      );
      return;
    }

    const payloadStr = payload.toString();
    if (payloadStr.startsWith("ping:")) {
      console.log(
        `🏓 [UDP PING] Received ping: ${payloadStr} from ${rinfo.address}:${rinfo.port}`
      );
      return;
    }

    // AI Imagine: tap raw decrypted Opus frames into a per-session buffer instead of
    // forwarding to a LiveKit bridge (imagine sessions never create a bridge).
    if (this.imagineFeatureEnabled) {
      // Cap ~2 min of 60ms frames so a device that never sends speech_end can't OOM us.
      if (this.imagineFrames.length < 2000) this.imagineFrames.push(Buffer.from(payload));
      this.udp.remoteSequence = sequence;
      return;
    }

    if (!this.bridge) {
      if (this.deferredSetupInProgress) {
        // Buffer audio during deferred setup — replay once bridge is ready
        if (!this.audioBuffer) this.audioBuffer = [];
        // Cap buffer at 5 seconds (~250 frames at 20ms each) to avoid memory issues
        if (this.audioBuffer.length < 250) {
          this.audioBuffer.push({ message: Buffer.from(message), payloadLength, timestamp, sequence });
        }
      }
      return;
    }

    // Bridge exists but agent hasn't joined yet — keep buffering
    // Audio sent to LiveKit room before agent subscribes is lost (real-time, no server buffering)
    if (this.bridge && !this.bridge.agentJoined) {
      if (!this.audioBuffer) this.audioBuffer = [];
      if (this.audioBuffer.length < 250) {
        this.audioBuffer.push({ message: Buffer.from(message), payloadLength, timestamp, sequence });
      }
      return;
    }

    this.bridge.sendAudio(payload, timestamp);
    this.udp.remoteSequence = sequence;

    // Count packets — stats logged by checkKeepAlive every 10s
    this.audioStats.packetCount++;
    this.audioStats.totalBytes += payload.length;
  }

  async checkKeepAlive() {
    // Don't check keepalive if connection is closing
    console.log("timer 2");
    if (this.closing) {
      return;
    }

    const now = Date.now();

    // Periodic audio status log
    if (this.audioStats) {
      const elapsed = (now - this.audioStats.lastLogTime) / 1000;
      if (elapsed >= 10) {
        if (this.audioStats.packetCount > 0) {
          const pps = Math.round(this.audioStats.packetCount / elapsed);
          const kbps = ((this.audioStats.totalBytes * 8) / elapsed / 1000).toFixed(1);
          console.log(
            `🎤 [AUDIO-STATS] Device ${this.deviceId}: ${this.audioStats.packetCount} packets in ${elapsed.toFixed(0)}s (${pps} pkt/s, ${kbps} kbps)`
          );
        } else {
          console.log(
            `🔇 [AUDIO-STATS] Device ${this.deviceId}: NO audio packets received in ${elapsed.toFixed(0)}s`
          );
        }
        this.audioStats.packetCount = 0;
        this.audioStats.totalBytes = 0;
        this.audioStats.lastLogTime = now;
      }
    }

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

    // Clear agent join failsafe timeout
    if (this.agentJoinFailsafeTimeout) {
      clearTimeout(this.agentJoinFailsafeTimeout);
      this.agentJoinFailsafeTimeout = null;
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
