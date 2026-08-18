// Wiring for the storm fix: the deferred LiveKit setup must consult SetupBackoff
// before it runs, and report the outcome back. Without this, the module from
// setup-backoff.test.js is dead code and the 2026-08-18 herd is still possible.
const test = require("node:test");
const assert = require("node:assert");
const { VirtualMQTTConnection } = require("../mqtt/virtual-connection");
const { SetupBackoff } = require("../gateway/setup-backoff");

// Same idiom as livekit-bridge-require-room.test.js: bare prototype, no MQTT/UDP.
function connectionWith(backoff) {
  const c = Object.create(VirtualMQTTConnection.prototype);
  c.deviceId = "aa:bb:cc:dd:ee:ff";
  c.closing = false;
  c.gateway = { setupBackoff: backoff };
  return c;
}

const noSleep = () => Promise.resolve();

test("a setup that succeeds clears the device's backoff", async () => {
  const backoff = new SetupBackoff({});
  backoff.recordFailure("aa:bb:cc:dd:ee:ff");
  const c = connectionWith(backoff);

  await c._setupWithBackoff(async () => "ok", noSleep);

  assert.strictEqual(backoff.delayFor("aa:bb:cc:dd:ee:ff"), 0);
});

test("a setup that fails is recorded and rethrown so the caller still sends goodbye", async () => {
  const backoff = new SetupBackoff({});
  const c = connectionWith(backoff);

  await assert.rejects(
    () => c._setupWithBackoff(async () => { throw new Error("livekit down"); }, noSleep),
    /livekit down/
  );
  assert.ok(backoff.delayFor("aa:bb:cc:dd:ee:ff") >= 1000, "failure was not recorded");
});

test("while the breaker is open the expensive setup is never attempted", async () => {
  const backoff = new SetupBackoff({});
  for (let i = 0; i < 5; i++) backoff.recordFailure(`other-device-${i}`);
  const c = connectionWith(backoff);
  let attempted = false;

  await assert.rejects(
    () => c._setupWithBackoff(async () => { attempted = true; }, noSleep),
    /breaker/i
  );
  assert.strictEqual(attempted, false, "setup ran while the breaker was open");
});

test("a device that gave up during the backoff wait is not set up anyway", async () => {
  const backoff = new SetupBackoff({});
  backoff.recordFailure("aa:bb:cc:dd:ee:ff");
  const c = connectionWith(backoff);
  let attempted = false;

  // The device disconnects while we are holding it off — a room created now leaks.
  await c._setupWithBackoff(async () => { attempted = true; }, async () => { c.closing = true; });

  assert.strictEqual(attempted, false, "set up a connection that had already closed");
});
