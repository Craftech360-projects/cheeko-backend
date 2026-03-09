/**
 * FastAPI Test Generator
 *
 * Generates Jest test files for livekit-server media_api.py endpoints.
 * Tests: health check, status codes, response time, body validation.
 *
 * POST endpoints that require active bots (start/stop/next/previous)
 * get lightweight tests — we verify the API responds, not that bots work.
 */

const PARAM_DEFAULTS = {
  ':room_name': 'test-room-000'
};

function resolvePath(routePath) {
  let resolved = routePath;
  // Convert FastAPI {param} to values
  resolved = resolved.replace(/\{(\w+)\}/g, (match, param) => {
    const key = `:${param}`;
    return PARAM_DEFAULTS[key] || `test-${param}`;
  });
  // Also handle any remaining :param style
  resolved = resolved.replace(/:(\w+)/g, (match) => {
    return PARAM_DEFAULTS[match] || 'test-' + match.substring(1);
  });
  return resolved;
}

function esc(str) {
  return str.replace(/'/g, "\\'");
}

/**
 * Generate test file for a group of media API routes (same category)
 */
function generateTestFile(category, routes, envName) {
  const lines = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated tests for: ${category} (livekit-server)`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` * Routes discovered: ${routes.length}`);
  lines.push(` * DO NOT EDIT — this file is regenerated on every test run.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`const { HttpClient } = require('../../lib/http-client');`);
  lines.push(`const config = require('../../test.config');`);
  lines.push(``);
  lines.push(`const env = process.env.TEST_ENV || '${envName}';`);
  lines.push(`const envConfig = config.environments[env];`);
  lines.push(`const client = new HttpClient(envConfig.mediaApi.baseUrl);`);
  lines.push(``);
  lines.push(`afterEach(() => new Promise(r => setTimeout(r, 50)));`);
  lines.push(``);

  for (const route of routes) {
    const testPath = resolvePath(route.path);
    const describeLabel = `${route.method} ${route.path}`;

    lines.push(`describe('${esc(describeLabel)}', () => {`);

    // Health endpoint — special treatment
    if (route.path === '/health' && route.method === 'GET') {
      lines.push(`  test('[${route.method} ${esc(route.path)}] should return 200', async () => {`);
      lines.push(`    const res = await client.get('${esc(testPath)}');`);
      lines.push(`    expect(res.status).toBe(200);`);
      lines.push(`  });`);
      lines.push(``);

      lines.push(`  test('[${route.method} ${esc(route.path)}] should return status field', async () => {`);
      lines.push(`    const res = await client.get('${esc(testPath)}');`);
      lines.push(`    expect(res.body).toHaveProperty('status');`);
      lines.push(`  });`);
      lines.push(``);
    } else if (route.method === 'GET') {
      // GET with path params (e.g. /bot/{room_name}/status) — room won't exist, expect 404
      lines.push(`  test('[${route.method} ${esc(route.path)}] should return 404 for non-existent room', async () => {`);
      lines.push(`    const res = await client.get('${esc(testPath)}');`);
      lines.push(`    expect([404, 422]).toContain(res.status);`);
      lines.push(`  });`);
      lines.push(``);
    } else if (route.method === 'POST') {
      // POST endpoints — test with minimal/empty body
      if (route.hasBody) {
        // Endpoints that require a request body — send minimal payload
        lines.push(`  test('[${route.method} ${esc(route.path)}] should return 422 with empty body', async () => {`);
        lines.push(`    const res = await client.post('${esc(testPath)}', { body: {} });`);
        lines.push(`    expect([404, 422]).toContain(res.status);`);
        lines.push(`  });`);
        lines.push(``);
      } else {
        // Endpoints with only path params (next/previous) — room won't exist, expect 404
        lines.push(`  test('[${route.method} ${esc(route.path)}] should return 404 for non-existent room', async () => {`);
        lines.push(`    const res = await client.post('${esc(testPath)}');`);
        lines.push(`    expect([404, 422]).toContain(res.status);`);
        lines.push(`  });`);
        lines.push(``);
      }
    }

    // Response time check for all endpoints
    lines.push(`  test('[${route.method} ${esc(route.path)}] should respond within 5000ms', async () => {`);
    if (route.method === 'GET') {
      lines.push(`    const res = await client.get('${esc(testPath)}');`);
    } else {
      lines.push(`    const res = await client.post('${esc(testPath)}', { body: {} });`);
    }
    lines.push(`    expect(res.responseTimeMs).toBeLessThan(5000);`);
    lines.push(`  });`);

    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}

module.exports = { generateTestFile, resolvePath, PARAM_DEFAULTS };
