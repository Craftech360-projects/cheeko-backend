/**
 * Scanner Orchestrator
 *
 * Runs all scanners and merges results into a single route list.
 */

const expressScanner = require('./express-scanner');
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

  // TODO: Add mqtt-scanner when building mqtt-gateway tests
  // TODO: Add fastapi-scanner when building livekit-server tests

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
