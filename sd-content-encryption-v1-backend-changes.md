# SD content encryption — backend changes to move from v2 to v1

**For:** the backend developer who built `feat/sd-content-encryption`
**From:** firmware side, 2026-09-12
**Decision:** we are shipping **version 1** (one shared wrap secret), not version 2
(per-device secret). Reasons in §1.

**State of play.** Your work is already merged into `origin/main`
(`e137a114 Merge branch 'feat/sd-content-encryption' into main`). Everything below is
against `origin/main`, not the feature branch.

**The good news first.** The file format, the AES mode, the wrap derivation, the
`encryption` payload shape, the gateway forwarding and the preview proxy are all
**already correct for v1**. Your own doc says it: *"the file format is identical and the
header's version byte selects the key path."* The change is genuinely small — five
edits, one of which is a single character.

---

## 1. Why v1, and what it gives up

Settled 2026-09-10 at a scale of ~100 customers.

**What v1 stops:** a parent pulling the SD card, copying the folder, and sharing it.
That is the piracy that actually happens.

**What v1 gives up, knowingly:** a copied card **will** play in another Cheeko.

**Why we are not paying for v2 yet:**

- Without flash encryption, the secret is readable off any unit either way. Your §11
  says exactly this — *"version 2 is version 1 with more moving parts"* — and we ruled
  flash encryption out at this volume: it burns eFuses irreversibly and ends USB
  flashing on production stock.
- v2 means a toy must reach the server **once** before any purchased pack plays. An NVS
  erase kills every card until re-registration. A replacement mainboard is a new MAC
  with no secret.
- That last one has no safe landing today. `encryptionFieldFor` returns `undefined`
  for an unknown device, which reads as "send the pack unencrypted" — but the S3 object
  is sealed and there is no plaintext copy. The toy gets sealed files and no key. Your
  firmware guide §9 admits this; the design doc §6 still describes it as a graceful
  fallback. **v1 removes this failure mode entirely**, because the key no longer
  depends on the device being known.

The trigger to revisit: if the shared secret leaks, or the first time content is found
posted publicly. Moving to v2 later **re-encrypts nothing** — only the version byte and
the source of the wrap secret change.

---

## 2. What does NOT change

Do not touch any of this. It is already right.

| Area | Status |
|---|---|
| `CKE1` header, AES-128-CTR, counter = `nonce(8) \|\| counter(8, BE, from 0)`, no padding | ✅ correct |
| `wrap_key = HMAC-SHA256(secret, "cheeko-wrap-v1")[0:16]`, `wrapped = AES-128-CTR(wrap_key, nonce_w, K)` | ✅ correct |
| Per-pack K, `rfid_content_pack.content_key`, AES-256-GCM at rest under `CONTENT_MASTER_KEY` | ✅ correct — keep it |
| `encryption: { v, key, nonce }` on `card_content` | ✅ correct shape |
| Gateway forwarding — `mqtt-gateway.js:213`, `:1192`, `:1236`, `:1303`, `:2118`, `:2148` | ✅ all paths covered, including the no-session one |
| Preview proxy (`getPackKey(packCode)`, server-side) | ✅ unaffected — never used the device secret |
| Character art plaintext (`upload.service.js:551`) | ✅ matches our scope decision |
| Custom-card recordings plaintext (`c6df0539`) | ✅ |
| Game assets plaintext (`8da1d92e`) | ✅ |
| `scripts/backfill-seal-content.js` | ✅ picks up the version change for free |

Character art being left plaintext is worth calling out: you landed on the same answer
we did, independently. Firmware treats `chars/` as plaintext and has no decryption on
that path, so keep it that way.

---

## 3. The five changes

### 3.1 `src/utils/contentCrypto.js` — one character

```js
function seal(plain, key, version = 2, nonce = crypto.randomBytes(8)) {
                                ^ change to 1
```

That is the whole crypto change. Nothing else in this file moves.

`wrapKeyForDevice(secret, packKey)` is already pure — it takes the secret as a
parameter. In v1 you pass the shared secret instead of the device's. **No edit needed
here**, only at the call site. Renaming it to `wrapPackKey` is optional and cosmetic.

### 3.2 `src/services/contentKeys.service.js` — add the shared secret

```js
const getWrapSecret = () => {
  const hex = process.env.CONTENT_WRAP_SECRET || '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
};
```

Export it. `registerDeviceSecret` and `getDeviceSecret` become unused — leave them
dormant or delete them, your call. Nothing on the device will call them any more.

### 3.3 `src/services/rfid.service.js` — `encryptionFieldFor` (~line 778)

**This is the important one.**

```js
const encryptionFieldFor = async (packCode) => {
  if (!contentKeys.isEnabled()) return undefined;
  try {
    const wrapSecret = contentKeys.getWrapSecret();
    const packKey = await contentKeys.getPackKey(packCode);
    if (!packKey || !wrapSecret) return undefined;
    return { v: 1, ...wrapKeyForDevice(wrapSecret, packKey) };
  } catch (err) {
    logger.warn(`[RFID-LOOKUP] key wrap failed for pack=${packCode}: ${err.message}`);
    return undefined;
  }
};
```

Three things changed:

1. **`mac` is gone, including the `if (!mac)` gate.** This is the whole point of v1 —
   an unknown device, a swapped mainboard and a first-ever tap all get a working key.
2. **`getDeviceSecret` is gone.** One fewer database read per tap.
3. **`v: 1`.**

Update the three call sites — `:889`, `:914`, `:3743` — to drop the `mac` argument.
(Leaving `mac` in the signature and ignoring it also works; just make sure the
`if (!mac)` gate goes, or nothing will ever be encrypted.)

**Worth doing while you are in here:** the wrapped blob is now identical for every
device, so it can be computed once per pack and cached rather than per request.

### 3.4 `src/services/device.service.js:908` — OTA registration

The firmware will not send `content_secret` any more. The `registerDeviceSecret` call
becomes dead code — it already no-ops on a missing field, so it is harmless to leave.
Remove it if you prefer a clean path.

`ai_device.content_secret` becomes an unused column. Leave the migration alone; dropping
it buys nothing and the rollback is worse.

### 3.5 Environment

| Var | Purpose | Change |
|---|---|---|
| `CONTENT_WRAP_SECRET` | **New.** 64 hex chars (32 bytes). The shared secret. | Add |
| `CONTENT_MASTER_KEY` | Protects `content_key` at rest in Postgres | Keep as is |

**`CONTENT_WRAP_SECRET` must be byte-identical to the firmware build.** On our side it
is a build-time constant (`CONFIG_CHEEKO_CONTENT_WRAP_SECRET_HEX`). If the two differ,
every unwrap produces garbage and every sealed pack fails to play. There is no error
that tells you they differ — CTR has no integrity check. See §6.

---

## 4. Re-seal the test packs

`ENCTEST-20260909-1046` (id 72) is sealed with **version byte 2**. v1 firmware will
refuse it — correctly, and loudly.

After the `seal()` default changes, either re-run the backfill against that pack or
create a fresh test pack. `ENCTEST-LEGACY-20260909-1046` (id 73, plaintext) needs
nothing.

Nothing in production is affected: `CONTENT_MASTER_KEY` is not set there yet.

---

## 5. Tests to update

| File | Change |
|---|---|
| `tests/unit/contentCrypto.test.js` | Version byte 2 → 1 |
| `tests/unit/upload.seal.test.js` | Version byte 2 → 1 |
| `tests/unit/rfid.lookup-encryption.test.js` | No `mac`, expect `v: 1`, expect a key for an unknown device |
| `tests/unit/device.content-secret.test.js` | Obsolete — delete or repoint |
| `tests/unit/contentKeys.service.test.js` | Drop device-secret cases, add `getWrapSecret` |
| `main/mqtt-gateway/tests/card-content-encryption.test.js` | Should pass unchanged |

Add one case that did not exist in v2 and matters now: **an unknown MAC still gets an
`encryption` block.** That is the regression that would silently undo the main benefit
of v1.

---

## 6. Shared test vectors

Assert these literally on both sides. They are the only thing that will catch a
mismatched secret or a wrong version byte before hardware does.

**Sealed file.** The version byte is not part of the CTR input, so the ciphertext is
byte-identical to your v2 vector — only byte 4 changes.

```
K         = 000102030405060708090a0b0c0d0e0f
nonce     = 1011121314151617
plaintext = "cheeko content encryption test!!"   (32 ASCII bytes)

sealed    = 434b4531 01 000000 1011121314151617
            ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a
                     ^^ 01, not 02
```

**Wrap.** Unchanged from your v2 vector — the maths does not care whether the secret is
per-device or shared.

```
wrap_secret = a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf
nonce_w     = 0909090909090909
K           = 000102030405060708090a0b0c0d0e0f

wrap_key    = 94e5bea4747beb214b0cb91b3f8825d3
wrapped K   = 99cf47ac63e20dd29d679e9854465f87
```

Firmware asserts both in its host test. If your Jest test asserts the same bytes, the
two implementations are pinned to each other.

---

## 7. Handing over the secret

The one operational question v1 creates: **how does the 32-byte secret get from the
firmware build to the server environment?**

Not Slack, not email, not a commit. Whatever your secrets process is — the same place
`CONTENT_MASTER_KEY` lives — is the right home. Generate it once, and treat changing it
as a breaking change: a new secret means re-encrypting all content **and** an OTA to
every device.

---

## 8. Rollout order — this part is not optional

1. **Firmware ships first.** It understands `CKE1` and plays plaintext exactly as
   before, so it is safe to release before anything is sealed.
2. **Wait for fleet adoption.** `rfid_card_tap_log.client_version` already records it.
3. **Then** set `CONTENT_WRAP_SECRET` and `CONTENT_MASTER_KEY` in production. New
   uploads seal from that moment.
4. **Then** backfill existing packs.

Turning the key on before step 2 makes every newly uploaded pack unplayable on older
firmware, with no plaintext copy to fall back to.

---

## 9. One thing you could not have known

Your firmware guide §6 Task 5 relies on `ContentFileAlreadyDownloaded` skipping existing
files, so recovery costs *"one lookup, not a re-download"*.

We have a branch in flight that downloads into `<id>.NEW` staging folders and promotes
only on completion — which changes that. It does not affect v1 (there is no rotation
recovery in v1, because the secret never changes), but it is worth knowing if v2 is ever
revisited.

Separately: you flagged that a version bump never re-fetches existing files. You are
right, it is a real bug, and the staged-download branch is the fix. **It must land
before any re-encryption backfill**, or migrated packs will show as updated while still
holding plaintext bytes behind a new manifest.

---

## 10. Summary

| # | File | Change | Size |
|---|---|---|---|
| 1 | `src/utils/contentCrypto.js` | `version = 2` → `1` | 1 char |
| 2 | `src/services/contentKeys.service.js` | Add `getWrapSecret()` | ~5 lines |
| 3 | `src/services/rfid.service.js` | `encryptionFieldFor`: drop `mac`, drop the `!mac` gate, `v: 1` | ~10 lines + 3 call sites |
| 4 | `src/services/device.service.js` | OTA `content_secret` becomes dead code | optional |
| 5 | env | Add `CONTENT_WRAP_SECRET` | config |

Plus: re-seal test pack 72, update six test files, add the unknown-MAC case.

Everything else you built — the format, the wrap, the at-rest encryption, the gateway,
the preview proxy, the backfill script, the plaintext carve-outs for character art,
custom cards and game assets — is used as is.
