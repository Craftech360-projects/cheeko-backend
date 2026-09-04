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
