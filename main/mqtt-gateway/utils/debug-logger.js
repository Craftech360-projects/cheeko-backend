/**
 * Debug Logger Configuration
 * 
 * Manages debug logging using the debug module.
 * Integrates with ConfigManager for dynamic debug toggle.
 */

const debugModule = require("debug");

/**
 * Create a debug logger instance
 * @param {string} namespace - Debug namespace (e.g., "mqtt-server")
 * @returns {Function} Debug logger function
 */
function createDebugLogger(namespace) {
    return debugModule(namespace);
}

/**
 * Enable or disable debug logging
 * @param {boolean} enabled - Whether to enable debug logging
 * @param {string} namespace - Debug namespace to enable/disable
 */
function setDebugEnabled(enabled, namespace = "mqtt-server") {
    if (enabled) {
        debugModule.enable(namespace);
    } else {
        debugModule.disable();
    }
}

/**
 * Setup debug logger with config manager integration
 * @param {ConfigManager} configManager - Config manager instance
 * @param {string} namespace - Debug namespace
 * @returns {Function} Debug logger function
 */
function setupDebugLogger(configManager, namespace = "mqtt-server") {
    const debug = createDebugLogger(namespace);

    // Set initial debug state from config
    setDebugEnabled(configManager.get("debug"), namespace);

    // Listen for config changes
    configManager.on("configChanged", (config) => {
        setDebugEnabled(config.debug || false, namespace);
    });

    return debug;
}

module.exports = {
    createDebugLogger,
    setDebugEnabled,
    setupDebugLogger,
};
