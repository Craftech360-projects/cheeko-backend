/**
 * Test-a-character sessions, straight through LiveKit.
 *
 * Does what mqtt-gateway does for a real device, minus the device: create the
 * room, attach the dispatch metadata the worker expects, dispatch the agent,
 * and mint a browser token. The browser then joins the room with livekit-client
 * and talks to the agent directly.
 *
 * No MQTT, no UDP, no Opus, no AES — those exist to get an ESP32 into a LiveKit
 * room, and a browser is already a WebRTC client. This tests the agent, not the
 * device transport (device-sim.js still covers that path).
 *
 * The metadata contract is imported from the gateway rather than re-typed, so
 * the worker keeps seeing exactly one shape. See core/mem0-integration.js.
 */

const crypto = require('crypto');
const {
  RoomServiceClient,
  AgentDispatchClient,
  AccessToken,
} = require('livekit-server-sdk');

const {
  buildDispatchMetadata,
  DEFAULT_RUNTIME_AGENT,
} = require('../mqtt-gateway/core/mem0-integration');

// Room name shape the gateway uses: <uuid>_<MAC, no colons, upper>_<type>.
// Some worker-side logging keys off it, so keep the shape.
function roomNameFor(mac, type = 'conversation') {
  return `${crypto.randomUUID()}_${mac.replace(/:/g, '').toUpperCase()}_${type}`;
}

// Same call the gateway makes for hello.character_id — resolves a character
// name to the agent that should serve it. persist:false keeps it session-scoped.
async function resolveCharacter(managerApiUrl, mac, characterName) {
  if (!characterName) return null;
  const url = `${managerApiUrl}/agent/device/${mac.replace(/:/g, '').toLowerCase()}/set-character`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterName, persist: false }),
  });
  const body = await r.json().catch(() => ({}));
  const d = body?.data;
  if (body?.code !== 0 || !d?.success) return null;
  return {
    characterName: d.newModeName || characterName,
    runtimeAgentName: d.runtimeAgentName || DEFAULT_RUNTIME_AGENT,
    characterId: d.characterId ?? null,
    language: d.language ?? null,
    sarvamVoiceId: d.sarvamVoiceId ?? null,
  };
}

async function fetchChildProfile(managerApiUrl, managerSecret, mac) {
  try {
    const r = await fetch(`${managerApiUrl}/config/child-profile-by-mac`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', secret: managerSecret || '' },
      body: JSON.stringify({ macAddress: mac.replace(/:/g, '').toLowerCase() }),
    });
    const body = await r.json().catch(() => ({}));
    return body?.code === 0 && body.data ? body.data : null;
  } catch {
    return null; // the agent has its own defaults; a missing profile isn't fatal
  }
}

/**
 * Create a room, dispatch the agent into it, and return a browser join token.
 */
async function startSession({ livekit, managerApiUrl, managerSecret, mac, characterName }) {
  const roomService = new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret);
  const dispatchClient = new AgentDispatchClient(livekit.url, livekit.apiKey, livekit.apiSecret);

  const [character, childProfile] = await Promise.all([
    resolveCharacter(managerApiUrl, mac, characterName),
    fetchChildProfile(managerApiUrl, managerSecret, mac),
  ]);

  const roomName = roomNameFor(mac);
  const agentName = character?.runtimeAgentName || DEFAULT_RUNTIME_AGENT;

  await roomService.createRoom({ name: roomName, emptyTimeout: 300, maxParticipants: 5 });

  const metadata = buildDispatchMetadata({
    macAddress: mac,
    deviceId: mac,
    character: character?.characterName || characterName || 'Cheeko',
    characterId: character?.characterId ?? null,
    language: character?.language ?? null,
    sarvamVoiceId: character?.sarvamVoiceId ?? null,
    childProfile,
    sessionConfig: {},
  });

  // Both, like the gateway: the worker reads job metadata, some paths read room
  // metadata, and they must agree.
  await roomService.updateRoomMetadata(roomName, metadata);
  await dispatchClient.createDispatch(roomName, agentName, { metadata });

  const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: `dashboard-${crypto.randomUUID().slice(0, 8)}`,
    name: 'Admin dashboard',
    ttl: '1h',
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  return {
    // The browser's address, which may differ from the one we just used.
    url: livekit.publicUrl || livekit.url,
    token: await at.toJwt(),
    roomName,
    agentName,
    character: character?.characterName || characterName || 'Cheeko',
    childName: childProfile?.name || null,
    childAge: childProfile?.age ?? null,
  };
}

async function deleteRoom(livekit, roomName) {
  try {
    await new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret).deleteRoom(roomName);
  } catch { /* already gone, or LiveKit cleaned it up on empty */ }
}

module.exports = { startSession, deleteRoom, roomNameFor };
