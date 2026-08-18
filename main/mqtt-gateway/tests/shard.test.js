// Phase 1 of making the gateway horizontal: N instances, each owning a disjoint
// slice of devices by MAC hash. There is no shared state — a device is wholly
// owned by one instance — so the ONLY thing that must hold is that the gateway
// and manager-api compute the same shard for the same device. These tests pin
// that contract; if the hash changes on one side, devices get routed to an
// instance that will never answer them.
const test = require("node:test");
const assert = require("node:assert");
const { shardFor, normalizeMac } = require("../gateway/shard");

test("a device always lands on the same shard", () => {
  const a = shardFor("AA:BB:CC:DD:EE:FF", 4);
  const b = shardFor("AA:BB:CC:DD:EE:FF", 4);

  assert.strictEqual(a, b);
});

// The gateway sees "AA:BB:CC:DD:EE:FF"; OTA sees "aa:bb:cc:dd:ee:ff" or
// "AABBCCDDEEFF". All three are the same toy and MUST hash to the same shard.
test("MAC formatting differences do not change the shard", () => {
  const canonical = shardFor("AA:BB:CC:DD:EE:FF", 4);

  assert.strictEqual(shardFor("aa:bb:cc:dd:ee:ff", 4), canonical);
  assert.strictEqual(shardFor("AABBCCDDEEFF", 4), canonical);
  assert.strictEqual(shardFor("aa-bb-cc-dd-ee-ff", 4), canonical);
});

test("shard is always inside the instance range", () => {
  for (let i = 0; i < 50; i++) {
    const s = shardFor(`AA:BB:CC:00:00:${i.toString(16).padStart(2, "0")}`, 4);
    assert.ok(s >= 0 && s < 4, `shard ${s} out of range`);
  }
});

// Single-instance deployments (prod today) must keep working untouched.
test("a single instance owns every device", () => {
  assert.strictEqual(shardFor("AA:BB:CC:DD:EE:FF", 1), 0);
  assert.strictEqual(shardFor("11:22:33:44:55:66", 1), 0);
});

// Uneven sharding would put the whole fleet on one box and defeat the point.
test("a fleet spreads across all shards", () => {
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 200; i++) {
    counts[shardFor(`D0:CF:13:04:${(i >> 8) & 0xff}:${i & 0xff}`, 4)]++;
  }

  assert.ok(Math.min(...counts) >= 30, `lopsided distribution: ${counts}`);
});

test("normalizeMac strips separators and cases", () => {
  assert.strictEqual(normalizeMac("aa-bb:cc.DD:ee:ff"), "AABBCCDDEEFF");
});

// The gateway drops messages for devices it does not own. Without this, every
// instance would answer every hello and toys would get N conflicting sessions.
test("an instance owns only its own slice", () => {
  const { ownsDevice } = require("../gateway/shard");
  const mac = "AA:BB:CC:DD:EE:FF";
  const mine = shardFor(mac, 4);

  assert.strictEqual(ownsDevice(mac, mine, 4), true);
  for (let i = 0; i < 4; i++) {
    if (i !== mine) assert.strictEqual(ownsDevice(mac, i, 4), false);
  }
});

test("every device is owned by exactly one instance", () => {
  const { ownsDevice } = require("../gateway/shard");
  for (let d = 0; d < 40; d++) {
    const mac = `D0:CF:13:04:15:${d.toString(16).padStart(2, "0")}`;
    const owners = [0, 1, 2, 3].filter((i) => ownsDevice(mac, i, 4));
    assert.strictEqual(owners.length, 1, `${mac} owned by ${owners.length} instances`);
  }
});
