function imageMessage({ sessionId, requestId, url, mime = 'image/jpeg', width = 320, height = 240, caption }) {
  const msg = { type: 'image', session_id: sessionId, request_id: requestId, url, mime, width, height };
  if (caption !== undefined && caption !== null) msg.caption = caption;
  return msg;
}
function imageStatus({ sessionId, requestId, state }) {
  return { type: 'image_status', session_id: sessionId, request_id: requestId, state };
}
function imageError({ sessionId, requestId, code, message }) {
  return { type: 'image_error', session_id: sessionId, request_id: requestId, code, message };
}
module.exports = { imageMessage, imageStatus, imageError };
