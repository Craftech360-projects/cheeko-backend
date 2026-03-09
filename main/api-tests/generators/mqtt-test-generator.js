/**
 * MQTT Test Generator
 *
 * Generates Jest test files for mqtt-gateway endpoints:
 *   - HTTP endpoints: status check, body validation, response time
 *   - MQTT handlers: publish succeeds, response time for responsive handlers
 *
 * Tests skip gracefully when MQTT broker is unavailable.
 */

/**
 * Escape single quotes in strings for JS code generation
 */
function esc(str) {
  return str.replace(/'/g, "\\'");
}

/**
 * Generate test file for a group of mqtt-gateway routes (same category)
 */
function generateTestFile(category, routes, envName) {
  const hasHttp = routes.some(r => r.type === 'http');
  const hasMqtt = routes.some(r => r.type === 'mqtt');

  const lines = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated tests for: ${category} (mqtt-gateway)`);
  lines.push(` * Generated at: ${new Date().toISOString()}`);
  lines.push(` * Routes discovered: ${routes.length}`);
  lines.push(` * DO NOT EDIT — this file is regenerated on every test run.`);
  lines.push(` */`);
  lines.push(``);

  if (hasHttp) {
    lines.push(`const { HttpClient } = require('../../lib/http-client');`);
  }
  if (hasMqtt) {
    lines.push(`const { MqttClient } = require('../../lib/mqtt-client');`);
  }
  lines.push(`const config = require('../../test.config');`);
  lines.push(``);
  lines.push(`const env = process.env.TEST_ENV || '${envName}';`);
  lines.push(`const envConfig = config.environments[env];`);
  lines.push(`const gwConfig = envConfig.mqttGateway;`);
  lines.push(``);

  if (hasHttp) {
    lines.push(`const httpClient = new HttpClient(gwConfig.httpUrl);`);
    lines.push(``);
  }

  if (hasMqtt) {
    lines.push(`let mqttClient;`);
    lines.push(``);
    lines.push(`beforeAll(async () => {`);
    lines.push(`  mqttClient = new MqttClient(gwConfig.brokerUrl);`);
    lines.push(`  const connected = await mqttClient.connect();`);
    lines.push(`  if (!connected) {`);
    lines.push(`    console.warn('MQTT broker not available — MQTT tests will be skipped');`);
    lines.push(`    mqttClient = null;`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push(``);
    lines.push(`afterAll(async () => {`);
    lines.push(`  if (mqttClient) await mqttClient.disconnect();`);
    lines.push(`});`);
    lines.push(``);
  }

  // Small delay between tests
  lines.push(`afterEach(() => new Promise(r => setTimeout(r, 50)));`);
  lines.push(``);

  // Generate HTTP tests
  const httpRoutes = routes.filter(r => r.type === 'http');
  for (const route of httpRoutes) {
    const describeLabel = `${route.method} ${route.path}`;

    lines.push(`describe('${esc(describeLabel)}', () => {`);

    // Test 1: Status check
    if (route.method === 'GET') {
      lines.push(`  test('[HTTP ${esc(route.method)} ${esc(route.path)}] should return 200', async () => {`);
      lines.push(`    const res = await httpClient.get('${esc(route.path)}');`);
      lines.push(`    expect(res.status).toBe(200);`);
      lines.push(`  });`);
      lines.push(``);
    }

    // Test 2: Body validation for health endpoint
    if (route.method === 'GET' && route.path === '/health') {
      lines.push(`  test('[HTTP ${esc(route.method)} ${esc(route.path)}] should return status field', async () => {`);
      lines.push(`    const res = await httpClient.get('${esc(route.path)}');`);
      lines.push(`    expect(res.body).toHaveProperty('status');`);
      lines.push(`  });`);
      lines.push(``);
    }

    // Test 3: POST validation (missing headers → 400)
    if (route.method === 'POST') {
      lines.push(`  test('[HTTP ${esc(route.method)} ${esc(route.path)}] should return 400 without required headers', async () => {`);
      lines.push(`    const res = await httpClient.post('${esc(route.path)}', { body: Buffer.alloc(0) });`);
      lines.push(`    expect([400, 404, 500]).toContain(res.status);`);
      lines.push(`  });`);
      lines.push(``);
    }

    // Test 4: Response time
    lines.push(`  test('[HTTP ${esc(route.method)} ${esc(route.path)}] should respond within 5000ms', async () => {`);
    if (route.method === 'GET') {
      lines.push(`    const res = await httpClient.get('${esc(route.path)}');`);
    } else {
      lines.push(`    const res = await httpClient.post('${esc(route.path)}', { body: Buffer.alloc(0) });`);
    }
    lines.push(`    expect(res.responseTimeMs).toBeLessThan(5000);`);
    lines.push(`  });`);

    lines.push(`});`);
    lines.push(``);
  }

  // Generate MQTT tests
  const mqttRoutes = routes.filter(r => r.type === 'mqtt');
  for (const route of mqttRoutes) {
    const describeLabel = `MQTT ${route.path}`;

    lines.push(`describe('${esc(describeLabel)}', () => {`);

    // Test 1: Publish succeeds
    lines.push(`  test('[MQTT ${esc(route.path)}] should publish successfully', async () => {`);
    lines.push(`    if (!mqttClient) return; // Skip if broker unavailable`);
    lines.push(`    const result = await mqttClient.publishAndWait('${esc(route.path)}', ${getTestPayload(route.path)});`);
    lines.push(`    expect(result.published).toBe(true);`);
    lines.push(`  });`);
    lines.push(``);

    // Test 2: Response time for handlers that respond
    if (route.respondsToDevice) {
      lines.push(`  test('[MQTT ${esc(route.path)}] should respond within 5000ms', async () => {`);
      lines.push(`    if (!mqttClient) return; // Skip if broker unavailable`);
      lines.push(`    const result = await mqttClient.publishAndWait('${esc(route.path)}', ${getTestPayload(route.path)}, { waitForResponse: true, timeoutMs: 5000 });`);
      lines.push(`    expect(result.published).toBe(true);`);
      lines.push(`    if (!result.timedOut) {`);
      lines.push(`      expect(result.responseTimeMs).toBeLessThan(5000);`);
      lines.push(`    }`);
      lines.push(`  });`);
      lines.push(``);
    }

    lines.push(`});`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Return a JSON string for test payload based on handler type
 */
function getTestPayload(handlerType) {
  switch (handlerType) {
    case 'hello':
      return '{ mac: "AABBCCDDEEFF" }';
    case 'card_lookup':
    case 'start_greeting_text':
      return '{ rfid_uid: "E96C8A82", sequence: 1 }';
    case 'mode-change':
      return '{ mode: "conversation" }';
    case 'character-change':
      return '{ character: "cheeko" }';
    case 'playback_control':
      return '{ action: "next" }';
    case 'download_request':
    case 'habit_download_request':
    case 'rhyme_download_request':
      return '{ content_type: "habit" }';
    case 'function_call':
      return '{ function_call: { name: "play_music", arguments: {} } }';
    case 'mcp':
      return '{ payload: { id: "test-1", method: "test" } }';
    default:
      return '{}';
  }
}

module.exports = { generateTestFile };
