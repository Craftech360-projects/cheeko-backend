/**
 * Virtual Cheeko device — Node port of client.py's protocol half.
 *
 * Speaks the same two planes as the ESP32 firmware:
 *   control -> MQTT  "device-server"        (hello / listen / abort / goodbye)
 *   control <- MQTT  "devices/p2p/<client>" (tts / stt / llm / image / mode_update)
 *   audio  <-> UDP   AES-CTR over Opus, 16-byte header IS the counter block
 *
 * Knows nothing about browsers or WebSockets: it takes and emits raw PCM16
 * @16kHz mono, so the caller can be a browser bridge, a test script, or a file.
 *
 * ponytail: no OTA handshake — creds are generated locally against
 * MQTT_SIGNATURE_KEY, same as client.py's setup_local_test_config(). Add OTA
 * only if this ever needs to point at a deployed server instead of localhost.
 */

const crypto = require('crypto');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const mqtt = require('mqtt');
const { OpusEncoder } = require('@discordjs/opus');

// What we ASK for in the hello. The gateway is free to answer with something
// else (it currently says 24 kHz / 60 ms), and its answer wins — see _hello.
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const FRAME_MS = 20;
const HEADER_LEN = 16;

// Firmware Cheeko Face: a leading [tag] is stripped from display text.
const FACE_EXPRESSIONS = new Set([
  'neutral', 'happy', 'excited', 'laughing', 'love', 'silly', 'curious',
  'surprised', 'confused', 'shy', 'sad', 'crying', 'angry', 'scared', 'sleepy',
]);

function parseExpressionTag(text) {
  const m = /^\[([a-z]{2,12})\]\s*/.exec(text || '');
  if (!m) return { face: null, text: text || '' };
  return {
    face: FACE_EXPRESSIONS.has(m[1]) ? m[1] : 'neutral',
    text: (text || '').slice(m[0].length),
  };
}

// Gateway checks this against MQTT_SIGNATURE_KEY (utils/mqtt_config_v2.js).
function makeCredentials(mac, signatureKey) {
  const clientId = `GID_test@@@${mac}@@@${crypto.randomUUID()}`;
  // Byte-for-byte what client.py sends. Python's json.dumps puts a space after
  // the colon; JSON.stringify does not, and the difference changes the HMAC.
  const username = Buffer.from('{"ip": "192.168.1.10"}').toString('base64');
  const password = crypto
    .createHmac('sha256', signatureKey)
    .update(`${clientId}|${username}`)
    .digest('base64');
  return { clientId, username, password };
}

class DeviceSim extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.host = opts.host || '127.0.0.1';
    this.mqttPort = Number(opts.mqttPort || 1883);
    this.signatureKey = opts.signatureKey || '';
    this.mac = opts.mac || '00:16:3e:ac:b5:38';
    this.characterId = opts.characterId || null;
    this.feature = opts.feature || null; // "ai_imagine" routes the whole session

    this.creds = makeCredentials(this.mac, this.signatureKey);
    this.p2pTopic = `devices/p2p/${this.creds.clientId}`;

    this.session = null;      // hello response: { session_id, udp:{...}, audio_params }
    this.aesKey = null;
    this.connectionId = 0;
    this.txSequence = 0;
    this.pcmLeftover = Buffer.alloc(0);
    this.stopped = false;

    // Negotiated in the hello response; these are only the opening bid.
    this.rate = SAMPLE_RATE;
    this.channels = CHANNELS;
    this.frameMs = FRAME_MS;
    this.bytesPerFrame = (SAMPLE_RATE * FRAME_MS / 1000) * 2;
    this.encoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);

    // Inbound UDP sequence health. Baseline is adopted from the first packet:
    // the gateway runs one continuous sequence per session, not per TTS stream.
    this.stats = { received: 0, missing: 0, duplicate: 0, outOfOrder: 0, first: null, last: 0 };
    this.expectedSeq = null;
  }

  log(msg) { this.emit('log', msg); }

  async start() {
    if (!this.signatureKey) throw new Error('MQTT_SIGNATURE_KEY is not set');
    await this._connectMqtt();
    await this._hello();
    this._openUdp();
    this.emit('ready', { sessionId: this.session.session_id, character: this.characterId });
  }

  _connectMqtt() {
    return new Promise((resolve, reject) => {
      this.log(`Connecting to MQTT ${this.host}:${this.mqttPort} as ${this.creds.clientId}`);
      this.mqtt = mqtt.connect(`mqtt://${this.host}:${this.mqttPort}`, {
        clientId: this.creds.clientId,
        username: this.creds.username,
        password: this.creds.password,
        reconnectPeriod: 0, // a dropped device stays dropped; don't silently re-attach
        connectTimeout: 8000,
      });
      this.mqtt.on('message', (_topic, payload) => this._onControl(payload));
      this.mqtt.on('error', (err) => {
        this.log(`MQTT error: ${err.message}`);
        reject(err);
      });
      this.mqtt.on('close', () => { if (!this.stopped) this.emit('closed', 'mqtt closed'); });
      this.mqtt.on('connect', () => {
        this.mqtt.subscribe(this.p2pTopic, (err) => {
          if (err) return reject(err);
          this.log(`MQTT connected, subscribed to ${this.p2pTopic}`);
          resolve();
        });
      });
    });
  }

  publish(payload) {
    if (!this.mqtt) throw new Error('MQTT not connected');
    this.mqtt.publish('device-server', JSON.stringify(payload));
  }

  _hello() {
    return new Promise((resolve, reject) => {
      const hello = {
        type: 'hello',
        version: 3,
        transport: 'mqtt',
        audio_params: {
          sample_rate: SAMPLE_RATE,
          channels: CHANNELS,
          frame_duration: FRAME_MS,
          format: 'opus',
        },
        features: ['tts', 'asr', 'vad'],
      };
      if (this.feature) hello.feature = this.feature;
      if (this.characterId) hello.character_id = this.characterId;

      const timer = setTimeout(() => {
        this.off('_hello', onHello);
        reject(new Error('Timed out waiting for hello response'));
      }, 30000);
      const onHello = (msg) => {
        clearTimeout(timer);
        this.session = msg;
        this.aesKey = Buffer.from(msg.udp.key, 'hex');
        // connectionId lives at bytes 4..8 of the nonce (the header template).
        this.connectionId = Buffer.from(msg.udp.nonce, 'hex').readUInt32BE(4);

        // The gateway's audio_params win over what we asked for — it currently
        // answers 24 kHz / 60 ms regardless of the request. Decoding at the
        // wrong rate still "works" but plays back at the wrong pitch, so this
        // has to follow the response, exactly like client.py does.
        const ap = msg.audio_params || {};
        this.rate = ap.sample_rate || SAMPLE_RATE;
        this.channels = ap.channels || CHANNELS;
        this.frameMs = ap.frame_duration || FRAME_MS;
        this.bytesPerFrame = (this.rate * this.frameMs / 1000) * 2 * this.channels;
        this.encoder = new OpusEncoder(this.rate, this.channels);

        this.log(`Session ${msg.session_id} udp=${msg.udp.server}:${msg.udp.port}`);
        this.log(`Audio negotiated: ${this.rate}Hz ${this.channels}ch ${this.frameMs}ms`);
        resolve();
      };
      this.once('_hello', onHello);
      this.publish(hello);
    });
  }

  _openUdp() {
    this.udp = dgram.createSocket('udp4');
    this.decoder = new OpusEncoder(this.rate, this.channels); // decode side of the same codec
    this.udp.on('message', (data) => this._onAudioPacket(data));
    this.udp.on('error', (err) => this.log(`UDP error: ${err.message}`));
    // Ping opens the NAT path so the gateway's audio can get back to us.
    this._sendUdp(Buffer.from(`ping:${this.session.session_id}`));
    this.log('UDP ping sent');
  }

  // --- packet crypto -------------------------------------------------------
  // Header doubles as the AES-CTR counter block, so every packet is uniquely
  // keyed and self-describing. Layout matches client.py's '>BBHIII'.
  _header(payloadLen, sequence) {
    const h = Buffer.alloc(HEADER_LEN);
    h.writeUInt8(0x01, 0);                                  // packet type
    h.writeUInt8(0x00, 1);                                  // flags
    h.writeUInt16BE(payloadLen, 2);
    h.writeUInt32BE(this.connectionId, 4);
    h.writeUInt32BE(Math.floor(Date.now() / 1000), 8);
    h.writeUInt32BE(sequence, 12);
    return h;
  }

  _cipherName() { return `aes-${this.aesKey.length * 8}-ctr`; }

  encryptPacket(payload) {
    const header = this._header(payload.length, this.txSequence++);
    const c = crypto.createCipheriv(this._cipherName(), this.aesKey, header);
    return Buffer.concat([header, c.update(payload), c.final()]);
  }

  _sendUdp(payload) {
    if (!this.udp || !this.session) return;
    const packet = this.encryptPacket(payload);
    this.udp.send(packet, this.session.udp.port, this.session.udp.server);
  }

  _onAudioPacket(data) {
    if (data.length <= HEADER_LEN) return;
    const header = data.subarray(0, HEADER_LEN);
    const encrypted = data.subarray(HEADER_LEN);
    this._trackSequence(header.readUInt32BE(12));
    try {
      const d = crypto.createDecipheriv(this._cipherName(), this.aesKey, header);
      const opus = Buffer.concat([d.update(encrypted), d.final()]);
      this.emit('pcm', this.decoder.decode(opus));
    } catch (err) {
      this.log(`Decode failed: ${err.message}`);
    }
  }

  _trackSequence(seq) {
    const s = this.stats;
    s.received += 1;
    if (this.expectedSeq === null) {
      this.expectedSeq = seq;
      s.first = seq;
      s.last = seq - 1;
    }
    if (seq > this.expectedSeq) s.missing += seq - this.expectedSeq;
    else if (seq < this.expectedSeq) {
      if (seq <= s.last) s.duplicate += 1; else s.outOfOrder += 1;
    }
    if (seq > s.last) { s.last = seq; this.expectedSeq = seq + 1; }
  }

  resetStats() {
    this.stats = { received: 0, missing: 0, duplicate: 0, outOfOrder: 0, first: null, last: 0 };
    this.expectedSeq = null;
  }

  // --- control plane -------------------------------------------------------
  _onControl(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return this.log(`Bad JSON: ${raw}`); }

    if (msg.type === 'hello' && msg.udp) return this.emit('_hello', msg);

    if ((msg.type === 'tts' || msg.type === 'llm') && msg.text) {
      const { face, text } = parseExpressionTag(msg.text);
      // `kind`, not `type`: consumers spread this into their own typed envelope.
      this.emit('say', { kind: msg.type, face, text });
    }
    if (msg.type === 'tts' && msg.state === 'start') this.resetStats();
    if (msg.type === 'tts' && msg.state === 'stop') this.emit('stats', this.stats);
    if (msg.type === 'mode_update' && msg.session_id) {
      this.session.session_id = msg.session_id; // adopt the switched character's session
      this.emit('flush');
    }
    this.emit('control', msg);
  }

  listen(text = 'hello baby') {
    this.publish({ type: 'listen', session_id: this.session.session_id, state: 'detect', text });
  }

  abort() {
    this.publish({ type: 'abort', session_id: this.session.session_id });
  }

  speechEnd() {
    this.publish({ type: 'speech_end', session_id: this.session.session_id });
  }

  /** Feed mic PCM16 at the negotiated rate. Any length; sliced into Opus frames. */
  writePcm(chunk) {
    if (!this.session) return;
    let buf = Buffer.concat([this.pcmLeftover, chunk]);
    let off = 0;
    while (buf.length - off >= this.bytesPerFrame) {
      const frame = buf.subarray(off, off + this.bytesPerFrame);
      off += this.bytesPerFrame;
      try {
        this._sendUdp(this.encoder.encode(frame));
      } catch (err) {
        this.log(`Encode failed: ${err.message}`);
      }
    }
    this.pcmLeftover = buf.subarray(off);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.session && this.mqtt?.connected) {
        this.publish({ type: 'goodbye', session_id: this.session.session_id });
      }
    } catch { /* socket already gone */ }
    this.udp?.close();
    this.mqtt?.end(true);
    this.emit('closed', 'stopped');
  }
}

module.exports = { DeviceSim, parseExpressionTag, makeCredentials, SAMPLE_RATE };

// --- CLI harness: node device-sim.js --character-id NANI ---------------------
// Sends silence, prints what the gateway says back. Verifies the protocol
// without a browser in the loop.
if (require.main === module) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : dflt;
  };
  const sim = new DeviceSim({
    host: arg('host', process.env.GATEWAY_HOST || '127.0.0.1'),
    mqttPort: arg('mqtt-port', process.env.GATEWAY_MQTT_PORT || 1883),
    signatureKey: process.env.MQTT_SIGNATURE_KEY || '',
    mac: arg('mac', '00:16:3e:ac:b5:38'),
    characterId: arg('character-id', null),
    feature: arg('feature', null),
  });
  sim.on('log', (m) => console.log('[sim]', m));
  sim.on('say', (s) => console.log(`[${s.kind}]${s.face ? ` (${s.face})` : ''} ${s.text}`));
  sim.on('control', (m) => console.log('[ctl]', JSON.stringify(m).slice(0, 300)));
  sim.on('stats', (s) => console.log('[stats]', JSON.stringify(s)));

  let pcmFrames = 0;
  sim.on('pcm', () => { if (++pcmFrames % 50 === 0) console.log(`[audio] ${pcmFrames} frames in`); });

  sim.start().then(() => {
    sim.listen();
    // A tone, not silence: silent PCM encodes to 3-byte Opus DTX frames that
    // the gateway treats as "no audio", which makes the harness look broken.
    const tone = Buffer.alloc(sim.bytesPerFrame); // sized from the negotiated rate
    let phase = 0;
    setInterval(() => {
      for (let i = 0; i < tone.length / 2; i++) {
        tone.writeInt16LE(Math.round(6000 * Math.sin(phase += 2 * Math.PI * 440 / sim.rate)), i * 2);
      }
      sim.writePcm(tone);
    }, sim.frameMs);
    setTimeout(() => {
      console.log(`\nRESULT: ${pcmFrames} audio frames received, stats=${JSON.stringify(sim.stats)}`);
      sim.stop();
      process.exit(pcmFrames > 0 ? 0 : 1);
    }, Number(arg('seconds', 20)) * 1000);
  }).catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
