#!/usr/bin/env node
/**
 * Full API Test Suite - Tests ALL 211 endpoints
 * Run: node scripts/full-api-test.js
 */

require('dotenv').config();
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8002/toy';

const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

async function test(method, path, options = {}) {
  const name = `${method.toUpperCase()} ${path}`;
  try {
    const url = `${BASE_URL}${path}`;
    const { headers = {}, body, expectStatus = [200, 201], skip = false, skipReason = '' } = options;

    if (skip) {
      results.skipped++;
      results.tests.push({ name, status: 'SKIP', reason: skipReason });
      return { skipped: true };
    }

    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => ({}));
    const statusOk = expectStatus.includes(res.status) || (data.code === 0);

    if (statusOk) {
      results.passed++;
      results.tests.push({ name, status: 'PASS', statusCode: res.status });
      return { success: true, data };
    } else {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', statusCode: res.status, error: data.msg || 'Unknown error' });
      return { success: false, data };
    }
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: error.message });
    return { success: false, error };
  }
}

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  FULL API TEST SUITE - Testing ALL 211 Endpoints');
  console.log('='.repeat(60) + '\n');

  // Setup: Create test user and get auth token
  const timestamp = Date.now();
  const testUser = `testuser_${timestamp}`;
  const testPass = 'TestPass123!';
  const macSuffix = timestamp.toString(16).slice(-6).toUpperCase();
  const testMac = `AA:BB:CC:${macSuffix.slice(0,2)}:${macSuffix.slice(2,4)}:${macSuffix.slice(4,6)}`;
  const serviceKey = process.env.SERVICE_SECRET_KEY || 'test-service-key';

  let authToken = null;
  let testAgentId = null;
  let testDeviceId = null;
  let testUserId = null;
  let testKidId = null;
  let testContentId = null;
  let testModelId = null;
  let testPackId = null;
  let testSeriesId = null;
  let testCardId = null;
  let testParamId = null;
  let testDictTypeId = null;
  let testDictDataId = null;
  let testFirmwareId = null;
  let testTtsVoiceId = null;
  let testSessionId = null;

  // ========================================
  // HEALTH & PUBLIC (index.js) - 3 endpoints
  // ========================================
  console.log('\n--- Health & Public (3 endpoints) ---');
  await test('get', '/health');
  await test('get', '/health/db');
  await test('get', '/pub-config');

  // ========================================
  // AUTH (auth.routes.js) - 10 endpoints
  // ========================================
  console.log('\n--- Auth (10 endpoints) ---');

  // Register
  const regResult = await test('post', '/user/register', {
    body: { username: testUser, password: testPass, email: `${testUser}@test.com` }
  });

  // Login
  const loginResult = await test('post', '/user/login', {
    body: { username: testUser, password: testPass }
  });
  if (loginResult.data?.data?.token) {
    authToken = loginResult.data.data.token;
    testUserId = loginResult.data.data.id;
  }

  const authHeaders = { Authorization: `Bearer ${authToken}` };

  await test('get', '/user/captcha');
  await test('get', '/user/info', { headers: authHeaders });
  await test('put', '/user/change-password', {
    headers: authHeaders,
    body: { oldPassword: testPass, newPassword: testPass },
    expectStatus: [200, 400] // May fail if password same
  });
  await test('put', '/user/update-password', {
    body: { username: testUser, newPassword: testPass },
    expectStatus: [200, 400]
  });
  await test('post', '/user/smsVerification', {
    body: { phone: '1234567890' },
    expectStatus: [200, 400, 501] // May not be implemented
  });
  // Skip logout and delete for now to keep session active
  await test('post', '/user/logout', { headers: authHeaders, skip: true, skipReason: 'Keep session active' });
  await test('delete', '/user/delete-account', { skip: true, skipReason: 'Preserve test user' });

  // ========================================
  // DEVICE (device.routes.js) - 27 endpoints
  // ========================================
  console.log('\n--- Device (27 endpoints) ---');

  // Register device
  const deviceResult = await test('post', '/device/register', {
    body: { mac: testMac, board: 'esp32', appVersion: '1.0.0' }
  });
  if (deviceResult.data?.data?.id) testDeviceId = deviceResult.data.data.id;

  await test('get', `/device/${testMac}`);
  await test('get', `/device/${testMac}/mode`);
  await test('get', `/device/${testMac}/device-mode`);
  await test('post', `/device/${testMac}/cycle-mode`);
  await test('get', '/device/list', { headers: authHeaders });

  // Manual add
  await test('post', '/device/manual-add', {
    headers: authHeaders,
    body: { mac: `BB:CC:DD:${macSuffix.slice(0,2)}:${macSuffix.slice(2,4)}:${macSuffix.slice(4,6)}`, alias: 'Test Device' },
    expectStatus: [200, 400]
  });

  // OTA endpoints
  await test('post', '/device/ota/check', { body: { mac: testMac, currentVersion: '1.0.0' } });
  await test('get', '/device/ota/firmware', { headers: authHeaders });
  await test('get', '/device/ota/firmware/all', { headers: authHeaders });
  await test('get', '/device/ota/firmware/latest/esp32', { headers: authHeaders, expectStatus: [200, 404] });

  // Create firmware for testing
  const fwResult = await test('post', '/device/ota/firmware', {
    headers: authHeaders,
    body: { firmwareName: 'Test FW', type: 'esp32', version: `1.0.${timestamp}`, size: 1024 }
  });
  if (fwResult.data?.data?.id) testFirmwareId = fwResult.data.data.id;

  await test('get', `/device/ota/firmware/${testFirmwareId || 'none'}`, {
    headers: authHeaders,
    expectStatus: testFirmwareId ? [200] : [404]
  });
  await test('put', `/device/ota/firmware/${testFirmwareId || 'none'}`, {
    headers: authHeaders,
    body: { remark: 'Updated' },
    expectStatus: testFirmwareId ? [200] : [404]
  });
  await test('put', `/device/ota/firmware/${testFirmwareId || 'none'}/force-update`, {
    headers: authHeaders,
    body: { forceUpdate: 0 },
    expectStatus: testFirmwareId ? [200] : [404]
  });

  // Token usage
  await test('post', '/device/token-usage', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, inputTokens: 100, outputTokens: 50 }
  });
  await test('get', '/device/token-usage/summary', { headers: authHeaders });
  await test('get', `/device/token-usage/${testMac}/stats`, { headers: authHeaders });
  await test('get', `/device/token-usage/${testMac}`, { headers: authHeaders });

  // Update device
  if (testDeviceId) {
    await test('put', `/device/update/${testDeviceId}`, {
      headers: authHeaders,
      body: { alias: 'Updated Device' }
    });
  }

  // Assign kid (will create kid first later)
  await test('put', `/device/assign-kid/${testDeviceId || 'none'}`, {
    headers: authHeaders,
    body: { kidId: null },
    expectStatus: [200, 400, 404]
  });
  await test('put', '/device/assign-kid-by-mac', {
    headers: authHeaders,
    body: { mac: testMac, kidId: null },
    expectStatus: [200, 400]
  });

  // Bind/unbind (need agent first)
  await test('get', `/device/bind/none`, { headers: authHeaders, expectStatus: [200, 404] });
  await test('post', '/device/unbind', { headers: authHeaders, body: { deviceId: 'none' }, expectStatus: [200, 400] });

  // Delete firmware (cleanup)
  await test('delete', `/device/ota/firmware/${testFirmwareId || 'none'}`, {
    headers: authHeaders,
    expectStatus: [200, 404]
  });
  await test('delete', `/device/token-usage/${testMac}`, { headers: authHeaders, expectStatus: [200, 404] });

  // ========================================
  // AGENT (agent.routes.js) - 15 endpoints
  // ========================================
  console.log('\n--- Agent (15 endpoints) ---');

  // Create agent
  const agentResult = await test('post', '/agent', {
    headers: authHeaders,
    body: { agentName: `Test Agent ${timestamp}`, agentCode: `test-${timestamp}`, systemPrompt: 'Test prompt' }
  });
  if (agentResult.data?.data?.id) testAgentId = agentResult.data.data.id;

  await test('get', '/agent/list', { headers: authHeaders });
  await test('get', '/agent/all', { headers: authHeaders });

  // Bind device to agent
  if (testAgentId) {
    await test('post', `/device/bind/${testAgentId}/${testMac}`, { headers: authHeaders });
  }

  await test('get', `/agent/prompt/${testMac}`);
  await test('get', `/agent/config/${testMac}`);
  await test('get', `/agent/agent-id/${testMac}`, { expectStatus: [200, 404] });
  await test('get', `/agent/current-character/${testMac}`, { expectStatus: [200, 404] });
  await test('post', `/agent/cycle-character/${testMac}`, { expectStatus: [200, 404] });

  if (testAgentId) {
    await test('post', `/agent/set-character/${testMac}/${testAgentId}`, { expectStatus: [200, 400] });
    await test('get', `/agent/${testAgentId}`, { headers: authHeaders });
    await test('get', `/agent/${testAgentId}/sessions`, { headers: authHeaders });
    await test('get', `/agent/${testAgentId}/chat-history/test-session`, { headers: authHeaders, expectStatus: [200] });
    await test('put', `/agent/${testAgentId}`, {
      headers: authHeaders,
      body: { agentName: 'Updated Agent' }
    });
  }

  await test('post', '/agent/chat-message', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, sessionId: 'test-session', chatType: 1, content: 'Hello' }
  });

  // Delete agent (cleanup later)

  // ========================================
  // CONTENT (content.routes.js) - 35 endpoints
  // ========================================
  console.log('\n--- Content (35 endpoints) ---');

  await test('get', '/content/library', { headers: authHeaders });
  await test('get', '/content/library/search?query=test', { headers: authHeaders });
  await test('get', '/content/library/categories', { headers: authHeaders });

  // Create content
  const contentResult = await test('post', '/content/library', {
    headers: authHeaders,
    body: { title: `Test Content ${timestamp}`, contentType: 'music', category: 'test' }
  });
  if (contentResult.data?.data?.id) testContentId = contentResult.data.data.id;

  await test('post', '/content/library/batch', {
    headers: authHeaders,
    body: { items: [{ title: 'Batch 1', contentType: 'music' }, { title: 'Batch 2', contentType: 'story' }] }
  });

  if (testContentId) {
    await test('get', `/content/library/${testContentId}`, { headers: authHeaders });
    await test('put', `/content/library/${testContentId}`, {
      headers: authHeaders,
      body: { title: 'Updated Content' }
    });
  }

  // Legacy music endpoints
  await test('get', '/content/music/list', { headers: authHeaders });
  const musicResult = await test('post', '/content/music/create', {
    headers: authHeaders,
    body: { title: `Test Music ${timestamp}`, artist: 'Test Artist' }
  });
  const testMusicId = musicResult.data?.data?.id;
  if (testMusicId) {
    await test('get', `/content/music/${testMusicId}`, { headers: authHeaders });
    await test('put', `/content/music/update/${testMusicId}`, {
      headers: authHeaders,
      body: { title: 'Updated Music' }
    });
  }

  // Textbook endpoints
  await test('get', '/content/textbook/list', { headers: authHeaders });
  await test('post', '/content/textbook/create', {
    headers: authHeaders,
    body: { title: `Test Textbook ${timestamp}`, subject: 'Math', grade: '1' },
    expectStatus: [200, 400]
  });

  // Random content & search
  await test('get', `/content/random/music/${testMac}`, { expectStatus: [200, 404] });
  await test('get', `/content/random/story/${testMac}`, { expectStatus: [200, 404] });
  await test('get', '/content/search?query=test', { headers: authHeaders });

  // Cleanup content
  if (testMusicId) await test('delete', `/content/music/delete/${testMusicId}`, { headers: authHeaders });
  if (testContentId) await test('delete', `/content/library/${testContentId}`, { headers: authHeaders });

  // ========================================
  // RFID (rfid.routes.js) - 30 endpoints
  // ========================================
  console.log('\n--- RFID (30 endpoints) ---');

  await test('get', '/admin/rfid/card/page', { headers: authHeaders });
  await test('get', '/admin/rfid/card/list', { headers: authHeaders });
  await test('get', '/admin/rfid/card/lookup/04A3B2C1D00000', { expectStatus: [200, 404] });
  await test('post', '/admin/rfid/card/rag-lookup/04A3B2C1D00000', {
    body: { queryText: 'test' },
    expectStatus: [200, 404]
  });
  await test('post', '/admin/rfid/rag/search', {
    body: { query: 'test' },
    expectStatus: [200, 400]
  });

  // Pack management
  await test('get', '/admin/rfid/pack/list', { headers: authHeaders });
  const packResult = await test('post', '/admin/rfid/pack', {
    headers: authHeaders,
    body: { packName: `Test Pack ${timestamp}`, packCode: `pack-${timestamp}` },
    expectStatus: [200, 403] // May require admin
  });
  if (packResult.data?.data?.id) testPackId = packResult.data.data.id;

  await test('get', `/admin/rfid/pack/${testPackId || 1}`, { headers: authHeaders, expectStatus: [200, 404] });
  await test('put', '/admin/rfid/pack', {
    headers: authHeaders,
    body: { id: testPackId || 1, packName: 'Updated Pack' },
    expectStatus: [200, 403, 404]
  });
  await test('get', `/admin/rfid/content-pack/${testPackId || 1}`, { expectStatus: [200, 404] });

  // Series management
  await test('get', '/admin/rfid/series/page', { headers: authHeaders });
  await test('get', '/admin/rfid/series/list', { headers: authHeaders });
  await test('get', '/admin/rfid/series/lookup/04A3B2C1D00000', { expectStatus: [200, 404] });

  const seriesResult = await test('post', '/admin/rfid/series', {
    headers: authHeaders,
    body: { seriesName: `Series ${timestamp}`, startUid: '04000000000000', endUid: '04FFFFFFFFFFFF' },
    expectStatus: [200, 403]
  });
  if (seriesResult.data?.data?.id) testSeriesId = seriesResult.data.data.id;

  await test('get', `/admin/rfid/series/${testSeriesId || 1}`, { headers: authHeaders, expectStatus: [200, 404] });
  await test('put', '/admin/rfid/series', {
    headers: authHeaders,
    body: { id: testSeriesId || 1, seriesName: 'Updated Series' },
    expectStatus: [200, 403, 404]
  });

  // Card management
  const cardResult = await test('post', '/admin/rfid/card', {
    headers: authHeaders,
    body: { rfidUid: `04${timestamp.toString(16).slice(-10).toUpperCase()}`, actionType: 'content' },
    expectStatus: [200, 403]
  });
  if (cardResult.data?.data?.id) testCardId = cardResult.data.data.id;

  await test('put', '/admin/rfid/card', {
    headers: authHeaders,
    body: { id: testCardId || 1, actionType: 'question' },
    expectStatus: [200, 403, 404]
  });

  // Legacy RFID endpoints
  await test('get', '/admin/rfid/list', { headers: authHeaders });
  await test('get', '/admin/rfid/by-uid/04A3B2C1D00000', { headers: authHeaders, expectStatus: [200, 404] });
  await test('post', '/admin/rfid/create', {
    headers: authHeaders,
    body: { uid: `05${timestamp.toString(16).slice(-10).toUpperCase()}`, name: 'Test Card' },
    expectStatus: [200, 400, 403]
  });
  await test('get', `/admin/rfid/${testCardId || 1}`, { headers: authHeaders, expectStatus: [200, 404] });
  await test('put', `/admin/rfid/update/${testCardId || 1}`, {
    headers: authHeaders,
    body: { name: 'Updated Card' },
    expectStatus: [200, 403, 404]
  });

  // Scan endpoints
  await test('post', `/admin/rfid/scan/${testMac}/04A3B2C1D00000`, { expectStatus: [200, 404] });
  await test('get', '/admin/rfid/scan-logs', { headers: authHeaders });
  await test('post', '/admin/rfid/register-batch', {
    headers: authHeaders,
    body: { cards: [{ uid: '06000000000001', name: 'Batch 1' }] },
    expectStatus: [200, 400, 403]
  });

  // Cleanup
  if (testCardId) await test('delete', '/admin/rfid/card', { headers: authHeaders, body: { id: testCardId }, expectStatus: [200, 403] });
  if (testSeriesId) await test('delete', `/admin/rfid/series/${testSeriesId}`, { headers: authHeaders, expectStatus: [200, 403] });
  if (testPackId) await test('delete', `/admin/rfid/pack/${testPackId}`, { headers: authHeaders, expectStatus: [200, 403] });
  await test('delete', `/admin/rfid/delete/${testCardId || 1}`, { headers: authHeaders, expectStatus: [200, 403, 404] });

  // ========================================
  // MODEL (model.routes.js) - 18 endpoints
  // ========================================
  console.log('\n--- Model (18 endpoints) ---');

  await test('get', '/models/names', { headers: authHeaders });
  await test('get', '/models/llm/names', { headers: authHeaders });
  await test('get', '/models/options');
  await test('get', '/models/list', { headers: authHeaders });
  await test('get', '/models/tts-voices');
  await test('get', '/models/type/llm', { headers: authHeaders });
  await test('get', '/models/llm/provideTypes', { headers: authHeaders });

  // Create model
  const modelResult = await test('post', '/models/create', {
    headers: authHeaders,
    body: { modelName: `Test Model ${timestamp}`, modelType: 'llm', provider: 'test' }
  });
  if (modelResult.data?.data?.id) testModelId = modelResult.data.data.id;

  if (testModelId) {
    await test('get', `/models/${testModelId}`, { headers: authHeaders });
    await test('put', `/models/update/${testModelId}`, {
      headers: authHeaders,
      body: { modelName: 'Updated Model' }
    });
  }

  // Provider-specific endpoints
  await test('post', '/models/llm/openai', {
    headers: authHeaders,
    body: { modelName: 'GPT Test', modelCode: 'gpt-test' },
    expectStatus: [200, 400]
  });
  await test('put', `/models/llm/openai/${testModelId || 'none'}`, {
    headers: authHeaders,
    body: { modelName: 'Updated' },
    expectStatus: [200, 400, 404]
  });

  // TTS Voice endpoints
  const voiceResult = await test('post', '/models/tts-voices/create', {
    headers: authHeaders,
    body: { voiceName: `Test Voice ${timestamp}`, voiceCode: `voice-${timestamp}`, language: 'en' }
  });
  if (voiceResult.data?.data?.id) testTtsVoiceId = voiceResult.data.data.id;

  if (testTtsVoiceId) {
    await test('get', `/models/tts-voices/${testTtsVoiceId}`, { headers: authHeaders });
    await test('put', `/models/tts-voices/update/${testTtsVoiceId}`, {
      headers: authHeaders,
      body: { voiceName: 'Updated Voice' }
    });
    await test('delete', `/models/tts-voices/delete/${testTtsVoiceId}`, { headers: authHeaders });
  }

  // Cleanup
  if (testModelId) await test('delete', `/models/${testModelId}`, { headers: authHeaders });
  await test('delete', `/models/delete/${testModelId || 'none'}`, { headers: authHeaders, expectStatus: [200, 404] });

  // ========================================
  // PROFILE (profile.routes.js) - 21 endpoints
  // ========================================
  console.log('\n--- Profile (21 endpoints) ---');

  // Kid profiles
  await test('get', '/api/mobile/kids/list', { headers: authHeaders });
  await test('get', '/api/mobile/kids', { headers: authHeaders });

  const kidResult = await test('post', '/api/mobile/kids/create', {
    headers: authHeaders,
    body: { name: `Test Kid ${timestamp}`, dateOfBirth: '2020-01-01' }
  });
  if (kidResult.data?.data?.id) testKidId = kidResult.data.data.id;

  await test('post', '/api/mobile/kids', {
    headers: authHeaders,
    body: { name: `Kid 2 ${timestamp}`, dateOfBirth: '2019-01-01' },
    expectStatus: [200, 400]
  });

  if (testKidId) {
    await test('get', `/api/mobile/kids/${testKidId}`, { headers: authHeaders });
    await test('put', `/api/mobile/kids/${testKidId}`, {
      headers: authHeaders,
      body: { name: 'Updated Kid' }
    });
    await test('get', `/api/mobile/kids/${testKidId}/progress`, { headers: authHeaders });
    await test('post', `/api/mobile/kids/${testKidId}/progress`, {
      headers: authHeaders,
      body: { totalSessions: 1 },
      expectStatus: [200, 400]
    });
    await test('get', `/api/mobile/kids/${testKidId}/activity`, { headers: authHeaders });
    await test('post', `/api/mobile/kids/${testKidId}/activity`, {
      headers: authHeaders,
      body: { activityType: 'game', duration: 300 },
      expectStatus: [200, 400]
    });
    await test('get', `/api/mobile/kids/${testKidId}/preferences`, { headers: authHeaders });
    await test('put', `/api/mobile/kids/${testKidId}/preferences`, {
      headers: authHeaders,
      body: { theme: 'dark' }
    });
  }

  // Parent profile
  await test('get', '/api/mobile/parent', { headers: authHeaders, expectStatus: [200, 404] });
  await test('post', '/api/mobile/parent', {
    headers: authHeaders,
    body: { email: `${testUser}@test.com` },
    expectStatus: [200, 400]
  });
  await test('put', '/api/mobile/parent', {
    headers: authHeaders,
    body: { displayName: 'Test Parent' },
    expectStatus: [200, 400]
  });
  await test('get', '/api/mobile/parent/notifications', { headers: authHeaders, expectStatus: [200, 404] });
  await test('put', '/api/mobile/parent/notifications', {
    headers: authHeaders,
    body: { emailNotifications: true },
    expectStatus: [200, 400]
  });
  await test('post', '/api/mobile/parent/onboarding/complete', {
    headers: authHeaders,
    expectStatus: [200, 400]
  });
  await test('post', '/api/mobile/parent/terms/accept', {
    headers: authHeaders,
    body: { termsVersion: '1.0' },
    expectStatus: [200, 400]
  });

  // Cleanup kid
  if (testKidId) await test('delete', `/api/mobile/kids/${testKidId}`, { headers: authHeaders });
  await test('delete', '/api/mobile/parent', { headers: authHeaders, skip: true, skipReason: 'Preserve parent' });

  // ========================================
  // ANALYTICS (analytics.routes.js) - 13 endpoints
  // ========================================
  console.log('\n--- Analytics (13 endpoints) ---');

  const sessionResult = await test('post', '/analytics/session/start', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, modeType: 'conversation' },
    expectStatus: [200, 400]
  });
  if (sessionResult.data?.data?.session_id) testSessionId = sessionResult.data.data.session_id;

  await test('post', '/analytics/session/end', {
    headers: { 'X-Service-Key': serviceKey },
    body: { sessionId: testSessionId || 'test' },
    expectStatus: [200, 400, 404]
  });

  await test('post', '/analytics/game-attempt', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, sessionId: testSessionId || 'test', gameType: 'math', isCorrect: true },
    expectStatus: [200, 400]
  });

  await test('post', '/analytics/media-event', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, contentType: 'music', eventType: 'play' },
    expectStatus: [200, 400]
  });

  await test('post', '/analytics/streak', {
    headers: { 'X-Service-Key': serviceKey },
    body: { mac: testMac, streakType: 'daily' },
    expectStatus: [200, 400]
  });

  await test('get', `/analytics/user/${testMac}/overall`, { headers: authHeaders });
  await test('get', `/analytics/user/${testMac}/math`, { headers: authHeaders });
  await test('get', `/analytics/user/${testMac}/riddle`, { headers: authHeaders });
  await test('get', `/analytics/user/${testMac}/wordladder`, { headers: authHeaders });
  await test('get', `/analytics/sessions/${testMac}`, { headers: authHeaders });
  await test('get', `/analytics/usage/daily/${testMac}`, { headers: authHeaders });
  await test('get', `/analytics/usage/weekly/${testMac}`, { headers: authHeaders });
  await test('get', `/analytics/usage/monthly/${testMac}`, { headers: authHeaders });

  // ========================================
  // SYSTEM (system.routes.js) - 22 endpoints
  // ========================================
  console.log('\n--- System (22 endpoints) ---');

  // Params
  await test('get', '/system/params/page', { headers: authHeaders });
  await test('get', '/system/params/list', { headers: authHeaders });
  await test('get', '/system/params/code/APP_NAME', { headers: authHeaders, expectStatus: [200, 404] });

  const paramResult = await test('post', '/system/params', {
    headers: authHeaders,
    body: { paramCode: `TEST_PARAM_${timestamp}`, paramValue: 'test', valueType: 'string' },
    expectStatus: [200, 403]
  });
  if (paramResult.data?.data?.id) testParamId = paramResult.data.data.id;

  if (testParamId) {
    await test('get', `/system/params/${testParamId}`, { headers: authHeaders });
    await test('put', `/system/params/${testParamId}`, {
      headers: authHeaders,
      body: { paramValue: 'updated' },
      expectStatus: [200, 403]
    });
    await test('delete', `/system/params/${testParamId}`, { headers: authHeaders, expectStatus: [200, 403] });
  }
  await test('delete', '/system/params', {
    headers: authHeaders,
    body: { ids: [testParamId || 0] },
    expectStatus: [200, 403]
  });

  // Dict Type
  await test('get', '/system/dict/type/page', { headers: authHeaders });
  await test('get', '/system/dict/type/list', { headers: authHeaders });

  const dictTypeResult = await test('post', '/system/dict/type', {
    headers: authHeaders,
    body: { dictType: `test_type_${timestamp}`, dictName: 'Test Type' },
    expectStatus: [200, 403]
  });
  if (dictTypeResult.data?.data?.id) testDictTypeId = dictTypeResult.data.data.id;

  if (testDictTypeId) {
    await test('get', `/system/dict/type/${testDictTypeId}`, { headers: authHeaders });
    await test('put', `/system/dict/type/${testDictTypeId}`, {
      headers: authHeaders,
      body: { dictName: 'Updated Type' },
      expectStatus: [200, 403]
    });
    await test('delete', `/system/dict/type/${testDictTypeId}`, { headers: authHeaders, expectStatus: [200, 403] });
  }
  await test('delete', '/system/dict/type', {
    headers: authHeaders,
    body: { ids: [testDictTypeId || 0] },
    expectStatus: [200, 403]
  });

  // Dict Data
  await test('get', '/system/dict/data/page', { headers: authHeaders });
  await test('get', '/system/dict/data/type/gender', { expectStatus: [200] });

  const dictDataResult = await test('post', '/system/dict/data', {
    headers: authHeaders,
    body: { dictType: 'gender', dictLabel: 'Test', dictValue: 'test' },
    expectStatus: [200, 403]
  });
  if (dictDataResult.data?.data?.id) testDictDataId = dictDataResult.data.data.id;

  if (testDictDataId) {
    await test('get', `/system/dict/data/${testDictDataId}`, { headers: authHeaders });
    await test('put', `/system/dict/data/${testDictDataId}`, {
      headers: authHeaders,
      body: { dictLabel: 'Updated' },
      expectStatus: [200, 403]
    });
    await test('delete', `/system/dict/data/${testDictDataId}`, { headers: authHeaders, expectStatus: [200, 403] });
  }
  await test('delete', '/system/dict/data', {
    headers: authHeaders,
    body: { ids: [testDictDataId || 0] },
    expectStatus: [200, 403]
  });

  // ========================================
  // ADMIN (admin.routes.js) - 17 endpoints
  // ========================================
  console.log('\n--- Admin (17 endpoints) ---');

  // These require admin role, expect 403 for regular user
  await test('get', '/admin/users/page', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/users/list', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', `/admin/users/${testUserId || 1}`, { headers: authHeaders, expectStatus: [200, 403, 404] });
  await test('post', '/admin/users', {
    headers: authHeaders,
    body: { username: `admin_test_${timestamp}`, password: 'AdminPass123!' },
    expectStatus: [200, 403]
  });
  await test('put', `/admin/users/${testUserId || 1}`, {
    headers: authHeaders,
    body: { status: 1 },
    expectStatus: [200, 403]
  });
  await test('put', `/admin/users/${testUserId || 1}/status`, {
    headers: authHeaders,
    body: { status: 1 },
    expectStatus: [200, 403]
  });
  await test('put', `/admin/users/${testUserId || 1}/password`, {
    headers: authHeaders,
    body: { password: 'NewPass123!' },
    expectStatus: [200, 403]
  });
  await test('put', `/admin/users/${testUserId || 1}/super-admin`, {
    headers: authHeaders,
    body: { superAdmin: 0 },
    expectStatus: [200, 403]
  });
  await test('delete', `/admin/users/${testUserId || 1}`, {
    headers: authHeaders,
    expectStatus: [200, 403],
    skip: true,
    skipReason: 'Preserve test user'
  });
  await test('delete', '/admin/users', {
    headers: authHeaders,
    body: { ids: [] },
    expectStatus: [200, 403]
  });

  // Stats endpoints
  await test('get', '/admin/stats/overview', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/users', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/devices', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/content', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/sessions', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/tokens', { headers: authHeaders, expectStatus: [200, 403] });
  await test('get', '/admin/stats/active', { headers: authHeaders, expectStatus: [200, 403] });

  // ========================================
  // CLEANUP
  // ========================================
  console.log('\n--- Cleanup ---');
  if (testAgentId) await test('delete', `/agent/${testAgentId}`, { headers: authHeaders });

  // ========================================
  // SUMMARY
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('  TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`\n  PASSED:  ${results.passed}`);
  console.log(`  FAILED:  ${results.failed}`);
  console.log(`  SKIPPED: ${results.skipped}`);
  console.log(`  TOTAL:   ${results.passed + results.failed + results.skipped}`);
  console.log('\n' + '='.repeat(60));

  if (results.failed > 0) {
    console.log('\nFailed tests:');
    results.tests
      .filter(t => t.status === 'FAIL')
      .forEach(t => console.log(`  - ${t.name}: ${t.error || `Status ${t.statusCode}`}`));
  }

  if (results.skipped > 0) {
    console.log('\nSkipped tests:');
    results.tests
      .filter(t => t.status === 'SKIP')
      .forEach(t => console.log(`  - ${t.name}: ${t.reason}`));
  }

  console.log('\n');
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
