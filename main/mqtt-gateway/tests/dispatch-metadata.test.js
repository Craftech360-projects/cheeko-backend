const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const gatewayPath = path.join(repoRoot, "gateway", "mqtt-gateway.js");
const metadataBuilderPath = path.join(repoRoot, "core", "mem0-integration.js");

test("buildDispatchMetadata emits the complete LiveKit room metadata contract", () => {
  const source = fs.readFileSync(metadataBuilderPath, "utf8");
  const requiredKeys = [
    "character",
    "character_id",
    "language",
    "child_profile",
    "device_mac",
    "device_uuid",
    "long_term_memories",
    "memory_entities",
    "memory_relations",
    "session_agent_name",
    "session_language_code",
    "session_language_name",
    "session_voice_id",
    "timestamp",
  ];

  for (const key of requiredKeys) {
    assert.match(source, new RegExp(`${key}:`), `missing metadata key ${key}`);
  }

  assert.match(source, /memories\s*=\s*memoryData\.memories\s*\|\|\s*\[\]/);
  assert.match(source, /relations\s*=\s*memoryData\.relations\s*\|\|\s*\[\]/);
  assert.match(source, /entities\s*=\s*memoryData\.entities\s*\|\|\s*\[\]/);
});

test("buildDispatchMetadata carries character_id and language but no persona text", () => {
  const { buildDispatchMetadata } = require("../core/mem0-integration");
  const meta = JSON.parse(buildDispatchMetadata({
    macAddress: "AABBCC",
    deviceId: "uuid-1",
    character: "Cheeko",
    characterId: "char-uuid",
    language: "German",
    childProfile: { name: "Asha" },
    memoryData: null,
  }));

  assert.strictEqual(meta.character_id, "char-uuid");
  assert.strictEqual(meta.language, "German");
  assert.strictEqual(meta.character, "Cheeko");
  // persona text must never ride in dispatch metadata (size ceiling, ADR-0003)
  assert.ok(!("system_prompt" in meta) && !("soul" in meta));
});

test("DEFAULT_RUNTIME_AGENT matches the deployed worker default", () => {
  const { DEFAULT_RUNTIME_AGENT } = require("../core/mem0-integration");
  assert.strictEqual(DEFAULT_RUNTIME_AGENT, process.env.LIVEKIT_DEFAULT_AGENT || "cheeko-agent");
});

test("mqtt-gateway dispatch call sites use the shared metadata builder", () => {
  const source = fs.readFileSync(gatewayPath, "utf8");

  assert.match(source, /buildDispatchMetadata/);
  assert.doesNotMatch(source, /metadata:\s*JSON\.stringify\s*\(\s*\{/);
});

test("the hardcoded CHARACTER_AGENT_MAP lookup is gone from both files", () => {
  const gateway = fs.readFileSync(gatewayPath, "utf8");
  const vconn = fs.readFileSync(path.join(repoRoot, "mqtt", "virtual-connection.js"), "utf8");
  // a lookup (the "[") would remain only if the map were still in use; comments have none
  assert.doesNotMatch(gateway, /CHARACTER_AGENT_MAP\s*\[/);
  assert.doesNotMatch(vconn, /CHARACTER_AGENT_MAP\s*\[/);
});
