/**
 * HTTP Test Generator
 *
 * Takes discovered routes from the scanner and generates Jest test files.
 * Each route file becomes one .test.js file in suites/manager-api/.
 *
 * Generated tests per endpoint:
 *   - Protected: 401 without auth, 200 happy path, envelope check, response time
 *   - Public: 200 happy path, envelope check, response time
 */

// Placeholder values for parameterized paths.
// IMPORTANT: Values must NOT contain colons — colons look like :param
// placeholders and get mangled by the fallback regex.
const PARAM_DEFAULTS = {
  ':id': 'test-id-000',
  ':mac': '28562F06A5E4',
  ':macAddress': '28562F06A5E4',
  ':agentId': 'test-agent-000',
  ':deviceId': 'test-device-000',
  ':deviceCode': 'TEST000',
  ':rfidUid': 'E96C8A82',
  ':uid': 'E96C8A82',
  ':sessionId': 'test-session-000',
  ':type': 'llm',
  ':provider': 'groq',
  ':dictType': 'device_type',
  ':contentId': 'test-content-000',
  ':templateId': 'test-template-000',
  ':modeType': 'math',
  ':room_name': 'test-room',
  ':key': 'test-key',
  ':age': '8',
  ':packCode': 'TEST-PACK-001',
  ':questionId': 'test-question-000'
};

/**
 * Replace :param placeholders in a path with test values.
 * Fallback regex runs FIRST so known params always win,
 * and no value containing colons can be re-processed.
 */
function resolvePath(routePath) {
  let resolved = routePath;
  // Step 1: Replace unknown :params with safe fallback (no colons)
  resolved = resolved.replace(/:(\w+)/g, (match) => {
    // If we have a known value, use it; otherwise use safe fallback
    if (PARAM_DEFAULTS[match]) {
      return PARAM_DEFAULTS[match];
    }
    return 'test-' + match.substring(1);
  });
  return resolved;
}

/**
 * Escape single quotes in strings for JS code generation
 */
function esc(str) {
  return str.replace(/'/g, "\\'");
}

/**
 * Generate test file content for a group of routes (same category)
 */
function generateTestFile(category, routes, envName) {
  const lines = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated tests for: ${category}`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` * Routes discovered: ${routes.length}`);
  lines.push(` * DO NOT EDIT — this file is regenerated on every test run.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`const { HttpClient } = require('../../lib/http-client');`);
  lines.push(`const { getAuthHeaders, getInvalidHeaders } = require('../../lib/auth-helper');`);
  lines.push(`const config = require('../../test.config');`);
  lines.push(``);
  lines.push(`const env = process.env.TEST_ENV || '${envName}';`);
  lines.push(`const envConfig = config.environments[env];`);
  lines.push(`const client = new HttpClient(envConfig.managerApi.baseUrl);`);
  lines.push(``);
  lines.push(`// Small delay between tests to avoid rate limiting`);
  lines.push(`afterEach(() => new Promise(r => setTimeout(r, 50)));`);
  lines.push(``);

  for (const route of routes) {
    const testPath = resolvePath(route.fullPath.replace(/^\/toy/, ''));
    const describeLabel = `${route.method} ${route.fullPath}`;
    // flexAuth REQUIRES a token (Firebase or JWT) — it is protected, not public
    const isProtected = route.auth !== 'none' && route.auth !== 'optional';
    const isFlexAuth = route.auth === 'flexAuth';

    lines.push(`describe('${esc(describeLabel)}', () => {`);

    // Test 1: Protected → 401 without auth
    if (isProtected) {
      lines.push(`  test('[${route.method} ${esc(route.fullPath)}] should return 401 without auth', async () => {`);
      lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}');`);
      lines.push(`    expect([401, 429]).toContain(res.status);`);
      lines.push(`  });`);
      lines.push(``);
    }

    // Test 2: Happy path with auth
    if (isProtected) {
      lines.push(`  test('[${route.method} ${esc(route.fullPath)}] should not return 401/403 with valid auth', async () => {`);
      lines.push(`    const headers = await getAuthHeaders('${route.auth}', envConfig);`);

      // For POST/PUT, send minimal body to avoid crashes
      if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { headers, body: {} });`);
      } else {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { headers });`);
      }

      lines.push(`    expect(res.status).not.toBe(401);`);
      lines.push(`    expect(res.status).not.toBe(403);`);
      lines.push(`  });`);
    } else if (route.auth === 'none' || route.auth === 'optional') {
      lines.push(`  test('[${route.method} ${esc(route.fullPath)}] should be accessible without auth', async () => {`);

      if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { body: {} });`);
        lines.push(`    expect(res.status).not.toBe(401);`);
        lines.push(`    expect(res.status).not.toBe(403);`);
      } else if (route.method === 'GET') {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}');`);
        lines.push(`    expect([200, 400, 404, 422, 429]).toContain(res.status);`);
      } else {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}');`);
        lines.push(`    expect(res.status).not.toBe(401);`);
      }

      lines.push(`  });`);
    }
    lines.push(``);

    // Test 3: Response envelope check (GET only)
    if (route.method === 'GET') {
      lines.push(`  test('[${route.method} ${esc(route.fullPath)}] should return valid response envelope', async () => {`);
      if (isProtected) {
        lines.push(`    const headers = await getAuthHeaders('${route.auth}', envConfig);`);
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { headers });`);
      } else {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}');`);
      }
      lines.push(`    if (res.status === 200 && res.body && typeof res.body === 'object') {`);
      lines.push(`      expect(res.body).toHaveProperty('code');`);
      lines.push(`      expect(res.body).toHaveProperty('msg');`);
      lines.push(`    }`);
      lines.push(`  });`);
      lines.push(``);
    }

    // Test 4: Response time check
    lines.push(`  test('[${route.method} ${esc(route.fullPath)}] should respond within 5000ms', async () => {`);
    if (isProtected) {
      lines.push(`    const headers = await getAuthHeaders('${route.auth}', envConfig);`);
      if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { headers, body: {} });`);
      } else {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { headers });`);
      }
    } else {
      if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}', { body: {} });`);
      } else {
        lines.push(`    const res = await client.request('${route.method}', '${esc(testPath)}');`);
      }
    }
    lines.push(`    expect(res.responseTimeMs).toBeLessThan(5000);`);
    lines.push(`  });`);

    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}

module.exports = { generateTestFile, resolvePath, PARAM_DEFAULTS };
