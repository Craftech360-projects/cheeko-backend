// tests/imagine-e2e.test.js
// End-to-end: real orchestrator + real WS client + real upload client, driven against
// a live line_art-mimicking WebSocket server and a live manager-api-mimicking HTTP
// server. No mocks — exercises the actual protocol + upload contract in-process.
const test = require('node:test');
const assert = require('assert');
const http = require('http');
const { WebSocketServer } = require('ws');

const { runImagine } = require('../imagine/imagine-orchestrator');
const { generateImagine } = require('../imagine/imagine-client');
const { uploadImagineJpeg } = require('../imagine/imagine-upload');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0x33, 0xff, 0xd9]);

// Fake line_art: speaks the same WS protocol as app/device_protocol.py imagine mode.
function startFakeLineArt() {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    let binaryFrames = 0;
    ws.on('message', (data, isBinary) => {
      if (isBinary) { binaryFrames++; return; }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') {
        assert.strictEqual(msg.feature, 'ai_imagine');
        ws.send(JSON.stringify({ type: 'hello', session_id: 'srv-sess' }));
      } else if (msg.type === 'listen' && msg.state === 'stop') {
        assert.ok(binaryFrames > 0, 'line_art should have received opus frames');
        ws.send(JSON.stringify({ type: 'line_art_transcription', text: 'a blue dog' }));
        ws.send(JSON.stringify({ type: 'image', image: JPEG.toString('base64'), caption: 'a blue dog' }));
      }
    });
  });
  return new Promise((res) => wss.on('listening', () => res({ wss, url: `ws://127.0.0.1:${wss.address().port}/ws` })));
}

// Fake manager-api: accepts the multipart upload, checks the service key, returns a URL.
function startFakeManagerApi() {
  let seenKey = null;
  const server = http.createServer((req, res) => {
    seenKey = req.headers['x-service-key'];
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, msg: 'success', data: { url: 'https://cdn.example/imagine/e2e.jpg', s3Key: 'imagine/e2e.jpg' } }));
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, url: `http://127.0.0.1:${server.address().port}`, getKey: () => seenKey })));
}

test('e2e: opus frames -> line_art WS -> upload -> image{url} published', async () => {
  const la = await startFakeLineArt();
  const api = await startFakeManagerApi();

  const conn = {
    imagineInFlight: false,
    imagineFrames: [Buffer.from([1, 2]), Buffer.from([3, 4])],
    udp: { session_id: 'dev-sess' },
    sent: [],
    sendMqttMessage(m) { this.sent.push(m); },
  };

  await runImagine(conn, {
    generateImagine,
    uploadImagineJpeg,
    lineArtWsUrl: la.url,
    managerApiUrl: api.url,
    serviceKey: 'e2e-secret',
    newRequestId: () => 'img_e2e',
    fetchVerdict: async () => ({ allowed: true, reason: 'ok' }), // SUB-3: required dep
  });

  const types = conn.sent.map((m) => m.type);
  assert.deepStrictEqual(types, ['image_status', 'image']);
  const img = conn.sent[1];
  assert.strictEqual(img.url, 'https://cdn.example/imagine/e2e.jpg');
  assert.strictEqual(img.caption, 'a blue dog');
  assert.strictEqual(img.session_id, 'dev-sess');
  assert.strictEqual(api.getKey(), 'e2e-secret'); // service key traveled end-to-end
  assert.strictEqual(conn.imagineInFlight, false);
  assert.strictEqual(conn.imagineFrames.length, 0);

  la.wss.close();
  api.server.close();
});
