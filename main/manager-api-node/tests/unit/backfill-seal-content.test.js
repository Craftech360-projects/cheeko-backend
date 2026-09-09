'use strict';
const crypto = require('crypto');
const cc = require('../../src/utils/contentCrypto');
const { resealItem, mimeTypeFor } = require('../../scripts/backfill-seal-content');

const K = crypto.randomBytes(16);
const MP3 = crypto.randomBytes(300);

function deps(body) {
  return {
    fetchBytes: jest.fn(async () => body),
    getPackKey: jest.fn(async () => K),
    getOrCreatePackKey: jest.fn(async () => K),
    packExists: jest.fn(async () => true),
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

test('dry run never provisions a pack key (getOrCreatePackKey is get-OR-CREATE and writes before the dryRun check)', async () => {
  const d = deps(MP3);
  d.dryRun = true;
  let called = false;
  d.getOrCreatePackKey = jest.fn(async () => {
    called = true; // would be a real prisma.rfid_content_pack.updateMany in production
    return K;
  });
  const r = await resealItem({ id: 1n, pack_code: 'STORY01', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: null }, d);
  expect(d.getOrCreatePackKey).not.toHaveBeenCalled();
  expect(called).toBe(false);
  expect(r.audio).toBe('would-seal');
});

test('an image URL reseals into the images category with an image MIME type', async () => {
  const d = deps(crypto.randomBytes(200));
  d.upload = jest.fn(async (buf, name, category) => ({ url: `https://cdn/rfidcontent/${category}/${name}`, body: buf }));
  const r = await resealItem({ id: 2n, pack_code: 'STORY01', audio_url: null, image_url: 'https://cdn/rfidcontent/images/old.jpg' }, d);
  expect(r.image).toBe('sealed');
  const [, name, category] = d.upload.mock.calls[0];
  expect(category).toBe('images');
  expect(mimeTypeFor(name)).toBe('image/jpeg');
});

test('an mp3 URL reseals into the audio category with audio/mpeg', async () => {
  const d = deps(MP3);
  d.upload = jest.fn(async (buf, name, category) => ({ url: `https://cdn/rfidcontent/${category}/${name}`, body: buf }));
  const r = await resealItem({ id: 3n, pack_code: 'STORY01', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: null }, d);
  expect(r.audio).toBe('sealed');
  const [, name, category] = d.upload.mock.calls[0];
  expect(category).toBe('audio');
  expect(mimeTypeFor(name)).toBe('audio/mpeg');
});

test('an audio URL under a language category folder (not literally "audio") reseals under that language', async () => {
  // Realistic per src/services/upload.service.js's uploadContentFile: the S3
  // key/URL is `rfidcontent/<categoryFolder>/<filename>`, one segment, where
  // categoryFolder is whatever the original upload passed (rfid.routes.js's
  // /content-pack/upload defaults it to 'English'/'uploads', not 'audio').
  // The naive pre-fix guess (`url.includes('/images/') ? 'images' : 'audio'`)
  // would also say 'audio' here, since the URL has no '/images/' segment — it
  // can't tell a language-folder file from an audio-folder one. This is what
  // makes the assertion below a real regression test for categoryFromUrl.
  const d = deps(MP3);
  d.upload = jest.fn(async (buf, name, category) => ({ url: `https://cdn/rfidcontent/${category}/${name}`, body: buf }));
  const r = await resealItem({ id: 6n, pack_code: 'STORY01', audio_url: 'https://cdn/rfidcontent/English/tiger-a1b2c3d4.mp3', image_url: null }, d);
  expect(r.audio).toBe('sealed');
  const [, name, category] = d.upload.mock.calls[0];
  expect(category).toBe('English');
  expect(mimeTypeFor(name)).toBe('audio/mpeg');
});

test('an image URL under a language category folder (not literally "images") reseals under that language', async () => {
  const d = deps(crypto.randomBytes(200));
  d.upload = jest.fn(async (buf, name, category) => ({ url: `https://cdn/rfidcontent/${category}/${name}`, body: buf }));
  const r = await resealItem({ id: 7n, pack_code: 'STORY01', audio_url: null, image_url: 'https://cdn/rfidcontent/Hindi/lion-b2c3d4e5.png' }, d);
  expect(r.image).toBe('sealed');
  const [, name, category] = d.upload.mock.calls[0];
  // Same naive guess would say 'audio' here (no '/images/' segment) — silently
  // wrong for an image file sitting under a language folder.
  expect(category).toBe('Hindi');
  expect(mimeTypeFor(name)).toBe('image/png');
});

test('dry run distinguishes "pack exists but has no key yet" from "genuinely unsealable"', async () => {
  const d = deps(MP3);
  d.dryRun = true;
  d.getPackKey = jest.fn(async () => null);
  d.packExists = jest.fn(async (packCode) => packCode === 'HASPACK');

  const withPack = await resealItem({ id: 8n, pack_code: 'HASPACK', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: null }, d);
  expect(withPack.audio).toBe('would-seal-after-key-creation');

  const withoutPack = await resealItem({ id: 9n, pack_code: 'NOPACK', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: null }, d);
  expect(withoutPack.audio).toBe('nokey');

  expect(d.getOrCreatePackKey).not.toHaveBeenCalled();
});

test('an image upload failure does not orphan an already-sealed audio upload', async () => {
  const d = deps(MP3);
  d.fetchBytes = jest.fn(async (url) => (url.includes('images') ? crypto.randomBytes(50) : MP3));
  d.upload = jest.fn(async (buf, name, category) => {
    if (category !== 'audio') throw new Error('S3 down');
    return { url: 'https://cdn/rfidcontent/audio/new-12345678.mp3' };
  });
  const r = await resealItem({ id: 5n, pack_code: 'STORY01', audio_url: 'https://cdn/rfidcontent/audio/old.mp3', image_url: 'https://cdn/rfidcontent/images/old.jpg' }, d);
  expect(r.audio).toBe('sealed');
  expect(r.image).toBe('error');
  expect(d.updateItem).toHaveBeenCalledWith(5n, { audio_url: 'https://cdn/rfidcontent/audio/new-12345678.mp3' });
});
