/**
 * Scanner Orchestrator
 *
 * Runs all scanners and merges results into a single route list.
 */

const expressScanner = require('./express-scanner');
const mqttScanner = require('./mqtt-scanner');
const fastapiScanner = require('./fastapi-scanner');
const config = require('../test.config');

/**
 * Run all scanners and return discovered routes
 *
 * @param {Object} options - { service: 'manager-api', category: 'health' }
 * @returns {Object} { routes: [], summary: {} }
 */
function scanAll(options = {}) {
  const results = {
    routes: [],
    summary: {
      total: 0,
      byService: {},
      byAuth: {},
      byMethod: {}
    }
  };

  // Scan manager-api-node
  if (!options.service || options.service === 'manager-api') {
    try {
      const routes = expressScanner.scan(config.sources.managerApiRoutes, {
        category: options.category
      });

      routes.forEach(r => { r.service = 'manager-api'; });
      results.routes = results.routes.concat(routes);
    } catch (err) {
      console.error('Express scanner error:', err.message);
    }
  }

  // Scan mqtt-gateway
  if (!options.service || options.service === 'mqtt-gateway') {
    try {
      const routes = mqttScanner.scan(config.sources.mqttGateway, {
        category: options.category
      });

      results.routes = results.routes.concat(routes);
    } catch (err) {
      console.error('MQTT scanner error:', err.message);
    }
  }

  // Scan livekit-server (media_api.py)
  if (!options.service || options.service === 'livekit-server') {
    try {
      const routes = fastapiScanner.scan(config.sources.mediaApi, {
        category: options.category
      });

      results.routes = results.routes.concat(routes);
    } catch (err) {
      console.error('FastAPI scanner error:', err.message);
    }
  }

  // Compute summary
  results.summary.total = results.routes.length;

  for (const route of results.routes) {
    // By service
    results.summary.byService[route.service] = (results.summary.byService[route.service] || 0) + 1;

    // By auth type
    results.summary.byAuth[route.auth] = (results.summary.byAuth[route.auth] || 0) + 1;

    // By HTTP method
    results.summary.byMethod[route.method] = (results.summary.byMethod[route.method] || 0) + 1;
  }

  return results;
}

module.exports = { scanAll };
