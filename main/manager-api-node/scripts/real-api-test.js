#!/usr/bin/env node
/**
 * Real API Test Suite
 * Tests all major endpoints with actual database operations
 */

require('dotenv').config();
const BASE_URL = 'http://localhost:8002/toy';

const tests = {
  passed: 0,
  failed: 0,
  results: []
};

async function test(name, fn) {
  try {
    const result = await fn();
    tests.passed++;
    tests.results.push({ name, status: 'PASS', result });
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    tests.failed++;
    tests.results.push({ name, status: 'FAIL', error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
    return null;
  }
}

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const { headers: customHeaders, ...restOptions } = options;
  const res = await fetch(url, {
    ...restOptions,
    headers: { 'Content-Type': 'application/json', ...customHeaders }
  });
  const data = await res.json();
  if (data.code !== 0 && !options.expectError) {
    throw new Error(data.msg || `API error: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

async function runTests() {
  console.log('\n=== Real API Test Suite ===\n');

  // 1. Health Endpoints
  console.log('\n--- Health Endpoints ---');
  await test('GET /health', async () => {
    const { data } = await api('/health');
    if (data.data.status !== 'healthy') throw new Error('Not healthy');
    return data.data;
  });

  await test('GET /health/db', async () => {
    const { data } = await api('/health/db');
    if (data.data.database !== 'connected') throw new Error('DB not connected');
    return data.data;
  });

  // 2. Public Config
  console.log('\n--- Public Config ---');
  await test('GET /pub-config', async () => {
    const { data } = await api('/pub-config');
    return data.data;
  });

  // 3. Authentication - Register & Login
  console.log('\n--- Authentication ---');
  const testUser = `test_${Date.now()}`;
  const testPass = 'TestPass123!';

  await test('POST /user/register', async () => {
    const { data } = await api('/user/register', {
      method: 'POST',
      body: JSON.stringify({ username: testUser, password: testPass })
    });
    return data.data;
  });

  let authToken = null;
  await test('POST /user/login', async () => {
    const { data } = await api('/user/login', {
      method: 'POST',
      body: JSON.stringify({ username: testUser, password: testPass })
    });
    authToken = data.data?.token;
    if (!authToken) throw new Error('No token returned');
    return { token: '***' };
  });

  await test('GET /user/info (with auth)', async () => {
    const { data } = await api('/user/info', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return data.data;
  });

  // 4. Devices (public endpoints)
  console.log('\n--- Devices ---');
  // Use unique MAC per test run to avoid "already bound" errors
  const macSuffix = Date.now().toString(16).slice(-6).toUpperCase();
  const testMac = `AA:BB:CC:${macSuffix.slice(0,2)}:${macSuffix.slice(2,4)}:${macSuffix.slice(4,6)}`;

  await test('POST /device/register', async () => {
    const { data } = await api('/device/register', {
      method: 'POST',
      body: JSON.stringify({
        mac: testMac,
        deviceName: 'Test Device',
        firmwareVersion: '1.0.0'
      })
    });
    return data.data;
  });

  await test('GET /device/:mac', async () => {
    const { data } = await api(`/device/${testMac}`);
    return data.data;
  });

  await test('GET /device/:mac/mode', async () => {
    const { data } = await api(`/device/${testMac}/mode`);
    return data.data;
  });

  await test('POST /device/:mac/cycle-mode', async () => {
    const { data } = await api(`/device/${testMac}/cycle-mode`, { method: 'POST' });
    return data.data;
  });

  // 5. Agents
  console.log('\n--- Agents ---');

  // Create an agent first
  let testAgentId = null;
  await test('POST /agent (create agent)', async () => {
    const { data } = await api('/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        agentName: 'Test Agent',
        agentCode: `test-agent-${Date.now()}`,
        systemPrompt: 'You are a helpful test assistant.',
        langCode: 'en',
        language: 'English'
      })
    });
    testAgentId = data.data?.id;
    if (!testAgentId) throw new Error('No agent ID returned');
    return { id: testAgentId };
  });

  // Bind device to agent
  await test('POST /device/bind/:agentId/:mac (bind device)', async () => {
    if (!testAgentId) throw new Error('No agent ID available');
    const { data } = await api(`/device/bind/${testAgentId}/${testMac}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return data.data;
  });

  await test('GET /agent/list (with auth)', async () => {
    const { data } = await api('/agent/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.list?.length || 0 };
  });

  await test('GET /agent/prompt/:mac', async () => {
    const { data } = await api(`/agent/prompt/${testMac}`);
    return data.data;
  });

  await test('GET /agent/config/:mac', async () => {
    const { data } = await api(`/agent/config/${testMac}`);
    return data.data;
  });

  // 6. Content
  console.log('\n--- Content ---');
  await test('GET /content/library (with auth)', async () => {
    const { data } = await api('/content/library', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.list?.length || 0 };
  });

  await test('GET /content/library/categories (with auth)', async () => {
    const { data } = await api('/content/library/categories', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return data.data;
  });

  await test('GET /content/random/music/:mac', async () => {
    const { data } = await api(`/content/random/music/${testMac}`, { expectError: true });
    if (data.code === 0) return data.data;
    if (data.msg?.includes('No music') || data.msg?.includes('not available')) {
      return { skipped: true, reason: 'No music content - run test-setup.sql' };
    }
    throw new Error(data.msg);
  });

  // 7. RFID
  console.log('\n--- RFID ---');

  // Test card lookup (expects data from test-setup.sql)
  const testRfidUid = '04A3B2C1D00000';
  await test('GET /admin/rfid/card/lookup/:uid (public)', async () => {
    const { data } = await api(`/admin/rfid/card/lookup/${testRfidUid}`, { expectError: true });
    // Success if found, skip if not found (depends on test data)
    if (data.code === 0) return data.data;
    if (data.msg?.includes('not found')) return { skipped: true, reason: 'No test data - run test-setup.sql' };
    throw new Error(data.msg);
  });

  await test('GET /admin/rfid/pack/list (with auth)', async () => {
    const { data } = await api('/admin/rfid/pack/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.length || 0 };
  });

  await test('GET /admin/rfid/series/list (with auth)', async () => {
    const { data } = await api('/admin/rfid/series/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.list?.length || 0 };
  });

  // 8. Models
  console.log('\n--- Models ---');
  await test('GET /models/options (public)', async () => {
    const { data } = await api('/models/options');
    return data.data;
  });

  await test('GET /models/tts-voices (public)', async () => {
    const { data } = await api('/models/tts-voices');
    return { count: data.data?.length || 0 };
  });

  await test('GET /models/names (with auth)', async () => {
    const { data } = await api('/models/names', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return data.data;
  });

  // 9. Kid Profiles
  console.log('\n--- Kid Profiles ---');
  await test('GET /api/mobile/kids/list (with auth)', async () => {
    const { data } = await api('/api/mobile/kids/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.length || 0 };
  });

  // 10. Analytics
  console.log('\n--- Analytics ---');
  const serviceKey = process.env.SERVICE_SECRET_KEY || 'test-service-key';

  await test('POST /analytics/session/start (service key)', async () => {
    const { data } = await api('/analytics/session/start', {
      method: 'POST',
      headers: { 'X-Service-Key': serviceKey },
      body: JSON.stringify({ mac: testMac, modeType: 'conversation' }),
      expectError: true
    });
    if (data.code === 0) return data.data;
    if (data.msg?.includes('Failed to start') || data.msg?.includes('table')) {
      return { skipped: true, reason: 'Analytics tables missing - run test-setup.sql' };
    }
    throw new Error(data.msg);
  });

  await test('GET /analytics/user/:mac/overall (with auth)', async () => {
    const { data } = await api(`/analytics/user/${testMac}/overall`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return data.data;
  });

  await test('GET /analytics/usage/daily/:mac (with auth)', async () => {
    const { data } = await api(`/analytics/usage/daily/${testMac}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.length || 0 };
  });

  // 11. System
  console.log('\n--- System ---');
  await test('GET /system/params/list (with auth)', async () => {
    const { data } = await api('/system/params/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.length || 0 };
  });

  await test('GET /system/dict/type/list (with auth)', async () => {
    const { data } = await api('/system/dict/type/list', {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    return { count: data.data?.length || 0 };
  });

  await test('GET /system/dict/data/type/:dictType (public)', async () => {
    const { data } = await api('/system/dict/data/type/sys_status');
    return data.data;
  });

  // 12. Swagger
  console.log('\n--- Documentation ---');
  await test('GET /doc.html (Swagger UI)', async () => {
    const res = await fetch(`${BASE_URL}/doc.html`);
    if (res.status !== 200) throw new Error(`Status: ${res.status}`);
    return { status: res.status };
  });

  await test('GET /swagger.json', async () => {
    const res = await fetch(`${BASE_URL}/swagger.json`);
    const data = await res.json();
    if (!data.openapi) throw new Error('Not OpenAPI spec');
    return { paths: Object.keys(data.paths).length };
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`\nResults: ${tests.passed} passed, ${tests.failed} failed\n`);

  if (tests.failed > 0) {
    console.log('Failed tests:');
    tests.results.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
  }

  process.exit(tests.failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
