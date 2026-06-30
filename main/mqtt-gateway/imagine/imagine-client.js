// imagine/imagine-client.js
const WebSocket = require('ws');

function generateImagine(opusFrames, { lineArtWsUrl, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(lineArtWsUrl);
    let settled = false;
    let caption;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch (_) {}
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('imagine timeout')), timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', version: 3, transport: 'websocket', feature: 'ai_imagine' }));
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (_) { return; }
      switch (msg.type) {
        case 'hello':
          ws.send(JSON.stringify({ type: 'listen', state: 'start', mode: 'manual' }));
          for (const frame of opusFrames) ws.send(frame);
          ws.send(JSON.stringify({ type: 'listen', state: 'stop' }));
          break;
        case 'line_art_transcription':
          caption = msg.text;
          break;
        // image message caption takes precedence over line_art_transcription text
        case 'image':
          finish(null, { jpegBuffer: Buffer.from(msg.image, 'base64'), caption: msg.caption != null ? msg.caption : caption });
          break;
        case 'line_art_error':
          finish(new Error(msg.message || 'line_art error'));
          break;
      }
    });
    ws.on('error', (e) => finish(e));
    ws.on('close', () => finish(new Error('line_art socket closed before image')));
  });
}
module.exports = { generateImagine };
