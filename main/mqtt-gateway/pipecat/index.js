/**
 * Pipecat Module Index
 *
 * Exports all Pipecat-related functionality for the MQTT gateway.
 */

const { PipecatBridge, setConfigManager: setBridgeConfigManager } = require("./pipecat-bridge");
const {
  sendOffer,
  sendAppMessage,
  terminateSession,
  checkHealth,
  getPipecatConfig,
  setConfigManager: setSignalingConfigManager,
} = require("./pipecat-signaling");
const {
  toPipecat,
  fromPipecat,
  shouldForwardToPipecat,
  shouldForwardToDevice,
  buildGreetingMetadata,
  TO_PIPECAT_MAP,
  FROM_PIPECAT_MAP,
} = require("./message-adapter");

/**
 * Initialize all Pipecat modules with config manager
 */
function setConfigManager(cm) {
  setBridgeConfigManager(cm);
  setSignalingConfigManager(cm);
}

module.exports = {
  // Bridge
  PipecatBridge,

  // Signaling
  sendOffer,
  sendAppMessage,
  terminateSession,
  checkHealth,
  getPipecatConfig,

  // Message Adapter
  toPipecat,
  fromPipecat,
  shouldForwardToPipecat,
  shouldForwardToDevice,
  buildGreetingMetadata,
  TO_PIPECAT_MAP,
  FROM_PIPECAT_MAP,

  // Config
  setConfigManager,
};
