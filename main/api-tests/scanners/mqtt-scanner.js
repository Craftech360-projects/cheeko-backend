/**
 * MQTT Gateway Scanner
 *
 * Scans mqtt-gateway source code to discover:
 *   - HTTP endpoints from udp-forwarder.js
 *   - MQTT message handlers from mqtt-gateway.js
 */

const fs = require('fs');
const path = require('path');

// Map MQTT handler types to categories for test grouping
const HANDLER_CATEGORIES = {
  hello: 'gateway-device',
  goodbye: 'gateway-device',
  'character-change': 'gateway-device',
  abort: 'gateway-device',
  'mode-change': 'gateway-device',
  'start_greeting': 'gateway-device',
  'playback_control': 'gateway-playback',
  'start_greeting_text': 'gateway-rfid',
  card_lookup: 'gateway-rfid',
  mcp: 'gateway-mcp',
  function_call: 'gateway-function',
  download_request: 'gateway-download',
  habit_download_request: 'gateway-download',
  rhyme_download_request: 'gateway-download'
};

// Handlers that are known to send a response back to the device
const RESPONDS_TO_DEVICE = new Set([
  'hello',
  'card_lookup',
  'start_greeting_text',
  'start_greeting',
  'download_request'
]);

/**
 * Scan udp-forwarder.js for HTTP endpoints
 */
function scanHttpEndpoints(gatewayDir) {
  const filePath = path.join(gatewayDir, 'udp-forwarder.js');
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const routes = [];

  // Match: req.method === 'GET' && req.url === '/health'
  // and: req.method === 'POST' && req.url === '/udp/forward'
  const httpRegex = /req\.method\s*===?\s*['"](\w+)['"]\s*&&\s*req\.url\s*===?\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = httpRegex.exec(content)) !== null) {
    routes.push({
      type: 'http',
      method: match[1],
      path: match[2],
      fullPath: match[2],
      auth: 'none',
      file: 'udp-forwarder.js',
      category: 'gateway-http',
      service: 'mqtt-gateway',
      source: 'udp-forwarder'
    });
  }

  return routes;
}

/**
 * Scan mqtt-gateway.js for MQTT message handlers
 */
function scanMqttHandlers(gatewayDir) {
  const filePath = path.join(gatewayDir, 'mqtt-gateway.js');
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const handlers = [];
  const seenTypes = new Set();

  // Match: originalPayload.type === "handler_name"
  const handlerRegex = /originalPayload\.type\s*===\s*["']([^"']+)["']/g;
  let match;

  while ((match = handlerRegex.exec(content)) !== null) {
    const handlerType = match[1];
    if (seenTypes.has(handlerType)) continue;
    seenTypes.add(handlerType);

    const category = HANDLER_CATEGORIES[handlerType] || 'gateway-misc';

    handlers.push({
      type: 'mqtt',
      method: 'MQTT',
      path: handlerType,
      fullPath: `mqtt://${handlerType}`,
      auth: 'none',
      file: 'mqtt-gateway.js',
      category,
      service: 'mqtt-gateway',
      source: 'mqtt-gateway',
      respondsToDevice: RESPONDS_TO_DEVICE.has(handlerType)
    });
  }

  return handlers;
}

/**
 * Scan all mqtt-gateway sources
 *
 * @param {string} gatewayDir - Path to mqtt-gateway/gateway/
 * @param {Object} options - { category: 'gateway-device' }
 * @returns {Array} Discovered routes/handlers
 */
function scan(gatewayDir, options = {}) {
  if (!fs.existsSync(gatewayDir)) {
    throw new Error(`MQTT gateway directory not found: ${gatewayDir}`);
  }

  let routes = [
    ...scanHttpEndpoints(gatewayDir),
    ...scanMqttHandlers(gatewayDir)
  ];

  if (options.category) {
    routes = routes.filter(r => r.category === options.category);
  }

  return routes;
}

module.exports = { scan, scanHttpEndpoints, scanMqttHandlers };
