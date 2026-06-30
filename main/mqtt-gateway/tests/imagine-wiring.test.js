// tests/imagine-wiring.test.js
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'mqtt', 'virtual-connection.js'), 'utf8');

test('reads the ai_imagine feature flag from the hello', () => {
  assert.match(src, /imagineFeatureEnabled\s*=\s*[^\n]*feature[^\n]*===\s*['"]ai_imagine['"]/);
});
test('skips the LiveKit bridge for imagine sessions', () => {
  // the bridge.connect call must be guarded by !imagineFeatureEnabled (or an early return for imagine)
  assert.match(src, /imagineFeatureEnabled/);
  assert.match(src, /if\s*\(\s*!?\s*this\.imagineFeatureEnabled/);
});
test('taps raw opus frames into imagineFrames', () => {
  assert.match(src, /this\.imagineFrames\.push\(/);
});
test('invokes runImagine on end of utterance', () => {
  assert.match(src, /runImagine\s*\(/);
});
test('requires the imagine modules', () => {
  assert.match(src, /require\(['"]\.\.\/imagine\/imagine-orchestrator['"]\)/);
  assert.match(src, /require\(['"]\.\.\/imagine\/imagine-client['"]\)/);
  assert.match(src, /require\(['"]\.\.\/imagine\/imagine-upload['"]\)/);
});
