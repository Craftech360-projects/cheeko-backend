// The race that crashed prod on 2026-08-18: cleanup nulls this.room while the
// async connect() is still in flight, then setup dereferences it. requireRoom()
// is the guard that turns that into a clean error instead of a TypeError.
const test = require("node:test");
const assert = require("node:assert");
const { LiveKitBridge } = require("../livekit/livekit-bridge");

function bridgeWithRoom(room) {
  const b = Object.create(LiveKitBridge.prototype);
  b.room = room;
  return b;
}

test("requireRoom throws a clear error when the room was torn down mid-setup", () => {
  const b = bridgeWithRoom(null);

  assert.throws(() => b.requireRoom(), /torn down during setup/);
});

test("requireRoom returns the live room when setup is still valid", () => {
  const room = { id: "room-1" };
  const b = bridgeWithRoom(room);

  assert.strictEqual(b.requireRoom(), room);
});
