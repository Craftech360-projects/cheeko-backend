'use strict';
const crypto = require('crypto');
const cc = require('../../src/utils/contentCrypto');

const K = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const NONCE = Buffer.from('1011121314151617', 'hex');
const PLAIN = Buffer.from('cheeko content encryption test!!', 'ascii'); // 32 bytes

describe('contentCrypto file format', () => {
  test('seal writes the CKE1 header, version 1, zero pad, nonce, and grows by 16', () => {
    const sealed = cc.seal(PLAIN, K, 1, NONCE);
    expect(sealed.length).toBe(PLAIN.length + 16);
    expect(sealed.subarray(0, 4).toString('ascii')).toBe('CKE1');
    expect(sealed[4]).toBe(1);
    expect(sealed.subarray(5, 8)).toEqual(Buffer.alloc(3, 0));
    expect(sealed.subarray(8, 16)).toEqual(NONCE);
  });

  test('ciphertext matches the reference vector (nonce || 64-bit BE counter from 0)', () => {
    const iv = Buffer.concat([NONCE, Buffer.alloc(8, 0)]);
    const expected = crypto.createCipheriv('aes-128-ctr', K, iv).update(PLAIN);
    const sealed = cc.seal(PLAIN, K, 1, NONCE);
    expect(sealed.subarray(16)).toEqual(expected);
    // Reference vector for Python test_client_crypto.py EXPECTED_HEX (Task 10):
    expect(sealed.subarray(16).toString('hex')).toBe('ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a');
  });

  // Shared vector, v1 handover §6. Firmware asserts these same bytes in its
  // host test, so the two implementations are pinned to each other.
  test('the whole sealed file matches the shared v1 vector, header included', () => {
    expect(cc.seal(PLAIN, K, 1, NONCE).toString('hex')).toBe(
      '434b45310100000010111213141516'
      + '17ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a'
    );
  });

  test('unseal round-trips and parseHeader reads version and nonce', () => {
    const sealed = cc.seal(PLAIN, K);
    expect(cc.parseHeader(sealed)).toEqual({ version: 1, nonce: sealed.subarray(8, 16) });
    expect(cc.unseal(sealed, K)).toEqual(PLAIN);
  });

  test('parseHeader returns null for plaintext and unseal throws', () => {
    expect(cc.parseHeader(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'))).toBeNull();
    expect(() => cc.unseal(PLAIN, K)).toThrow('not sealed');
  });

  test('two seals of the same file use different nonces', () => {
    const a = cc.seal(PLAIN, K);
    const b = cc.seal(PLAIN, K);
    expect(a.subarray(8, 16)).not.toEqual(b.subarray(8, 16));
  });

  test('createUnsealStream decrypts across a chunk boundary that is not 16-aligned', async () => {
    const big = crypto.randomBytes(5000);
    const sealed = cc.seal(big, K);
    const body = sealed.subarray(16);
    const stream = cc.createUnsealStream(K, sealed.subarray(8, 16));
    const out = [];
    stream.on('data', (d) => out.push(d));
    stream.write(body.subarray(0, 2048));
    stream.write(body.subarray(2048, 2048 + 7)); // deliberately unaligned
    stream.end(body.subarray(2048 + 7));
    await new Promise((r) => stream.on('end', r));
    expect(Buffer.concat(out)).toEqual(big);
  });
});

describe('contentCrypto key wrapping', () => {
  const S = crypto.randomBytes(32);

  test('wrapKeyForDevice derives wrap_key = HMAC-SHA256(S, "cheeko-wrap-v1")[0:16] and CTR-wraps K', () => {
    const { key, nonce } = cc.wrapKeyForDevice(S, K);
    const wrapKey = crypto.createHmac('sha256', S).update('cheeko-wrap-v1').digest().subarray(0, 16);
    const iv = Buffer.concat([Buffer.from(nonce, 'hex'), Buffer.alloc(8, 0)]);
    const unwrapped = crypto.createDecipheriv('aes-128-ctr', wrapKey, iv).update(Buffer.from(key, 'hex'));
    expect(unwrapped).toEqual(K);
    expect(Buffer.from(nonce, 'hex').length).toBe(8);
  });

  // Shared vector, v1 handover §6. wrap_key is deterministic; the wrapped K is
  // only deterministic for a fixed nonce_w, so derive both here by hand.
  test('the wrap derivation matches the shared v1 vector', () => {
    const secret = Buffer.from('a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf', 'hex');
    const nonceW = Buffer.from('0909090909090909', 'hex');
    const wrapKey = crypto.createHmac('sha256', secret).update(cc.WRAP_INFO).digest().subarray(0, 16);
    expect(wrapKey.toString('hex')).toBe('94e5bea4747beb214b0cb91b3f8825d3');
    const iv = Buffer.concat([nonceW, Buffer.alloc(8, 0)]);
    const wrapped = crypto.createCipheriv('aes-128-ctr', wrapKey, iv).update(K);
    expect(wrapped.toString('hex')).toBe('99cf47ac63e20dd29d679e9854465f87');
  });

  test('encryptAtRest / decryptAtRest round-trip and detect tampering', () => {
    const master = crypto.randomBytes(32);
    const blob = cc.encryptAtRest(K, master);
    expect(cc.decryptAtRest(blob, master)).toEqual(K);
    blob[blob.length - 1] ^= 1;
    expect(() => cc.decryptAtRest(blob, master)).toThrow();
  });
});
