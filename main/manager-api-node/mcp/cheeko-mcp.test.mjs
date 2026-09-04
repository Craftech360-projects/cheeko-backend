// node --test mcp/cheeko-mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, toToolResult } from './cheeko-mcp.mjs';

const names = (s) => Object.keys(s._registeredTools ?? s.registeredTools ?? {});
const noop = async () => ({ content: [] });

test('write tools are absent unless ALLOW_WRITES is set', () => {
  const ro = names(buildServer({ api: noop, canWrite: false }));
  assert.deepEqual(ro.sort(), ['get_content_pack', 'list_content_packs']);

  const rw = names(buildServer({ api: noop, canWrite: true }));
  assert.ok(rw.includes('create_content_pack'));
  assert.ok(rw.includes('update_content_pack'));
  assert.ok(!rw.includes('delete_content_pack'), 'delete is deliberately not exposed');
});

test('code!==0 on an HTTP 200 is still an error', () => {
  const r = toToolResult(200, JSON.stringify({ code: 500, msg: 'boom', data: null }));
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /boom/);
});

test('success unwraps data', () => {
  const r = toToolResult(200, JSON.stringify({ code: 0, msg: 'success', data: [{ packCode: 'A' }] }));
  assert.equal(r.isError, false);
  assert.deepEqual(JSON.parse(r.content[0].text), [{ packCode: 'A' }]);
});

test('non-JSON body does not throw', () => {
  const r = toToolResult(502, '<html>bad gateway</html>');
  assert.equal(r.isError, true);
});

test('upload_pack_file is a write tool', () => {
  assert.ok(names(buildServer({ api: noop, canWrite: true })).includes('upload_pack_file'));
  assert.ok(!names(buildServer({ api: noop, canWrite: false })).includes('upload_pack_file'));
});

test('uploadPlan: PNG converts to .bin unless it is a thumbnail or convert=false', async () => {
  const { uploadPlan } = await import('./cheeko-mcp.mjs');
  assert.deepEqual(uploadPlan('/x/cover.png'), { filename: 'cover.bin', mime: 'application/octet-stream', shouldConvert: true });
  assert.deepEqual(uploadPlan('/x/cover.png', { contentPackId: 31 }), { filename: 'cover.png', mime: 'image/png', shouldConvert: false });
  assert.deepEqual(uploadPlan('/x/cover.png', { convert: false }), { filename: 'cover.png', mime: 'image/png', shouldConvert: false });
  assert.deepEqual(uploadPlan('/x/song.mp3'), { filename: 'song.mp3', mime: 'audio/mpeg', shouldConvert: false });
  assert.deepEqual(uploadPlan('/x/frame.bin'), { filename: 'frame.bin', mime: 'application/octet-stream', shouldConvert: false });
  assert.throws(() => uploadPlan('/x/notes.txt'), /Unsupported file type/);
});
