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

test("mqtt-gateway dispatch call sites use the shared metadata builder", () => {
  const source = fs.readFileSync(gatewayPath, "utf8");

  assert.match(source, /buildDispatchMetadata/);
  assert.doesNotMatch(source, /metadata:\s*JSON\.stringify\s*\(\s*\{/);
});
