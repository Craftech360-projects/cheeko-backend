// Drives the REAL connect() path and forces the failure that took prod down on
// 2026-08-18: setup throws after the room is already connected. Proves the
// catch releases the room instead of stranding a live websocket.
const test = require("node:test");
const assert = require("node:assert");

const rtc = require("@livekit/rtc-node");

let lastRoom = null;

class FakeRoom {
  constructor() {
    this.connectCalls = 0;
    this.disconnectCalls = 0;
    this.localParticipant = {
      publishTrack: async () => ({}),
      publishData: async () => {},
      setAttributes: async () => {},
    };
    lastRoom = this;
  }
  on() {}
  off() {}
  removeAllListeners() {}
  async connect() {
    this.connectCalls++;
  }
  registerTextStreamHandler() {
    // The production failure: cleanup nulled the room mid-connect.
    throw new TypeError("Cannot read properties of null (reading 'registerTextStreamHandler')");
  }
  async disconnect() {
    this.disconnectCalls++;
  }
}

rtc.Room = FakeRoom;

const { LiveKitBridge } = require("../livekit/livekit-bridge");

function bridge() {
  const b = Object.create(LiveKitBridge.prototype);
  b.macAddress = "00:16:3E:00:00:01";
  b.uuid = "test-uuid";
  b.roomType = "conversation";
  b.sessionId = "test-uuid";
  b.livekitConfig = {
    url: "ws://127.0.0.1:7880",
    api_key: "devkey",
    api_secret: "secret-at-least-32-chars-long-for-jwt",
  };
  b.audioSource = {};
  b.workerPool = null;
  b.userData = {};
  b.connection = {};
  b.emit = () => {};
  b.on = () => {};
  return b;
}

test("a room whose setup throws is disconnected, not stranded", async () => {
  const b = bridge();

  await assert.rejects(() => b.connect({}, {}, null));

  // Before the fix the catch only logged and rejected, leaving this.room
  // pointing at a room the gateway never closed. That is the leak.
  assert.strictEqual(
    b.room,
    null,
    "a failed setup must release the room, not strand it on the bridge"
  );
});
