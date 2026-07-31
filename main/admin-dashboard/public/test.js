// Test tab — talk to a character through LiveKit directly.
//
// The dashboard server creates the room, attaches the dispatch metadata the
// worker expects and dispatches the agent (see livekit-session.js); the browser
// just joins that room as a normal WebRTC participant. No device emulation:
// this exercises the agent, not the ESP32 transport.

const T = (id) => document.getElementById(id);

let room = null;
let session = null;   // { url, token, roomName, agentName, character }
let running = false;
let LK = null;        // lazily imported livekit-client module

function tlog(message, cls) {
  const el = T('testLog');
  const line = document.createElement('div');
  line.className = 'logline' + (cls ? ' ' + cls : '');
  line.textContent = message;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// Firmware Cheeko Face: a leading [tag] drives the face and is stripped from
// the displayed text. Mirrors parse_expression_tag() in client.py.
const FACES = new Set(['neutral', 'happy', 'excited', 'laughing', 'love', 'silly',
  'curious', 'surprised', 'confused', 'shy', 'sad', 'crying', 'angry', 'scared', 'sleepy']);

function parseFace(text) {
  const m = /^\[([a-z]{2,12})\]\s*/.exec(text || '');
  if (!m) return { face: null, text: text || '' };
  return { face: FACES.has(m[1]) ? m[1] : 'neutral', text: text.slice(m[0].length) };
}

// Each lk.transcription chunk carries the full text so far, not a delta, so a
// speaker's row is rewritten in place until it goes final — then the next chunk
// starts a fresh row. Same behaviour the gateway relies on for the device
// display ("interim gets overwritten by final").
const openTurn = { kid: null, cheeko: null };

function turn(who, rawText, final) {
  const { face, text } = who === 'cheeko' ? parseFace(rawText) : { face: null, text: rawText };
  if (!text) return;
  let row = openTurn[who];
  if (!row) {
    row = document.createElement('div');
    row.className = 'turn ' + who;
    row.innerHTML = `<span class="who">${who === 'kid' ? 'You' : 'Cheeko'}</span>` +
      `<span class="face" hidden></span><span class="said"></span>`;
    T('transcript').appendChild(row);
    openTurn[who] = row;
  }
  const faceEl = row.querySelector('.face');
  if (face) { faceEl.hidden = false; faceEl.textContent = face; }
  row.querySelector('.said').textContent = text;
  row.classList.toggle('interim', !final);
  if (final) openTurn[who] = null;
  T('transcript').scrollTop = T('transcript').scrollHeight;
}

function resetTurns() { openTurn.kid = null; openTurn.cheeko = null; }

// The agent publishes speech as TEXT STREAMS on these topics — not as
// RoomEvent.TranscriptionReceived, which never fires for this worker. Reading
// the wrong source is why the transcript pane stayed empty.
function registerTextHandlers(r) {
  const isAgent = (info) => {
    const id = info?.identity ?? info ?? '';
    return String(id) !== r.localParticipant.identity;
  };

  r.registerTextStreamHandler('lk.transcription', async (reader, info) => {
    const final = String(reader.info?.attributes?.['lk.final']) === 'true';
    const text = (await reader.readAll() || '').trim();
    if (!text) return;
    // Some senders wrap it as {segments:[...]}; most send plain text.
    let out = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.segments?.length) out = parsed.segments.map((s) => s.text).join(' ').trim();
    } catch { /* plain text */ }
    turn(isAgent(info) ? 'cheeko' : 'kid', out, final);
  });

  r.registerTextStreamHandler('lk.agent.events', async (reader) => {
    let event;
    try { event = JSON.parse(await reader.readAll()); } catch { return; }
    const type = event.type || event.data?.type;
    if (type === 'agent_state_changed' && event.data) {
      const { old_state, new_state } = event.data;
      T('testState').textContent = new_state || 'live';
      tlog(`agent: ${old_state} -> ${new_state}`);
    } else if (type === 'speech_created' && event.data) {
      // Fallback text source when transcription streams are quiet.
      const said = event.data.text || event.data.content || event.data.source_text;
      if (said) turn('cheeko', said, true);
    }
  });
}

function setRunning(on) {
  running = on;
  T('startTest').hidden = on;
  T('stopTest').hidden = !on;
  T('muteBtn').disabled = !on;
  T('testChar').disabled = on;
  T('testMac').disabled = on;
  T('testState').textContent = on ? 'live' : 'idle';
  T('testState').className = 'pill ' + (on ? 'live' : '');
}

async function loadTestCharacters() {
  const sel = T('testChar');
  sel.innerHTML = '<option value="">(device default)</option>';
  try {
    const list = await api('GET', '/templates');
    list.slice()
      .sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)))
      .forEach((t) => {
        const o = document.createElement('option');
        o.value = t.agentName;
        o.textContent = t.agentName;
        sel.appendChild(o);
      });
  } catch (e) {
    tlog('Could not load characters: ' + e.message, 'err');
  }
}

// The agent deliberately does NOT auto-greet — base_assistant.py waits for a
// `ready_for_greeting` data message before calling play_greeting(). The gateway
// sends it from livekit-bridge.js when the agent joins; without it the agent
// sits there with a live audio track and says nothing.
//
// The gateway skips the greeting when the child was already mid-sentence during
// setup. There's no equivalent here: you press Start and then speak, so the
// greeting always fires. Interrupting it is just normal barge-in.
async function sendGreetingTrigger() {
  if (!room || !session) return;
  try {
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({
        type: 'ready_for_greeting',
        session_id: session.roomName,
        timestamp: Date.now(),
      })),
      { reliable: true },
    );
    tlog('Sent ready_for_greeting', 'ok');
  } catch (e) {
    tlog('Failed to send greeting trigger: ' + e.message, 'err');
  }
}

async function startTest() {
  T('transcript').innerHTML = '';
  T('testLog').innerHTML = '';
  resetTurns();

  if (!window.isSecureContext) {
    tlog(`Microphone blocked: ${location.origin} is not a secure context.`, 'err');
    tlog('Quickest fix — tunnel the dashboard AND LiveKit, then use localhost:', 'err');
    tlog(`  ssh -L 4000:localhost:4000 -L 7880:localhost:7880 <user>@${location.hostname}`, 'err');
    tlog('  …then open http://localhost:4000 and set LIVEKIT_PUBLIC_URL=ws://localhost:7880', 'err');
    tlog('Serving this page over HTTPS instead also requires wss:// for LiveKit — ' +
         'an https page cannot open a ws:// socket.', 'err');
    return;
  }

  try {
    // ESM-only package, and this app has no bundler — import it at use time.
    if (!LK) LK = await import('/vendor/livekit/livekit-client.esm.mjs');
  } catch (e) {
    return tlog('Could not load livekit-client: ' + e.message, 'err');
  }

  tlog('Creating room and dispatching agent…');
  try {
    const res = await fetch('/lk/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        characterName: T('testChar').value || null,
        mac: T('testMac').value.trim(),
      }),
    });
    session = await res.json();
    if (!res.ok) throw new Error(session.msg || 'HTTP ' + res.status);
  } catch (e) {
    return tlog('Could not start session: ' + e.message, 'err');
  }

  tlog(`Room ${session.roomName}`, 'ok');
  tlog(`Character "${session.character}" -> agent "${session.agentName}"`);
  if (session.childName) tlog(`Child profile: ${session.childName}, age ${session.childAge}`);

  room = new LK.Room({ adaptiveStream: true, dynacast: true });

  room.on(LK.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === LK.Track.Kind.Audio) {
      // attach() returns an <audio> that must be in the DOM to play.
      const el = track.attach();
      el.autoplay = true;
      T('audioSink').appendChild(el);
      tlog('Agent audio track attached', 'ok');
    }
  });

  room.on(LK.RoomEvent.ParticipantConnected, (p) => {
    tlog(`Agent joined: ${p.identity}`, 'ok');
    T('testState').textContent = 'agent joined';
    sendGreetingTrigger();
  });
  room.on(LK.RoomEvent.ParticipantDisconnected, (p) => tlog(`Left: ${p.identity}`));

  registerTextHandlers(room);

  room.on(LK.RoomEvent.Disconnected, (reason) => {
    tlog('Disconnected' + (reason ? ': ' + reason : ''));
    setRunning(false);
  });

  try {
    await room.connect(session.url, session.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    setRunning(true);
    tlog('Connected — start talking.', 'ok');

    // The agent is dispatched before we connect, so on a warm worker it can
    // already be in the room — and ParticipantConnected never fires for
    // participants that were already there. Trigger the greeting for them too.
    if (room.remoteParticipants.size > 0) {
      const who = [...room.remoteParticipants.values()].map((p) => p.identity).join(', ');
      tlog(`Agent already in room: ${who}`, 'ok');
      T('testState').textContent = 'agent joined';
      await sendGreetingTrigger();
    } else {
      tlog('Waiting for the agent to join…');
    }
  } catch (e) {
    tlog('LiveKit connect failed: ' + e.message, 'err');
    stopTest();
  }
}

async function stopTest() {
  try { await room?.disconnect(); } catch { /* already down */ }
  room = null;
  T('audioSink').innerHTML = '';
  setRunning(false);
  if (session?.roomName) {
    fetch('/lk/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ roomName: session.roomName }),
    }).catch(() => { /* room expires on its own */ });
  }
  session = null;
}

function toggleMute() {
  if (!room) return;
  const on = room.localParticipant.isMicrophoneEnabled;
  room.localParticipant.setMicrophoneEnabled(!on);
  T('muteBtn').textContent = on ? 'Unmute mic' : 'Mute mic';
}

T('startTest').addEventListener('click', startTest);
T('stopTest').addEventListener('click', stopTest);
T('muteBtn').addEventListener('click', toggleMute);
