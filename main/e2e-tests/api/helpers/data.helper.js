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

module.exports = {
  uniqueId,
  testDevice,
  testContent,
  testPlaylist,
  testKidProfile,
  testRfidCard,
  testRfidSeries,
};
