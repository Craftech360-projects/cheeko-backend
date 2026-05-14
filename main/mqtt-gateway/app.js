/**
 * MQTT Gateway - Modular Entry Point
 *
 * Refactored from monolithic implementation into modular components.
 * This file serves as the thin orchestration layer.
 */

require('dotenv').config();

// Load console override FIRST (before any other modules)
require('./utils/console-override');

const { validateCerebriumToken } = require('./core/media-api-client');
const { initializeOpus } = require('./core/opus-initializer');
const { setupDebugLogger } = require('./utils/debug-logger');
const { ConfigManager } = require('./utils/config-manager');
const { WorkerPoolManager } = require('./core/worker-pool-manager');
const logger = require('./utils/logger');
const { MQTTGateway, setConfigManager } = require('./gateway/mqtt-gateway');
const { startInternalCommandServer } = require('./gateway/internal-command-server');

validateCerebriumToken();
initializeOpus();

const configManager = new ConfigManager('mqtt.json');
const debug = setupDebugLogger(configManager);

setConfigManager(configManager);

let gateway = null;
let globalWorkerPool = null;
let internalCommandServer = null;

async function main() {
  logger.info('Starting MQTT Gateway...');

  try {
    globalWorkerPool = new WorkerPoolManager(4);

    gateway = new MQTTGateway(globalWorkerPool);
    await gateway.start();

    internalCommandServer = startInternalCommandServer(gateway);

    logger.info('MQTT Gateway started successfully');
  } catch (error) {
    logger.error('Failed to start MQTT Gateway:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  if (internalCommandServer) {
    internalCommandServer.close();
    internalCommandServer = null;
  }

  if (gateway && gateway.stop) {
    await gateway.stop();
  }

  if (globalWorkerPool && globalWorkerPool.terminate) {
    await globalWorkerPool.terminate();
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

if (require.main === module) {
  main().catch((error) => {
    logger.error('Application error:', error);
    process.exit(1);
  });
}

module.exports = {
  configManager,
  debug,
};
