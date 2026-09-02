# Editing one custom-card recording — what was built

Implements `docs/custom-card-item-edit-backend-spec.md` (CheekoAI-Parent-App).
This file records what the endpoint does, and the three places the
implementation deliberately departs from the spec because the spec was written
against a picture of this backend that did not match it.

---

## The endpoint

```
PATCH /toy/api/mobile/kids/{kidId}/custom-card/content/{itemNumber}
Content-Type: multipart/form-data
```

| Part | Type | Meaning |
|---|---|---|
| `title` | field | New title. Omitted = unchanged. Empty = clear to fallback. Max 80 chars. |
| `audio` | file | New recording. Also accepted as `file` or `files`. Omitted = unchanged. |
| `image` | file | The packed 296×240 RGB565 panel frame. Omitted = unchanged. |
| `clearImage` | field `"true"` | Removes the picture. With `image` → `400`. |

Headers: `If-Match: "<version>"` fences the write, `Idempotency-Key` makes a
retry replay instead of writing twice. Both optional.

Answers `200` with the whole card in the `{code, msg, data}` envelope and an
`ETag` carrying the new version — the same shape `GET` answers with, so the
client adopts it wholesale.

| Situation | Status | `data` |
|---|---|---|
| Saved | `200` | the whole card |
| Nothing to write | `200` | the whole card, version unchanged |
| `clearImage` + `image`, bad audio, bad frame, title too long | `400` | `null` |
| No such child / recording / pack | `404` | `null` |
| `If-Match` stale | `412` | **the current card** |
| `Idempotency-Key` replayed while the first call is in flight | `409` | `null` |

Every `msg` is a plain sentence written for a parent, because the app surfaces
`400`/`404`/`412` text verbatim and discards anything that looks technical.

## What else changed

- **`ETag` on `GET`**, from the pack version. `If-None-Match` → `304`.
- **Every write bumps the version**, once per request, on `PATCH` and on all
  four legacy routes. The version is a monotonic integer serialised as a string.
- **`Idempotency-Key`** on `PATCH` and `POST /content`, stored in the new
  `idempotency_record` table with a 24 h TTL. Migration:
  `prisma/migrations/20260903000000_idempotency_record`.
- **Objects are overwritten at their existing key**, so `fileUrl` and `imageUrl`
  survive an edit. They are served `Cache-Control: no-cache` with S3's `ETag`,
  and a CloudFront invalidation is issued when `CLOUDFRONT_DISTRIBUTION_ID` is
  set.
- **`.bin` frames are accepted on the legacy upload paths too**, so a current
  app build can use them everywhere.

## Not application code

- **CORS.** `scripts/set-customcard-cors.js` puts the bucket rule, including
  `Access-Control-Expose-Headers: ETag, Content-Length` — without which the
  browser cannot revalidate and re-downloads every 142 KB frame on every view.
  The CloudFront side (forward `Origin`, keep those two headers) is a
  distribution setting the script cannot make; its header block says what to do.
- **Rate limits.** Unchanged: the existing global limiter in `src/app.js`
  applies. No per-parent write limit was added.
- **S3 object versioning** is the only recovery path for a picture a parent
  overwrites by mistake. It is a bucket setting; turn it on if support needs one.

---

## Three deliberate departures from the spec

### 1. The stored frame carries the 12-byte LVGL header

**Spec §3:** store the app's 142,080 bytes byte-for-byte.
**Built:** accept 142,080 **or** 142,092, and always store 142,092.

The spec's §3.3 calls the manager dashboard "the reference implementation" for
decoding the stored `.bin`. That decoder rejects anything whose first byte is
not `0x19` (`RfidContentPackDialog.vue:563`), and the toy's SD image loader
reads the same LVGL v9 container. A headerless 142,080-byte frame renders in
neither: the picture would silently never appear on the device, which is the
entire point of the feature.

So a raw frame is wrapped in the fixed 12-byte header and an already-wrapped one
is stored untouched. **The pixels are never touched** — nothing is decoded,
scaled, re-oriented or re-encoded, which is what §3.1's "do not convert" rule
is actually protecting. `toDeviceFrame` in `src/utils/lvglImage.js` is the whole
of it.

> **Client note:** the length sniff in the spec's §10.1 step 2 must test for
> **142,092**, not 142,080, and skip the first 12 bytes before expanding
> RGB565 → RGBA8888. Anything else is a legacy PNG, as the spec says.

### 2. Legacy paths still convert PNG and JPEG

**Spec §4.1/§13.2:** legacy paths store PNG "as-is, no conversion".
**Built:** legacy paths keep converting PNG/JPEG to the LVGL frame, exactly as
they did before; a packed frame skips the converter entirely.

§13.1 assumes existing rows hold PNGs. They do not — this backend has always
converted on upload, so every stored picture is already an LVGL `.bin`. Storing
a PNG as-is would therefore be a *regression*: a shipped build's upload would
stop appearing on the toy, where today it appears fine.

Keeping the conversion satisfies what §13.2 actually wants — shipped builds
never break — and costs nothing, because a `.bin` from a current build never
reaches the converter.

The consequence §13.1 predicts does not apply here: there is no population of
legacy PNG rows to heal, so no picture disappears from the toy.

### 3. `PATCH` audio takes a fresh key when the format changes

**Spec §8.1:** overwrite in place; "same for audio".
**Built:** the audio key is reused only when the extension matches.

Writing WAV bytes over a `.mp3` key hands the toy a URL whose name disagrees
with its contents. A format change takes a new key instead and the old object is
swept. Pictures are always `.bin`, so `imageUrl` is unconditionally stable —
which is the case the client's frame cache depends on.

---

## The one non-obvious interaction

Stable URLs break the content hash.

The toy compares `content_hash` before `version`, and the hash used to be built
from the item URLs. Once an edit overwrites the bytes at an existing key, a
replaced picture leaves every URL byte-identical — the hash would not move, the
tap handshake would answer `card_up_to_date`, and the toy would show the old
picture for ever.

`packContentHash` therefore takes the new version as part of its input, and the
titles too (the one field with no object behind it). `customCard.patch.test.js`
pins this; removing the version from the hash fails three tests.

---

## Tests

| File | Covers |
|---|---|
| `tests/unit/customCard.patch.test.js` | the service: frame handling, each field, version, identity, `If-Match` |
| `tests/integration/custom-card-patch.test.js` | the wire: envelope, parts, `ETag`/`If-None-Match`/`If-Match`, `Idempotency-Key`, legacy routes |
| `tests/unit/upload.service.customCard.test.js` | key reuse, the extension rule, `no-cache`, the prefix guard |

Run them together:

```bash
npx jest tests/unit/customCard tests/unit/upload.service tests/integration/custom-card --runInBand --forceExit
```

## Still open

1. **Firmware byte order.** The app packs little-endian, which the existing
   converter also emits, so this is consistent — but it has never been confirmed
   against the device. Scrambled colours on the toy mean byte order, not packing.
2. **The `maxItems` escape hatch.** The app has no delete (spec §7.1), so a card
   at 10 recordings can only be brought back under the cap from the manager
   dashboard. Flag it if that is not the intent.
