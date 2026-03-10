/**
 * Test Data Factories
 *
 * Generates unique test data for E2E scenarios.
 * All test data uses 'e2e-test-' prefix for easy identification and cleanup.
 */

const { v4: uuidv4 } = require('uuid');

function uniqueId() {
  return uuidv4().slice(0, 8);
}

function testDevice() {
  const id = uniqueId();
  return {
    macAddress: `E2:E2:${id.slice(0, 2).toUpperCase()}:${id.slice(2, 4).toUpperCase()}:${id.slice(4, 6).toUpperCase()}:${id.slice(6, 8).toUpperCase()}`,
    model: 'esp32-test',
    remark: `e2e-test-device-${id}`,
  };
}

function testContent(type = 'music') {
  const id = uniqueId();
  return {
    title: `e2e-test-${type}-${id}`,
    contentType: type,
    url: `https://cdn.test.com/${type}/${id}.mp3`,
    category: 'test',
    description: `E2E test ${type} content`,
  };
}

function testPlaylist() {
  const id = uniqueId();
  return {
    name: `e2e-test-playlist-${id}`,
    description: 'E2E test playlist',
  };
}

function testKidProfile() {
  const id = uniqueId();
  return {
    name: `E2E Kid ${id}`,
    nickname: `kid-${id}`,
    birthDate: '2019-06-15',
    gender: 'male',
    language: 'en',
    interests: ['robots', 'dinosaurs'],
  };
}

function testRfidCard() {
  const id = uniqueId();
  return {
    rfidUid: `E2ERFID${id}`,
    name: `e2e-test-card-${id}`,
  };
}

function testRfidSeries() {
  const id = uniqueId();
  return {
    name: `e2e-test-series-${id}`,
    startUid: `E2E${id.slice(0, 4).toUpperCase()}000001`,
    endUid: `E2E${id.slice(0, 4).toUpperCase()}000010`,
  };
}

function testAgent() {
  const id = uniqueId();
  return {
    agentName: `e2e-test-agent-${id}`,
    agentCode: `e2e_${id}`,
    systemPrompt: 'You are a friendly test assistant.',
    langCode: 'en',
    language: 'English',
  };
}

function testAgentTemplate() {
  const id = uniqueId();
  return {
    agentName: `e2e-test-template-${id}`,
    agentCode: `e2e_tpl_${id}`,
    systemPrompt: 'You are a template assistant for testing.',
    langCode: 'en',
    language: 'English',
    isVisible: 1,
  };
}

function testModel() {
  const id = uniqueId();
  return {
    modelType: 'LLM',
    modelCode: `e2e-model-${id}`,
    modelName: `E2E Test Model ${id}`,
    configJson: { provider: 'test', apiKey: 'test-key' },
    isDefault: 0,
    isEnabled: 1,
  };
}

function testTtsVoice(ttsModelId) {
  const id = uniqueId();
  const voice = {
    voiceName: `e2e-voice-${id}`,
    voiceCode: `voice_${id}`,
    language: 'en',
  };
  if (ttsModelId) voice.ttsModelId = ttsModelId;
  return voice;
}

function testOtaFirmware() {
  const id = uniqueId();
  return {
    firmwareName: `e2e-firmware-${id}`,
    type: 'esp32',
    version: `0.0.${Date.now() % 10000}`,
    size: 1024,
    remark: 'E2E test firmware',
  };
}

module.exports = {
  uniqueId,
  testDevice,
  testContent,
  testPlaylist,
  testKidProfile,
  testRfidCard,
  testRfidSeries,
  testAgent,
  testAgentTemplate,
  testModel,
  testTtsVoice,
  testOtaFirmware,
};
