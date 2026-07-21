// tests/subscription-gate.test.js — SUB-2 criterion 3: a refused verdict
// streams the gate clip and creates no LiveKit room.
const test = require('node:test');
const assert = require('assert');
const Module = require('module');
const path = require('path');

const axiosStub = {
  get: async (url) => {
    if (url.includes('/device-mode')) return { data: { code: 0, data: 'manual' } };
    if (url.includes('/mode')) return { data: { code: 0, data: 'conversation' } };
    return { data: { code: 0, data: null } };
  },
  post: async () => ({ data: { code: 0 } }),
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'axios') return axiosStub;
  return origLoad.apply(this, arguments);
};

const { VirtualMQTTConnection } = require('../mqtt/virtual-connection');

const MAC = 'AA:BB:CC:DD:EE:FF';

// Minimal receiver for _deferredSetup. roomService is a tripwire: Step 2 touches
// it, so a refused session that reaches LiveKit fails loudly instead of silently.
function makeConnection(verdict) {
  const calls = { streamed: [], mqtt: [], closed: false };
  return {
    calls,
    deviceId: MAC,
    imagineFeatureEnabled: false,
    deferredSetupInProgress: true,
    udp: { session_id: 'sess-1', remoteAddress: { address: '1.2.3.4', port: 5 } },
    gateway: {
      get roomService() {
        throw new Error('Step 2 reached: LiveKit room setup must not run for a refused session');
      },
      streamAudioViaUdp: async (...args) => { calls.streamed.push(args); },
    },
    sendMqttMessage: (m) => calls.mqtt.push(JSON.parse(m)),
    close: () => { calls.closed = true; },
    fetchCurrentCharacter: async () => ({ characterName: 'Cheeko', runtimeAgentName: 'cheeko' }),
    fetchChildProfile: async () => null,
    fetchSessionVerdict: async () => verdict,
    _deferredSetup: VirtualMQTTConnection.prototype._deferredSetup,
  };
}

const run = (conn) => conn._deferredSetup({}, MAC, 'uuid-1', 'AABBCCDDEEFF', 'sess-1');

test.beforeEach(() => {
  process.env.MANAGER_API_URL = 'http://api:8002/toy';
});

test('refused verdict streams the gate clip and creates no LiveKit room', async () => {
  const conn = makeConnection({ allowed: false, reason: 'no_plan', remaining: null });

  await run(conn);

  assert.strictEqual(conn.calls.streamed.length, 1, 'gate clip should stream exactly once');
  const [deviceId, clipPath, , sendGoodbye, text] = conn.calls.streamed[0];
  assert.strictEqual(deviceId, MAC);
  assert.strictEqual(path.basename(clipPath), 'subscription_gate.pcm');
  assert.strictEqual(sendGoodbye, false);
  assert.match(text, /Mumma or Papa/);
  assert.strictEqual(conn.deferredSetupInProgress, false);
});

test('refused verdict sends goodbye carrying the reason, then closes', async () => {
  const conn = makeConnection({ allowed: false, reason: 'no_plan', remaining: null });

  await run(conn);

  const goodbye = conn.calls.mqtt.find((m) => m.type === 'goodbye');
  assert.ok(goodbye, 'device must be told the session is over');
  assert.strictEqual(goodbye.reason, 'no_plan');
  assert.strictEqual(conn.calls.closed, true);
});

test('allowed verdict proceeds to LiveKit and streams no clip', async () => {
  const conn = makeConnection({ allowed: true, reason: 'ok', remaining: null });

  // The roomService tripwire throws, which *is* the proof we got to Step 2.
  await assert.rejects(run(conn), /Step 2 reached/);
  assert.strictEqual(conn.calls.streamed.length, 0, 'allowed session must not hear the gate clip');
});

test('a fail-open verdict is allowed, not gated', async () => {
  const conn = makeConnection({ allowed: true, reason: 'fail_open', remaining: null });

  await assert.rejects(run(conn), /Step 2 reached/);
  assert.strictEqual(conn.calls.streamed.length, 0);
});

test('a rejected verdict promise does not gate the session', async () => {
  const conn = makeConnection(null);
  conn.fetchSessionVerdict = async () => { throw new Error('unexpected'); };

  // fetchSessionVerdict fails open internally, but a bug there must not lock a
  // paying child out — allSettled rejection has to fall through to allowed.
  await assert.rejects(run(conn), /Step 2 reached/);
  assert.strictEqual(conn.calls.streamed.length, 0);
});
