// tests/imagine-client.test.js
const test = require('node:test');
const assert = require('assert');
const { WebSocketServer } = require('ws');
const { generateImagine } = require('../imagine/imagine-client');

function startFakeLineArt(handler) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => handler(ws));
  return new Promise((resolve) => wss.on('listening', () => resolve({ wss, url: `ws://127.0.0.1:${wss.address().port}` })));
}

test('runs the handshake and returns the decoded jpeg + caption', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]);
  const { wss, url } = await startFakeLineArt((ws) => {
    const got = [];
    ws.on('message', (data, isBinary) => {
      if (isBinary) { got.push(data); return; }
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') { assert.strictEqual(msg.feature, 'ai_imagine'); ws.send(JSON.stringify({ type: 'hello', session_id: 'srv1' })); }
      if (msg.type === 'listen' && msg.state === 'stop') {
        assert.strictEqual(got.length, 2); // two opus frames forwarded as binary
        ws.send(JSON.stringify({ type: 'line_art_transcription', text: 'a blue dog' }));
        ws.send(JSON.stringify({ type: 'image', image: jpeg.toString('base64'), caption: 'a blue dog' }));
      }
    });
  });
  const res = await generateImagine([Buffer.from([1, 2]), Buffer.from([3, 4])], { lineArtWsUrl: url });
  assert.ok(res.jpegBuffer.equals(jpeg));
  assert.strictEqual(res.caption, 'a blue dog');
  wss.close();
});

test('rejects on line_art_error', async () => {
  const { wss, url } = await startFakeLineArt((ws) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'hello', session_id: 's' }));
      if (msg.type === 'listen' && msg.state === 'stop') ws.send(JSON.stringify({ type: 'line_art_error', message: 'no speech', stage: 'stt' }));
    });
  });
  await assert.rejects(() => generateImagine([Buffer.from([1])], { lineArtWsUrl: url }));
  wss.close();
});
