// Shared session-timing instrumentation for the GPT-Live and Test device tabs.
//
// Both tabs join a LiveKit room and want the same three numbers out of the
// session log: how long the agent took to join, how long each agent state
// lasted, and reply latency (last user transcript -> next "speaking" state).
// The two tabs learn about state changes through different transports — the
// Python worker (GPT-Live) publishes `lk.agent.state` as a participant
// attribute, the Go worker (Test device) sends it as a `lk.agent.events` data
// stream — but once a tab has extracted the plain state string, feeding it
// through the same tracker is what makes the numbers comparable across the
// two workers. Reimplementing this per tab was how the Test device tab ended
// up without them in the first place.
//
// No module system in this app (see server.js's note on vendoring
// livekit-client instead of adding a bundler) — this is a plain script that
// defines one global, loaded before test.js and gptlive.js.

function createLatencyTracker(log) {
  // All client-side (performance.now()), same clock for both tabs.
  const t = { start: 0, lastUserText: 0, stateSince: 0, state: null, lastReply: null, lastDelegate: null, join: null };

  const fmt = (ms) => (ms == null ? '—' : Math.round(ms) + ' ms');

  function reset() {
    Object.assign(t, { start: performance.now(), lastUserText: 0, stateSince: 0, state: null, lastReply: null, lastDelegate: null, join: null });
  }

  // Call once the agent participant is seen in the room.
  function noteJoined(identity) {
    t.join = performance.now() - t.start;
    log(`Agent joined: ${identity} (${fmt(t.join)} after Start)`, 'ok');
    return t.join;
  }

  // Call on every transcript chunk (interim or final) attributed to the kid —
  // matches GPT-Live, where "last transcript" tracks ongoing speech, not just
  // closed segments.
  function noteUserTranscript() {
    t.lastUserText = performance.now();
  }

  // Call with the plain next-state string, however the tab learned it. Timing
  // is derived entirely from this tracker's own bookkeeping (not whatever
  // "old_state"/duration a worker might self-report), so both tabs compute it
  // the same way regardless of which worker is behind them.
  function noteStateChange(next) {
    const now = performance.now();
    const prev = t.state;
    const held = prev ? now - t.stateSince : 0;
    log(`agent: ${prev || '—'} -> ${next}` + (prev ? ` (${prev} for ${fmt(held)})` : ''));
    if (next === 'speaking' && t.lastUserText) {
      t.lastReply = now - t.lastUserText;   // last user transcript -> agent audio
      t.lastUserText = 0;
      log(`reply latency (last transcript -> speaking): ${fmt(t.lastReply)}`, 'ok');
    }
    if (prev === 'thinking') {
      t.lastDelegate = held;                        // backend model + tool round trip
      log(`delegation took ${fmt(held)}`, 'ok');
    }
    t.state = next;
    t.stateSince = now;
  }

  return { t, fmt, reset, noteJoined, noteUserTranscript, noteStateChange };
}
