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
  b._ttsTurnActive = false;
  b._ttsTurnGeneration = 0;
  b._pendingTtsStopTimer = null;
  b.connection = {
    udp: { session_id: "s1" },
    sendMqttMessage: (raw) => b.sent.push(JSON.parse(raw).state),
  };
  return b;
}

test("agent speaking state starts TTS without speech_created", () => {
  const b = bridgeRecordingMqtt();

  b.handleTtsAgentStateChange("listening", "speaking");

  assert.deepStrictEqual(b.sent, ["start"]);
});

test("cascade speech_created remains sentence metadata after the state starts TTS", () => {
  const b = bridgeRecordingMqtt();

  b.handleTtsAgentStateChange("thinking", "speaking");
  b.sendTtsStartMessage("Hello there");

  assert.deepStrictEqual(b.sent, ["start", "sentence_start"]);
});

test("speech_created still starts legacy agents that do not publish state", () => {
  const b = bridgeRecordingMqtt();

  b.sendTtsStartMessage("Hello there");

  assert.deepStrictEqual(b.sent, ["start"]);
});

test("duplicate state delivery starts and stops a turn only once", async () => {
  const b = bridgeRecordingMqtt();

  b.handleTtsAgentStateChange("listening", "speaking");
  b.handleTtsAgentStateChange("listening", "speaking");
  b.handleTtsAgentStateChange("speaking", "listening");
  b.handleTtsAgentStateChange("speaking", "listening");
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["start", "stop"]);
});

test("clearing audio buffers cancels a delayed stop from the old session", async () => {
  const b = bridgeRecordingMqtt();
  b.frameBuffer = Buffer.alloc(0);
  b.workerPool = null;

  b.sendTtsStartMessage();
  b.scheduleTtsStop();
  b.clearAudioBuffers();
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["start"]);
});

test("closing the bridge cancels a delayed stop", async () => {
  const b = bridgeRecordingMqtt();
  b.finalizeDeviceAudioCapture = () => {};
  b.finalizeAgentAudioCapture = () => {};
  b.room = null;
  b.pendingMcpRequests = new Map();
  b.volumeAdjustmentQueue = [];
  b.workerPool = null;

  b.sendTtsStartMessage();
  b.scheduleTtsStop();
  await b.close();
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["start"]);
});

test("short consecutive turns each send their own start and stop", async () => {
  const b = bridgeRecordingMqtt();

  b.handleTtsAgentStateChange("listening", "speaking");
  b.scheduleTtsStop();
  await new Promise((r) => setTimeout(r, 600));
  b.handleTtsAgentStateChange("listening", "speaking");
  b.scheduleTtsStop();
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["start", "stop", "start", "stop"]);
});

test("a stop still pending when new speech starts is sent before the start, not after it", async () => {
  const b = bridgeRecordingMqtt();

  b.sendTtsStartMessage("Hello!");
  b.scheduleTtsStop(); // greeting interrupted: speaking -> listening
  await new Promise((r) => setTimeout(r, 380));
  b.sendTtsStartMessage("Yippee!"); // the reply begins before the 500ms stop fired
  await new Promise((r) => setTimeout(r, 300)); // well past the original stop time

  assert.deepStrictEqual(b.sent, ["start", "stop", "start"]);
});

test("a stop with no new speech behind it is still sent after the delay", async () => {
  const b = bridgeRecordingMqtt();

  b.sendTtsStartMessage();
  b.scheduleTtsStop();
  assert.deepStrictEqual(b.sent, ["start"]);
  await new Promise((r) => setTimeout(r, 600));

  assert.deepStrictEqual(b.sent, ["start", "stop"]);
});
