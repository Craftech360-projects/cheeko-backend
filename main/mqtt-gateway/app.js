/**
 * MQTT Gateway Entry Point
 * Slim entry point that initializes dependencies and starts the gateway
 * Original monolithic file backed up to app.js.backup
 */

require("dotenv").config();

const debug = require("debug")("mqtt-server");
const {
  RoomServiceClient,
  AgentDispatchClient,
} = require("livekit-server-sdk");

// ================================
// Opus Initialization
// ================================
let OpusEncoder, OpusDecoder;
let opusEncoder = null;
let opusDecoder = null;

try {
  const discordOpus = require("@discordjs/opus");
  OpusEncoder = discordOpus.OpusEncoder;
  OpusDecoder = discordOpus.OpusEncoder; // Discord opus uses same class for encoding/decoding
  console.log(
    "✅ [OPUS] Using native @discordjs/opus (libopus bindings - OPTIMIZED)"
  );
} catch (err) {
  console.error("❌ [OPUS] @discordjs/opus not available:", err.message);
  console.error(
    "❌ [OPUS] Cannot proceed without Opus library. Please run: npm install @discordjs/opus"
  );
  process.exit(1);
}

// ================================
// Import lib modules
// ================================
const { ConfigManager } = require("./utils/config-manager");
const {
  // Constants
  OUTGOING_SAMPLE_RATE,
  INCOMING_SAMPLE_RATE,
  CHANNELS,
  OUTGOING_FRAME_DURATION_MS,
  INCOMING_FRAME_DURATION_MS,

  // Core classes
  StreamingCrypto,
  MQTTGateway,

  // Dependency injection
  setStreamingCrypto,
  setDependencies,
} = require("./lib");

// ================================
// Initialize Config Manager
// ================================
const configManager = new ConfigManager("mqtt.json");

// ================================
// Validate Cerebrium Token
// ================================
const CEREBRIUM_TOKEN = process.env.CEREBRIUM_API_TOKEN;
if (!CEREBRIUM_TOKEN) {
  console.error("❌ [FATAL] CEREBRIUM_API_TOKEN not set in environment!");
  console.error("💡 [HINT] Add CEREBRIUM_API_TOKEN to your .env file");
  process.exit(1);
}
console.log("✅ [AUTH] Cerebrium authentication configured");

// ================================
// Initialize Opus Encoder/Decoder
// ================================
if (OpusEncoder) {
  try {
    opusEncoder = new OpusEncoder(OUTGOING_SAMPLE_RATE, CHANNELS);
    opusDecoder = new OpusEncoder(INCOMING_SAMPLE_RATE, CHANNELS);
    console.log(`✅ [OPUS] Encoder/decoder initialized:`);
    console.log(
      `   Encoder: ${OUTGOING_SAMPLE_RATE}Hz ${OUTGOING_FRAME_DURATION_MS}ms mono`
    );
    console.log(
      `   Decoder: ${INCOMING_SAMPLE_RATE}Hz ${INCOMING_FRAME_DURATION_MS}ms mono`
    );
  } catch (err) {
    console.error(`❌ [OPUS] Failed to initialize encoder/decoder:`, err.message);
    process.exit(1);
  }
}

// ================================
// Initialize StreamingCrypto
// ================================
const streamingCrypto = new StreamingCrypto();
console.log("✅ [CRYPTO] StreamingCrypto initialized");

// ================================
// Inject Dependencies into Modules
// ================================

// Inject into VirtualMQTTConnection
setStreamingCrypto(streamingCrypto);

// Inject into MQTTGateway
setDependencies({
  configManager,
  RoomServiceClient,
  AgentDispatchClient,
  opusEncoder,
  streamingCrypto,
});

console.log("✅ [INIT] All dependencies injected");

// ================================
// Create and Start Gateway
// ================================
const gateway = new MQTTGateway();
gateway.start();

console.log("✅ [GATEWAY] MQTT Gateway started");

// ================================
// Process Event Handlers
// ================================

// Handle unhandled errors from LiveKit SDK
process.on("uncaughtException", (error) => {
  if (
    error.message &&
    error.message.includes("InvalidState - failed to capture frame")
  ) {
    console.warn(
      `⚠️ [GLOBAL] Caught InvalidState error (non-fatal), continuing operation...`
    );
    console.warn(
      `💡 [INFO] This occurs when audio frames arrive during room disconnect - now handled gracefully`
    );
  } else {
    console.error(`❌ [FATAL] Uncaught exception:`, error);
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    `❌ [FATAL] Unhandled rejection at:`,
    promise,
    `reason:`,
    reason
  );
});

process.on("SIGINT", () => {
  console.warn("Received SIGINT signal, starting shutdown");
  gateway.stop();
});
