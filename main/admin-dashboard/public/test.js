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

// --- Push-to-talk (Manual Talk) ---
// Publishes the same data-channel payloads mqtt-gateway forwards for a real
// device, so the agent (pkg/livekit/room_session.go) cannot tell this browser
// from an ESP32. Only acted on when the sarvam_rest provider is active; with a
// streaming provider the agent ignores them and this is just a mic toggle.
let talking = false;        // true between press and speech_end
let speechEndAt = 0;        // for the turn-latency readout
let viz = null;             // RadialVisualizer
let audioCtx = null;
let micAnalyser = null;
let remoteAnalyser = null;

// The ring runs whenever the tab is open — an empty box reads as broken, and
// the idle animation is what shows the component is alive before a session.
function startViz() {
  if (!viz) viz = new window.RadialVisualizer(T('vizCanvas'));
  viz.start();
}

function vizState(state) {
  if (viz) viz.setState(state);
  T('pttState').textContent = state;
  T('pttState').className = 'pill ptt-' + state;
}

async function publish(payload) {
  if (!room) return;
  await room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ ...payload, source: 'admin_dashboard' })),
    { reliable: true },
  );
}

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function makeAnalyser(mediaStreamTrack) {
  const ctx = ensureAudioContext();
  const src = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.7;
  src.connect(analyser);
  return analyser;
}

// Tap 1: mic on, turn opens.
async function pttPress() {
  if (!room || talking) return;
  // Barge-in: a tap while Cheeko is talking stops the reply first, exactly as
  // the firmware's manual-interrupt does.
  if (T('pttState').textContent === 'speaking') {
    await publish({ type: 'abort', session_id: session?.roomName });
    tlog('Sent abort (barge-in)');
  }
  talking = true;
  speechEndAt = 0;
  await publish({ type: 'ptt_event', action: 'press', state: 'start', mode: 'manual' });
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    const pub = [...room.localParticipant.audioTrackPublications.values()][0];
    if (pub?.track?.mediaStreamTrack) {
      micAnalyser = makeAnalyser(pub.track.mediaStreamTrack);
      viz?.attachAnalyser(micAnalyser);
    }
  } catch (e) {
    // The turn is already open on the agent's side; say so rather than
    // leaving a silent turn the child cannot end.
    tlog('Could not open the mic: ' + e.message, 'err');
  }
  vizState('listening');
  T('pttBtn').textContent = '■ Done';
  T('pttBtn').classList.add('talking');
  tlog('PTT press — listening', 'ok');
}

// Tap 2: End Turn. The agent finalizes the utterance and transcribes it.
async function pttDone() {
  if (!room || !talking) return;
  talking = false;
  speechEndAt = performance.now();
  await publish({ type: 'speech_end', session_id: session?.roomName });
  await room.localParticipant.setMicrophoneEnabled(false);
  viz?.attachAnalyser(null);
  vizState('thinking');
  T('pttBtn').textContent = '● Talk';
  T('pttBtn').classList.remove('talking');
  tlog('PTT speech_end — thinking', 'ok');
}

// Esc: Cancel Turn. Buffer discarded, nothing transcribed, Cheeko stays silent.
async function pttCancel() {
  if (!room || !talking) return;
  talking = false;
  speechEndAt = 0;
  await publish({ type: 'ptt_event', action: 'release', state: 'stop' });
  await room.localParticipant.setMicrophoneEnabled(false);
  viz?.attachAnalyser(null);
  vizState('idle');
  T('pttBtn').textContent = '● Talk';
  T('pttBtn').classList.remove('talking');
  tlog('PTT cancel — turn discarded', 'ok');
}

function pttToggle() {
  if (talking) pttDone(); else pttPress();
}

// speech_end -> first final transcript. The number this whole PTT/batch-STT
// change exists to move (12s streaming -> target under 2s).
function noteTurnLatency() {
  if (!speechEndAt) return;
  const ms = Math.round(performance.now() - speechEndAt);
  speechEndAt = 0;
  T('pttLatency').textContent = ms + ' ms';
  tlog(`Turn latency (speech_end -> transcript): ${ms} ms`, 'ok');
}

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
    const who = isAgent(info) ? 'cheeko' : 'kid';
    // The child's own final transcript is what closes the latency window.
    if (who === 'kid' && final) noteTurnLatency();
    turn(who, out, final);
  });

  r.registerTextStreamHandler('lk.agent.events', async (reader) => {
    let event;
    try { event = JSON.parse(await reader.readAll()); } catch { return; }
    const type = event.type || event.data?.type;
    if (type === 'agent_state_changed' && event.data) {
      const { old_state, new_state } = event.data;
      T('testState').textContent = new_state || 'live';
      tlog(`agent: ${old_state} -> ${new_state}`);
      // Correction signal for the ring: the worker knows when it actually
      // started and stopped speaking. Never override an open turn — the
      // child's mic wins while they hold the floor.
      if (!talking) {
        if (new_state === 'speaking') {
          viz?.attachAnalyser(remoteAnalyser);
          vizState('speaking');
        } else if (new_state === 'thinking') {
          viz?.attachAnalyser(null);
          vizState('thinking');
        } else if (new_state === 'listening' || new_state === 'idle') {
          viz?.attachAnalyser(null);
          vizState('idle');
        }
      }
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
  T('pttBtn').disabled = !on;
  T('testChar').disabled = on;
  T('testMac').disabled = on;
  T('testState').textContent = on ? 'live' : 'idle';
  T('testState').className = 'pill ' + (on ? 'live' : '');
  if (!on) {
    talking = false;
    T('pttBtn').textContent = '● Talk';
    T('pttBtn').classList.remove('talking');
    viz?.attachAnalyser(null);
    vizState('idle');
  }
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
      // Drive the ring from Cheeko's voice while she speaks.
      if (track.mediaStreamTrack) {
        remoteAnalyser = makeAnalyser(track.mediaStreamTrack);
        if (!talking) {
          viz?.attachAnalyser(remoteAnalyser);
          vizState('speaking');
        }
      }
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
    // Publish the track, then close it: Manual Talk means the mic only opens
    // between taps, and publishing once up front keeps the first press
    // instant. Non-fatal on purpose — a denied or missing mic must not tear
    // down a session that is otherwise live; the first Talk press asks again.
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch (micErr) {
      tlog('Mic unavailable (' + micErr.message + ') — press Talk to grant access.', 'err');
    }
    setRunning(true);
    startViz();
    vizState('connecting');
    tlog('Connected — press Talk (or Space) to speak.', 'ok');

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
T('pttBtn').addEventListener('click', pttToggle);
document.querySelector('.tab[data-tab="testView"]')?.addEventListener('click', startViz);

// Space = tap, Esc = cancel — same shape as client.py's 's' and spacebar.
document.addEventListener('keydown', (e) => {
  if (!running || T('testView').hidden) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); pttToggle(); }
  else if (e.code === 'Escape') { e.preventDefault(); pttCancel(); }
});
