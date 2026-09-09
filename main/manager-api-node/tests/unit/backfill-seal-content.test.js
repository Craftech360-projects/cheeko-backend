'use strict';
const crypto = require('crypto');
const cc = require('../../src/utils/contentCrypto');
const { resealItem } = require('../../scripts/backfill-seal-content');

const K = crypto.randomBytes(16);
const MP3 = crypto.randomBytes(300);

function deps(body) {
  return {
    fetchBytes: jest.fn(async () => body),
    getOrCreatePackKey: jest.fn(async () => K),
    upload: jest.fn(async (buf) => ({ url: 'https://cdn/rfidcontent/audio/new-12345678.mp3', body: buf })),
    updateItem: jest.fn(async () => {}),
    dryRun: false
  };
}

test('a plaintext item is downloaded, sealed, re-uploaded under a new key, and the row updated', async () => {
  const d = deps(MP3);
  const r = await resealItem({ id: 1n, content_pack_id: 7n, pack_code: 'STORY01', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: null }, d);
  expect(r).toEqual({ audio: 'sealed', image: 'skipped' });
  const uploaded = d.upload.mock.calls[0][0];
  expect(cc.unseal(uploaded, K)).toEqual(MP3);
  expect(d.updateItem).toHaveBeenCalledWith(1n, { audio_url: 'https://cdn/rfidcontent/audio/new-12345678.mp3' });
});

test('an already-sealed item is left alone', async () => {
  const d = deps(cc.seal(MP3, K));
  const r = await resealItem({ id: 1n, pack_code: 'STORY01', audio_url: 'https://cdn/a.mp3', image_url: null }, d);
  expect(r.audio).toBe('already');
  expect(d.upload).not.toHaveBeenCalled();
});

test('dry run touches nothing', async () => {
  const d = { ...deps(MP3), dryRun: true };
  await resealItem({ id: 1n, pack_code: 'STORY01', audio_url: 'https://cdn/a.mp3', image_url: null }, d);
  expect(d.upload).not.toHaveBeenCalled();
  expect(d.updateItem).not.toHaveBeenCalled();
});
