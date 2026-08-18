// The one contract that makes sharding safe: manager-api and the gateway must
// compute the SAME shard for the same device. The gateway silently drops MQTT
// messages for devices it does not own, so a disagreement here does not error —
// it just means settings pushes vanish and toys never get their updates.
const test = require("node:test");
const assert = require("node:assert");
const gateway = require("../gateway/shard");
const managerApi = require("../../manager-api-node/src/utils/gateway-shard");

test("gateway and manager-api agree on every device's shard", () => {
  for (let count of [2, 4, 8]) {
    for (let d = 0; d < 100; d++) {
      const mac = `D0:CF:13:${(d >> 4) & 0xff}:${d & 0xff}:${(d * 7) & 0xff}`;
      assert.strictEqual(
        gateway.shardFor(mac, count),
        managerApi.shardFor(mac, count),
        `disagreement for ${mac} at count=${count}`
      );
    }
  }
});

test("both sides normalize MAC formatting identically", () => {
  const forms = ["AA:BB:CC:DD:EE:FF", "aa-bb-cc-dd-ee-ff", "AABBCCDDEEFF"];
  for (const f of forms) {
    assert.strictEqual(gateway.normalizeMac(f), managerApi.normalizeMac(f));
    assert.strictEqual(gateway.shardFor(f, 4), managerApi.shardFor(f, 4));
  }
});

test("manager-api routes a device to its owning instance's port", () => {
  process.env.GATEWAY_SHARD_COUNT = "4";
  process.env.MQTT_GATEWAY_INTERNAL_URL = "http://127.0.0.1:8091";
  const mac = "AA:BB:CC:DD:EE:FF";

  const url = managerApi.gatewayUrlFor(mac);

  assert.strictEqual(url, `http://127.0.0.1:${8091 + gateway.shardFor(mac, 4)}`);
  delete process.env.GATEWAY_SHARD_COUNT;
});

// Prod runs one instance today; sharding must be invisible until switched on.
test("single-instance deployments are unaffected", () => {
  delete process.env.GATEWAY_SHARD_COUNT;
  process.env.MQTT_GATEWAY_INTERNAL_URL = "http://127.0.0.1:8091";

  assert.strictEqual(managerApi.gatewayUrlFor("AA:BB:CC:DD:EE:FF"), "http://127.0.0.1:8091");
});
