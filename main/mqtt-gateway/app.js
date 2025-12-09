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
    // Initialize and start the gateway
    const gateway = new MQTTGateway();
    await gateway.start();

    logger.info("✅ [MAIN] MQTT Gateway started successfully");

    // ================================
    // Start REST API Server for MCP
    // ================================
    const express = require('express');
    const { initDeviceAPI } = require('./api/device-api');

    const app = express();
    app.use(express.json());

    // Add device control API routes
    app.use('/api', initDeviceAPI(gateway));

    const API_PORT = process.env.API_PORT || 8081;
    app.listen(API_PORT, () => {
      logger.info(`✅ [API] REST API server listening on port ${API_PORT}`);
      logger.info(`🎯 [READY] System ready to accept device connections and API requests`);
    });

    // Store gateway reference for signal handlers
    global.gateway = gateway;

  } catch (error) {
    logger.error("❌ [FATAL] Failed to start MQTT Gateway:", error);
    process.exit(1);
  }
}

// ================================
// Signal Handlers
// ================================

process.on("SIGINT", async () => {
  logger.info("\n🛑 [SHUTDOWN] Received SIGINT, shutting down gracefully...");
  if (global.gateway && global.gateway.stop) {
    await global.gateway.stop();
  }

  // Wait for Loki batches to be sent before exiting
  // console.log("⏳ [SHUTDOWN] Waiting 3 seconds for log batches to be sent...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("\n🛑 [SHUTDOWN] Received SIGTERM, shutting down gracefully...");
  if (global.gateway && global.gateway.stop) {
    await global.gateway.stop();
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
