const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

// mqtt-gateway.js is hard to instantiate directly (it wires MQTT/UDP/LiveKit
// clients on require), so — following the house pattern in
// dispatch-metadata.test.js — these tests pin the outbound message shape by
// asserting against the module's SOURCE TEXT rather than executing it. The
// failure mode this guards against is a dropped field: fetchRfidContentFromManagerApi
// returns an explicit whitelist, and a card_ai reply once carried a character's
// NAME but never its artwork for weeks because a field wasn't named there.
// `encryption` (the wrapped content key, Spec §6) is exactly the same shape of trap.

const src = fs.readFileSync(
  path.join(__dirname, "..", "gateway", "mqtt-gateway.js"),
  "utf8"
);

test("fetchRfidContentFromManagerApi whitelists encryption", () => {
  const start = src.indexOf("async function fetchRfidContentFromManagerApi");
  const end = src.indexOf("async function fetchContentDownloadManifest");
  assert.ok(start !== -1 && end !== -1, "could not locate function boundaries");
  const fn = src.slice(start, end);
  assert.match(fn, /encryption:\s*data\.encryption\s*\|\|\s*null/);
});

test("card_content (grouped + flat) and card_ai forward rfidContent.encryption", () => {
  const occurrences =
    src.match(
      /\.\.\.\(rfidContent\.encryption \? \{ encryption: rfidContent\.encryption \} : \{\}\)/g
    ) || [];
  assert.strictEqual(
    occurrences.length,
    3,
    "expected encryption spread in grouped card_content, flat card_content, and card_ai"
  );
});

test("handleContentDownloadRequest's download_response (grouped + flat) forward manifest.encryption", () => {
  const start = src.indexOf("async handleContentDownloadRequest");
  const end = src.indexOf(
    "handleModeChange",
    start
  );
  assert.ok(start !== -1 && end !== -1, "could not locate handleContentDownloadRequest boundaries");
  const fn = src.slice(start, end);
  const occurrences =
    fn.match(
      /\.\.\.\(manifest\.encryption \? \{ encryption: manifest\.encryption \} : \{\}\)/g
    ) || [];
  assert.strictEqual(
    occurrences.length,
    2,
    "expected encryption spread in both the grouped and flat download_required responses"
  );
});

test("encryption key is never logged", () => {
  // A guard against accidentally interpolating rfidContent.encryption /
  // manifest.encryption (which carries the raw key) into a logger.* call.
  assert.doesNotMatch(src, /logger\.[a-z]+\(`[^`]*\$\{[^}]*\.encryption[^}]*\}/);
});
