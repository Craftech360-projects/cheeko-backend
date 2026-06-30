// tests/imagine-messages.test.js
const test = require('node:test');
const assert = require('assert');
const m = require('../imagine/imagine-messages');

test('imageMessage has the spec shape and defaults', () => {
  const msg = m.imageMessage({ sessionId: 's1', requestId: 'img_1', url: 'https://cdn/x.jpg', caption: 'a cat' });
  assert.strictEqual(msg.type, 'image');
  assert.strictEqual(msg.session_id, 's1');
  assert.strictEqual(msg.request_id, 'img_1');
  assert.strictEqual(msg.url, 'https://cdn/x.jpg');
  assert.strictEqual(msg.mime, 'image/jpeg');
  assert.strictEqual(msg.width, 320);
  assert.strictEqual(msg.height, 240);
  assert.strictEqual(msg.caption, 'a cat');
});

test('imageMessage omits caption when not given', () => {
  const msg = m.imageMessage({ sessionId: 's1', requestId: 'img_1', url: 'u' });
  assert.ok(!('caption' in msg));
});

test('imageStatus and imageError shapes', () => {
  assert.deepStrictEqual(m.imageStatus({ sessionId: 's', requestId: 'r', state: 'generating' }),
    { type: 'image_status', session_id: 's', request_id: 'r', state: 'generating' });
  assert.deepStrictEqual(m.imageError({ sessionId: 's', requestId: 'r', code: 'no_speech', message: 'x' }),
    { type: 'image_error', session_id: 's', request_id: 'r', code: 'no_speech', message: 'x' });
});
