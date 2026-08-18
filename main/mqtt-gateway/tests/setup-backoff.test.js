// The 2026-08-18 outage: every LiveKit setup failed, each device got a `goodbye`,
// all ~50 toys re-sent `hello` in lockstep, and the gateway attempted 50 more
// doomed setups. The room leak is fixed, so retries are cheap — but nothing damps
// the herd. SetupBackoff spaces retries out and stops hammering a dead dependency.
const test = require("node:test");
const assert = require("node:assert");
const { SetupBackoff } = require("../gateway/setup-backoff");

// Injected clock so the cooldown tests don't actually sleep.
function backoffAt(clock) {
  return new SetupBackoff({ now: () => clock.t });
}

test("a device that has not failed waits before its first setup", () => {
  const b = backoffAt({ t: 0 });

  assert.strictEqual(b.delayFor("aa:bb:cc"), 0);
});

test("delay grows exponentially with consecutive failures for that device", () => {
  const b = backoffAt({ t: 0 });

  b.recordFailure("aa:bb:cc");
  const first = b.delayFor("aa:bb:cc");
  b.recordFailure("aa:bb:cc");
  const second = b.delayFor("aa:bb:cc");

  assert.ok(first >= 1000 && first <= 1500, `first delay ${first} outside base+jitter`);
  assert.ok(second >= 2000 && second <= 3000, `second delay ${second} outside 2x+jitter`);
});

test("delay is capped so a wedged device is never parked forever", () => {
  const b = backoffAt({ t: 0 });

  for (let i = 0; i < 20; i++) b.recordFailure("aa:bb:cc");

  assert.ok(b.delayFor("aa:bb:cc") <= 45000, "delay exceeded the cap");
});

test("a successful setup clears the device's backoff", () => {
  const b = backoffAt({ t: 0 });

  b.recordFailure("aa:bb:cc");
  b.recordSuccess("aa:bb:cc");

  assert.strictEqual(b.delayFor("aa:bb:cc"), 0);
});

// The anti-herd property, at the size that actually took prod down: 50 toys
// failing in the same instant must not come back in the same instant.
test("a fleet that fails together is spread across the retry window", () => {
  const b = backoffAt({ t: 0 });
  const fleet = Array.from({ length: 50 }, (_, i) => `device-${i}`);

  fleet.forEach((d) => b.recordFailure(d));
  const delays = fleet.map((d) => b.delayFor(d));

  assert.ok(new Set(delays).size >= 40, `only ${new Set(delays).size}/50 distinct delays`);
  assert.ok(Math.max(...delays) - Math.min(...delays) > 200, "delays not spread");
});

test("the breaker opens once failures pile up across the whole fleet", () => {
  const b = backoffAt({ t: 0 });

  assert.strictEqual(b.isOpen(), false);
  for (let i = 0; i < 5; i++) b.recordFailure(`device-${i}`);

  assert.strictEqual(b.isOpen(), true);
});

test("the breaker closes again after the cooldown elapses", () => {
  const clock = { t: 0 };
  const b = backoffAt(clock);

  for (let i = 0; i < 5; i++) b.recordFailure(`device-${i}`);
  clock.t = 30001;

  assert.strictEqual(b.isOpen(), false);
});

test("one successful setup closes the breaker early", () => {
  const b = backoffAt({ t: 0 });

  for (let i = 0; i < 5; i++) b.recordFailure(`device-${i}`);
  b.recordSuccess("device-0");

  assert.strictEqual(b.isOpen(), false);
});
