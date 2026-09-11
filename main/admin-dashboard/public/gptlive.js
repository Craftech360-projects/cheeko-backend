// GPT-Live tab — talk to a full-duplex realtime agent through LiveKit.
//
// Unlike the Test device tab there is no push-to-talk and no greeting trigger:
// the mic stays open and the model decides when to listen, speak and stop.
// The server side is the same /lk/start, with agentName dispatching the worker
// directly instead of resolving a character through the manager.

const G = (id) => document.getElementById(id);

let gRoom = null;
let gSession = null;
let gLK = null;
// Transcript rows keyed by segment id. Every lk.transcription chunk carries the
// full text of its segment, so a chunk rewrites its own row and a new segment
// id starts a new row. Keying on lk.final (as test.js does) loses history with
// GPT-Live, whose segments are not always closed with a final chunk.
const gRows = new Map();

// Timing, all client-side (performance.now()). GPT-Live reports no ttft, so
// these are the numbers that matter for feel: how long after the child's
// words the agent starts talking, and how long a backend delegation takes.
const gT = { start: 0, lastUserText: 0, stateSince: 0, state: null, lastReply: null, lastDelegate: null, join: null };

function glog(message, cls) {
  const line = document.createElement('div');
  line.className = 'logline' + (cls ? ' ' + cls : '');
  line.textContent = message;
  G('gptLog').appendChild(line);
  G('gptLog').scrollTop = G('gptLog').scrollHeight;
}

const fmt = (ms) => (ms == null ? '—' : Math.round(ms) + ' ms');
function gMetrics() {
  G('gptMetrics').textContent = `join ${fmt(gT.join)} · reply ${fmt(gT.lastReply)} · delegate ${fmt(gT.lastDelegate)}`;
}

function gTurn(segmentId, who, text, final) {
  if (!text) return;
  let row = gRows.get(segmentId);
  if (!row) {
    row = document.createElement('div');
    row.className = 'turn ' + who;
    row.innerHTML = `<span class="who">${who === 'kid' ? 'You' : 'Cheeko'}</span><span class="said"></span>`;
    G('gptTranscript').appendChild(row);
    gRows.set(segmentId, row);
  }
  row.querySelector('.said').textContent = text;
  row.classList.toggle('interim', !final);
  G('gptTranscript').scrollTop = G('gptTranscript').scrollHeight;
}

function gState(next) {
  const now = performance.now();
  const prev = gT.state;
  const held = prev ? now - gT.stateSince : 0;
  G('gptState').textContent = next;
  glog(`agent: ${prev || '—'} -> ${next}` + (prev ? ` (${prev} for ${fmt(held)})` : ''));
  if (next === 'speaking' && gT.lastUserText) {
    gT.lastReply = now - gT.lastUserText;            // last user transcript -> agent audio
    gT.lastUserText = 0;
    glog(`reply latency (last transcript -> speaking): ${fmt(gT.lastReply)}`, 'ok');
  }
  if (prev === 'thinking') {
    gT.lastDelegate = held;                            // backend model + tool round trip
    glog(`delegation took ${fmt(held)}`, 'ok');
  }
  gT.state = next;
  gT.stateSince = now;
  gMetrics();
}

function gSetRunning(on) {
  G('gptStart').hidden = on;
  G('gptStop').hidden = !on;
  G('gptMute').disabled = !on;
  G('gptAgent').disabled = on;
  G('gptMac').disabled = on;
  G('gptVoice').disabled = on;
  G('gptAccent').disabled = on;
  G('gptState').textContent = on ? 'live' : 'idle';
  G('gptState').className = 'pill ' + (on ? 'live' : '');
}

async function gptStart() {
  G('gptTranscript').innerHTML = '';
  G('gptLog').innerHTML = '';
  gRows.clear();
  Object.assign(gT, { start: performance.now(), lastUserText: 0, stateSince: 0, state: null, lastReply: null, lastDelegate: null, join: null });
  gMetrics();

  if (!window.isSecureContext) {
    return glog(`Microphone blocked: ${location.origin} is not a secure context — open via localhost or https.`, 'err');
  }
  if (!gLK) gLK = await import('/vendor/livekit/livekit-client.esm.mjs');

  glog('Creating room and dispatching agent…');
  const res = await fetch('/lk/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      agentName: G('gptAgent').value.trim(),
      mac: G('gptMac').value.trim(),
      gptlive: { voice: G('gptVoice').value, accent: G('gptAccent').value },
    }),
  });
  gSession = await res.json();
  if (!res.ok) throw new Error(gSession.msg || 'HTTP ' + res.status);
  glog(`Room ${gSession.roomName} -> agent "${gSession.agentName}" (voice ${G('gptVoice').value}, accent ${G('gptAccent').value})`, 'ok');

  const onAgentJoined = (identity) => {
    gT.join = performance.now() - gT.start;
    glog(`Agent joined: ${identity} (${fmt(gT.join)} after Start)`, 'ok');
    G('gptState').textContent = 'agent joined';
    gMetrics();
  };

  gRoom = new gLK.Room();
  gRoom.on(gLK.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== gLK.Track.Kind.Audio) return;
    const el = track.attach();
    el.autoplay = true;
    G('gptAudioSink').appendChild(el);
    glog('Agent audio attached', 'ok');
  });
  gRoom.on(gLK.RoomEvent.ParticipantConnected, (p) => onAgentJoined(p.identity));
  gRoom.on(gLK.RoomEvent.ParticipantDisconnected, (p) => glog(`Left: ${p.identity}`));
  gRoom.on(gLK.RoomEvent.Disconnected, (reason) => {
    glog('Disconnected' + (reason ? ': ' + reason : ''));
    gSetRunning(false);
  });
  // The worker publishes its state as a participant attribute.
  gRoom.on(gLK.RoomEvent.ParticipantAttributesChanged, (changed, p) => {
    if (p !== gRoom.localParticipant && changed['lk.agent.state']) gState(changed['lk.agent.state']);
  });
  gRoom.registerTextStreamHandler('lk.transcription', async (reader, info) => {
    const attrs = reader.info?.attributes || {};
    const final = String(attrs['lk.final']) === 'true';
    const text = (await reader.readAll() || '').trim();
    const who = String(info?.identity ?? '') === gRoom.localParticipant.identity ? 'kid' : 'cheeko';
    if (who === 'kid' && text) gT.lastUserText = performance.now();
    gTurn(attrs['lk.segment_id'] || reader.info?.id, who, text, final);
  });

  await gRoom.connect(gSession.url, gSession.token);
  await gRoom.localParticipant.setMicrophoneEnabled(true); // full duplex: mic stays open
  gSetRunning(true);
  glog(`Connected in ${fmt(performance.now() - gT.start)} — mic is live. Just talk.`, 'ok');
  const already = [...gRoom.remoteParticipants.values()][0];
  if (already) onAgentJoined(already.identity); else glog('Waiting for the agent to join…');
}

async function gptStop() {
  try { await gRoom?.disconnect(); } catch { /* already down */ }
  gRoom = null;
  G('gptAudioSink').innerHTML = '';
  gSetRunning(false);
  if (gSession?.roomName) {
    fetch('/lk/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ roomName: gSession.roomName }),
    }).catch(() => { /* room expires on its own */ });
  }
  gSession = null;
}

G('gptStart').addEventListener('click', () => gptStart().catch((e) => { glog(e.message, 'err'); gptStop(); }));
G('gptStop').addEventListener('click', gptStop);
G('gptMute').addEventListener('click', async () => {
  if (!gRoom) return;
  const on = gRoom.localParticipant.isMicrophoneEnabled;
  await gRoom.localParticipant.setMicrophoneEnabled(!on);
  G('gptMute').textContent = on ? 'Unmute mic' : 'Mute mic';
});
