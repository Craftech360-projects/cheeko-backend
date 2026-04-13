/**
 * MQTT Gateway - Modular Entry Point
 * 
 * Refactored from 6,964-line monolithic file into 19 modular components.
 * This file serves as the thin orchestration layer.
 */

// ================================
// Environment and Core Setup
// ================================
require("dotenv").config();

// Load console override FIRST (before any other modules)
require("./utils/console-override");

const { validateCerebriumToken } = require("./core/media-api-client");
const { initializeOpus } = require("./core/opus-initializer");
const { setupDebugLogger } = require("./utils/debug-logger");
const { ConfigManager } = require("./utils/config-manager");
const { WorkerPoolManager } = require("./core/worker-pool-manager");
const logger = require("./utils/logger");

// Validate environment
validateCerebriumToken();

// Initialize Opus codec
const { opusEncoder, opusDecoder } = initializeOpus();
// logger.info("✅ [INIT] Opus codec initialized");

// Setup configuration and debug logging
const configManager = new ConfigManager("mqtt.json");
const debug = setupDebugLogger(configManager);

// logger.info("✅ [INIT] Core modules initialized");

// Check and log Loki status
// if (process.env.LOKI_HOST) {
//   logger.info(`✅ [LOGGING] Grafana Loki enabled. Sending logs to: ${process.env.LOKI_HOST}`);
// } else {
//   logger.warn("⚠️ [LOGGING] Grafana Loki NOT configured. Logs will only be saved locally.");
// }

// ================================
// Import Gateway and inject config
// ================================
const { MQTTGateway, setConfigManager } = require("./gateway/mqtt-gateway");

// Inject config manager into gateway (which will cascade to LiveKit bridge)
setConfigManager(configManager);

// ================================
// HTTP Publish Server (for Manager API / Worker)
// ================================
const express = require("express");
const httpPublishApp = express();
httpPublishApp.use(express.json());

const HTTP_PUBLISH_PORT = parseInt(process.env.HTTP_PUBLISH_PORT || "3001", 10);
const HTTP_PUBLISH_SECRET = process.env.HTTP_PUBLISH_SECRET || "";

httpPublishApp.post("/publish", async (req, res) => {
  // Validate secret key
  const secret = req.headers["x-service-key"];
  if (HTTP_PUBLISH_SECRET && secret !== HTTP_PUBLISH_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { topic, payload, macAddress } = req.body || {};
  if (!topic || !payload) {
    return res.status(400).json({ success: false, message: "topic and payload required" });
  }

  try {
    if (!gateway || !gateway.mqttClient || !gateway.mqttClient.connected) {
      return res.status(503).json({ success: false, message: "MQTT client not connected" });
    }

    gateway.mqttPublish(topic, payload);
    logger.info(`📤 [HTTP-PUBLISH] Published to ${topic} for device ${macAddress || "unknown"}`);
    res.json({ success: true, topic, macAddress });
  } catch (error) {
    logger.error(`❌ [HTTP-PUBLISH] Failed to publish to ${topic}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// logger.info("✅ [CONFIG] ConfigManager injected into all modules");

// ================================
// Main Application
// ================================
async function main() {
  logger.info("🚀 [MAIN] Starting MQTT Gateway...");
  // logger.info("📦 [MODULES] Loaded:");
  // logger.info("   ✅ Phase 1: Constants & Utilities (3 modules)");
  // logger.info("   ✅ Phase 2: Core Layer (5 modules)");
  // logger.info("   ✅ Phase 3: LiveKit Layer (4 modules)");
  // logger.info("   ✅ Phase 4: MQTT Layer (2 modules)");
  // logger.info("   ✅ Phase 5: Gateway Layer (5 modules)");
  // logger.info("   ✅ Total: 19 modules loaded");

  try {
    // Initialize global worker pool (shared across all connections)
    globalWorkerPool = new WorkerPoolManager(4);

    // Initialize and start the gateway with the shared worker pool
    gateway = new MQTTGateway(globalWorkerPool);
    await gateway.start();

    // Start HTTP publish server
    httpPublishApp.listen(HTTP_PUBLISH_PORT, () => {
      logger.info(`✅ [HTTP-PUBLISH] Server listening on port ${HTTP_PUBLISH_PORT}`);
    });

    logger.info("✅ [MAIN] MQTT Gateway started successfully");
    // logger.info("🎯 [READY] System ready to accept device connections");
  } catch (error) {
    logger.error("❌ [FATAL] Failed to start MQTT Gateway:", error);
    process.exit(1);
  }
}

// ================================
// Signal Handlers
// ================================
let gateway = null;
let globalWorkerPool = null;

process.on("SIGINT", async () => {
  logger.info("\n🛑 [SHUTDOWN] Received SIGINT, shutting down gracefully...");
  if (gateway && gateway.stop) {
    await gateway.stop();
  }

  // Terminate global worker pool
  if (globalWorkerPool && globalWorkerPool.terminate) {
    await globalWorkerPool.terminate();
  }

  // Wait for Loki batches to be sent before exiting
  // console.log("⏳ [SHUTDOWN] Waiting 3 seconds for log batches to be sent...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("\n🛑 [SHUTDOWN] Received SIGTERM, shutting down gracefully...");
  if (gateway && gateway.stop) {
    await gateway.stop();
  }

  // Terminate global worker pool
  if (globalWorkerPool && globalWorkerPool.terminate) {
    await globalWorkerPool.terminate();
  }

  // Wait for Loki batches to be sent before exiting
  // console.log("⏳ [SHUTDOWN] Waiting 3 seconds for log batches to be sent...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  process.exit(0);
});

// ================================
// Start Application
// ================================
if (require.main === module) {
  main().catch((error) => {
    logger.error("❌ [FATAL] Application error:", error);
    process.exit(1);
  });
}

module.exports = {
  configManager,
  debug,
};
