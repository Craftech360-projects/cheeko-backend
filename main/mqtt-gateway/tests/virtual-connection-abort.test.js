// Same teardown race as the room bug, different object: cleanup nulls this.bridge
// while sendAbortSignal() is in flight, then the next line derefs it. Logged this
// morning as "❌ [ABORT] Failed to forward abort signal to LiveKit:
// TypeError: Cannot read properties of null (reading 'sendTtsStopMessage')".
// Consequence is a device left in speaking mode — the TTS stop never arrives.
const test = require("node:test");
const assert = require("node:assert");
const { VirtualMQTTConnection } = require("../mqtt/virtual-connection");

function connectionWithBridge(bridge) {
  const c = Object.create(VirtualMQTTConnection.prototype);
  c.deviceId = "aa:bb:cc:dd:ee:ff";
  c.bridge = bridge;
  return c;
}

test("abort still stops TTS when cleanup nulls the bridge mid-flight", async () => {
  let ttsStopped = false;
  const c = connectionWithBridge(null);
  c.bridge = {
    // Cleanup runs while we are awaiting the abort signal.
    sendAbortSignal: async () => { c.bridge = null; },
    sendTtsStopMessage: () => { ttsStopped = true; },
  };

  await c._handleAbort({ type: "abort", session_id: "s-1" });

  assert.strictEqual(ttsStopped, true, "device was left in speaking mode");
});

test("abort with no bridge at all is a no-op, not a crash", async () => {
  const c = connectionWithBridge(null);

  await assert.doesNotReject(() => c._handleAbort({ type: "abort", session_id: "s-1" }));
});
