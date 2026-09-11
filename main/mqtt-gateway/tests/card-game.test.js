const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

// The helper is unit-tested directly. The two senders are pinned against the
// module SOURCE TEXT, following card-content-encryption.test.js: the gateway
// wires MQTT/UDP/LiveKit on require, and the failure this guards against is a
// dropped field in fetchRfidContentFromManagerApi's explicit whitelist, or one
// sender growing a card_game branch while the other keeps spreading the lookup
// payload as card_content.

const { isCardGame, buildCardGameMessage } = require("../gateway/card-game");

const LOOKUP = {
  rfid_uid: "04A1B2C3",
  contentType: "sound_quiz",
  appId: "hometown",
  title: "Around the House",
  version: "3",
  contentHash: "h3",
  prompts: [{ sound: "Doorbell", prompt: "DING-DONG?", file: "doorbell.mp3" }],
  assets: [
    { name: "manifest.jsn", url: "https://cdn/rfidcontent/apps/hometown/manifest.jsn" },
    { name: "doorbell.mp3", url: "https://cdn/x.mp3" },
  ],
};

test("isCardGame keys on sound_quiz + appId + assets", () => {
  assert.strictEqual(isCardGame(LOOKUP), true);
  assert.strictEqual(isCardGame({ ...LOOKUP, contentType: "story_pack" }), false);
  assert.strictEqual(isCardGame({ ...LOOKUP, assets: null }), false);
  assert.strictEqual(isCardGame({ ...LOOKUP, appId: "" }), false);
  assert.strictEqual(isCardGame(null), false);
});

test("buildCardGameMessage emits the firmware contract in snake_case", () => {
  const msg = buildCardGameMessage("04A1B2C3", LOOKUP, { session_id: "s1" });
  assert.deepStrictEqual(msg, {
    type: "card_game",
    rfid_uid: "04A1B2C3",
    session_id: "s1",
    app_id: "hometown",
    name: "Around the House",
    version: 3,
    content_hash: "h3",
    prompts: [{ sound: "Doorbell", prompt: "DING-DONG?", file: "doorbell.mp3" }],
    assets: [
      { name: "manifest.jsn", url: "https://cdn/rfidcontent/apps/hometown/manifest.jsn" },
      { name: "doorbell.mp3", url: "https://cdn/x.mp3" },
    ],
  });
  // No camelCase leaks and nothing beyond the contract.
  assert.deepStrictEqual(Object.keys(msg).sort(), ["app_id", "assets", "content_hash", "name", "prompts", "rfid_uid", "session_id", "type", "version"]);
});

test("version defaults to 1 and content_hash to null", () => {
  const msg = buildCardGameMessage("U", { ...LOOKUP, version: undefined, contentHash: undefined });
  assert.strictEqual(msg.version, 1);
  assert.strictEqual(msg.content_hash, null);
});

const gatewaySrc = fs.readFileSync(path.join(__dirname, "..", "gateway", "mqtt-gateway.js"), "utf8");
const vcSrc = fs.readFileSync(path.join(__dirname, "..", "mqtt", "virtual-connection.js"), "utf8");

test("fetchRfidContentFromManagerApi whitelists the game fields", () => {
  const start = gatewaySrc.indexOf("async function fetchRfidContentFromManagerApi");
  const end = gatewaySrc.indexOf("async function fetchContentDownloadManifest");
  assert.ok(start !== -1 && end !== -1, "could not locate function boundaries");
  const fn = gatewaySrc.slice(start, end);
  for (const f of ["appId", "contentHash", "prompts", "assets"]) {
    assert.match(fn, new RegExp(`${f}:\\s*data\\.${f}\\s*\\|\\|\\s*null`), `whitelist must name ${f}`);
  }
});

test("no-session router sends card_game before the textToSend guard", () => {
  const start = gatewaySrc.indexOf("sent card_unknown to device");
  const end = gatewaySrc.indexOf("// Determine text for agent path");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate the routing slice");
  const slice = gatewaySrc.slice(start, end);
  assert.match(slice, /isCardGame\(rfidContent\)/);
  assert.match(slice, /buildCardGameMessage\(rfidUid, rfidContent\)/);
});

test("in-session sender sends card_game before the isAiCard classification", () => {
  const start = vcSrc.indexOf("const cardData = response.data.data;");
  const end = vcSrc.indexOf("const isAiCard =");
  assert.ok(start !== -1 && end !== -1 && start < end, "could not locate the lookup slice");
  const slice = vcSrc.slice(start, end);
  assert.match(slice, /isCardGame\(cardData\)/);
  assert.match(slice, /buildCardGameMessage\(rfidUid, cardData, \{ session_id: json\.session_id \}\)/);
});

test("both senders require the shared helper", () => {
  assert.match(gatewaySrc, /require\("\.\/card-game"\)/);
  assert.match(vcSrc, /require\("\.\.\/gateway\/card-game"\)/);
});
