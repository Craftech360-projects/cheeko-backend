// imagine/imagine-orchestrator.js
const messages = require('./imagine-messages');

function mapError(err) {
  const m = (err && err.message ? err.message : '').toLowerCase();
  if (/no speech|no usable|transcribe/.test(m)) return 'no_speech';
  if (/safety|blocked|filter/.test(m)) return 'safety_block';
  if (/rate.?limit|too many|429/.test(m)) return 'rate_limited';
  return 'generation_failed';
}

async function runImagine(conn, deps) {
  if (conn.imagineInFlight) return; // ponytail: one image per session; drop overlapping requests
  const sessionId = conn.udp && conn.udp.session_id;
  const requestId = deps.newRequestId();
  // Per-session cooldown so rapid repeated knob-presses can't spam FLUX (cost/abuse).
  const cooldownMs = deps.cooldownMs != null ? deps.cooldownMs : 2000;
  if (conn.lastImagineAt && Date.now() - conn.lastImagineAt < cooldownMs) {
    conn.sendMqttMessage(messages.imageError({ sessionId, requestId, code: 'rate_limited', message: 'One at a time — try again in a moment.' }));
    return;
  }
  conn.lastImagineAt = Date.now();
  conn.imagineInFlight = true;
  const frames = conn.imagineFrames || [];
  conn.imagineFrames = [];
  if (!frames.length) {
    // Knob pressed but no audio captured — don't bother line_art.
    conn.sendMqttMessage(messages.imageError({ sessionId, requestId, code: 'no_speech', message: "I didn't hear anything." }));
    conn.imagineInFlight = false;
    return;
  }
  console.log(`🖼️ [IMAGINE] ${requestId} start: frames=${frames.length}, lineArtWsUrl=${deps.lineArtWsUrl}, managerApiUrl=${deps.managerApiUrl}`);
  try {
    conn.sendMqttMessage(messages.imageStatus({ sessionId, requestId, state: 'generating' }));
    const { jpegBuffer, caption } = await deps.generateImagine(frames, { lineArtWsUrl: deps.lineArtWsUrl });
    if (conn.imagineClosed) {
      // Device left (goodbye/reconnect) while generating — don't upload or publish to a dead session.
      console.log(`🖼️ [IMAGINE] ${requestId} session closed mid-generation — dropping result`);
      return;
    }
    console.log(`🖼️ [IMAGINE] ${requestId} generated: jpeg=${jpegBuffer ? jpegBuffer.length : 0}B, caption="${caption || ''}" — uploading...`);
    const url = await deps.uploadImagineJpeg(jpegBuffer, { managerApiUrl: deps.managerApiUrl, serviceKey: deps.serviceKey });
    console.log(`🖼️ [IMAGINE] ${requestId} uploaded -> ${url}`);
    conn.sendMqttMessage(messages.imageMessage({ sessionId, requestId, url, caption }));
  } catch (err) {
    console.error(`🖼️ [IMAGINE] ${requestId} FAILED (${mapError(err)}): ${err && err.message}`, err && err.stack);
    conn.sendMqttMessage(messages.imageError({ sessionId, requestId, code: mapError(err), message: 'Could not create that picture.' }));
  } finally {
    conn.imagineInFlight = false;
  }
}
module.exports = { runImagine, mapError };
