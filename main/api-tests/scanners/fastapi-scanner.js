/**
 * FastAPI Scanner
 *
 * Scans livekit-server/media_api.py to discover HTTP endpoints.
 * Parses @app.get/post/put/delete decorators and extracts route info.
 */

const fs = require('fs');
const path = require('path');

// Map endpoint paths to categories for test grouping
const PATH_CATEGORIES = {
  '/health': 'media-health',
  '/start-music-bot': 'media-music',
  '/start-story-bot': 'media-story',
  '/stop-bot': 'media-control',
  '/music-bot/': 'media-music',
  '/story-bot/': 'media-story',
  '/bot/': 'media-control'
};

/**
 * Determine category from endpoint path
 */
function getCategory(routePath) {
  for (const [prefix, category] of Object.entries(PATH_CATEGORIES)) {
    if (routePath === prefix || routePath.startsWith(prefix)) {
      return category;
    }
  }
  return 'media-misc';
}

/**
 * Convert FastAPI path params {param} to Express-style :param
 */
function convertPathParams(routePath) {
  return routePath.replace(/\{(\w+)\}/g, ':$1');
}

/**
 * Scan media_api.py for FastAPI endpoints
 *
 * @param {string} filePath - Path to media_api.py
 * @param {Object} options - { category: 'media-health' }
 * @returns {Array} Discovered routes
 */
function scan(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media API file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const routes = [];

  // Match: @app.get("/path") or @app.post("/path/{param}")
  const routeRegex = /@app\.(get|post|put|delete|patch)\(\s*"([^"]+)"\s*\)/g;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const category = getCategory(routePath);
    const expressPath = convertPathParams(routePath);

    // Check if the endpoint requires a request body (Pydantic model or Body)
    // Look at the function signature after the decorator
    const afterDecorator = content.substring(match.index, match.index + 500);
    const hasBody = /Request\)/.test(afterDecorator) || /Body\(/.test(afterDecorator);

    routes.push({
      type: 'http',
      method,
      path: routePath,
      expressPath,
      fullPath: routePath,
      auth: 'none', // media_api has no auth middleware
      file: path.basename(filePath),
      category,
      service: 'livekit-server',
      source: 'fastapi',
      hasBody
    });
  }

  if (options.category) {
    routes = routes.filter(r => r.category === options.category);
  }

  return routes;
}

module.exports = { scan };
