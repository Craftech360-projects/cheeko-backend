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

// Each builder is checked against its OWN slice of the source, not the whole
// file: a prior version of this test counted the spread literal across the
// whole file (expecting 3, anywhere), and missed the card_ai spread being
// deleted while a duplicate was added elsewhere in the file — the count held
// at 3 and every test stayed green while card_ai shipped with no key.
const ENCRYPTION_SPREAD =
  /\.\.\.\(rfidContent\.encryption \? \{ encryption: rfidContent\.encryption \} : \{\}\)/g;

test("card_content (grouped) forwards rfidContent.encryption", () => {
  const start = src.indexOf("if (hasStories) {");
  const end = src.indexOf("// Flat content");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate grouped card_content boundaries");
  const fn = src.slice(start, end);
  const occurrences = fn.match(ENCRYPTION_SPREAD) || [];
  assert.strictEqual(occurrences.length, 1, "expected encryption spread in grouped card_content");
});

test("card_content (flat) forwards rfidContent.encryption", () => {
  const start = src.indexOf("// Flat content");
  const end = src.indexOf("BRANCH C: AI PROMPT CARD");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate flat card_content boundaries");
  const fn = src.slice(start, end);
  const occurrences = fn.match(ENCRYPTION_SPREAD) || [];
  assert.strictEqual(occurrences.length, 1, "expected encryption spread in flat card_content");
});

test("card_ai forwards rfidContent.encryption", () => {
  const start = src.indexOf("send card_ai to set device into conversation mode");
  const end = src.indexOf("BRANCH B: Q&A");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate card_ai boundaries");
  const fn = src.slice(start, end);
  const occurrences = fn.match(ENCRYPTION_SPREAD) || [];
  assert.strictEqual(occurrences.length, 1, "expected encryption spread in card_ai");
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
