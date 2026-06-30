// imagine/imagine-orchestrator.js
const messages = require('./imagine-messages');

function mapError(err) {
  const m = (err && err.message ? err.message : '').toLowerCase();
  if (/no speech|no usable|transcribe/.test(m)) return 'no_speech';
  if (/safety|blocked|filter/.test(m)) return 'safety_block';
  if (/rate.?limit|too many/.test(m)) return 'rate_limited';
  return 'generation_failed';
}

async function runImagine(conn, deps) {
  if (conn.imagineInFlight) return; // ponytail: one image per session; drop overlapping requests
  conn.imagineInFlight = true;
  const frames = conn.imagineFrames || [];
  conn.imagineFrames = [];
  const sessionId = conn.udp && conn.udp.session_id;
  const requestId = deps.newRequestId();
  try {
    conn.sendMqttMessage(messages.imageStatus({ sessionId, requestId, state: 'generating' }));
    const { jpegBuffer, caption } = await deps.generateImagine(frames, { lineArtWsUrl: deps.lineArtWsUrl });
    const url = await deps.uploadImagineJpeg(jpegBuffer, { managerApiUrl: deps.managerApiUrl, serviceKey: deps.serviceKey });
    conn.sendMqttMessage(messages.imageMessage({ sessionId, requestId, url, caption }));
  } catch (err) {
    conn.sendMqttMessage(messages.imageError({ sessionId, requestId, code: mapError(err), message: 'Could not create that picture.' }));
  } finally {
    conn.imagineInFlight = false;
  }
}
module.exports = { runImagine, mapError };
