// node --test mcp/cheeko-mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, toToolResult } from './cheeko-mcp.mjs';

const names = (s) => Object.keys(s._registeredTools ?? s.registeredTools ?? {});
const noop = async () => ({ content: [] });

test('write tools are absent unless ALLOW_WRITES is set', () => {
  const ro = names(buildServer({ api: noop, canWrite: false }));
  for (const w of ['create_content_pack', 'update_content_pack', 'upload_pack_file']) assert.ok(!ro.includes(w), w + ' must not exist read-only');

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

test('generic proxy tools exist in both modes; curated writes only with ALLOW_WRITES', () => {
  const ro = names(buildServer({ api: noop, canWrite: false })).sort();
  assert.deepEqual(ro, ['admin_request', 'describe_endpoint', 'get_content_pack', 'list_content_packs', 'search_endpoints']);
  assert.ok(names(buildServer({ api: noop, canWrite: true })).includes('admin_request'));
});

test('writeCheck: GET always, writes need ALLOW_WRITES, NO_WRITE groups refused', async () => {
  const { writeCheck } = await import('./cheeko-mcp.mjs');
  assert.equal(writeCheck('GET', '/user/list', false), null);
  assert.equal(writeCheck('GET', '/ota/check', true), null);
  assert.match(writeCheck('POST', '/device/register', false), /read-only/);
  assert.equal(writeCheck('POST', '/device/register', true), null);
  assert.equal(writeCheck('PUT', '/admin/rfid/content-pack', true), null);
  for (const r of ['/user/login', '/ota/upload', '/otaMag/x', '/admin/params', '/admin/server/restart', '/models/1', '/livekit/providers']) {
    assert.match(writeCheck('POST', r, true) ?? '', /blocked/, `expected ${r} blocked`);
  }
  // Prefix must be a path segment: /users-report is not /user
  assert.equal(writeCheck('POST', '/userx', true), null);
});

test('searchSpec ranks by matched terms and formats METHOD path — summary', async () => {
  const { searchSpec } = await import('./cheeko-mcp.mjs');
  const spec = { paths: {
    '/device/list': { get: { summary: 'List devices', tags: ['Device'] } },
    '/device/{mac}': { get: { summary: 'Get one device' }, delete: { summary: 'Remove device' } },
    '/agent/list': { get: { summary: 'List agents', tags: ['Agent'] } }
  } };
  const out = searchSpec(spec, 'device list');
  assert.equal(out[0], 'GET /device/list — List devices');
  assert.ok(out.includes('GET /agent/list — List agents'));
  // 'Remove device' matches one term, so it is present but ranked below the two-term hit.
  assert.ok(out.indexOf('DELETE /device/{mac} — Remove device') > 0);
  assert.deepEqual(searchSpec(spec, 'zzz'), []);
});

test('makeApi sends the bearer only when a user token is given', async () => {
  const { makeApi } = await import('./cheeko-mcp.mjs');
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { seen.push({ url, headers: opts.headers }); return { status: 200, text: async () => '{"code":0,"data":null}' }; };
  try {
    await makeApi('http://x/toy', 'KEY')('/a');
    await makeApi('http://x/toy', 'KEY', 'TOK')('/b');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen[0].headers['X-Service-Key'], 'KEY');
  assert.equal(seen[0].headers.Authorization, undefined);
  assert.equal(seen[1].headers['X-Service-Key'], 'KEY');
  assert.equal(seen[1].headers.Authorization, 'Bearer TOK');
  assert.match(seen[1].headers['X-Request-ID'], /^mcp-.+-[0-9a-f]{8}$/);
});
