// tests/session-verdict.test.js
const test = require('node:test');
const assert = require('assert');
const Module = require('module');

// Stub axios before requiring the connection module.
let lastGet;
let axiosResponse = { data: { code: 0, msg: 'success', data: { allowed: true, reason: 'ok', remaining: null } } };
let axiosError = null;

const axiosStub = {
  get: async (url, opts) => {
    lastGet = { url, opts };
    if (axiosError) throw axiosError;
    return axiosResponse;
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
const BASE = 'http://api:8002';

// fetchSessionVerdict touches no instance state, so a bare receiver is enough.
const fetchVerdict = (mac = MAC, base = BASE) =>
  VirtualMQTTConnection.prototype.fetchSessionVerdict.call({}, mac, base);

test.beforeEach(() => {
  axiosError = null;
  axiosResponse = { data: { code: 0, msg: 'success', data: { allowed: true, reason: 'ok', remaining: null } } };
  process.env.MANAGER_API_SECRET = 'svc-123';
});

test('calls session-verdict with the service key', async () => {
  await fetchVerdict();

  assert.strictEqual(lastGet.url, `${BASE}/toy/device/${encodeURIComponent(MAC)}/session-verdict`);
  assert.strictEqual(lastGet.opts.headers['X-Service-Key'], 'svc-123');
});

test('returns the verdict payload on success', async () => {
  axiosResponse = { data: { code: 0, data: { allowed: false, reason: 'no_plan', remaining: null } } };

  const verdict = await fetchVerdict();

  assert.strictEqual(verdict.allowed, false);
  assert.strictEqual(verdict.reason, 'no_plan');
});

test('fails open when the endpoint errors', async () => {
  axiosError = new Error('ECONNREFUSED');

  const verdict = await fetchVerdict();

  assert.strictEqual(verdict.allowed, true);
  assert.strictEqual(verdict.reason, 'fail_open');
});

test('fail-open verdict keeps the endpoint remaining shape, not a bare null', async () => {
  axiosError = new Error('ECONNREFUSED');

  const { remaining } = await fetchVerdict();

  // SUB-3 will read remaining.questions_month; a null here would throw during
  // exactly the outage the fail-open path exists to survive.
  assert.deepStrictEqual(remaining, {
    questions_month: null,
    questions_today: null,
    minutes_today: null,
    images_today: null,
  });
});

test('fails open when the endpoint times out', async () => {
  axiosError = Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });

  const verdict = await fetchVerdict();

  assert.strictEqual(verdict.allowed, true);
  assert.strictEqual(verdict.reason, 'fail_open');
});

test('fails open on a non-success envelope', async () => {
  axiosResponse = { data: { code: 401, msg: 'Invalid service key' } };

  const verdict = await fetchVerdict();

  assert.strictEqual(verdict.allowed, true);
  assert.strictEqual(verdict.reason, 'fail_open');
});
