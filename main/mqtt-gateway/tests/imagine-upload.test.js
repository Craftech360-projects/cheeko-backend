// tests/imagine-upload.test.js
const test = require('node:test');
const assert = require('assert');
const Module = require('module');

// Stub axios before requiring the client.
let lastPost;
const axiosStub = { post: async (url, body, opts) => { lastPost = { url, body, opts }; return { data: { code: 0, msg: 'success', data: { url: 'https://cdn/x.jpg', s3Key: 'imagine/x.jpg' } } }; } };
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') return axiosStub;
  return origLoad.apply(this, arguments);
};

const { uploadImagineJpeg } = require('../imagine/imagine-upload');

test('posts multipart to /imagine/upload with service key and returns url', async () => {
  const url = await uploadImagineJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
    managerApiUrl: 'http://api/toy', serviceKey: 'svc-123',
  });
  assert.strictEqual(url, 'https://cdn/x.jpg');
  assert.strictEqual(lastPost.url, 'http://api/toy/imagine/upload');
  assert.strictEqual(lastPost.opts.headers['X-Service-Key'], 'svc-123');
});

test('throws when response envelope is not success', async () => {
  axiosStub.post = async () => ({ data: { code: 400, msg: 'bad' } });
  await assert.rejects(() => uploadImagineJpeg(Buffer.from([1]), { managerApiUrl: 'http://api/toy', serviceKey: 's' }));
});

test.after(() => { Module._load = origLoad; Module._resolveFilename = origResolve; });
