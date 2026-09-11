/**
 * card_game: the message a tapped sound-quiz card produces (spec §3 in
 * docs/superpowers/specs/2026-09-11-sound-pack-game-card-design.md).
 *
 * One builder for both senders — the no-session router in mqtt-gateway.js and
 * the in-session path in virtual-connection.js. They have drifted before
 * (character artwork reached one and not the other for weeks), so the shape
 * lives here and nowhere else.
 *
 * The lookup API speaks camelCase; the firmware reads snake_case. Field names
 * below are the firmware contract. Do not add or rename.
 */

function isCardGame(data) {
  return Boolean(
    data &&
    data.contentType === "sound_quiz" &&
    data.appId &&
    Array.isArray(data.assets)
  );
}

function buildCardGameMessage(rfidUid, data, extra = {}) {
  const version = parseInt(data.version, 10);
  return {
    type: "card_game",
    rfid_uid: rfidUid,
    ...extra,
    app_id: data.appId,
    name: data.title || data.packName || data.appId,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    content_hash: data.contentHash || null,
    prompts: (data.prompts || []).map((p) => ({ sound: p.sound, prompt: p.prompt, file: p.file })),
    assets: data.assets.map((a) => ({ name: a.name, url: a.url })),
  };
}

module.exports = { isCardGame, buildCardGameMessage };
