/**
 * Express Route Scanner
 *
 * Reads manager-api-node route files and extracts all endpoints
 * with their HTTP method, path, and auth middleware.
 *
 * Supports:
 *   - router.get/post/put/delete/patch('/path', middleware..., handler)
 *   - router.use(middlewareFn)  (router-wide middleware)
 *   - router.use('/prefix', subRouter)  (mount paths from index.js)
 *   - validate() middleware detection
 */

const fs = require('fs');
const path = require('path');

// Known auth middleware names → auth type mapping
const AUTH_MIDDLEWARE_MAP = {
  requireAuth: 'bearer',
  requireAdmin: 'admin',
  requireSuperAdmin: 'superAdmin',
  requireServiceKey: 'serviceKey',
  requireDualAuth: 'dualAuth',
  requireFlexAuth: 'flexAuth',
  requireFirebaseAuth: 'firebase',
  optionalAuth: 'optional'
};

/**
 * Parse index.js to extract mount paths: router.use('/prefix', routeModule)
 */
function parseMountPaths(indexFilePath) {
  const content = fs.readFileSync(indexFilePath, 'utf-8');
  const mounts = {};

  // Match: router.use('/path', variableName) or router.use('/path', require('...'))
  const mountRegex = /router\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:(\w+)|require\(['"]([^'"]+)['"]\))\s*\)/g;
  let match;

  while ((match = mountRegex.exec(content)) !== null) {
    const mountPath = match[1];
    const varName = match[2];
    const requirePath = match[3];

    // Resolve which route file this points to
    let routeFile = null;
    if (varName) {
      // Find the require() that defines this variable
      const requireRegex = new RegExp(
        `const\\s+${varName}\\s*=\\s*require\\(['"]([^'"]+)['"]\\)`,
        'm'
      );
      const reqMatch = content.match(requireRegex);
      if (reqMatch) {
        routeFile = reqMatch[1];
      }
    } else if (requirePath) {
      routeFile = requirePath;
    }

    if (routeFile) {
      // Normalize: './auth.routes' → 'auth.routes.js'
      const fileName = path.basename(routeFile).replace(/^\.\//, '');
      const fullFileName = fileName.endsWith('.js') ? fileName : fileName + '.js';
      mounts[fullFileName] = mountPath;
    }
  }

  return mounts;
}

/**
 * Parse inline routes defined directly in index.js (health, pub-config, etc.)
 */
function parseInlineRoutes(indexFilePath) {
  const content = fs.readFileSync(indexFilePath, 'utf-8');
  const routes = [];

  // Match: router.get('/path', handler) or router.get('/path', async handler)
  const routeRegex = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];

    // Check what's between the path and the handler — look for middleware
    const afterPath = content.substring(match.index + match[0].length, match.index + match[0].length + 200);
    const auth = extractMiddleware(afterPath);

    routes.push({
      method,
      path: routePath,
      fullPath: '/toy' + routePath,
      auth: auth || 'none',
      file: 'index.js',
      category: 'health',
      source: 'inline'
    });
  }

  return routes;
}

// Priority order: most restrictive middleware wins when multiple are present.
// e.g. requireAuth + requireSuperAdmin → superAdmin (not bearer)
const AUTH_PRIORITY = [
  'requireSuperAdmin',
  'requireAdmin',
  'requireServiceKey',
  'requireDualAuth',
  'requireFlexAuth',
  'requireFirebaseAuth',
  'requireAuth',
  'optionalAuth'
];

/**
 * Extract auth middleware from the code between route path and handler.
 * Returns the most restrictive auth type found.
 */
function extractMiddleware(codeFragment) {
  for (const mwName of AUTH_PRIORITY) {
    if (codeFragment.includes(mwName)) {
      return AUTH_MIDDLEWARE_MAP[mwName];
    }
  }
  return null;
}

/**
 * Check if a route file has router-wide middleware (router.use(middlewareFn))
 */
function getRouterWideMiddleware(content) {
  // Match: router.use(requireFirebaseAuth) — no path argument
  const routerUseRegex = /router\.use\(\s*(require\w+)\s*\)/g;
  let match;
  while ((match = routerUseRegex.exec(content)) !== null) {
    const mwName = match[1];
    if (AUTH_MIDDLEWARE_MAP[mwName]) {
      return AUTH_MIDDLEWARE_MAP[mwName];
    }
  }
  return null;
}

/**
 * Parse a single route file and extract all endpoints
 */
function parseRouteFile(filePath, mountPath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const category = fileName.replace('.routes.js', '').replace('.js', '');
  const routes = [];

  // Check for router-wide middleware
  const routerWideAuth = getRouterWideMiddleware(content);

  // Match route definitions: router.get('/path', ...)
  const routeRegex = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];

    // Get the code between path string and the next closing of the route definition
    // Look ahead ~300 chars for middleware identification
    const afterPath = content.substring(
      match.index + match[0].length,
      Math.min(match.index + match[0].length + 300, content.length)
    );

    let auth = extractMiddleware(afterPath) || routerWideAuth || 'none';
    const hasValidation = afterPath.includes('validate(');

    routes.push({
      method,
      path: routePath,
      fullPath: '/toy' + mountPath + routePath,
      auth,
      file: fileName,
      category,
      hasValidation,
      source: 'route-file'
    });
  }

  return routes;
}

/**
 * Scan all route files and return discovered routes
 *
 * @param {string} routesDir - Path to manager-api-node/src/routes/
 * @param {Object} options - { category: 'health' } to filter
 * @returns {Array} Discovered routes
 */
function scan(routesDir, options = {}) {
  const indexFile = path.join(routesDir, 'index.js');

  if (!fs.existsSync(indexFile)) {
    throw new Error(`Route index not found: ${indexFile}`);
  }

  // Step 1: Get inline routes from index.js (health, pub-config)
  const inlineRoutes = parseInlineRoutes(indexFile);

  // Step 2: Get mount paths
  const mounts = parseMountPaths(indexFile);

  // Step 3: Scan each route file
  let allRoutes = [...inlineRoutes];

  for (const [fileName, mountPath] of Object.entries(mounts)) {
    const filePath = path.join(routesDir, fileName);
    if (fs.existsSync(filePath)) {
      const routes = parseRouteFile(filePath, mountPath);
      allRoutes = allRoutes.concat(routes);
    }
  }

  // Step 4: Filter by category if specified
  if (options.category) {
    allRoutes = allRoutes.filter(r => r.category === options.category);
  }

  return allRoutes;
}

module.exports = { scan, parseMountPaths, parseInlineRoutes, parseRouteFile };
