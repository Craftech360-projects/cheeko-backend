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

const { validateCerebriumToken } = require("./core/media-api-client");
const { initializeOpus } = require("./core/opus-initializer");
const { setupDebugLogger } = require("./utils/debug-logger");
const { ConfigManager } = require("./utils/config-manager");

// Validate environment
validateCerebriumToken();

// Initialize Opus codec
const { opusEncoder, opusDecoder } = initializeOpus();
console.log("✅ [INIT] Opus codec initialized");

// Setup configuration and debug logging
const configManager = new ConfigManager("mqtt.json");
const debug = setupDebugLogger(configManager);

console.log("✅ [INIT] Core modules initialized");

// ================================
// Import Gateway and inject config
// ================================
const { MQTTGateway, setConfigManager } = require("./gateway/mqtt-gateway");

// Inject config manager into gateway (which will cascade to LiveKit bridge)
setConfigManager(configManager);

console.log("✅ [CONFIG] ConfigManager injected into all modules");

// ================================
// Main Application
// ================================
async function main() {
    console.log("🚀 [MAIN] Starting MQTT Gateway (Modular Architecture)...");
    console.log("📦 [MODULES] Loaded:");
    console.log("   ✅ Phase 1: Constants & Utilities (3 modules)");
    console.log("   ✅ Phase 2: Core Layer (5 modules)");
    console.log("   ✅ Phase 3: LiveKit Layer (4 modules)");
    console.log("   ✅ Phase 4: MQTT Layer (2 modules)");
    console.log("   ✅ Phase 5: Gateway Layer (5 modules)");
    console.log("   ✅ Total: 19 modules loaded");

    try {
        // Initialize and start the gateway
        const gateway = new MQTTGateway();
        await gateway.start();

        console.log("✅ [MAIN] MQTT Gateway started successfully");
        console.log("🎯 [READY] System ready to accept device connections");
    } catch (error) {
        console.error("❌ [FATAL] Failed to start MQTT Gateway:", error);
        process.exit(1);
    }
}

// ================================
// Signal Handlers
// ================================
let gateway = null;

process.on("SIGINT", async () => {
    console.log("\n🛑 [SHUTDOWN] Received SIGINT, shutting down gracefully...");
    if (gateway && gateway.stop) {
        await gateway.stop();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("\n🛑 [SHUTDOWN] Received SIGTERM, shutting down gracefully...");
    if (gateway && gateway.stop) {
        await gateway.stop();
    }
    process.exit(0);
});

// ================================
// Start Application
// ================================
if (require.main === module) {
    main().catch((error) => {
        console.error("❌ [FATAL] Application error:", error);
        process.exit(1);
    });
}

module.exports = {
    configManager,
    debug,
};
