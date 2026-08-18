const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const gatewayPath = path.join(repoRoot, "gateway", "mqtt-gateway.js");

test("buildDispatchMetadata emits the complete LiveKit room metadata contract", () => {
  const { buildDispatchMetadata } = require("../core/mem0-integration");
  const meta = JSON.parse(buildDispatchMetadata({
    macAddress: "AABBCC",
    deviceId: "uuid-1",
    character: "Cheeko",
    childProfile: { name: "Asha" },
    memoryData: null,
  }));

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
    assert.ok(key in meta, `missing metadata key ${key}`);
  }

  // Mem0 was removed, but the worker's contract still requires these fields to
  // arrive as empty arrays. The old assertions grepped the builder's source for
  // the deleted `memoryData.memories || []` lines, so they broke on the removal
  // while the contract itself was never at risk.
  assert.deepStrictEqual(meta.long_term_memories, []);
  assert.deepStrictEqual(meta.memory_relations, []);
  assert.deepStrictEqual(meta.memory_entities, []);
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

test("buildDispatchMetadata carries parent_rule inside child_profile (ADR-0004)", () => {
  const { buildDispatchMetadata } = require("../core/mem0-integration");

  const withRule = JSON.parse(buildDispatchMetadata({
    macAddress: "AABBCC",
    childProfile: { name: "Asha", parent_rule: "Bedtime is 8pm" },
    memoryData: null,
  }));
  assert.strictEqual(withRule.child_profile.parent_rule, "Bedtime is 8pm");

  // Always present (null) when the child has no rule, so the worker reads a stable shape.
  const withoutRule = JSON.parse(buildDispatchMetadata({
    macAddress: "AABBCC",
    childProfile: { name: "Asha" },
    memoryData: null,
  }));
  assert.strictEqual(withoutRule.child_profile.parent_rule, null);
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
