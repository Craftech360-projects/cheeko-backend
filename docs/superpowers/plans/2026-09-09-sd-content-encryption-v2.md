# SD Content Encryption (Version 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal every pack file with a per-pack key before it reaches S3, deliver that key to a toy wrapped under a per-device secret held in NVS flash, and decrypt on the toy in RAM at playback, so neither the SD card nor a public CloudFront URL yields playable content.

**Architecture:** Files get a 16-byte `CKE1` header and an AES-128-CTR body under a per-pack key K stored encrypted at rest in Postgres. Each toy generates a 32-byte secret S on first boot, keeps it in NVS, and registers it through the OTA check it already makes. At card lookup the server wraps K under `HMAC-SHA256(S, "cheeko-wrap-v1")[0:16]` and the gateway forwards it in `card_content`; the toy stores only the wrapped key on SD, unwraps in RAM, and decrypts each read chunk in place. Legacy plaintext files, detected by the missing magic, keep working everywhere.

**Tech Stack:** Node 20 / Express / Prisma (`crypto.createCipheriv('aes-128-ctr')`), Jest; mqtt-gateway (node:test); Python 3 device mimic in `client.py` (`cryptography` AES-128-CTR, already used for UDP audio); Vue 2 dashboard. Firmware is out of scope for this plan.

**Spec:** `main/manager-api-node/docs/sd-content-encryption.md` (sections 3, 4, 6, 7, 8, 9)

## Global Constraints

- File format is exactly: `"CKE1"`, version byte `2`, 3 zero bytes, 8-byte random nonce, AES-128-CTR body. Counter block is `nonce || 64-bit big-endian counter from 0`. No padding.
- HMAC info string is exactly `"cheeko-wrap-v1"`. Wrap key is the first 16 bytes of `HMAC-SHA256(S, info)`.
- Plaintext K is never written to the SD card and never returned by any API. S is never returned by any API.
- FATFS is 8.3 only (`CONFIG_FATFS_LFN_NONE=y`). No new filenames longer than 8+3.
- Decrypt in place, streaming in 2048-byte chunks, so the client mirrors the toy's `READ_BUF_SIZE` and its unaligned chunk boundaries.
- Files without the `CKE1` magic are plaintext and must behave exactly as today, on every reader.
- Every S3 writer whose output lands on an SD card seals; pack thumbnails and everything else stay plaintext.
- Firmware is NOT changed by this plan. `client.py` is the device under test and must keep the toy's exact on-disk shapes: `manifest.jsn` (not .json), `audio/01.mp3`, `images/01.bin`, `s01/` for grouped packs, 8.3 names throughout.
- All manager-api routes keep the `{code, msg, data}` envelope. Auth middleware unchanged.
- Sealing is gated on `CONTENT_MASTER_KEY` being set. Unset means today's behaviour, so local and CI keep working.
- Rollout order is firmware first, then server env flip, then backfill. Tasks are ordered so each subsystem is shippable on its own.

---

## File map

| Subsystem | Path | Responsibility |
|---|---|---|
| API | `src/utils/contentCrypto.js` (new) | `seal`, `unseal`, `parseHeader`, `wrapKeyForDevice`, `encryptAtRest`, `decryptAtRest`. Pure, no Prisma. |
| API | `src/services/contentKeys.service.js` (new) | `getOrCreatePackKey(packCode)`, `getPackKey(packCode)`, `registerDeviceSecret(mac, secretHex)`, `getDeviceSecret(mac)`. Prisma only. |
| API | `prisma/migrations/20260909000000_content_encryption/migration.sql` (new) | Two BYTEA columns. |
| API | `src/services/upload.service.js` | Call `seal` in the four SD-bound writers. |
| API | `src/routes/rfid.routes.js` | Upload route passes `packCode`; new `GET /content-pack/preview`. |
| API | `src/services/rfid.service.js` | `lookupCardByUid` and `buildCharacterArt` attach `encryption`. |
| API | `src/services/device.service.js`, `src/routes/ota.routes.js` | OTA check accepts `content_secret`. |
| API | `scripts/backfill-seal-content.js` (new) | One-off re-seal of existing CloudFront objects. |
| Gateway | `gateway/mqtt-gateway.js` | Whitelist `encryption`, forward in both `card_content` shapes and in `card_ai`. |
| Client | `client_crypto.py` (new) | CKE1 seal/unseal, stream decrypt, pack-key unwrap. |
| Client | `client_storage.py` (new) | NVS and SD-card stand-ins on disk. |
| Client | `client.py` | Register the secret on OTA, download `card_content`, decrypt at playback. |
| Client | `test_client_crypto.py`, `test_client_storage.py`, `test_client_pack_download.py`, `test_client_playback.py` (new) | Format vector, storage, download, playback. |
| Dashboard | `src/apis/module/rfid.js`, `src/components/RfidContentPackDialog.vue`, `src/views/RfidManagement.vue` | Preview through the proxy. |

Shared test vector, used by the Jest test (Task 1) and the Python client test (Task 10) so the two implementations are checked against each other rather than each against itself:

```
K        = 000102030405060708090a0b0c0d0e0f
nonce    = 1011121314151617
plaintext (32 bytes) = "cheeko content encryption test!!"  (ASCII, exactly 32 bytes)
expected ciphertext  = computed once in Task 1 step 3 and pasted into both tests
```

---

## Part A: manager-api-node

All commands run from `D:\cheeko-backend\main\manager-api-node`.

### Task 1: Pure crypto helpers

**Files:**
- Create: `src/utils/contentCrypto.js`
- Test: `tests/unit/contentCrypto.test.js`

**Interfaces:**
- Produces:
  - `seal(plain: Buffer, key: Buffer16, version = 2): Buffer` – header + ciphertext
  - `parseHeader(buf: Buffer): { version: number, nonce: Buffer8 } | null` – null when no magic
  - `unseal(sealed: Buffer, key: Buffer16): Buffer` – throws `Error('not sealed')` when no magic
  - `createUnsealStream(key: Buffer16, nonce: Buffer8): Transform` – decrypts a stream whose first 16 bytes were already removed
  - `wrapKeyForDevice(secret: Buffer32, packKey: Buffer16): { key: string, nonce: string }` – hex fields
  - `encryptAtRest(plain: Buffer, masterKey: Buffer32): Buffer` / `decryptAtRest(blob: Buffer, masterKey: Buffer32): Buffer` – AES-256-GCM, layout `iv(12) || tag(16) || ct`
  - `MAGIC = Buffer.from('CKE1')`, `HEADER_BYTES = 16`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const crypto = require('crypto');
const cc = require('../../src/utils/contentCrypto');

const K = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const NONCE = Buffer.from('1011121314151617', 'hex');
const PLAIN = Buffer.from('cheeko content encryption test!!', 'ascii'); // 32 bytes

describe('contentCrypto file format', () => {
  test('seal writes the CKE1 header, version 2, zero pad, nonce, and grows by 16', () => {
    const sealed = cc.seal(PLAIN, K, 2, NONCE);
    expect(sealed.length).toBe(PLAIN.length + 16);
    expect(sealed.subarray(0, 4).toString('ascii')).toBe('CKE1');
    expect(sealed[4]).toBe(2);
    expect(sealed.subarray(5, 8)).toEqual(Buffer.alloc(3, 0));
    expect(sealed.subarray(8, 16)).toEqual(NONCE);
  });

  test('ciphertext matches the reference vector (nonce || 64-bit BE counter from 0)', () => {
    const iv = Buffer.concat([NONCE, Buffer.alloc(8, 0)]);
    const expected = crypto.createCipheriv('aes-128-ctr', K, iv).update(PLAIN);
    const sealed = cc.seal(PLAIN, K, 2, NONCE);
    expect(sealed.subarray(16)).toEqual(expected);
    // Paste this hex into test_client_crypto.py EXPECTED_HEX (Task 10):
    // console.log(expected.toString('hex'));
  });

  test('unseal round-trips and parseHeader reads version and nonce', () => {
    const sealed = cc.seal(PLAIN, K);
    expect(cc.parseHeader(sealed)).toEqual({ version: 2, nonce: sealed.subarray(8, 16) });
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

  test('encryptAtRest / decryptAtRest round-trip and detect tampering', () => {
    const master = crypto.randomBytes(32);
    const blob = cc.encryptAtRest(K, master);
    expect(cc.decryptAtRest(blob, master)).toEqual(K);
    blob[blob.length - 1] ^= 1;
    expect(() => cc.decryptAtRest(blob, master)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/contentCrypto.test.js`
Expected: FAIL with `Cannot find module '../../src/utils/contentCrypto'`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass, and capture the vector**

Run: `npx jest tests/unit/contentCrypto.test.js`
Expected: PASS, 8 tests.

Then print the reference ciphertext once and keep it for Task 12:

```bash
node -e "const c=require('crypto');const K=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');const iv=Buffer.from('10111213141516170000000000000000','hex');console.log(c.createCipheriv('aes-128-ctr',K,iv).update(Buffer.from('cheeko content encryption test!!')).toString('hex'))"
```

Paste the 64-hex-char output into `tests/unit/contentCrypto.test.js` as a literal `expect(sealed.subarray(16).toString('hex')).toBe('<hex>')` assertion in the vector test, so the test no longer derives the expectation from the same library it checks.

- [ ] **Step 5: Commit**

```bash
git add src/utils/contentCrypto.js tests/unit/contentCrypto.test.js
git commit -m "feat(content-crypto): CKE1 seal/unseal, device key wrap, at-rest helpers"
```

---

### Task 2: Schema and key service

**Files:**
- Create: `prisma/migrations/20260909000000_content_encryption/migration.sql`
- Modify: `prisma/schema.prisma` (`rfid_content_pack` at line 836, `ai_device` at line 106)
- Create: `src/services/contentKeys.service.js`
- Test: `tests/unit/contentKeys.service.test.js`

**Interfaces:**
- Consumes: `encryptAtRest`, `decryptAtRest` from Task 1
- Produces:
  - `isEnabled(): boolean` – true when `CONTENT_MASTER_KEY` is a 64-hex string
  - `getOrCreatePackKey(packCode: string): Promise<Buffer16 | null>` – null when disabled or pack unknown and cannot be created
  - `getPackKey(packCode: string): Promise<Buffer16 | null>`
  - `registerDeviceSecret(mac: string, secretHex: string): Promise<void>` – idempotent, 64-hex only
  - `getDeviceSecret(mac: string): Promise<Buffer32 | null>`

- [ ] **Step 1: Write the migration**

```sql
-- Content encryption keys (spec §6). Both columns hold ciphertext produced by
-- contentCrypto.encryptAtRest under CONTENT_MASTER_KEY: a database dump must
-- not hand out pack keys or device secrets.
--
-- SAFE ON A LIVE DATABASE: nullable, no default, metadata-only. Existing rows
-- get NULL, which every reader treats as "not encrypted".

ALTER TABLE rfid_content_pack
  ADD COLUMN IF NOT EXISTS content_key BYTEA;

ALTER TABLE ai_device
  ADD COLUMN IF NOT EXISTS content_secret BYTEA;
```

Add to `prisma/schema.prisma`:

```prisma
// in model rfid_content_pack, after content_hash
  content_key       Bytes?
// in model ai_device, after app_version
  content_secret             Bytes?
```

Run: `npx prisma generate`
Expected: client regenerates without error.

- [ ] **Step 2: Write the failing test**

```js
'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_content_pack: { findFirst: jest.fn(), updateMany: jest.fn() },
  ai_device: { findFirst: jest.fn(), updateMany: jest.fn() },
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const MASTER = crypto.randomBytes(32).toString('hex');

describe('contentKeys.service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.CONTENT_MASTER_KEY = MASTER;
  });
  afterEach(() => { delete process.env.CONTENT_MASTER_KEY; });

  test('isEnabled is false without CONTENT_MASTER_KEY and every getter returns null', async () => {
    delete process.env.CONTENT_MASTER_KEY;
    const svc = require('../../src/services/contentKeys.service');
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.getOrCreatePackKey('STORY01')).toBeNull();
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toBeNull();
    expect(mockPrisma.rfid_content_pack.findFirst).not.toHaveBeenCalled();
  });

  test('getOrCreatePackKey creates a 16-byte key once and returns the same key after', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    let stored = null;
    mockPrisma.rfid_content_pack.findFirst.mockImplementation(async () => ({ id: 7n, content_key: stored }));
    mockPrisma.rfid_content_pack.updateMany.mockImplementation(async ({ data }) => { stored = data.content_key; return { count: 1 }; });

    const k1 = await svc.getOrCreatePackKey('STORY01');
    expect(k1.length).toBe(16);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
    expect(cc.decryptAtRest(stored, Buffer.from(MASTER, 'hex'))).toEqual(k1);

    const k2 = await svc.getOrCreatePackKey('STORY01');
    expect(k2).toEqual(k1);
    expect(mockPrisma.rfid_content_pack.updateMany).toHaveBeenCalledTimes(1);
  });

  test('getOrCreatePackKey returns null for an unknown pack code', async () => {
    const svc = require('../../src/services/contentKeys.service');
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(null);
    expect(await svc.getOrCreatePackKey('NOPE')).toBeNull();
  });

  test('registerDeviceSecret stores encrypted, normalises the mac, and rejects bad input', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const secret = crypto.randomBytes(32).toString('hex');
    mockPrisma.ai_device.updateMany.mockResolvedValue({ count: 1 });

    await svc.registerDeviceSecret('aa-bb-cc-dd-ee-ff', secret);
    const call = mockPrisma.ai_device.updateMany.mock.calls[0][0];
    expect(call.where.mac_address).toBe('AA:BB:CC:DD:EE:FF');
    expect(cc.decryptAtRest(call.data.content_secret, Buffer.from(MASTER, 'hex')).toString('hex')).toBe(secret);

    await expect(svc.registerDeviceSecret('AA:BB:CC:DD:EE:FF', 'short')).rejects.toThrow('content_secret must be 64 hex chars');
  });

  test('getDeviceSecret decrypts, and returns null when the column is empty', async () => {
    const svc = require('../../src/services/contentKeys.service');
    const cc = require('../../src/utils/contentCrypto');
    const s = crypto.randomBytes(32);
    mockPrisma.ai_device.findFirst.mockResolvedValue({ content_secret: cc.encryptAtRest(s, Buffer.from(MASTER, 'hex')) });
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toEqual(s);

    mockPrisma.ai_device.findFirst.mockResolvedValue({ content_secret: null });
    expect(await svc.getDeviceSecret('AA:BB:CC:DD:EE:FF')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest tests/unit/contentKeys.service.test.js`
Expected: FAIL with `Cannot find module '../../src/services/contentKeys.service'`

- [ ] **Step 4: Write the service**

```js
'use strict';
/**
 * Pack keys (K) and device secrets (S) for content encryption. Spec §6.
 *
 * Both live in Postgres encrypted under CONTENT_MASTER_KEY. When that env var
 * is unset the whole feature is off: every getter answers null and callers
 * fall back to today's plaintext behaviour.
 */
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { normalizeMacAddress } = require('../utils/helpers');
const cc = require('../utils/contentCrypto');
const logger = require('../utils/logger');

const masterKey = () => {
  const hex = process.env.CONTENT_MASTER_KEY || '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
};

const isEnabled = () => masterKey() !== null;

const getPackKey = async (packCode) => {
  const mk = masterKey();
  if (!mk || !packCode) return null;
  const row = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCode },
    select: { id: true, content_key: true },
  });
  if (!row || !row.content_key) return null;
  return cc.decryptAtRest(Buffer.from(row.content_key), mk);
};

const getOrCreatePackKey = async (packCode) => {
  const mk = masterKey();
  if (!mk || !packCode) return null;
  const row = await prisma.rfid_content_pack.findFirst({
    where: { pack_code: packCode },
    select: { id: true, content_key: true },
  });
  if (!row) return null;
  if (row.content_key) return cc.decryptAtRest(Buffer.from(row.content_key), mk);

  const key = crypto.randomBytes(16);
  await prisma.rfid_content_pack.updateMany({
    where: { id: row.id, content_key: null },   // never overwrite a key that landed first
    data: { content_key: cc.encryptAtRest(key, mk) },
  });
  // Re-read: if a concurrent upload won the race, use its key, not ours.
  const again = await prisma.rfid_content_pack.findFirst({ where: { id: row.id }, select: { content_key: true } });
  return cc.decryptAtRest(Buffer.from(again.content_key), mk);
};

const registerDeviceSecret = async (mac, secretHex) => {
  const mk = masterKey();
  if (!mk) return;
  if (!/^[0-9a-f]{64}$/i.test(secretHex || '')) throw new Error('content_secret must be 64 hex chars');
  const normalizedMac = normalizeMacAddress(mac);
  if (!normalizedMac) throw new Error('Invalid MAC address format');
  const res = await prisma.ai_device.updateMany({
    where: { mac_address: normalizedMac },
    data: { content_secret: cc.encryptAtRest(Buffer.from(secretHex, 'hex'), mk) },
  });
  if (res.count === 0) logger.warn(`[CONTENT-KEYS] content_secret for unknown device ${normalizedMac} ignored`);
};

const getDeviceSecret = async (mac) => {
  const mk = masterKey();
  const normalizedMac = normalizeMacAddress(mac);
  if (!mk || !normalizedMac) return null;
  const row = await prisma.ai_device.findFirst({
    where: { mac_address: normalizedMac },
    select: { content_secret: true },
  });
  if (!row || !row.content_secret) return null;
  return cc.decryptAtRest(Buffer.from(row.content_secret), mk);
};

module.exports = { isEnabled, getPackKey, getOrCreatePackKey, registerDeviceSecret, getDeviceSecret };
```

Check `normalizeMacAddress` in `src/utils/helpers.js:102` returns `AA:BB:CC:DD:EE:FF` uppercase with colons for the inputs used in the test. If it returns lowercase, change the test expectation to match the helper rather than the helper to match the test.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/unit/contentKeys.service.test.js tests/unit/contentCrypto.test.js`
Expected: PASS

- [ ] **Step 6: Add the env var to `.env.example`**

```bash
# Content encryption (spec: docs/sd-content-encryption.md). 32 random bytes as hex.
# Unset = feature off. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CONTENT_MASTER_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations/20260909000000_content_encryption prisma/schema.prisma src/services/contentKeys.service.js tests/unit/contentKeys.service.test.js .env.example
git commit -m "feat(content-crypto): pack key and device secret storage, encrypted at rest"
```

---

### Task 3: Seal at upload

**Files:**
- Modify: `src/services/upload.service.js` (`uploadContentFile` 55-113, `uploadCustomCardAudio` 415, `uploadCustomCardImage` 457, `uploadCharacterArt` 500)
- Modify: `src/routes/rfid.routes.js:3774-3829` (upload handler)
- Test: `tests/unit/upload.seal.test.js`

**Interfaces:**
- Consumes: `seal` (Task 1), `getOrCreatePackKey` (Task 2)
- Produces: `uploadContentFile(fileBuffer, filename, contentType, category, mimeType, { sealKey = null } = {})`; the three other writers gain the same trailing `{ sealKey }` option. When `sealKey` is a 16-byte Buffer the body written to S3 is `seal(fileBuffer, sealKey)`; otherwise unchanged.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const crypto = require('crypto');

const sent = [];
jest.mock('@aws-sdk/client-s3', () => {
  class PutObjectCommand { constructor(input) { this.input = input; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; } }
  class ListObjectsV2Command { constructor(input) { this.input = input; } }
  class S3Client { async send(cmd) { sent.push(cmd.input); return {}; } }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command };
});
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const upload = require('../../src/services/upload.service');
const cc = require('../../src/utils/contentCrypto');

const K = crypto.randomBytes(16);
const MP3 = Buffer.from('ID3 fake mp3 body for sealing');

describe('upload sealing', () => {
  beforeEach(() => { sent.length = 0; });

  test('uploadContentFile writes plaintext when no sealKey is given', async () => {
    await upload.uploadContentFile(MP3, 'tiger.mp3', 'rfidcontent', 'audio', 'audio/mpeg');
    expect(sent[0].Body).toEqual(MP3);
  });

  test('uploadContentFile seals the body when sealKey is given, and the URL is unchanged in shape', async () => {
    const r = await upload.uploadContentFile(MP3, 'tiger.mp3', 'rfidcontent', 'audio', 'audio/mpeg', { sealKey: K });
    const body = sent[0].Body;
    expect(cc.parseHeader(body)).not.toBeNull();
    expect(cc.unseal(body, K)).toEqual(MP3);
    expect(sent[0].ContentType).toBe('audio/mpeg');
    expect(r.url).toMatch(/^https:\/\/.+\/rfidcontent\/audio\/tiger-[0-9a-f]{8}\.mp3$/);
  });

  test('custom card audio and image and character art seal too', async () => {
    await upload.uploadCustomCardAudio(MP3, 42, 'rec.mp3', 'audio/mpeg', { sealKey: K });
    await upload.uploadCustomCardImage(Buffer.alloc(12, 1), 42, { sealKey: K });
    await upload.uploadCharacterArt(Buffer.alloc(12, 2), 'tara', 1, 'talk', { sealKey: K });
    for (const put of sent) expect(cc.parseHeader(put.Body)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/upload.seal.test.js`
Expected: FAIL on the second test, `parseHeader` returns null because the body is plaintext.

- [ ] **Step 3: Implement in `upload.service.js`**

At the top, after the existing requires:

```js
const { seal } = require('../utils/contentCrypto');

// Spec §4: every writer whose output lands on an SD card runs its body through
// this. A null key means the feature is off or the caller wants plaintext (pack
// thumbnails), and the bytes go out exactly as before.
const maybeSeal = (buffer, sealKey) => (sealKey ? seal(buffer, sealKey) : buffer);
```

Change the four signatures and their `Body:` lines:

```js
const uploadContentFile = async (fileBuffer, filename, contentType, category, mimeType, { sealKey = null } = {}) => {
  ...
      Body: maybeSeal(fileBuffer, sealKey),
```

```js
async function uploadCustomCardAudio(fileBuffer, kidId, filename, mimeType, { reuseKey = null, sealKey = null } = {}) {
  ...   Body: maybeSeal(fileBuffer, sealKey),
```

```js
async function uploadCustomCardImage(binBuffer, kidId, { reuseKey = null, sealKey = null } = {}) {
  ...   Body: maybeSeal(binBuffer, sealKey),
```

```js
async function uploadCharacterArt(binBuffer, sdFolder, version, state, { sealKey = null } = {}) {
  ...   Body: maybeSeal(binBuffer, sealKey),
```

Leave `uploadThumbnail`, `uploadImagineImage`, `uploadKidAvatar` untouched.

- [ ] **Step 4: Wire the upload route**

In `src/routes/rfid.routes.js`, add near the other requires:

```js
const contentKeys = require('../services/contentKeys.service');
```

Replace the `uploadService.uploadContentFile(...)` call at 3808 with:

```js
      // Pack thumbnails stay plaintext: the dashboard shows them in an <img>.
      // Everything else on this route lands on an SD card, so it is sealed
      // under the pack's key when encryption is on. packCode is required for
      // that; without it the file goes out plaintext and we say so in the log.
      const packCode = req.body?.packCode || null;
      let sealKey = null;
      if (!isPackThumbnail && contentKeys.isEnabled()) {
        sealKey = packCode ? await contentKeys.getOrCreatePackKey(packCode) : null;
        if (!sealKey) logger.warn(`[RFID-UPLOAD] no pack key for packCode=${packCode || 'none'}; uploading plaintext`);
      }
      const result = await uploadService.uploadContentFile(
        artwork.buffer,
        artwork.filename,
        'rfidcontent',
        category,
        artwork.mimeType,
        { sealKey }
      );
```

Note `getOrCreatePackKey` returns null when the pack row does not exist yet. The dashboard creates the pack row before uploading item files in Task 15, so this is only a warning path.

- [ ] **Step 5: Run the tests**

Run: `npx jest tests/unit/upload.seal.test.js tests/unit/customCard.audio.test.js tests/unit/customCard.image.test.js tests/unit/characterArt.encoder.test.js`
Expected: PASS. The custom-card and character tests mock the upload service and must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/services/upload.service.js src/routes/rfid.routes.js tests/unit/upload.seal.test.js
git commit -m "feat(content-crypto): seal SD-bound uploads under the pack key"
```

---

### Task 4: Seal custom-card recordings and character art at their call sites

**Files:**
- Modify: `src/services/customCard.service.js` (the two calls to `uploadCustomCardAudio` / `uploadCustomCardImage`)
- Modify: the character art upload site (`grep -n "uploadCharacterArt(" src/` to find it; it is in the agent/character route added by commit 94c18330)
- Test: extend `tests/unit/customCard.audio.test.js`

**Interfaces:**
- Consumes: `getOrCreatePackKey` (Task 2), `sealKey` option (Task 3)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/customCard.audio.test.js`, inside the existing describe that has `mockUpload` and `PACK` in scope:

```js
  test('custom card audio is uploaded with the pack key as sealKey when encryption is on', async () => {
    const contentKeys = require('../../src/services/contentKeys.service');
    const K = Buffer.alloc(16, 9);
    jest.spyOn(contentKeys, 'isEnabled').mockReturnValue(true);
    jest.spyOn(contentKeys, 'getOrCreatePackKey').mockResolvedValue(K);
    mockPrisma.kid_profile.findFirst.mockResolvedValue({ id: BigInt(KID_ID) });
    mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
    mockPrisma.rfid_content_pack.upsert.mockResolvedValue(PACK);
    mockPrisma.content_item.findMany.mockResolvedValue([]);
    mockUpload.uploadCustomCardAudio.mockResolvedValue({ url: 'https://cdn/x.mp3', s3Key: 'k' });

    await customCardService.addRecording(USER_ID, KID_ID, { buffer: Buffer.from('a'), originalname: 'a.mp3', mimetype: 'audio/mpeg' }, {});

    const opts = mockUpload.uploadCustomCardAudio.mock.calls[0][4];
    expect(opts.sealKey).toEqual(K);
    expect(contentKeys.getOrCreatePackKey).toHaveBeenCalledWith(PACK.pack_code);
  });
```

Adjust the service function name (`addRecording`) and its argument order to whatever `customCard.service.js` actually exports for "add a recording"; read the top of the existing test file, which already calls it, and copy that call.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/customCard.audio.test.js -t "sealKey"`
Expected: FAIL, `opts` is undefined or has no `sealKey`.

- [ ] **Step 3: Implement**

In `customCard.service.js`, where the pack row is resolved and before each upload call:

```js
const contentKeys = require('./contentKeys.service');
...
const sealKey = contentKeys.isEnabled() ? await contentKeys.getOrCreatePackKey(pack.pack_code) : null;
const uploaded = await uploadService.uploadCustomCardAudio(mp3.buffer, kidId, file.originalname, 'audio/mpeg', { reuseKey, sealKey });
```

and the same `{ reuseKey, sealKey }` on `uploadCustomCardImage`.

For character art, the pack-key concept does not apply, so use the character's own key: add to `contentKeys.service.js`

```js
const getOrCreateCharacterKey = async (sdFolder) => { /* same shape as getOrCreatePackKey against ai_agent_template.art_content_key */ };
```

with a third migration line in the Task 2 migration file:

```sql
ALTER TABLE ai_agent_template
  ADD COLUMN IF NOT EXISTS art_content_key BYTEA;
```

and `art_content_key Bytes?` in the Prisma model. Pass `{ sealKey }` at the `uploadCharacterArt` call site.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/customCard tests/unit/characterArt.encoder.test.js tests/unit/contentKeys.service.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/customCard.service.js src/services/contentKeys.service.js prisma tests/unit
git commit -m "feat(content-crypto): seal custom-card recordings and character art"
```

---

### Task 5: Register the device secret through the OTA check

**Files:**
- Modify: `src/routes/ota.routes.js:140-155` (deviceReport build) and `:236-250`
- Modify: `src/services/device.service.js:878` (`checkOtaVersion`)
- Test: `tests/unit/device.content-secret.test.js`

**Interfaces:**
- Consumes: `registerDeviceSecret` (Task 2)
- Produces: OTA check body may carry `content_secret: <64 hex>`; the server stores it and never echoes it. Response unchanged.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const contentKeys = { registerDeviceSecret: jest.fn(async () => {}), isEnabled: () => true };
jest.mock('../../src/services/contentKeys.service', () => contentKeys);
jest.mock('../../src/config/database', () => ({ prisma: {
  ai_device: { findFirst: jest.fn(async () => null), update: jest.fn(), create: jest.fn() },
  sys_params: { findUnique: jest.fn(async () => null) },
  ai_ota: { findMany: jest.fn(async () => []) },
} }));

const deviceService = require('../../src/services/device.service');

test('checkOtaVersion registers content_secret from the report and does not echo it', async () => {
  const secret = 'ab'.repeat(32);
  const res = await deviceService.checkOtaVersion('AA:BB:CC:DD:EE:FF', 'client', {
    version: '1.2.3', board: 'cheeko-v2', contentSecret: secret,
  });
  expect(contentKeys.registerDeviceSecret).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', secret);
  expect(JSON.stringify(res)).not.toContain(secret);
});

test('a malformed content_secret is ignored, not fatal', async () => {
  contentKeys.registerDeviceSecret.mockRejectedValueOnce(new Error('content_secret must be 64 hex chars'));
  await expect(deviceService.checkOtaVersion('AA:BB:CC:DD:EE:FF', 'client', { version: '1', contentSecret: 'nope' })).resolves.toBeDefined();
});
```

If `checkOtaVersion` needs more Prisma models mocked to reach its return, look at `tests/unit/device.service.test.js` for the existing mock shape and copy it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/device.content-secret.test.js`
Expected: FAIL, `registerDeviceSecret` not called.

- [ ] **Step 3: Implement**

`src/routes/ota.routes.js`, both places the `deviceReport` object is built (around lines 143 and 239), add:

```js
        contentSecret: req.body.content_secret || null,
```

`src/services/device.service.js`, inside `checkOtaVersion` right after `deviceReport` is resolved (after line 893):

```js
  // Spec §6: the toy registers its content secret on the OTA call it already
  // makes. Best effort and never in the response: a bad value is the toy's
  // problem to fix, not a reason to refuse an OTA answer.
  if (deviceReport?.contentSecret) {
    try {
      await contentKeys.registerDeviceSecret(normalizedMac, deviceReport.contentSecret);
    } catch (err) {
      logger.warn(`[OTA] content_secret rejected for ${normalizedMac}: ${err.message}`);
    }
  }
```

and `const contentKeys = require('./contentKeys.service');` at the top.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/device.content-secret.test.js tests/unit/device.service.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/ota.routes.js src/services/device.service.js tests/unit/device.content-secret.test.js
git commit -m "feat(content-crypto): accept content_secret on the OTA check"
```

---

### Task 6: Deliver the wrapped key at lookup

**Files:**
- Modify: `src/services/rfid.service.js` (`buildContentPackResponse` 777, `buildCharacterArt` 889, `lookupCardByUid` 928, `resolveCustomCardPack` callers at 1024 and 1057)
- Test: `tests/unit/rfid.lookup-encryption.test.js`

**Interfaces:**
- Consumes: `getPackKey`, `getDeviceSecret` (Task 2), `wrapKeyForDevice` (Task 1)
- Produces: content-pack lookup responses gain `encryption: { v: 2, key: <hex>, nonce: <hex> }` when the pack has a key and the device has a secret. `character` objects gain the same `encryption` field for sprites. Field is absent otherwise.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const crypto = require('crypto');

const mockPrisma = {
  rfid_card_mapping: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn() },
  rfid_series: { findFirst: jest.fn() },
  custom_card: { findFirst: jest.fn() },
  ai_agent_template: { findFirst: jest.fn() },
  $queryRaw: jest.fn(async () => []),
  $queryRawUnsafe: jest.fn(async () => []),
};
jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const K = crypto.randomBytes(16);
const S = crypto.randomBytes(32);
const keys = {
  isEnabled: jest.fn(() => true),
  getPackKey: jest.fn(async () => K),
  getDeviceSecret: jest.fn(async () => S),
  getCharacterKey: jest.fn(async () => null),
};
jest.mock('../../src/services/contentKeys.service', () => keys);

const rfid = require('../../src/services/rfid.service');
const cc = require('../../src/utils/contentCrypto');

const PACK = { id: 7n, pack_code: 'STORY01', name: 'Jungle', content_type: 'story_pack', version: '2', content_hash: 'h' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue({ id: 1n, content_pack_id: 7n, card_type: 'content' });
  mockPrisma.rfid_content_pack.findFirst.mockResolvedValue(PACK);
});

test('content pack lookup carries a wrapped key the device secret can unwrap', async () => {
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption.v).toBe(2);
  const wrapKey = crypto.createHmac('sha256', S).update(cc.WRAP_INFO).digest().subarray(0, 16);
  const iv = Buffer.concat([Buffer.from(res.encryption.nonce, 'hex'), Buffer.alloc(8, 0)]);
  expect(crypto.createDecipheriv('aes-128-ctr', wrapKey, iv).update(Buffer.from(res.encryption.key, 'hex'))).toEqual(K);
  expect(keys.getDeviceSecret).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
});

test('no field when the pack has no key', async () => {
  keys.getPackKey.mockResolvedValueOnce(null);
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption).toBeUndefined();
});

test('no field, and no error, when the device has no secret (unknown mac or mainboard swap)', async () => {
  keys.getDeviceSecret.mockResolvedValueOnce(null);
  const res = await rfid.lookupCardByUid('04A1B2C3', 'AA:BB:CC:DD:EE:FF');
  expect(res.encryption).toBeUndefined();
  expect(res.packCode).toBe('STORY01');
});

test('no field when no mac was supplied', async () => {
  const res = await rfid.lookupCardByUid('04A1B2C3', undefined);
  expect(res.encryption).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/rfid.lookup-encryption.test.js`
Expected: FAIL, `res.encryption` undefined in the first test.

- [ ] **Step 3: Implement**

Add near the top of `rfid.service.js`:

```js
const contentKeys = require('./contentKeys.service');
const { wrapKeyForDevice } = require('../utils/contentCrypto');

/**
 * Spec §6 key delivery. Returns the `encryption` field for a pack, or
 * undefined when either side of the wrap is missing. Never throws: a missing
 * secret (unknown mac, mainboard swap, feature off) must degrade to the
 * plaintext response, not fail the tap.
 */
const encryptionFieldFor = async (packCode, mac) => {
  if (!mac || !contentKeys.isEnabled()) return undefined;
  try {
    const [packKey, secret] = await Promise.all([
      contentKeys.getPackKey(packCode),
      contentKeys.getDeviceSecret(mac),
    ]);
    if (!packKey || !secret) return undefined;
    return { v: 2, ...wrapKeyForDevice(secret, packKey) };
  } catch (err) {
    logger.warn(`[RFID-LOOKUP] key wrap failed for pack=${packCode} mac=${mac}: ${err.message}`);
    return undefined;
  }
};
```

Change `buildContentPackResponse(pack, normalizedUid)` to `buildContentPackResponse(pack, normalizedUid, mac)` and, in both its return objects (grouped at 829, flat after 847), add:

```js
      encryption: await encryptionFieldFor(pack.pack_code, mac),
```

Update its three callers inside `lookupCardByUid` to pass `mac` (lines 1024 and 1057, plus any other `buildContentPackResponse(` call: `grep -n "buildContentPackResponse(" src/services/rfid.service.js`).

For sprites, change `buildCharacterArt(agentName)` to `buildCharacterArt(agentName, mac)`, select `art_content_key` too, and on the returned object add `encryption` computed the same way but from the character key:

```js
const encryptionFieldForCharacter = async (sdFolder, mac) => { /* same as encryptionFieldFor, using contentKeys.getCharacterKey(sdFolder) */ };
...
      encryption: await encryptionFieldForCharacter(tpl.sd_folder, mac),
```

Add `getCharacterKey(sdFolder)` to `contentKeys.service.js` mirroring `getPackKey` against `ai_agent_template.art_content_key`. Update the three `buildCharacterArt(` callers to pass `mac`.

JSON.stringify drops `undefined` fields, so old firmware and the gateway see no change for unencrypted packs.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/rfid.lookup-encryption.test.js tests/unit/customCard.lookup.test.js tests/unit/character-resolver.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/rfid.service.js src/services/contentKeys.service.js tests/unit/rfid.lookup-encryption.test.js
git commit -m "feat(content-crypto): return the pack key wrapped for the tapping device"
```

---

### Task 7: Dashboard preview proxy route

**Files:**
- Modify: `src/routes/rfid.routes.js` (add route before `GET /content-pack/:id` at 4032, since `/content-pack/preview` must win over `/:id`)
- Test: `tests/unit/rfid.preview-route.test.js`

**Interfaces:**
- Consumes: `parseHeader`, `createUnsealStream` (Task 1), `getPackKey` (Task 2)
- Produces: `GET /admin/rfid/content-pack/preview?url=<cloudfront url>&packCode=<code>`, `requireAdmin`. Streams decrypted bytes. 302 to `url` when the object is plaintext. 400 for a URL off the CloudFront domain. 404 when the pack has no key.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../src/middleware/auth', () => ({
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (req, _s, n) => { req.user = { id: 1 }; n(); },
}));
jest.mock('../../src/config/database', () => ({ prisma: {} }));

const K = crypto.randomBytes(16);
jest.mock('../../src/services/contentKeys.service', () => ({
  isEnabled: () => true, getPackKey: jest.fn(async (c) => (c === 'STORY01' ? K : null)),
}));

const cc = require('../../src/utils/contentCrypto');
const MP3 = crypto.randomBytes(5000);
const SEALED = cc.seal(MP3, K);
const CDN = 'https://dsmzc13oafp54.cloudfront.net';

global.fetch = jest.fn(async (url) => {
  const body = url.endsWith('plain.mp3') ? MP3 : SEALED;
  return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => body, body: require('stream').Readable.toWeb(require('stream').Readable.from([body])) };
});

const app = express();
app.use('/admin/rfid', require('../../src/routes/rfid.routes'));

test('streams the decrypted file for a sealed object', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'STORY01' }).buffer().parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  expect(res.body).toEqual(MP3);
});

test('redirects to CloudFront for a legacy plaintext object', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/plain.mp3`, packCode: 'STORY01' });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(`${CDN}/rfidcontent/audio/plain.mp3`);
});

test('refuses a URL off the CloudFront domain', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: 'https://evil.example/x.mp3', packCode: 'STORY01' });
  expect(res.status).toBe(400);
});

test('404 when the pack has no key', async () => {
  const res = await request(app).get('/admin/rfid/content-pack/preview').query({ url: `${CDN}/rfidcontent/audio/x.mp3`, packCode: 'NOKEY' });
  expect(res.status).toBe(404);
});
```

Check `supertest` is in devDependencies (`grep supertest package.json`). If not: `npm i -D supertest`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/rfid.preview-route.test.js`
Expected: FAIL, 404 or the `/:id` handler answering.

- [ ] **Step 3: Implement**

Insert before `router.get('/content-pack/:id'` at 4032:

```js
/**
 * Admin-only decrypt proxy for the dashboard's play button (spec §8).
 * The browser never sees a key. Origin is pinned to CloudFront so this cannot
 * be pointed at arbitrary hosts. Legacy plaintext objects redirect straight
 * to the CDN, so the dialog needs no special case for them.
 */
router.get('/content-pack/preview',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { url, packCode } = req.query;
    const cdn = `https://${process.env.CLOUDFRONT_DOMAIN || 'dsmzc13oafp54.cloudfront.net'}/`;
    if (typeof url !== 'string' || !url.startsWith(cdn)) return badRequest(res, 'url must be on the content CDN');

    const upstream = await fetch(url);
    if (!upstream.ok) return notFound(res, `upstream ${upstream.status}`);
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const header = parseHeader(bytes);
    if (!header) return res.redirect(url);

    const key = await contentKeys.getPackKey(packCode);
    if (!key) return notFound(res, 'No content key for this pack');

    res.type(url.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream');
    res.set('Cache-Control', 'private, no-store');
    const { Readable } = require('stream');
    Readable.from([bytes.subarray(HEADER_BYTES)]).pipe(createUnsealStream(key, header.nonce)).pipe(res);
  })
);
```

and at the top of the file: `const { parseHeader, createUnsealStream, HEADER_BYTES } = require('../utils/contentCrypto');`

Buffering the whole object is deliberate for a 50 MB cap and an admin audience. Do not add a streaming header sniff.

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/rfid.preview-route.test.js`
Expected: PASS

- [ ] **Step 5: Update the MCP doc and commit**

`docs/mcp.md` lists content-pack routes the MCP hardcodes. This route is admin-only and read-only, so no MCP edit is needed; add one line under the content-pack section saying so, then:

```bash
git add src/routes/rfid.routes.js tests/unit/rfid.preview-route.test.js docs/mcp.md
git commit -m "feat(content-crypto): admin-only decrypt proxy for dashboard preview"
```

---

### Task 8: Backfill script

**Files:**
- Create: `scripts/backfill-seal-content.js`
- Modify: `package.json` scripts
- Test: `tests/unit/backfill-seal-content.test.js`

**Interfaces:**
- Consumes: `seal`, `parseHeader` (Task 1), `getOrCreatePackKey` (Task 2), `uploadContentFile` with `sealKey` (Task 3)
- Produces: `node scripts/backfill-seal-content.js [--dry-run] [--pack STORY01]`; exports `resealItem(item, deps)` for the test.

- [ ] **Step 1: Write the failing test**

```js
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
    dryRun: false,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/backfill-seal-content.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the script**

```js
#!/usr/bin/env node
'use strict';
/**
 * Re-seal existing pack files (spec §9 step 4).
 *
 * For every content_item audio/image URL that is still plaintext: download,
 * seal under the pack key, upload under a NEW uuid-suffixed key (the old one is
 * cached at the edge for a year), point the row at the new URL. Old objects
 * are left in place for a rollback window; delete them by hand later.
 *
 *   node scripts/backfill-seal-content.js --dry-run
 *   node scripts/backfill-seal-content.js --pack STORY01
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { seal, parseHeader } = require('../src/utils/contentCrypto');

async function resealOne(url, packCode, d) {
  if (!url) return 'skipped';
  const bytes = await d.fetchBytes(url);
  if (parseHeader(bytes)) return 'already';
  const key = await d.getOrCreatePackKey(packCode);
  if (!key) return 'nokey';
  if (d.dryRun) return 'would-seal';
  const name = path.basename(new URL(url).pathname).replace(/-[0-9a-f]{8}(\.[a-z0-9]+)$/i, '$1');
  const up = await d.upload(seal(bytes, key), decodeURIComponent(name), url.includes('/images/') ? 'images' : 'audio');
  return up.url;
}

async function resealItem(item, d) {
  const audio = await resealOne(item.audio_url, item.pack_code, d);
  const image = await resealOne(item.image_url, item.pack_code, d);
  const patch = {};
  if (audio.startsWith('http')) patch.audio_url = audio;
  if (image.startsWith('http')) patch.image_url = image;
  if (Object.keys(patch).length && !d.dryRun) await d.updateItem(item.id, patch);
  return {
    audio: audio.startsWith('http') ? 'sealed' : audio,
    image: image.startsWith('http') ? 'sealed' : image,
  };
}

async function main() {
  const { prisma } = require('../src/config/database');
  const contentKeys = require('../src/services/contentKeys.service');
  const uploadService = require('../src/services/upload.service');
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const packArg = args[args.indexOf('--pack') + 1];
  if (!contentKeys.isEnabled()) throw new Error('CONTENT_MASTER_KEY is not set');

  const rows = await prisma.$queryRawUnsafe(`
    SELECT ci.id, ci.audio_url, ci.image_url, p.pack_code
    FROM content_item ci JOIN rfid_content_pack p ON p.id = ci.content_pack_id
    WHERE (ci.audio_url IS NOT NULL OR ci.image_url IS NOT NULL)
    ${packArg && args.includes('--pack') ? `AND p.pack_code = '${packArg.replace(/'/g, '')}'` : ''}
    ORDER BY ci.id`);

  const d = {
    dryRun,
    fetchBytes: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    getOrCreatePackKey: contentKeys.getOrCreatePackKey,
    upload: (buf, name, category) => uploadService.uploadContentFile(buf, name, 'rfidcontent', category, name.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'),
    updateItem: (id, patch) => prisma.content_item.updateMany({ where: { id }, data: patch }),
  };

  const tally = {};
  for (const row of rows) {
    const r = await resealItem(row, d);
    for (const v of Object.values(r)) tally[v] = (tally[v] || 0) + 1;
    console.log(`${row.pack_code} item ${row.id}: audio=${r.audio} image=${r.image}`);
  }
  console.log(tally);
  await prisma.$disconnect();
}

module.exports = { resealItem };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
```

Note `upload` passes the already-sealed buffer with no `sealKey`, so `uploadContentFile` writes it as-is. Do not pass `sealKey` here or the file is sealed twice.

Add to `package.json` scripts:

```json
    "backfill:seal-content": "node scripts/backfill-seal-content.js",
    "backfill:seal-content:dry": "node scripts/backfill-seal-content.js --dry-run",
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/unit/backfill-seal-content.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole API suite and commit**

Run: `npm test`
Expected: PASS, no new failures against the pre-existing baseline (run `git stash; npm test; git stash pop` first if unsure what the baseline is).

```bash
git add scripts/backfill-seal-content.js tests/unit/backfill-seal-content.test.js package.json
git commit -m "feat(content-crypto): backfill script to re-seal existing pack files"
```

---

## Part B: mqtt-gateway

All commands run from `D:\cheeko-backend\main\mqtt-gateway`.

### Task 9: Carry `encryption` through both senders

**Files:**
- Modify: `gateway/mqtt-gateway.js:184-210` (whitelist), `:1156-1169` and `:1198-1212` (`card_content` builders), `:1257-1275` (`card_ai` builder)
- Test: `tests/card-content-encryption.test.js`

**Interfaces:**
- Consumes: lookup response field `encryption: {v, key, nonce}` and `character.encryption` (Task 6)
- Produces: `card_content` and `card_ai` MQTT payloads carry `encryption` unchanged when present, absent otherwise. `virtual-connection.js` already spreads `...cardData`, no change there.

- [ ] **Step 1: Write the failing test**

```js
const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "gateway", "mqtt-gateway.js"), "utf8");

// The whitelist and the two hand-built manifests are the places a lookup field
// silently dies (see the character-art comment in fetchRfidContentFromManagerApi).
// Pin them with a source check so a refactor that drops `encryption` fails CI.
test("fetchRfidContentFromManagerApi whitelists encryption", () => {
  const start = src.indexOf("async function fetchRfidContentFromManagerApi");
  const end = src.indexOf("async function fetchContentDownloadManifest");
  const fn = src.slice(start, end);
  assert.match(fn, /encryption:\s*data\.encryption\s*\|\|\s*null/);
});

test("both card_content manifests and the hand-built card_ai forward encryption", () => {
  const occurrences = src.match(/\.\.\.\(rfidContent\.encryption \? \{ encryption: rfidContent\.encryption \} : \{\}\)/g) || [];
  assert.strictEqual(occurrences.length, 3, "expected encryption spread in grouped card_content, flat card_content, and card_ai");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/card-content-encryption.test.js`
Expected: FAIL, 0 occurrences.

- [ ] **Step 3: Implement**

In the whitelist return (after `character: data.character || null,`):

```js
      // Spec §6: the pack key wrapped for this device. Same trap as character:
      // not named here means the toy never sees it and plays nothing.
      encryption: data.encryption || null,
```

In the grouped manifest (after `replace_mode: "safe_background_refresh",` at 1168), the flat manifest (after 1211), and the `card_ai` object (after the `character` spread at 1274), add the identical line:

```js
              ...(rfidContent.encryption ? { encryption: rfidContent.encryption } : {}),
```

`character.encryption` for sprites already travels inside `rfidContent.character`, which is spread whole.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS including the new file.

- [ ] **Step 5: Commit**

```bash
git add gateway/mqtt-gateway.js tests/card-content-encryption.test.js
git commit -m "feat(gateway): forward the wrapped content key in card_content and card_ai"
```

---

## Part C: client.py device mimic

Firmware is out of scope for this plan. `D:\cheeko-backend\client.py` is the Python test client that already impersonates an ESP32 toy: it does the OTA handshake (`get_ota_config`, line 566), connects to MQTT with gateway credentials, sends `card_lookup` (`send_rfid_card_lookup`, line 303), asks for downloads (`request_content_download`, line 354), and already runs AES-128-CTR through `cryptography` for UDP audio (`encrypt_packet`, line 537). These tasks make it exercise the whole encryption path end to end, so the server, the gateway and the format are provable without touching the toy.

The client stands in for the toy's storage: NVS becomes `client_state/nvs.json`, and the SD card becomes `client_state/sdcard/cheeko/skills/<skill_id>/`. Same filenames, same `manifest.jsn` shape, same 8.3 names, so what the client writes is byte-for-byte what the firmware will later write.

All commands run from `D:\cheeko-backend`.

### Task 10: Client crypto module, with a self-check

**Files:**
- Create: `client_crypto.py`
- Test: `test_client_crypto.py`

**Interfaces:**
- Produces:
  - `MAGIC = b'CKE1'`, `HEADER_BYTES = 16`, `WRAP_INFO = b'cheeko-wrap-v1'`
  - `parse_header(head: bytes) -> tuple[int, bytes] | None` – `(version, nonce8)`, None when no magic
  - `seal(plain: bytes, key: bytes, version: int = 2, nonce: bytes | None = None) -> bytes`
  - `unseal(sealed: bytes, key: bytes) -> bytes` – raises `ValueError('not sealed')` when no magic
  - `decrypt_stream(key: bytes, nonce: bytes)` – returns an object with `.update(chunk) -> bytes`, sequential, carries the partial block
  - `unwrap_pack_key(secret: bytes, wrapped: bytes, nonce_w: bytes) -> bytes`
  - `wrap_pack_key(secret: bytes, key: bytes, nonce_w: bytes) -> bytes` – for the round-trip test only

- [ ] **Step 1: Write the failing test**

```python
"""Format check for the CKE1 sealed-file layout the toy will read.

The vector is shared with manager-api-node tests/unit/contentCrypto.test.js.
If these two disagree, the toy plays noise, so this file is the contract.

Run: python -m pytest test_client_crypto.py -q   (or: python test_client_crypto.py)
"""
import hmac
import hashlib
import os

from client_crypto import (
    HEADER_BYTES, WRAP_INFO, parse_header, seal, unseal,
    decrypt_stream, unwrap_pack_key, wrap_pack_key,
)

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
NONCE = bytes.fromhex("1011121314151617")
PLAIN = b"cheeko content encryption test!!"          # exactly 32 bytes
EXPECTED_HEX = "<paste from manager-api Task 1 step 4>"


def test_seal_layout():
    sealed = seal(PLAIN, K, 2, NONCE)
    assert len(sealed) == len(PLAIN) + HEADER_BYTES
    assert sealed[:4] == b"CKE1"
    assert sealed[4] == 2
    assert sealed[5:8] == b"\x00\x00\x00"
    assert sealed[8:16] == NONCE


def test_matches_the_shared_vector():
    sealed = seal(PLAIN, K, 2, NONCE)
    assert sealed[HEADER_BYTES:].hex() == EXPECTED_HEX


def test_parse_header_and_round_trip():
    sealed = seal(PLAIN, K)
    assert parse_header(sealed) == (2, sealed[8:16])
    assert unseal(sealed, K) == PLAIN


def test_plaintext_is_recognised_as_plaintext():
    assert parse_header(b"ID3\x04" + b"\x00" * 12) is None
    try:
        unseal(PLAIN, K)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "not sealed" in str(exc)


def test_nonce_differs_per_seal():
    assert seal(PLAIN, K)[8:16] != seal(PLAIN, K)[8:16]


def test_stream_decrypt_across_unaligned_chunks():
    big = os.urandom(5000)
    sealed = seal(big, K)
    body = sealed[HEADER_BYTES:]
    dec = decrypt_stream(K, sealed[8:16])
    out = dec.update(body[:2048]) + dec.update(body[2048:2055]) + dec.update(body[2055:])
    assert out == big


def test_unwrap_matches_the_server_derivation():
    secret = os.urandom(32)
    nonce_w = os.urandom(8)
    wrapped = wrap_pack_key(secret, K, nonce_w)
    assert unwrap_pack_key(secret, wrapped, nonce_w) == K
    # and independently, the way rfid.service.js computes it
    wrap_key = hmac.new(secret, WRAP_INFO, hashlib.sha256).digest()[:16]
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    c = Cipher(algorithms.AES(wrap_key), modes.CTR(nonce_w + b"\x00" * 8)).decryptor()
    assert c.update(wrapped) + c.finalize() == K


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python test_client_crypto.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'client_crypto'`

- [ ] **Step 3: Write `client_crypto.py`**

```python
"""CKE1 sealed-content crypto for the device mimic.

Mirrors manager-api-node/src/utils/contentCrypto.js and what the firmware will
do with mbedtls_aes_crypt_ctr. Kept in its own module, with no client.py
imports, so the format can be tested without MQTT, audio or a server.

Format (docs/sd-content-encryption.md section 3):
    "CKE1" | version(1) | zero(3) | nonce(8) | AES-128-CTR body
Counter block is nonce || 64-bit big-endian counter from 0, which is exactly
what CTR mode with iv = nonce + 8 zero bytes produces.
"""
import hashlib
import hmac
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"CKE1"
HEADER_BYTES = 16
WRAP_INFO = b"cheeko-wrap-v1"


def _ctr(key: bytes, nonce: bytes):
    return Cipher(algorithms.AES(key), modes.CTR(nonce + b"\x00" * 8),
                  backend=default_backend())


def parse_header(head: bytes):
    """(version, nonce) for a sealed file, or None when this is plaintext."""
    if not head or len(head) < HEADER_BYTES or head[:4] != MAGIC:
        return None
    return head[4], bytes(head[8:16])


def seal(plain: bytes, key: bytes, version: int = 2, nonce: bytes = None) -> bytes:
    nonce = nonce or os.urandom(8)
    header = MAGIC + bytes([version]) + b"\x00\x00\x00" + nonce
    enc = _ctr(key, nonce).encryptor()
    return header + enc.update(plain) + enc.finalize()


def unseal(sealed: bytes, key: bytes) -> bytes:
    parsed = parse_header(sealed)
    if parsed is None:
        raise ValueError("not sealed")
    dec = _ctr(key, parsed[1]).decryptor()
    return dec.update(sealed[HEADER_BYTES:]) + dec.finalize()


def decrypt_stream(key: bytes, nonce: bytes):
    """Sequential decryptor for chunked reads.

    The toy reads 2 KB at a time and those boundaries are not 16-byte aligned,
    so the keystream position has to survive between calls. cryptography's
    CipherContext already does that; this wrapper just names the intent.
    """
    return _ctr(key, nonce).decryptor()


def _wrap_key(secret: bytes) -> bytes:
    return hmac.new(secret, WRAP_INFO, hashlib.sha256).digest()[:16]


def unwrap_pack_key(secret: bytes, wrapped: bytes, nonce_w: bytes) -> bytes:
    dec = _ctr(_wrap_key(secret), nonce_w).decryptor()
    return dec.update(wrapped) + dec.finalize()


def wrap_pack_key(secret: bytes, key: bytes, nonce_w: bytes) -> bytes:
    """CTR is symmetric, so this is unwrap under another name. Test-side only."""
    return unwrap_pack_key(secret, key, nonce_w)
```

- [ ] **Step 4: Run the test, and fill in the vector**

Get the reference ciphertext from the manager-api side (Task 1 step 4 printed it). If it is not to hand, regenerate it there:

```bash
node -e "const c=require('crypto');const K=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');const iv=Buffer.from('10111213141516170000000000000000','hex');console.log(c.createCipheriv('aes-128-ctr',K,iv).update(Buffer.from('cheeko content encryption test!!')).toString('hex'))"
```

Paste the 64 hex chars into `EXPECTED_HEX`, then run: `python test_client_crypto.py`
Expected: all seven tests print OK.

- [ ] **Step 5: Commit**

```bash
git add client_crypto.py test_client_crypto.py
git commit -m "feat(client): CKE1 seal/unseal and pack-key unwrap for the device mimic"
```

---

### Task 11: Device secret in a local NVS mimic, sent on the OTA check

**Files:**
- Create: `client_storage.py`
- Modify: `client.py:566-600` (`get_ota_config`), `client.py:168-184` (`setup_local_test_config`)
- Test: `test_client_storage.py`

**Interfaces:**
- Consumes: nothing from Task 10
- Produces:
  - `DeviceStore(base_dir='client_state', mac: str)` with:
    - `.secret_hex() -> str` – 64 lowercase hex, generated on first call and persisted to `<base>/nvs.json` under key `dev_secret`, keyed per MAC so two clients on one machine do not share
    - `.secret() -> bytes` – the same value as 32 bytes
    - `.rotate_secret() -> str` – new secret, used to test the wipe path
    - `.sd_root() -> str` – `<base>/sdcard/cheeko`
    - `.skill_dir(skill_id) -> str` – `<sd_root>/skills/<skill_id>`, created on demand

- [ ] **Step 1: Write the failing test**

```python
"""The client's stand-ins for NVS and the SD card.

The toy keeps its content secret in NVS namespace "cheeko" key "dev_secret" and
its packs under /sdcard/cheeko/skills/<id>/. This module is the same shape on
disk so the client's manifest.jsn is what the firmware will later parse.
"""
import json
import os
import shutil
import tempfile

from client_storage import DeviceStore

MAC = "00:16:3e:7a:11:c6"


def _store():
    d = tempfile.mkdtemp()
    return DeviceStore(base_dir=d, mac=MAC), d


def test_secret_is_generated_once_and_persists():
    store, d = _store()
    try:
        first = store.secret_hex()
        assert len(first) == 64 and int(first, 16) >= 0
        assert store.secret_hex() == first
        # a fresh object over the same directory reads the stored value
        assert DeviceStore(base_dir=d, mac=MAC).secret_hex() == first
        assert store.secret() == bytes.fromhex(first)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_two_macs_get_different_secrets():
    store, d = _store()
    try:
        other = DeviceStore(base_dir=d, mac="00:16:3e:7a:11:c7")
        assert store.secret_hex() != other.secret_hex()
        saved = json.load(open(os.path.join(d, "nvs.json")))
        assert len(saved["dev_secret"]) == 2
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_rotate_changes_the_secret():
    store, d = _store()
    try:
        before = store.secret_hex()
        after = store.rotate_secret()
        assert after != before
        assert store.secret_hex() == after
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_skill_dir_layout_matches_the_toy():
    store, d = _store()
    try:
        path = store.skill_dir("story01")
        assert path.replace("\\", "/").endswith("sdcard/cheeko/skills/story01")
        assert os.path.isdir(path)
    finally:
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python test_client_storage.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'client_storage'`

- [ ] **Step 3: Write `client_storage.py`**

```python
"""On-disk stand-ins for the toy's NVS and SD card.

client_state/
  nvs.json                                  {"dev_secret": {"<mac>": "<64 hex>"}}
  sdcard/cheeko/skills/<skill_id>/manifest.jsn
  sdcard/cheeko/skills/<skill_id>/audio/01.mp3
  sdcard/cheeko/skills/<skill_id>/images/01.bin

Paths and filenames match the firmware exactly (8.3 names, "manifest.jsn" not
"manifest.json"), so a directory produced here could be copied onto a real card.
"""
import json
import os
import secrets


class DeviceStore:
    def __init__(self, base_dir: str = "client_state", mac: str = ""):
        self.base_dir = base_dir
        self.mac = mac
        self._nvs_path = os.path.join(base_dir, "nvs.json")
        os.makedirs(base_dir, exist_ok=True)

    def _read_nvs(self) -> dict:
        try:
            with open(self._nvs_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (FileNotFoundError, ValueError):
            return {}

    def _write_nvs(self, data: dict) -> None:
        with open(self._nvs_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)

    def secret_hex(self) -> str:
        nvs = self._read_nvs()
        stored = nvs.get("dev_secret", {}).get(self.mac)
        if stored and len(stored) == 64:
            return stored
        return self._store_secret(secrets.token_hex(32))

    def _store_secret(self, value: str) -> str:
        nvs = self._read_nvs()
        nvs.setdefault("dev_secret", {})[self.mac] = value
        self._write_nvs(nvs)
        return value

    def secret(self) -> bytes:
        return bytes.fromhex(self.secret_hex())

    def rotate_secret(self) -> str:
        """Mimics an NVS erase: the old wrapped keys on the card become dead."""
        return self._store_secret(secrets.token_hex(32))

    def sd_root(self) -> str:
        path = os.path.join(self.base_dir, "sdcard", "cheeko")
        os.makedirs(path, exist_ok=True)
        return path

    def skill_dir(self, skill_id: str) -> str:
        path = os.path.join(self.sd_root(), "skills", skill_id)
        os.makedirs(path, exist_ok=True)
        return path
```

- [ ] **Step 4: Wire it into client.py**

In `TestClient.__init__` (after `self.device_mac_formatted` is set, around line 127):

```python
        # Stand-ins for the toy's NVS and SD card. The content secret is
        # generated on first run and reused, exactly as the firmware does.
        self.store = DeviceStore(base_dir=os.getenv("TEST_CLIENT_STATE", "client_state"),
                                 mac=self.device_mac_formatted)
```

with `from client_storage import DeviceStore` at the top of the file.

In `get_ota_config`, add the secret to the POST body (the `data` dict at line 576):

```python
                "client_id": session_client_id,
                # Spec section 6: the toy registers its content secret on the
                # OTA call it already makes. Write-only — the server never
                # returns it.
                "content_secret": self.store.secret_hex(),
```

`setup_local_test_config` skips OTA entirely, so add a line there that says so:

```python
        logger.info("[RFID-TEST] Local mode: no OTA call, so content_secret is NOT registered. "
                    "Run once with --register-secret if the server has no secret for this MAC.")
```

- [ ] **Step 5: Add `--register-secret`**

The RFID test mode never calls OTA, so it needs a way to register. Add a method on `TestClient`:

```python
    def register_content_secret(self) -> bool:
        """POST the content secret to the OTA endpoint without the full handshake.

        RFID mode configures MQTT locally and never calls OTA, so a fresh MAC has
        no secret on the server and every lookup comes back unencrypted. This is
        the one call that fixes that.
        """
        url = f"http://{SERVER_IP}:{OTA_PORT}/toy/ota/"
        body = {
            "application": {"version": "1.7.6", "name": "cheeko-client-mimic"},
            "board": {"type": "doit-ai-01-kit"},
            "mac_address": self.device_mac_formatted,
            "content_secret": self.store.secret_hex(),
        }
        try:
            resp = requests.post(url, headers={"device-id": self.device_mac_formatted},
                                 json=body, timeout=10)
            logger.info("[SECRET] Registered content secret for %s: HTTP %s",
                        self.device_mac_formatted, resp.status_code)
            body_text = resp.text or ""
            if self.store.secret_hex() in body_text:
                logger.error("[SECRET] SERVER ECHOED THE SECRET BACK — that is a leak, report it")
                return False
            return resp.ok
        except requests.exceptions.RequestException as exc:
            logger.error("[SECRET] Failed to register content secret: %s", exc)
            return False
```

Add the flag in `__main__`:

```python
    parser.add_argument(
        "--register-secret",
        action="store_true",
        help="Register this client's content secret with the server before the test. "
             "Needed once per MAC in rfid mode, which does not call OTA.",
    )
```

and in the `rfid` branch, before `client.run_rfid_test(...)`:

```python
            if args.register_secret:
                client.register_content_secret()
```

- [ ] **Step 6: Run the tests**

Run: `python test_client_storage.py`
Expected: four OK lines.

Then, against a running API with `CONTENT_MASTER_KEY` set and the device row present:

```bash
python client.py --mode rfid --rfid-uid <UID> --register-secret
```

Expected: `[SECRET] Registered content secret ... HTTP 200`, no leak warning. Confirm on the API side:

```sql
SELECT mac_address, content_secret IS NOT NULL AS has_secret FROM ai_device WHERE mac_address = '00:16:3E:7A:11:C6';
```

If `has_secret` is false, the MAC has no `ai_device` row yet; bind the device in the dashboard first, then re-run.

- [ ] **Step 7: Commit**

```bash
git add client_storage.py test_client_storage.py client.py
git commit -m "feat(client): device content secret in an NVS mimic, registered on the OTA call"
```

---

### Task 12: Download a sealed pack to the SD mimic, keeping the key wrapped

**Files:**
- Modify: `client.py` (`on_mqtt_message` 194-270 to route `card_content`, plus a new download method)
- Test: `test_client_pack_download.py`

**Interfaces:**
- Consumes: `parse_header`, `unwrap_pack_key` (Task 10), `DeviceStore` (Task 11)
- Produces:
  - `TestClient.download_card_content(card_content: dict) -> dict` – downloads every `audio[]` and `images[]` URL (and `stories[]` when grouped) into the skill dir, writes `manifest.jsn` last, returns `{'skill_id', 'files': [...], 'sealed': bool}`
  - `manifest.jsn` shape: `{"skill_id", "skill_name", "version", "content_hash", "content_type", "enc": {"v":2,"key":"<hex>","nonce":"<hex>"}}` with `enc` present only for sealed packs
  - Plain key K is never written to disk

- [ ] **Step 1: Write the failing test**

```python
"""Downloading a card_content payload onto the SD mimic.

Two things must hold and are easy to get wrong: the wrapped key goes into
manifest.jsn and the plain key never does, and a plaintext pack must still work
so the rollout does not need a flag day.
"""
import json
import os
import shutil
import tempfile
from unittest import mock

import client_crypto
from client_storage import DeviceStore

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
MP3 = b"ID3" + b"\x00" * 500
PNGBIN = b"\x19\x12" + b"\x00" * 300


def _client(tmp):
    from client import TestClient
    c = TestClient(device_mac="00:16:3e:7a:11:c6")
    c.store = DeviceStore(base_dir=tmp, mac="00:16:3e:7a:11:c6")
    return c


def _fake_get(body):
    resp = mock.Mock()
    resp.content = body
    resp.raise_for_status = mock.Mock()
    return mock.Mock(return_value=resp)


def test_sealed_pack_is_stored_as_ciphertext_with_a_wrapped_key():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        nonce_w = os.urandom(8)
        wrapped = client_crypto.wrap_pack_key(c.store.secret(), K, nonce_w)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "story01", "skill_name": "Jungle", "version": 2,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}],
            "images": [{"index": 1, "url": "https://cdn/a.bin"}],
            "encryption": {"v": 2, "key": wrapped.hex(), "nonce": nonce_w.hex()},
        }
        with mock.patch("client.requests.get", _fake_get(client_crypto.seal(MP3, K))):
            result = c.download_card_content(payload)

        assert result["sealed"] is True
        skill = c.store.skill_dir("story01")
        on_disk = open(os.path.join(skill, "audio", "01.mp3"), "rb").read()
        assert client_crypto.parse_header(on_disk) is not None      # stored sealed
        assert client_crypto.unseal(on_disk, K) == MP3

        manifest = json.load(open(os.path.join(skill, "manifest.jsn")))
        assert manifest["enc"] == {"v": 2, "key": wrapped.hex(), "nonce": nonce_w.hex()}
        assert K.hex() not in json.dumps(manifest)                  # plain key never on disk
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_plaintext_pack_still_downloads_and_has_no_enc_block():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "old01", "skill_name": "Legacy", "version": 1,
            "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": [],
        }
        with mock.patch("client.requests.get", _fake_get(MP3)):
            result = c.download_card_content(payload)
        assert result["sealed"] is False
        manifest = json.load(open(os.path.join(c.store.skill_dir("old01"), "manifest.jsn")))
        assert "enc" not in manifest
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_grouped_stories_land_in_s01_directories():
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {
            "type": "card_content", "rfid_uid": "AABBCCDD",
            "skill_id": "grp01", "skill_name": "Stories", "version": 1,
            "stories": [{"index": 1, "title": "One",
                         "audio": [{"index": 1, "url": "https://cdn/a.mp3"}],
                         "images": [{"index": 1, "url": "https://cdn/a.bin"}]}],
        }
        with mock.patch("client.requests.get", _fake_get(MP3)):
            c.download_card_content(payload)
        skill = c.store.skill_dir("grp01")
        assert os.path.exists(os.path.join(skill, "s01", "audio", "01.mp3"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_manifest_is_written_last():
    """It is the completion marker. A pack whose manifest exists but whose audio
    does not would be treated as downloaded and would play silence."""
    tmp = tempfile.mkdtemp()
    try:
        c = _client(tmp)
        payload = {"type": "card_content", "rfid_uid": "A", "skill_id": "fail01",
                   "skill_name": "X", "version": 1,
                   "audio": [{"index": 1, "url": "https://cdn/a.mp3"}], "images": []}
        with mock.patch("client.requests.get", side_effect=Exception("network down")):
            try:
                c.download_card_content(payload)
            except Exception:
                pass
        assert not os.path.exists(os.path.join(c.store.skill_dir("fail01"), "manifest.jsn"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python test_client_pack_download.py`
Expected: FAIL, `AttributeError: 'TestClient' object has no attribute 'download_card_content'`

- [ ] **Step 3: Implement `download_card_content`**

Add to `TestClient`:

```python
    def download_card_content(self, card_content: Dict) -> Dict:
        """Mimic ContentManager::HandleServerResponse for a card_content payload.

        Files are stored EXACTLY as the CDN serves them — sealed stays sealed.
        Decryption happens at playback (see play_skill), which is what the toy
        does and what keeps a copied card useless.
        """
        skill_id = (card_content.get("skill_id") or "").lower()
        if not skill_id:
            raise ValueError("card_content has no skill_id")
        skill_dir = self.store.skill_dir(skill_id)

        enc = card_content.get("encryption") or None
        if enc and not (enc.get("v") == 2 and len(enc.get("key", "")) == 32
                        and len(enc.get("nonce", "")) == 16):
            logger.warning("[PACK] encryption block malformed; treating pack as plaintext")
            enc = None

        written = []

        def fetch(url, dest):
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            with open(dest, "wb") as fh:
                fh.write(resp.content)
            written.append(dest)
            state = "sealed" if client_crypto.parse_header(resp.content) else "plaintext"
            logger.info("[PACK] %s -> %s (%d bytes, %s)", url, dest, len(resp.content), state)

        stories = card_content.get("stories") or []
        if stories:
            for story in stories:
                group = os.path.join(skill_dir, "s%02d" % int(story.get("index", 1)))
                for item in story.get("audio", []):
                    fetch(item["url"], os.path.join(group, "audio", "%02d.mp3" % int(item["index"])))
                for item in story.get("images", []):
                    fetch(item["url"], os.path.join(group, "images", "%02d.bin" % int(item["index"])))
        else:
            for item in card_content.get("audio", []):
                fetch(item["url"], os.path.join(skill_dir, "audio", "%02d.mp3" % int(item["index"])))
            for item in card_content.get("images", []):
                fetch(item["url"], os.path.join(skill_dir, "images", "%02d.bin" % int(item["index"])))

        # manifest.jsn LAST — it is the completion marker, same as the firmware.
        manifest = {
            "skill_id": skill_id,
            "skill_name": card_content.get("skill_name") or skill_id,
            "version": card_content.get("version") or 1,
            "content_hash": card_content.get("latest_content_hash") or "",
            "content_type": card_content.get("content_type") or "",
        }
        if enc:
            # The WRAPPED key. Unwrapping needs the NVS secret, so this file on
            # its own gets an attacker nothing.
            manifest["enc"] = {"v": 2, "key": enc["key"], "nonce": enc["nonce"]}
        with open(os.path.join(skill_dir, "manifest.jsn"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)

        logger.info("[PACK] skill '%s' ready: %d files, %s", skill_id, len(written),
                    "sealed" if enc else "plaintext")
        return {"skill_id": skill_id, "files": written, "sealed": bool(enc)}
```

with `import client_crypto` at the top of `client.py`.

Route it from `on_mqtt_message`, in the `else:` branch before `mqtt_message_queue.put(payload)`:

```python
            elif payload.get("type") == "card_content" and self.auto_download_packs:
                try:
                    self.download_card_content(payload)
                except Exception as exc:
                    logger.error("[PACK] download failed: %s", exc)
                mqtt_message_queue.put(payload)
```

and `self.auto_download_packs = False` in `__init__`, set True by `run_rfid_test` when the new `--download-pack` flag is passed. Keep the payload going onto the queue either way, so `send_rfid_card_lookup` still returns it.

- [ ] **Step 4: Run the tests**

Run: `python test_client_pack_download.py`
Expected: four OK lines.

- [ ] **Step 5: Commit**

```bash
git add client.py test_client_pack_download.py
git commit -m "feat(client): download card_content to the SD mimic, storing the key wrapped"
```

---

### Task 13: Play a sealed pack, decrypting chunk by chunk

**Files:**
- Modify: `client.py` (new `skill_key`, `read_skill_file`, `play_skill` methods; `run_rfid_test` wiring; `__main__` flags)
- Test: `test_client_playback.py`

**Interfaces:**
- Consumes: everything from Tasks 10 to 12
- Produces:
  - `TestClient.skill_key(skill_id) -> bytes | None` – reads `manifest.jsn`, unwraps with the NVS secret, None for plaintext packs, raises nothing
  - `TestClient.read_skill_file(path, key) -> bytes` – streams in 2048-byte chunks like the firmware's `READ_BUF_SIZE`, decrypting in place; raises `RuntimeError` for a sealed file with no key
  - `TestClient.play_skill(skill_id, decode_check=True) -> dict` – reads every file, checks the MP3 or LVGL magic, returns `{'played': n, 'failed': n}`

- [ ] **Step 1: Write the failing test**

```python
"""Playback from the SD mimic: the chunked decrypt the toy does, and the two
failure modes that must never be silent.
"""
import json
import os
import shutil
import tempfile

import client_crypto
from client_storage import DeviceStore

K = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(range(256)) * 30   # > one 2048 chunk
LVGL = b"\x19\x12\x00\x00" + b"\x28\x01\xf0\x00" + b"\x50\x02\x00\x00" + b"\x00" * 500


def _client_with_pack(tmp, sealed=True, wrong_secret=False):
    from client import TestClient
    c = TestClient(device_mac="00:16:3e:7a:11:c6")
    c.store = DeviceStore(base_dir=tmp, mac="00:16:3e:7a:11:c6")
    skill = c.store.skill_dir("story01")
    os.makedirs(os.path.join(skill, "audio"), exist_ok=True)
    os.makedirs(os.path.join(skill, "images"), exist_ok=True)

    manifest = {"skill_id": "story01", "skill_name": "Jungle", "version": 2}
    if sealed:
        nonce_w = os.urandom(8)
        secret = os.urandom(32) if wrong_secret else c.store.secret()
        wrapped = client_crypto.wrap_pack_key(secret, K, nonce_w)
        manifest["enc"] = {"v": 2, "key": wrapped.hex(), "nonce": nonce_w.hex()}
        audio, image = client_crypto.seal(MP3, K), client_crypto.seal(LVGL, K)
    else:
        audio, image = MP3, LVGL

    open(os.path.join(skill, "audio", "01.mp3"), "wb").write(audio)
    open(os.path.join(skill, "images", "01.bin"), "wb").write(image)
    json.dump(manifest, open(os.path.join(skill, "manifest.jsn"), "w"))
    return c


def test_sealed_pack_decrypts_to_a_valid_mp3_across_chunk_boundaries():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        key = c.skill_key("story01")
        assert key == K
        data = c.read_skill_file(os.path.join(c.store.skill_dir("story01"), "audio", "01.mp3"), key)
        assert data == MP3
        assert data[:3] == b"ID3"
        result = c.play_skill("story01")
        assert result == {"played": 2, "failed": 0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_plaintext_pack_plays_with_no_key():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp, sealed=False)
        assert c.skill_key("story01") is None
        assert c.play_skill("story01") == {"played": 2, "failed": 0}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_wrong_secret_fails_loudly_and_never_returns_ciphertext():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp, wrong_secret=True)
        result = c.play_skill("story01")
        assert result["played"] == 0 and result["failed"] == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_sealed_file_with_no_key_raises_rather_than_returning_ciphertext():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        path = os.path.join(c.store.skill_dir("story01"), "audio", "01.mp3")
        try:
            c.read_skill_file(path, None)
            assert False, "expected RuntimeError"
        except RuntimeError as exc:
            assert "sealed" in str(exc).lower()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_rotating_the_secret_kills_the_pack_the_way_an_nvs_erase_would():
    tmp = tempfile.mkdtemp()
    try:
        c = _client_with_pack(tmp)
        assert c.play_skill("story01")["played"] == 2
        c.store.rotate_secret()
        assert c.play_skill("story01")["failed"] == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"{name}: OK")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python test_client_playback.py`
Expected: FAIL, `AttributeError: ... 'skill_key'`

- [ ] **Step 3: Implement**

```python
    def skill_key(self, skill_id: str):
        """Unwrap this skill's pack key with the NVS secret. None = plaintext pack.

        Mimics ContentManager::GetSkillKey. The key exists only for the duration
        of playback; nothing caches it and nothing writes it down.
        """
        manifest_path = os.path.join(self.store.skill_dir(skill_id), "manifest.jsn")
        try:
            with open(manifest_path, "r", encoding="utf-8") as fh:
                manifest = json.load(fh)
        except (FileNotFoundError, ValueError):
            logger.warning("[PLAY] skill '%s' has no readable manifest.jsn", skill_id)
            return None

        enc = manifest.get("enc")
        if not enc:
            return None
        try:
            return client_crypto.unwrap_pack_key(
                self.store.secret(),
                bytes.fromhex(enc["key"]),
                bytes.fromhex(enc["nonce"]),
            )
        except (KeyError, ValueError) as exc:
            logger.error("[PLAY] skill '%s': malformed enc block: %s", skill_id, exc)
            return None

    def read_skill_file(self, path: str, key) -> bytes:
        """Read a pack file, decrypting in 2048-byte chunks like the firmware.

        READ_BUF_SIZE on the toy is 2048 and those boundaries are not 16-byte
        aligned, so this is the case worth exercising here rather than on device.
        """
        CHUNK = 2048
        with open(path, "rb") as fh:
            head = fh.read(client_crypto.HEADER_BYTES)
            parsed = client_crypto.parse_header(head)
            if parsed is None:
                # Legacy plaintext file: rewind and read as-is.
                fh.seek(0)
                return fh.read()

            version, nonce = parsed
            if key is None:
                raise RuntimeError(f"sealed file with no key: {path}")
            if version != 2:
                raise RuntimeError(f"unsupported seal version {version}: {path}")

            dec = client_crypto.decrypt_stream(key, nonce)
            out = bytearray()
            while True:
                chunk = fh.read(CHUNK)
                if not chunk:
                    break
                out += dec.update(chunk)
            return bytes(out)

    def play_skill(self, skill_id: str, decode_check: bool = True) -> Dict:
        """Read every file of a downloaded skill and check it decodes.

        Stands in for the MP3 decoder and the LVGL image loader. A file that
        fails is counted and logged, never handed onward as audio — playing
        ciphertext is the one outcome the firmware must also refuse.
        """
        key = self.skill_key(skill_id)
        skill_dir = self.store.skill_dir(skill_id)
        played = failed = 0

        for root, _dirs, files in os.walk(skill_dir):
            for name in sorted(files):
                if name == "manifest.jsn":
                    continue
                path = os.path.join(root, name)
                try:
                    data = self.read_skill_file(path, key)
                except Exception as exc:
                    logger.error("[PLAY] %s: %s", path, exc)
                    failed += 1
                    continue

                if decode_check:
                    ok = (data[:3] == b"ID3" or data[:2] == b"\xff\xfb") if name.endswith(".mp3") \
                        else (data[:1] == b"\x19") if name.endswith(".bin") else True
                    if not ok:
                        logger.error("[PLAY] %s decrypted to garbage — wrong key. "
                                     "Refusing to play. First bytes: %s", path, data[:8].hex())
                        failed += 1
                        continue

                logger.info("[PLAY] %s OK (%d bytes)", path, len(data))
                played += 1

        logger.info("[PLAY] skill '%s': %d played, %d failed, key=%s",
                    skill_id, played, failed, "unwrapped" if key else "none (plaintext)")
        return {"played": played, "failed": failed}
```

- [ ] **Step 4: Wire the end-to-end flow into `run_rfid_test`**

Add two parameters `download_pack: bool = False, play_pack: bool = False` and, after the lookup response is logged:

```python
        if download_pack and lookup_response and lookup_response.get("type") == "card_content":
            try:
                result = self.download_card_content(lookup_response)
                logger.info("[RFID-TEST] downloaded %d files (sealed=%s)",
                            len(result["files"]), result["sealed"])
                if play_pack:
                    stats = self.play_skill(result["skill_id"])
                    if stats["failed"]:
                        logger.error("[RFID-TEST] %d file(s) failed to decrypt", stats["failed"])
            except Exception as exc:
                logger.error("[RFID-TEST] pack download failed: %s", exc)
        elif download_pack:
            logger.warning("[RFID-TEST] lookup did not return card_content; nothing to download")
```

Add the flags in `__main__` and pass them through:

```python
    parser.add_argument("--download-pack", action="store_true",
                        help="rfid mode: download the card's files into the SD mimic.")
    parser.add_argument("--play-pack", action="store_true",
                        help="rfid mode: decrypt and verify every downloaded file. Implies --download-pack.")
```

```python
                download_pack=args.download_pack or args.play_pack,
                play_pack=args.play_pack,
```

- [ ] **Step 5: Run the tests**

Run: `python test_client_playback.py`
Expected: five OK lines.

Then all three client test files:

```bash
python test_client_crypto.py && python test_client_storage.py && python test_client_pack_download.py && python test_client_playback.py
```

- [ ] **Step 6: Commit**

```bash
git add client.py test_client_playback.py
git commit -m "feat(client): unwrap the pack key and decrypt sealed files at playback"
```

---

### Task 14: End-to-end run against real services

**Files:**
- Create: `docs/superpowers/plans/2026-09-09-sd-content-encryption-e2e-log.md` (the evidence)
- Modify: `client.py` only if a step below exposes a defect

No unit tests here. This is the run that proves the eight preceding tasks work together against a real API, a real gateway and real S3.

**Preconditions:** API running with `CONTENT_MASTER_KEY` set, gateway running with Task 9 merged, a device row for the client's MAC, and one content pack whose files were uploaded after sealing was switched on.

- [ ] **Step 1: Register the secret**

```bash
python client.py --mode rfid --rfid-uid <UID> --register-secret
```

Record: HTTP status, and the SQL result of `SELECT content_secret IS NOT NULL FROM ai_device WHERE mac_address='00:16:3E:7A:11:C6'`.

- [ ] **Step 2: Tap, download, play**

```bash
python client.py --mode rfid --rfid-uid <UID> --play-pack
```

Record from the log:
- the `card_content` payload contains an `encryption` block with `v: 2`
- each `[PACK]` line says `sealed`
- `[PLAY] skill ... N played, 0 failed, key=unwrapped`

- [ ] **Step 3: Prove the card alone is useless**

```bash
python - <<'PY'
import glob
p = glob.glob('client_state/sdcard/cheeko/skills/*/audio/01.mp3')[0]
head = open(p, 'rb').read(16)
print(p, head[:4], 'sealed' if head[:4] == b'CKE1' else 'PLAINTEXT — FAIL')
PY
```

Expected: `b'CKE1'`. If it says PLAINTEXT the server is not sealing; stop and check `CONTENT_MASTER_KEY` and whether the pack's files predate the backfill.

Also fetch one of the CDN URLs from the log directly and confirm the bytes start with `CKE1` rather than `ID3`.

- [ ] **Step 4: Prove another device cannot use a copied card**

```bash
python client.py --mode rfid --rfid-uid <UID> --device-mac 00:16:3e:7a:11:c9 --register-secret --play-pack
```

Then copy the first client's `client_state/sdcard` over the second's and run `--play-pack` again without re-downloading. Expected: `failed` equal to the file count, and the `decrypted to garbage — wrong key` log line. This is the whole point of version 2; if it plays, the wrap is not per-device and the plan has a bug.

- [ ] **Step 5: Prove offline playback works**

Stop the API and the gateway. Run:

```bash
python client.py --mode rfid --rfid-uid <UID> --play-pack
```

The lookup will time out. Expected: the `[PLAY]` lines still report the previously downloaded pack as played, because the secret is in the NVS mimic and the wrapped key is on the card. If playback needs the network, the key is being fetched at the wrong time.

- [ ] **Step 6: Prove a legacy pack still works**

Tap a UID whose pack was never re-sealed. Expected: `[PACK] ... plaintext`, no `enc` in `manifest.jsn`, `key=none (plaintext)`, all files played.

- [ ] **Step 7: Write the evidence file and commit**

Record each step's command, the relevant log lines, and pass or fail. Anything that failed goes in with what was done about it.

```bash
git add docs/superpowers/plans/2026-09-09-sd-content-encryption-e2e-log.md client.py
git commit -m "test(client): end-to-end evidence for sealed pack download and playback"
```

---

## Part D: manager-web dashboard

All commands run from `D:\cheeko-backend\main\manager-web`.

### Task 15: Preview through the proxy, and send `packCode` on upload

**Files:**
- Modify: `src/apis/module/rfid.js` (add `previewAudioObjectUrl`)
- Modify: `src/components/RfidContentPackDialog.vue:626-661` (`uploadOne`), `:840-862` (play/stop)
- Modify: `src/views/RfidManagement.vue:1768-1789` (`togglePreviewAudio` / `stopPreviewAudio`)

**Interfaces:**
- Consumes: `GET /admin/rfid/content-pack/preview` (Task 7); upload route reading `packCode` (Task 3)
- Produces: `previewAudioObjectUrl(url, packCode): Promise<string>` returning a blob URL

- [ ] **Step 1: API helper**

Append to `src/apis/module/rfid.js`:

```js
/**
 * Sealed pack audio cannot be handed to <audio> directly (spec §8). Fetch it
 * through the admin-only decrypt proxy with the bearer token and play a blob.
 * The caller revokes the returned URL when playback stops.
 */
export async function previewAudioObjectUrl(url, packCode) {
    const stored = localStorage.getItem('token');
    let token = stored;
    try { token = JSON.parse(stored).token || stored; } catch (e) { /* plain token */ }
    const q = `url=${encodeURIComponent(url)}&packCode=${encodeURIComponent(packCode || '')}`;
    const res = await fetch(`${getServiceUrl()}/admin/rfid/content-pack/preview?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`preview ${res.status}`);
    return URL.createObjectURL(await res.blob());
}
```

Note the token parsing copies `getAuthToken()` from the dialog at line 587. Do not import the dialog into the API module.

- [ ] **Step 2: Dialog**

`RfidContentPackDialog.vue`, in `uploadOne` after `formData.append('category', category);`:

```js
      if (this.form.packCode) {
        formData.append('packCode', this.form.packCode);
      }
```

The pack row must exist before item files upload, or the server has no row to hang the key on. In the dialog's save flow, if `!this.form.id` and there are pending item uploads, create the pack first (`POST /content-pack` with `packCode` and `name`), then upload. If the dialog already orders it that way, leave it.

Replace the play branch at 845-855:

```js
        this.stopAudio();
        try {
          const objectUrl = await previewAudioObjectUrl(url, this.form.packCode);
          this.currentObjectUrl = objectUrl;
          this.currentAudio = new Audio(objectUrl);
          this.currentAudio.onended = () => { this.playingUrl = null; };
          await this.currentAudio.play();
          this.playingUrl = url;
        } catch (err) {
          console.error('Audio preview failed', err);
          this.$message.error('Could not play audio');
          this.playingUrl = null;
        }
```

Make the enclosing method `async`. In `stopAudio()`:

```js
        if (this.currentObjectUrl) {
            URL.revokeObjectURL(this.currentObjectUrl);
            this.currentObjectUrl = null;
        }
```

Add `currentObjectUrl: null` to `data()` and `import { previewAudioObjectUrl } from '@/apis/module/rfid';`.

- [ ] **Step 3: Lookup and Test panel**

`RfidManagement.vue` `togglePreviewAudio` becomes:

```js
        async togglePreviewAudio(url) {
            if (this.playingUrl === url) {
                this.stopPreviewAudio();
                return;
            }
            this.stopPreviewAudio();
            try {
                const packCode = (this.consoleLookupResult && this.consoleLookupResult.data && this.consoleLookupResult.data.packCode) || '';
                this._previewObjectUrl = await previewAudioObjectUrl(url, packCode);
                this._previewAudio = new Audio(this._previewObjectUrl);
                this._previewAudio.addEventListener('ended', () => { this.playingUrl = null; });
                await this._previewAudio.play();
                this.playingUrl = url;
            } catch (e) {
                this.$message.error('Could not play this audio');
                this.playingUrl = null;
            }
        },
```

and `stopPreviewAudio` revokes `this._previewObjectUrl` the same way. Import the helper.

- [ ] **Step 4: Verify in the browser**

Run: `npm run serve` with the API running with `CONTENT_MASTER_KEY` set.

1. Create a pack, upload an MP3 to an item, press play in the dialog: audio plays. Network tab shows one request to `/admin/rfid/content-pack/preview` with status 200 and `audio/mpeg`.
2. Open a legacy pack, press play: preview request answers 302 and audio plays.
3. Lookup and Test: enter a UID bound to the sealed pack, press play on a track: plays.
4. Paste the CloudFront URL of the sealed file into a new tab: the browser downloads or fails to play. That is expected.

- [ ] **Step 5: Commit**

```bash
git add src/apis/module/rfid.js src/components/RfidContentPackDialog.vue src/views/RfidManagement.vue
git commit -m "feat(dashboard): preview sealed pack audio through the decrypt proxy; send packCode on upload"
```

---

## Part E: rollout

### Task 16: Production rollout checklist

No code. Ordered, each step gated on the previous.

- [ ] **Step 1: Firmware first — NOT part of this plan.** Sealing must not be switched on in production until firmware that understands `CKE1` has reached the fleet; old firmware would feed ciphertext to its decoder. This plan proves the server, gateway and format with `client.py` and stops there. Track fleet adoption with `SELECT client_version, COUNT(*) FROM rfid_card_tap_log WHERE created_at > now() - interval '7 days' GROUP BY 1`. Until that firmware ships, run steps 3 to 5 on staging only.
- [ ] **Step 2: Migrate the database.** `npx prisma migrate deploy` on staging, then production. Metadata-only, no table rewrite.
- [ ] **Step 3: Set `CONTENT_MASTER_KEY`** in staging, restart, run `npm test` and the dashboard checks from Task 15 step 4 against staging. Then production. Back the key up in the secrets manager before the first sealed upload; losing it loses every pack key.
- [ ] **Step 4: Confirm registration.** `SELECT COUNT(*) FROM ai_device WHERE content_secret IS NOT NULL` climbs as toys make their next OTA check. Toys that have not checked in yet get plaintext responses, by design.
- [ ] **Step 5: Backfill.** `npm run backfill:seal-content:dry`, review the tally, then `npm run backfill:seal-content`. Old objects stay in S3 for a rollback window; delete them by hand after two weeks.
- [ ] **Step 6: Flash encryption.** Separate project. Enable `CONFIG_SECURE_FLASH_ENC_ENABLED` in development mode on bench units first, then decide release mode with the production line. Until this lands, S is readable off a dumped chip and the scheme stops casual copying only.

---

## Self-review

**Spec coverage.** §3 file format: Task 1 and Task 10 (client). §4 sealing on upload: Tasks 3 and 4. §6 keys, schema, delivery, gateway, client NVS mimic, unwrap, secret rotation: Tasks 2, 5, 6, 9, 11, 13. §7 offline playback: Task 13 keeps playback local and Task 14 step 5 proves it offline; Task 13's rotate test covers a changed secret. §8 preview: Tasks 7 and 15. §9 rollout and backfill: Tasks 8 and 16. §10 tests: every task carries one, and the shared vector links Task 1 and Task 10 (client). Loud failures: Task 13's `play_skill` refuses garbage and the wrong-secret test pins it. Firmware-side decryption is deferred with the rest of the firmware work.

**Placeholder scan.** The one deliberate blank is `EXPECTED_HEX` in Task 11, which Task 1 step 4 produces; the plan says exactly where it comes from. Task 16 step 1 has a fill-in for the adoption threshold, which is a decision, not code.

**Type consistency.** `seal(plain, key, version, nonce)` in Task 1 is called as `seal(buffer, sealKey)` in Tasks 3, 4, 8. `wrapKeyForDevice` returns `{key, nonce}` hex, consumed by Task 6 as `{ v: 2, ...wrapKeyForDevice() }`, forwarded by Task 9, parsed by Task 12 as `v`, `key` (32 hex), `nonce` (16 hex). Python `unwrap_pack_key(secret, wrapped, nonce_w)` in Task 10 is the inverse of Node `wrapKeyForDevice`, and Task 10's last test asserts that directly. `DeviceStore` from Task 11 is used in Tasks 12, 13, 14. `skill_key` / `read_skill_file` / `play_skill` from Task 13 are used only within Tasks 13 and 14. `contentKeys` exports `isEnabled`, `getPackKey`, `getOrCreatePackKey`, `getCharacterKey`, `getOrCreateCharacterKey`, `registerDeviceSecret`, `getDeviceSecret`; Task 6's test mocks `getCharacterKey`, which Task 4 adds.

**Known gaps to decide before execution.**
- Task 4's character-art call site and the custom-card service function names are located by grep at execution time rather than pinned here, because they were added in the last two commits and their exact names were not verified.
- `client.py` currently has no test suite and no test runner configured. The four new test files are plain-`python` runnable via their `__main__` block, so no pytest dependency is added. If the repo later grows a Python CI job, wire them in there.
- Character sprites are sealed on the server (Task 4) but `client.py` never downloads character art, so that path is proven only by the API unit test until firmware work resumes.
