const test = require("node:test");
const assert = require("node:assert");
const { LiveKitBridge } = require("../livekit/livekit-bridge");

// Build a bridge without running the real constructor (it allocates a native
// AudioSource). We only exercise the room-abandon path.
function bridgeWith(room) {
  const b = Object.create(LiveKitBridge.prototype);
  b.room = room;
  b.roomName = "test-room";
  b.roomService = null;
  return b;
}

function fakeRoom() {
  return {
    disconnectCalls: 0,
    async disconnect() {
      this.disconnectCalls++;
    },
  };
}

test("abandonRoom disconnects a room whose setup failed", async () => {
  const room = fakeRoom();
  const b = bridgeWith(room);

  await b.abandonRoom(new Error("registerTextStreamHandler of null"));

  assert.strictEqual(room.disconnectCalls, 1, "room must be disconnected");
  assert.strictEqual(b.room, null, "room reference must be cleared");
});

test("abandonRoom is safe when the room was never created", async () => {
  const b = bridgeWith(null);

  await b.abandonRoom(new Error("failed before room creation"));

  assert.strictEqual(b.room, null);
});

test("abandonRoom still clears the room when disconnect throws", async () => {
  const room = {
    disconnectCalls: 0,
    async disconnect() {
      this.disconnectCalls++;
      throw new Error("socket already gone");
    },
  };
  const b = bridgeWith(room);

  await b.abandonRoom(new Error("setup failed"));

  assert.strictEqual(room.disconnectCalls, 1);
  assert.strictEqual(b.room, null, "a throwing disconnect must not leak the room");
});
