// Teardown hygiene from docs/plans/2026-03-07-mqtt-gateway-scaling-design.md
// (items 1.3 and 1.4). These pin the contract that close() releases what it owns.
//
// They are NOT justified by a measured memory win: an A/B burst on dev (20 sessions,
// same script back to back) retained +115 MB without these changes and +119 MB with
// them. The residual native retention on prod — 1.17 GB RSS on a 32 MB JS heap —
// remains unexplained; MALLOC_ARENA_MAX=2 is still the only intervention with a
// measured effect.
const test = require("node:test");
const assert = require("node:assert");
const { LiveKitBridge } = require("../livekit/livekit-bridge");

function bridgeWithRoom() {
  const b = Object.create(LiveKitBridge.prototype);
  let removed = false;
  b.room = {
    removeAllListeners: () => { removed = true; },
    disconnect: async () => {},
    localParticipant: null,
    state: "disconnected",
    wasCleared: () => removed,
  };
  b.roomName = "room-1";
  b.roomService = null;
  b.macAddress = "aa:bb:cc:dd:ee:ff";
  b.connection = null;
  b.audioSource = null;
  b.isAudioPlaying = false;
  b.audioPlayingStartTime = null;
  b.workerPool = null;
  b.sessionId = null;
  b.pendingMcpRequests = new Map([["req-1", { resolve() {}, reject() {} }]]);
  b.volumeAdjustmentQueue = [{ action: "up", step: 1, resolve() {}, reject() {} }];
  return b;
}

test("close() removes room listeners so the native Room can be freed", async () => {
  const b = bridgeWithRoom();
  const room = b.room;

  await b.close();

  assert.strictEqual(room.wasCleared(), true, "listeners left attached to the Room");
});

test("close() clears pending MCP requests", async () => {
  const b = bridgeWithRoom();

  await b.close();

  assert.strictEqual(b.pendingMcpRequests.size, 0, "pending MCP requests retained");
});

test("close() clears the volume adjustment queue", async () => {
  const b = bridgeWithRoom();

  await b.close();

  assert.strictEqual(b.volumeAdjustmentQueue.length, 0, "volume queue retained");
});
