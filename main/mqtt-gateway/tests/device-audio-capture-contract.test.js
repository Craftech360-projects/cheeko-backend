const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const bridgePath = path.join(repoRoot, "livekit", "livekit-bridge.js");
const virtualConnectionPath = path.join(repoRoot, "mqtt", "virtual-connection.js");

test("LiveKitBridge captures incoming device PCM by default", () => {
  const source = fs.readFileSync(bridgePath, "utf8");

  assert.match(source, /this\.deviceAudioRecorder\s*=\s*null/);
  assert.match(source, /initializeDeviceAudioRecorder\(\)/);
  assert.match(source, /captureDevicePcm\(pcmBuffer\)/);
  assert.match(source, /sampleRate:\s*INCOMING_SAMPLE_RATE/);
  assert.match(source, /label:\s*"device-audio"/);
  assert.match(source, /this\.captureDevicePcm\(pcmBuffer\)/);
  assert.match(source, /this\.captureDevicePcm\(opusData\)/);
});

test("device stop-speaking events finalize the current device audio WAV", () => {
  const source = fs.readFileSync(virtualConnectionPath, "utf8");

  assert.match(source, /finalizeDeviceAudioCapture\("ptt_stop"\)/);
  assert.match(source, /finalizeDeviceAudioCapture\("speech_end"\)/);
});

test("LiveKitBridge captures outgoing agent PCM by default and finalizes when speech stops", () => {
  const source = fs.readFileSync(bridgePath, "utf8");

  assert.match(source, /initializeAgentAudioRecorder\(\)/);
  assert.match(source, /label:\s*"agent-audio"/);
  assert.match(source, /sampleRate:\s*OUTGOING_SAMPLE_RATE/);
  assert.match(source, /this\.captureAgentPcm\(frameData\)/);
  assert.match(source, /finalizeAgentAudioCapture\("agent_state_speaking_stopped"\)/);
  assert.match(source, /finalizeAgentAudioCapture\("agent_stream_speaking_stopped"\)/);
  assert.match(
    source,
    /const isEnabled = envEnabled !== undefined[\s\S]*configEnabled !== undefined[\s\S]*:\s*true;/
  );
});
