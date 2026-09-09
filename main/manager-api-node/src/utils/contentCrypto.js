'use strict';
/**
 * Content encryption primitives shared by upload, lookup, preview and backfill.
 *
 * File format (spec §3): "CKE1" | ver | 000 | nonce(8) | AES-128-CTR body.
 * Counter block = nonce || 64-bit big-endian counter from 0. Node's aes-128-ctr
 * with iv = nonce || 8 zero bytes increments exactly that way, so the firmware's
 * mbedtls_aes_crypt_ctr sees the same keystream.
 *
 * Pure: no Prisma, no env reads. Callers pass keys in.
 */
const crypto = require('crypto');
const { Transform } = require('stream');

const MAGIC = Buffer.from('CKE1');
const HEADER_BYTES = 16;
const WRAP_INFO = 'cheeko-wrap-v1';

function ctrIv(nonce) {
  return Buffer.concat([nonce, Buffer.alloc(8, 0)]);
}

function seal(plain, key, version = 2, nonce = crypto.randomBytes(8)) {
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header[4] = version;
  nonce.copy(header, 8);
  const body = crypto.createCipheriv('aes-128-ctr', key, ctrIv(nonce)).update(plain);
  return Buffer.concat([header, body]);
}

function parseHeader(buf) {
  if (!buf || buf.length < HEADER_BYTES || !buf.subarray(0, 4).equals(MAGIC)) return null;
  return { version: buf[4], nonce: buf.subarray(8, 16) };
}

function unseal(sealed, key) {
  const h = parseHeader(sealed);
  if (!h) throw new Error('not sealed');
  return crypto.createDecipheriv('aes-128-ctr', key, ctrIv(h.nonce)).update(sealed.subarray(HEADER_BYTES));
}

// For streaming the preview: the caller strips the 16-byte header first.
function createUnsealStream(key, nonce) {
  const d = crypto.createDecipheriv('aes-128-ctr', key, ctrIv(nonce));
  return new Transform({
    transform(chunk, _enc, cb) { cb(null, d.update(chunk)); },
    flush(cb) { cb(null, d.final()); },
  });
}

function wrapKeyForDevice(secret, packKey) {
  const wrapKey = crypto.createHmac('sha256', secret).update(WRAP_INFO).digest().subarray(0, 16);
  const nonce = crypto.randomBytes(8);
  const wrapped = crypto.createCipheriv('aes-128-ctr', wrapKey, ctrIv(nonce)).update(packKey);
  return { key: wrapped.toString('hex'), nonce: nonce.toString('hex') };
}

// At-rest protection for K and S in Postgres: AES-256-GCM, iv(12) || tag(16) || ct.
function encryptAtRest(plain, masterKey) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function decryptAtRest(blob, masterKey) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

module.exports = {
  MAGIC, HEADER_BYTES, WRAP_INFO,
  seal, parseHeader, unseal, createUnsealStream, wrapKeyForDevice,
  encryptAtRest, decryptAtRest,
};
