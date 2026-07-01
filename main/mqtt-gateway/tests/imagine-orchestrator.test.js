// tests/imagine-orchestrator.test.js
const test = require('node:test');
const assert = require('assert');
const { runImagine } = require('../imagine/imagine-orchestrator');

function fakeConn() {
  return { imagineInFlight: false, imagineFrames: [Buffer.from([1])], udp: { session_id: 'sess1' }, sent: [], sendMqttMessage(m) { this.sent.push(m); } };
}
const baseDeps = (over) => Object.assign({
  lineArtWsUrl: 'ws://x', managerApiUrl: 'http://api/toy', serviceKey: 'k',
  newRequestId: () => 'img_test',
  generateImagine: async () => ({ jpegBuffer: Buffer.from([9]), caption: 'a cat' }),
  uploadImagineJpeg: async () => 'https://cdn/x.jpg',
}, over);

test('happy path: status then image', async () => {
  const conn = fakeConn();
  await runImagine(conn, baseDeps());
  const types = conn.sent.map((m) => m.type);
  assert.deepStrictEqual(types, ['image_status', 'image']);
  const img = conn.sent[1];
  assert.strictEqual(img.url, 'https://cdn/x.jpg');
  assert.strictEqual(img.caption, 'a cat');
  assert.strictEqual(img.session_id, 'sess1');
  assert.strictEqual(conn.imagineInFlight, false);
  assert.strictEqual(conn.imagineFrames.length, 0);
});

test('serialize: second concurrent call is ignored while in flight', async () => {
  const conn = fakeConn();
  conn.imagineInFlight = true;
  await runImagine(conn, baseDeps());
  assert.strictEqual(conn.sent.length, 0);
});

test('error path: generation failure publishes image_error and clears lock', async () => {
  const conn = fakeConn();
  await runImagine(conn, baseDeps({ generateImagine: async () => { throw new Error('boom'); } }));
  const types = conn.sent.map((m) => m.type);
  assert.deepStrictEqual(types, ['image_status', 'image_error']);
  assert.strictEqual(conn.sent[1].code, 'generation_failed');
  assert.strictEqual(conn.imagineInFlight, false);
});

test('error mapping: no-speech', async () => {
  const conn = fakeConn();
  await runImagine(conn, baseDeps({ generateImagine: async () => { throw new Error('no speech detected'); } }));
  assert.strictEqual(conn.sent[1].code, 'no_speech');
});

test('closed session: drops result mid-generation, no upload or image', async () => {
  const conn = fakeConn();
  let uploaded = false;
  await runImagine(conn, baseDeps({
    generateImagine: async () => { conn.imagineClosed = true; return { jpegBuffer: Buffer.from([9]), caption: 'x' }; },
    uploadImagineJpeg: async () => { uploaded = true; return 'https://cdn/x.jpg'; },
  }));
  assert.strictEqual(uploaded, false);
  assert.deepStrictEqual(conn.sent.map((m) => m.type), ['image_status']);
  assert.strictEqual(conn.imagineInFlight, false);
});

test('empty frames: no_speech without calling line_art', async () => {
  const conn = fakeConn();
  conn.imagineFrames = [];
  let called = false;
  await runImagine(conn, baseDeps({ generateImagine: async () => { called = true; return {}; } }));
  assert.strictEqual(called, false);
  assert.deepStrictEqual(conn.sent.map((m) => m.type), ['image_error']);
  assert.strictEqual(conn.sent[0].code, 'no_speech');
  assert.strictEqual(conn.imagineInFlight, false);
});
