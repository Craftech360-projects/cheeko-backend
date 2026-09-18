// Seen on dev 2026-09-18: the child interrupted the greeting, the agent went
// speaking -> listening (a tts stop scheduled 500ms out), and the reply's tts
// start went out 380ms later. The stale stop then landed 121ms AFTER that start,
// the device stopped playback, and the whole reply streamed to a toy that was no
// longer playing. A pending stop must never arrive after a newer start.
const test = require("node:test");
const assert = require("node:assert");
const { LiveKitBridge } = require("../livekit/livekit-bridge");

function bridgeRecordingMqtt() {
  const b = Object.create(LiveKitBridge.prototype);
  b.macAddress = "AA:BB:CC:DD:EE:FF";
  b.sent = [];
  b.connection = {
    udp: { session_id: "s1" },
    sendMqttMessage: (raw) => b.sent.push(JSON.parse(raw).state),
  };
  return b;
}

test("a stop still pending when new speech starts is sent before the start, not after it", async () => {
  const b = bridgeRecordingMqtt();

  b.scheduleTtsStop(); // greeting interrupted: speaking -> listening
  await new Promise((r) => setTimeout(r, 380));
  b.sendTtsStartMessage("Yippee!"); // the reply begins before the 500ms stop fired
  await new Promise((r) => setTimeout(r, 300)); // well past the original stop time

  assert.deepStrictEqual(b.sent, ["stop", "start"]);
});

test("a stop with no new speech behind it is still sent after the delay", async () => {
  const b = bridgeRecordingMqtt();

  b.scheduleTtsStop();
  assert.deepStrictEqual(b.sent, []);
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["stop"]);
});
