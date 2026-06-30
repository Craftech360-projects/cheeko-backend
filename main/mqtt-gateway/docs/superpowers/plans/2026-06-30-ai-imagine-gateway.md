# AI Imagine — mqtt-gateway Integrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a device opens a session with `feature:"ai_imagine"`, the gateway forwards its raw Opus audio to line_art's WebSocket, gets a generated JPEG back, uploads it to manager-api, and publishes an `image{url}` message to the device over MQTT — bypassing the LiveKit/chat pipeline. One image per session.

**Architecture:** All new logic lives in small, injectable modules under `mqtt-gateway/imagine/` (pure message builders, an HTTP upload client, a line_art WS client, an orchestrator). The only edits to the large `mqtt/virtual-connection.js` are thin glue: read the feature flag on hello, skip the LiveKit bridge for imagine sessions, tap raw Opus frames into a per-session buffer, and call the orchestrator on end-of-utterance. The orchestrator is tested with fakes; the WS client with a real in-test `ws` server; the glue with a contract test matching the repo's existing style.

**Tech Stack:** Node.js, `mqtt`, `ws` (already a dependency, currently unused), `axios`, `form-data`, Node built-in `node:test`.

## Global Constraints

- Imagine session identified by **`json.feature === "ai_imagine"`** on the device **hello** (top-level field, spec Option A — NOT inside `json.features`).
- For imagine sessions: **do NOT** connect the LiveKit bridge or dispatch the chat agent.
- Tap **raw Opus frames** (post-decrypt `payload` in `onUdpMessage`, before `bridge.sendAudio`) into a per-session buffer.
- **One image per session at a time** — serialize via an `imagineInFlight` lock; ignore a new utterance while one is in flight.
- line_art WS URL from new env **`LINE_ART_WS_URL`**; manager-api base from existing **`MANAGER_API_URL`** (already ends in `/toy`) → upload endpoint is `${MANAGER_API_URL}/imagine/upload`; service key from existing **`MANAGER_API_SECRET`** sent in header **`X-Service-Key`**.
- Device-facing messages use existing `sendMqttMessage()` and these exact shapes (spec §4):
  - `image`: `{type:"image", session_id, request_id, url, mime:"image/jpeg", width:320, height:240, caption?}`
  - `image_status`: `{type:"image_status", session_id, request_id, state:"generating"}`
  - `image_error`: `{type:"image_error", session_id, request_id, code, message}` — codes: `no_speech`|`safety_block`|`generation_failed`|`rate_limited`.
- Do not change the existing chat/music/story bridge behavior for non-imagine sessions.

---

### Task 1: Device-facing message builders

**Files:**
- Create: `D:\cheeko-backend\main\mqtt-gateway\imagine\imagine-messages.js`
- Test: `D:\cheeko-backend\main\mqtt-gateway\tests\imagine-messages.test.js`

**Interfaces:**
- Produces:
  - `imageMessage({sessionId, requestId, url, mime?, width?, height?, caption?}) -> object`
  - `imageStatus({sessionId, requestId, state}) -> object`
  - `imageError({sessionId, requestId, code, message}) -> object`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/imagine-messages.test.js
const test = require('node:test');
const assert = require('assert');
const m = require('../imagine/imagine-messages');

test('imageMessage has the spec shape and defaults', () => {
  const msg = m.imageMessage({ sessionId: 's1', requestId: 'img_1', url: 'https://cdn/x.jpg', caption: 'a cat' });
  assert.strictEqual(msg.type, 'image');
  assert.strictEqual(msg.session_id, 's1');
  assert.strictEqual(msg.request_id, 'img_1');
  assert.strictEqual(msg.url, 'https://cdn/x.jpg');
  assert.strictEqual(msg.mime, 'image/jpeg');
  assert.strictEqual(msg.width, 320);
  assert.strictEqual(msg.height, 240);
  assert.strictEqual(msg.caption, 'a cat');
});

test('imageMessage omits caption when not given', () => {
  const msg = m.imageMessage({ sessionId: 's1', requestId: 'img_1', url: 'u' });
  assert.ok(!('caption' in msg));
});

test('imageStatus and imageError shapes', () => {
  assert.deepStrictEqual(m.imageStatus({ sessionId: 's', requestId: 'r', state: 'generating' }),
    { type: 'image_status', session_id: 's', request_id: 'r', state: 'generating' });
  assert.deepStrictEqual(m.imageError({ sessionId: 's', requestId: 'r', code: 'no_speech', message: 'x' }),
    { type: 'image_error', session_id: 's', request_id: 'r', code: 'no_speech', message: 'x' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-messages.test.js`
Expected: FAIL — cannot find module `../imagine/imagine-messages`

- [ ] **Step 3: Write minimal implementation**

```javascript
// imagine/imagine-messages.js
function imageMessage({ sessionId, requestId, url, mime = 'image/jpeg', width = 320, height = 240, caption }) {
  const msg = { type: 'image', session_id: sessionId, request_id: requestId, url, mime, width, height };
  if (caption !== undefined && caption !== null) msg.caption = caption;
  return msg;
}
function imageStatus({ sessionId, requestId, state }) {
  return { type: 'image_status', session_id: sessionId, request_id: requestId, state };
}
function imageError({ sessionId, requestId, code, message }) {
  return { type: 'image_error', session_id: sessionId, request_id: requestId, code, message };
}
module.exports = { imageMessage, imageStatus, imageError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-messages.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/mqtt-gateway && git add imagine/imagine-messages.js tests/imagine-messages.test.js && git commit -m "feat(imagine): device-facing image/image_status/image_error builders" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: manager-api upload client

**Files:**
- Create: `D:\cheeko-backend\main\mqtt-gateway\imagine\imagine-upload.js`
- Test: `D:\cheeko-backend\main\mqtt-gateway\tests\imagine-upload.test.js`

**Interfaces:**
- Produces: `uploadImagineJpeg(jpegBuffer, {managerApiUrl, serviceKey}) -> Promise<string>` (returns the public URL; throws on failure).

- [ ] **Step 0: Ensure form-data is available**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node -e "require('form-data')" && echo OK || npm install form-data`
(axios needs form-data for multipart in Node. If it prints OK, it's already present.)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/imagine-upload.test.js
const test = require('node:test');
const assert = require('assert');
const Module = require('module');

// Stub axios before requiring the client.
let lastPost;
const axiosStub = { post: async (url, body, opts) => { lastPost = { url, body, opts }; return { data: { code: 0, msg: 'success', data: { url: 'https://cdn/x.jpg', s3Key: 'imagine/x.jpg' } } }; } };
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') return axiosStub;
  return origLoad.apply(this, arguments);
};

const { uploadImagineJpeg } = require('../imagine/imagine-upload');

test('posts multipart to /imagine/upload with service key and returns url', async () => {
  const url = await uploadImagineJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
    managerApiUrl: 'http://api/toy', serviceKey: 'svc-123',
  });
  assert.strictEqual(url, 'https://cdn/x.jpg');
  assert.strictEqual(lastPost.url, 'http://api/toy/imagine/upload');
  assert.strictEqual(lastPost.opts.headers['X-Service-Key'], 'svc-123');
});

test('throws when response envelope is not success', async () => {
  axiosStub.post = async () => ({ data: { code: 400, msg: 'bad' } });
  await assert.rejects(() => uploadImagineJpeg(Buffer.from([1]), { managerApiUrl: 'http://api/toy', serviceKey: 's' }));
});

test.after(() => { Module._load = origLoad; Module._resolveFilename = origResolve; });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-upload.test.js`
Expected: FAIL — cannot find module `../imagine/imagine-upload`

- [ ] **Step 3: Write minimal implementation**

```javascript
// imagine/imagine-upload.js
const axios = require('axios');
const FormData = require('form-data');

async function uploadImagineJpeg(jpegBuffer, { managerApiUrl, serviceKey }) {
  const form = new FormData();
  form.append('file', jpegBuffer, { filename: 'imagine.jpg', contentType: 'image/jpeg' });
  const res = await axios.post(`${managerApiUrl}/imagine/upload`, form, {
    headers: { ...form.getHeaders(), 'X-Service-Key': serviceKey },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 15000,
  });
  if (res.data && res.data.code === 0 && res.data.data && res.data.data.url) {
    return res.data.data.url;
  }
  throw new Error(`imagine upload failed: ${JSON.stringify(res.data)}`);
}
module.exports = { uploadImagineJpeg };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-upload.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/mqtt-gateway && git add imagine/imagine-upload.js tests/imagine-upload.test.js package.json package-lock.json && git commit -m "feat(imagine): manager-api JPEG upload client" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: line_art WebSocket client

**Files:**
- Create: `D:\cheeko-backend\main\mqtt-gateway\imagine\imagine-client.js`
- Test: `D:\cheeko-backend\main\mqtt-gateway\tests\imagine-client.test.js`

**Interfaces:**
- Produces: `generateImagine(opusFrames, {lineArtWsUrl, timeoutMs?}) -> Promise<{jpegBuffer: Buffer, caption?: string}>`. `opusFrames` is an array of Buffers (raw Opus). Throws on line_art error / timeout / socket close before image.

Drives line_art's existing WS protocol: send `hello{feature:"ai_imagine"}`; on `hello` reply send `listen/start`, then each Opus frame as a binary message, then `listen/stop`; resolve on the `image` message (base64 `image` field), reject on `line_art_error`.

- [ ] **Step 1: Write the failing test (uses a real in-test ws server impersonating line_art)**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-client.test.js`
Expected: FAIL — cannot find module `../imagine/imagine-client`

- [ ] **Step 3: Write minimal implementation**

```javascript
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
      try { ws.close(); } catch (_) {}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-client.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/mqtt-gateway && git add imagine/imagine-client.js tests/imagine-client.test.js && git commit -m "feat(imagine): line_art WebSocket client (opus in, jpeg out)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Orchestrator (serialize → status → generate → upload → publish)

**Files:**
- Create: `D:\cheeko-backend\main\mqtt-gateway\imagine\imagine-orchestrator.js`
- Test: `D:\cheeko-backend\main\mqtt-gateway\tests\imagine-orchestrator.test.js`

**Interfaces:**
- Consumes: `imagine-messages` (Task 1); injected `generateImagine` (Task 3) and `uploadImagineJpeg` (Task 2).
- Produces: `runImagine(conn, deps) -> Promise<void>`, where:
  - `conn` has: `imagineInFlight` (bool), `imagineFrames` (Buffer[]), `udp.session_id` (string), and `sendMqttMessage(obj)`.
  - `deps` has: `generateImagine`, `uploadImagineJpeg`, `lineArtWsUrl`, `managerApiUrl`, `serviceKey`, and `newRequestId()`.
  - Behavior: if `imagineInFlight` is already true, return immediately (serialize). Else set it, drain frames, publish `image_status:generating`, generate, upload, publish `image{url}`. On any error publish `image_error` with a mapped code. Always clear `imagineInFlight` at the end.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-orchestrator.test.js`
Expected: FAIL — cannot find module `../imagine/imagine-orchestrator`

- [ ] **Step 3: Write minimal implementation**

```javascript
// imagine/imagine-orchestrator.js
const messages = require('./imagine-messages');

function mapError(err) {
  const m = (err && err.message ? err.message : '').toLowerCase();
  if (/no speech|no usable|transcribe/.test(m)) return 'no_speech';
  if (/safety|blocked|filter/.test(m)) return 'safety_block';
  if (/rate.?limit|too many/.test(m)) return 'rate_limited';
  return 'generation_failed';
}

async function runImagine(conn, deps) {
  if (conn.imagineInFlight) return; // ponytail: one image per session; drop overlapping requests
  conn.imagineInFlight = true;
  const frames = conn.imagineFrames || [];
  conn.imagineFrames = [];
  const sessionId = conn.udp && conn.udp.session_id;
  const requestId = deps.newRequestId();
  try {
    conn.sendMqttMessage(messages.imageStatus({ sessionId, requestId, state: 'generating' }));
    const { jpegBuffer, caption } = await deps.generateImagine(frames, { lineArtWsUrl: deps.lineArtWsUrl });
    const url = await deps.uploadImagineJpeg(jpegBuffer, { managerApiUrl: deps.managerApiUrl, serviceKey: deps.serviceKey });
    conn.sendMqttMessage(messages.imageMessage({ sessionId, requestId, url, caption }));
  } catch (err) {
    conn.sendMqttMessage(messages.imageError({ sessionId, requestId, code: mapError(err), message: 'Could not create that picture.' }));
  } finally {
    conn.imagineInFlight = false;
  }
}
module.exports = { runImagine, mapError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-orchestrator.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/mqtt-gateway && git add imagine/imagine-orchestrator.js tests/imagine-orchestrator.test.js && git commit -m "feat(imagine): orchestrator (serialize, status, generate, upload, publish)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire into `virtual-connection.js` (integration glue)

**Files:**
- Modify: `D:\cheeko-backend\main\mqtt-gateway\mqtt\virtual-connection.js`
- Test: `D:\cheeko-backend\main\mqtt-gateway\tests\imagine-wiring.test.js`

> **This is an integration task against a large existing file.** Before editing, READ these regions to anchor each edit: `parseHelloMessage` (~line 386), `_deferredSetup` (~line 636–665, the `bridge.connect` call), `onUdpMessage` (~line 1635–1705, the decrypt + `this.bridge.sendAudio(payload, timestamp)` call ~1700), `parseOtherMessage` (~line 1040–1120, where `goodbye`/`abort` branch), and `sendMqttMessage` (~line 267). Apply each edit at the verified location; match surrounding style.

**Interfaces:**
- Consumes: `runImagine` (Task 4), `generateImagine` (Task 3), `uploadImagineJpeg` (Task 2).
- Produces: imagine sessions never connect the bridge; raw Opus accumulates in `this.imagineFrames`; on end-of-utterance (`speech_end`, and `listen`/`state:"stop"`) `runImagine` is invoked once.

- [ ] **Step 1: Write the failing contract test** (matches the repo's source-contract test style; the behavioral logic is already covered by Tasks 1–4)

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-wiring.test.js`
Expected: FAIL — none of the patterns are present yet.

- [ ] **Step 3: Apply the wiring edits**

3a. **Requires** (top of file, with other requires):
```javascript
const { runImagine } = require('../imagine/imagine-orchestrator');
const { generateImagine } = require('../imagine/imagine-client');
const { uploadImagineJpeg } = require('../imagine/imagine-upload');
const { randomUUID } = require('crypto');
```

3b. **Hello flag** — in `parseHelloMessage`, after the session/uuid fields are set (and where other `json.*` fields are read):
```javascript
this.imagineFeatureEnabled = json.feature === 'ai_imagine';
this.imagineInFlight = false;
this.imagineFrames = [];
```

3c. **Skip the bridge** — in `_deferredSetup`, guard the bridge creation/connect + agent dispatch:
```javascript
if (this.imagineFeatureEnabled) {
  // AI Imagine: no LiveKit bridge, no chat agent. Audio is forwarded to line_art on speech_end.
  this.logger?.info?.('[imagine] session in ai_imagine mode; skipping LiveKit bridge', { deviceId: this.deviceId });
} else {
  // ... existing bridge = new LiveKitBridge(...) + await this.bridge.connect(...) + agent dispatch ...
}
```
(Wrap the EXISTING bridge setup block in the `else`. Do not delete it.)

3d. **Tap Opus** — in `onUdpMessage`, where `payload` holds the decrypted Opus and the code calls `this.bridge.sendAudio(payload, timestamp)`, branch:
```javascript
if (this.imagineFeatureEnabled) {
  this.imagineFrames.push(Buffer.from(payload));
} else {
  this.bridge.sendAudio(payload, timestamp);
}
```

3e. **Trigger on end-of-utterance** — in `parseOtherMessage`, add a branch (near the `goodbye`/`abort` branches) that fires for the end-of-speech signal. Handle BOTH `speech_end` and `listen`/`state:"stop"`:
```javascript
if (this.imagineFeatureEnabled && (json.type === 'speech_end' || (json.type === 'listen' && json.state === 'stop'))) {
  // fire-and-forget; runImagine serializes + publishes image/image_status/image_error itself
  runImagine(this, {
    generateImagine,
    uploadImagineJpeg,
    lineArtWsUrl: process.env.LINE_ART_WS_URL,
    managerApiUrl: process.env.MANAGER_API_URL,
    serviceKey: process.env.MANAGER_API_SECRET,
    newRequestId: () => `img_${randomUUID().slice(0, 8)}`,
  }).catch((e) => this.logger?.error?.('[imagine] runImagine failed', { err: e?.message }));
  return;
}
```
(If `parseOtherMessage` already has an `if/else if` chain on `json.type`, insert this as an early guarded branch so it wins for imagine sessions. Confirm `sendMqttMessage` is the method `runImagine` will call via `conn.sendMqttMessage` — `this` is the connection, which has `sendMqttMessage`.)

3f. Add `LINE_ART_WS_URL` to `.env.example` (or the env docs) with a comment, e.g. `LINE_ART_WS_URL=ws://127.0.0.1:8090/ws`.

- [ ] **Step 4: Run the contract test + full suite**

Run: `cd /d/cheeko-backend/main/mqtt-gateway && node --test tests/imagine-wiring.test.js && npm test`
Expected: imagine-wiring PASS (5); full suite green (no regressions in existing tests).

- [ ] **Step 5: Commit**

```bash
cd /d/cheeko-backend/main/mqtt-gateway && git add mqtt/virtual-connection.js tests/imagine-wiring.test.js .env.example && git commit -m "feat(imagine): wire ai_imagine path into virtual-connection (skip bridge, tap opus, orchestrate)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** feature flag on hello (Option A) → Task 5/3b ✓; bypass LiveKit → 5/3c ✓; forward raw Opus to line_art WS → Task 3 + 5/3d ✓; upload to manager-api with service key → Task 2 ✓; publish image/image_status/image_error → Tasks 1+4 ✓; serialize one-per-session → Task 4 ✓; error code mapping → Task 4 ✓. Out of scope (handled elsewhere): the actual S3 upload (manager-api subsystem), JPEG generation (line_art subsystem).
- **Placeholder scan:** Tasks 1–4 contain complete code. Task 5 is an explicit integration task: every edit names a verified anchor (function + approximate line) and shows the exact code to insert; the only thing the implementer must discover is the precise surrounding lines to wrap (unavoidable for glue in a 3,600-line file), guarded by a contract test.
- **Type consistency:** `generateImagine(frames,{lineArtWsUrl}) -> {jpegBuffer,caption}` (Task 3) consumed by `runImagine` (Task 4) and injected in Task 5; `uploadImagineJpeg(buf,{managerApiUrl,serviceKey}) -> url` (Task 2) consumed identically; `conn.sendMqttMessage` is the real method on `VirtualMQTTConnection`; `conn.imagineFrames` / `conn.imagineInFlight` / `conn.udp.session_id` all set in Task 5 and consumed by Task 4.
- **Risk note:** Task 5 is the only task touching live real-time code; its behavioral logic is pushed into Tasks 1–4 (fully unit-tested) so the glue stays thin and contract-tested. Recommend a real device/integration smoke test after merge (out of scope for unit TDD).
