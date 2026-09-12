# SD content encryption

Downloaded content on the toy's SD card is stored in the clear today. Pull the card, put it in a laptop, and every purchased MP3 is an ordinary file. The same files are also reachable as public CloudFront URLs through the unauthenticated card lookup, so anyone who reads a card's UID with a phone can fetch them without a toy. This document describes how that content is sealed.

**Status, 2026-09-12: version 1 is what ships.** Settled 2026-09-10 at a scale of
~100 customers, and implemented. Version 2 is designed, deferred, and described in
section 6 for whenever it is revisited. Everything outside sections 5, 6 and 11 applies
to both.

![Version 1 overview: upload sealing, the shared wrap secret, key delivery, offline playback, dashboard preview and key locations](sd-content-encryption.svg)

**Scope.** Downloaded content only: pack audio, pack item images, custom-card recordings. Built-in UI art, themes, character sprites, `cardmap.jsn` and logs stay plaintext. Character sprites were in scope until 2026-09-10, when they were ruled out. Pack thumbnails stay plaintext because the dashboard shows them in an `<img>`.

**Out of scope.** Secure Boot and RFID card authenticity. Note that a cloned card UID gets a clean download from CloudFront in either version, so per-device keys buy little until card authenticity is addressed.

---

## 1. How content flows today

Verified against the code, September 2026.

| Step | Where | What happens |
|---|---|---|
| Upload | `src/routes/rfid.routes.js` `POST /admin/rfid/content-pack/upload` | Multer holds the file in memory. PNG/JPEG item art is converted to an LVGL RGB565 `.bin` by `toDeviceArtwork`. `uploadService.uploadContentFile` writes to S3 bucket `cheeko-music-files` under `rfidcontent/<category>/<name>-<uuid8>.<ext>` with `Cache-Control: max-age=31536000`, and returns a public CloudFront URL. |
| Save | `rfidService.createContentPack` / `updateContentPack` | Pack row in `rfid_content_pack`, one `content_item` row per item holding `audio_url` and `image_url`. |
| Tap | firmware `ContentManager::OnCardTapped` | If the card is already on SD, play immediately. Otherwise send `card_lookup` over MQTT with `rfid_uid`, `mac_address`, `local_version`, `local_content_hash`. |
| Lookup | `main/mqtt-gateway/gateway/mqtt-gateway.js` `card_lookup` handler | `POST /admin/rfid/card/tap` for the version handshake, then `GET /admin/rfid/card/lookup/<uid>?mac=` . Both are unauthenticated. `fetchRfidContentFromManagerApi` copies an explicit whitelist of fields. Publishes `card_content` with `audio[]` / `images[]` or `stories[]` URLs to `devices/p2p/<clientId>`. |
| Download | firmware `ContentManager::HandleServerResponse` | Plain HTTP GET per URL into `/sdcard/cheeko/skills/<id>/audio/01.mp3`, `images/01.bin`, or `s01/...` for grouped packs. `manifest.jsn` is written last as the completion marker. |
| Play | `main/audio/mp3_player.cc`, `cheeko_sd_image_loader.cc` | MP3 read in 2048-byte `fread` chunks, no seeks. Images read whole into PSRAM, then the 12-byte LVGL header is checked. |

Also verified: there is no per-device secret anywhere today. The MQTT password is an HMAC of client id plus username under one global `mqtt.signature_key`, and the client id contains a per-call UUID that is never stored. The firmware signs an activation challenge with the eFuse HMAC peripheral, but the backend ignores that field. Flash encryption is not enabled (`CONFIG_SECURE_FLASH_ENC_ENABLED` is unset).

---

## 2. Threat model

| Attack | Version 1 (shipped) | Version 2 (deferred) |
|---|---|---|
| Parent copies the SD card and shares the folder | stopped | stopped |
| Anyone fetches the CloudFront URLs from the public lookup | stopped | stopped |
| Copied SD card used in another Cheeko that also has the card | works | stopped |
| One firmware image is dumped | all packs on all toys exposed | nothing exposed |
| One toy's flash is dumped | all packs on all toys exposed | that toy's packs only |
| Owner dumps their own flash | exposes K | exposes S, unless flash encryption is on |
| Recording the speaker | never stoppable | never stoppable |

ESP32 flash encryption is what closes the flash-dump rows. It protects the firmware image (version 1's K) and NVS (version 2's S) equally. It is a separate feature from Secure Boot, but enabling it in release mode is one-way per chip and changes how boards are flashed on the line. Treat it as its own project and start in development mode.

---

## 3. File format, shared by both versions

```
offset  size  field
0       4     magic "CKE1"
4       1     version: 1 = K wrapped under the shared secret, 2 = under a per-device secret
5       3     reserved, zero
8       8     nonce, random per file
16      ..    AES-128-CTR ciphertext of the original file
```

- Counter block is `nonce(8) || counter(8, big-endian, from 0)`, incremented per 16-byte block.
- No padding. File length is original + 16.
- CTR is a stream cipher, so any 16-byte block decrypts independently. The toy decrypts each 2 KB chunk in place as it is read.
- A file without the magic is plaintext and is read exactly as today. This is what makes rollout safe. Moving from version 1 to version 2 re-encrypts nothing either: only the version byte and the source of the wrap secret change.
- CTR provides confidentiality only, no integrity tag. Bit flips decrypt to garbage rather than failing. For this threat that is fine. If tamper detection is ever needed, add a hash to the download manifest rather than switching modes.
- Filenames do not change. 8.3 only (`CONFIG_FATFS_LFN_NONE=y`).

---

## 4. Sealing on upload

Same code for both versions. Only the source of `key` differs.

```js
// src/services/upload.service.js
const MAGIC = Buffer.from('CKE1');

function seal(plain, key, version = 1) {
  const nonce = crypto.randomBytes(8);
  const iv = Buffer.concat([nonce, Buffer.alloc(8, 0)]);
  const body = crypto.createCipheriv('aes-128-ctr', key, iv).update(plain);
  const header = Buffer.alloc(16);
  MAGIC.copy(header, 0);
  header[4] = version;
  nonce.copy(header, 8);
  return Buffer.concat([header, body]);
}
```

```js
// src/routes/rfid.routes.js, upload handler, after toDeviceArtwork
const body = isPackThumbnail ? artwork.buffer : seal(artwork.buffer, contentKey, ENC_VERSION);
const result = await uploadService.uploadContentFile(body, artwork.filename, 'rfidcontent', category, artwork.mimeType);
```

- Sealing happens in memory on the server. Multer never touches disk. Only sealed bytes reach S3.
- Apply the same `seal` at the other S3 writers whose output lands on an SD card: custom-card audio and image. Everything else stays plaintext, including character art (ruled out 2026-09-10).
- Gate on `CONTENT_MASTER_KEY` being set, so local and test environments keep working and production rollout is an env flip.
- S3 keys, CloudFront URLs, `Cache-Control`, and the `content_item` row are unchanged. Nothing downstream knows encryption happened.
- The MCP's `upload_pack_file` posts through the same route and gets sealed automatically. No MCP change.

---

## 5. Version 1, as shipped

Note what version 1 turned out to be. The original sketch was one global key compiled
into firmware. What shipped keeps the **per-pack key** of version 2 and changes only
where the *wrapping* secret comes from: one shared secret instead of one per device.
Per-pack keys cost nothing extra and keep the blast radius of a leaked pack key to one
pack, so there was no reason to give them up.

**Pack key K.** 16 random bytes per pack, generated on first upload for that pack.
`rfid_content_pack.content_key`, encrypted at rest under `CONTENT_MASTER_KEY`. The
upload dialog sends `packCode` with each file so the server can
`getOrCreatePackKey(packCode)` before the pack row exists.

**Wrap secret.** 32 bytes, one for the whole fleet. Backend: `CONTENT_WRAP_SECRET`
env var, 64 hex chars. Firmware: build-time constant
`CONFIG_CHEEKO_CONTENT_WRAP_SECRET_HEX`. The two must be byte-identical. Nothing tells
you when they are not — CTR has no integrity check, so a mismatch just produces garbage
that fails at the MP3 decoder — so both sides assert the section 10 vectors in their own
test suite.

**Schema.**

```sql
ALTER TABLE rfid_content_pack ADD COLUMN content_key BYTEA;      -- K, encrypted at rest
```

`ai_device.content_secret` exists from the version 2 migration and is unused. Dropping
it buys nothing and the rollback is worse, so it stays.

**Key delivery at lookup.** In `lookupCardByUid`, content-pack branch, and in the
download manifest:

```
wrap_key = HMAC-SHA256(wrap_secret, "cheeko-wrap-v1")[0:16]
wrapped  = AES-128-CTR(wrap_key, nonce_w, K)        nonce_w random per response
```

The response gains `encryption: { v: 1, key: <wrapped hex>, nonce: <nonce_w hex> }`.
Omitted for unencrypted packs, and omitted — never faked — when either the pack key or
the wrap secret is missing.

**No MAC is involved.** `encryptionFieldFor(packCode)` does not take one and does not
read the device table. A first-ever tap, an unregistered toy and a swapped mainboard all
get a working key. This is the single biggest practical difference from version 2, where
an unknown device had no safe answer: the S3 object is sealed and there is no plaintext
copy, so "return it unencrypted" would have meant sealed files with no key.

The lookup stays public. The wrapped key is useless without the fleet secret, which only
firmware and the server hold.

**Gateway.** `fetchRfidContentFromManagerApi` in `mqtt-gateway.js` returns an explicit
field whitelist, so `encryption` had to be added to it *and* to the `card_content`
payload it publishes. `virtual-connection.js` spreads `...cardData` and carries the field
automatically, so the two senders differ until the whitelist is updated. Both paths are
covered by `tests/card-content-encryption.test.js`. This exact trap hid character artwork
for weeks.

**Firmware.** Implementation guide with current anchors and pinned vectors:
[sd-content-encryption-firmware.md](sd-content-encryption-firmware.md).

- `main/boards/common/content_crypto.{h,cc}`: `IsEncrypted(head16)` plus a thin wrapper over `mbedtls_aes_setkey_enc` and `mbedtls_aes_crypt_ctr` holding key, nonce counter, `nc_off` and `stream_block`. These are the same calls `mqtt_protocol.cc` already uses for UDP audio, so no new dependency and the hardware AES block is used automatically. mbedtls carries the partial keystream block across calls, so unaligned chunk boundaries need no extra code.
- `HandleServerResponse`: parse `encryption` from `card_content` and `card_ai`, write `wrapped` and `nonce_w` into `manifest.jsn`. Never write plain K to SD.
- Playback start: compute the HMAC from the build-time secret, unwrap K in RAM, hand it to the decryptor. Drop K when playback ends.
- `mp3_player.cc`: after `fopen`, read 16 bytes. If magic, keep the nonce and decrypt every `fread` chunk in place before the decoder. If not, `fseek(0)` and proceed as today. No new allocation.
- `cheeko_sd_image_loader.cc`: after the whole-file read into PSRAM, decrypt in place before the existing LVGL header check. The 12 KB internal-heap guard is untouched.
- Failure is loud: an unknown version byte, or a decrypt that yields a non-MP3 or non-LVGL header, refuses playback, logs a telemetry marker with the pack id, and shows an on-screen message. Never fall through to the decoder with ciphertext.

**No rotation story.** The secret never changes in normal operation, so there is no
NVS-erase recovery, no fingerprint file on the card and no pending-registration flag —
all of that was version 2 machinery. Changing the secret is a breaking change: it means
re-encrypting all content **and** an OTA to every device. Treat it as one.

**Where the secret lives.** Wherever `CONTENT_MASTER_KEY` lives. Not Slack, not email,
not a commit. Generate it once.

---

## 6. Version 2: per-device secret (deferred)

Version 2 changes exactly one thing: the wrap secret becomes per-device instead of
shared. Files, `seal`, K, the readers, the gateway and the preview proxy are identical,
and moving to it re-encrypts nothing — only the version byte and the source of the
secret change.

**What it buys.** A copied SD card stops playing in another Cheeko. That is the only
row of the section 2 table that moves.

**Device secret S.** 32 random bytes the toy generates itself on first boot after Wi-Fi
is up (the RNG is not truly random before the RF starts) and stores in NVS, namespace
`cheeko`, key `dev_secret`. It registers S once by including it in the OTA check the toy
already makes, into `ai_device.content_secret`, encrypted at rest. No factory step.

**Why it was deferred, 2026-09-10.**

- Without flash encryption the secret is readable off any unit either way, so version 2 is version 1 with more moving parts. Flash encryption was ruled out at this volume: it burns eFuses irreversibly and ends USB flashing on production stock.
- A toy must reach the server **once** before any purchased pack plays. An NVS erase kills every card until re-registration. A replacement mainboard is a new MAC with no secret, and there is no safe answer for it — see section 5.
- Recovery needs a fingerprint file on the card, a persisted pending-registration flag, and a wipe-and-re-download path, none of which version 1 needs. The detail is in this file's history if it is ever revived.

**The trigger to revisit.** The shared secret leaks, or content is found posted
publicly.

**Why HMAC then AES rather than encrypting with the secret directly.** A per-device S
can later move into the ESP32-S3 HMAC peripheral, where the key is eFuse-backed and
never readable even by firmware, without changing the file format or re-encrypting
anything. Only the derivation of `wrap_key` moves.

---

## 7. Offline playback

Nothing needed at playback time comes from the network: the sealed files and the wrapped key are on the SD card, the wrap secret is in firmware, and K is unwrapped into RAM. `OnCardTapped` plays a known card immediately and does not wait for the `card_lookup` reply. The 10-second timeout only applies to cards the toy has never seen.

Offline does not work for a card that was never downloaded, exactly as today.

---

## 8. Dashboard preview

`RfidContentPackDialog.vue` plays item audio with `new Audio(cloudfrontUrl)`. Sealed files break that. Add one admin-only route that decrypts on the server and streams the result. The key never reaches the browser.

```js
router.get('/content-pack/preview', requireAdmin, asyncHandler(async (req, res) => {
  const { url, packCode } = req.query;
  // Origin is pinned by exact hostname, https only, no embedded credentials, no port,
  // and the fetch uses redirect:'manual' so an off-domain redirect is never followed.
  // A startsWith check is NOT sufficient: cloudfront.net.attacker.com passes it.
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== CLOUDFRONT_DOMAIN ||
      parsed.port !== '' || parsed.username || parsed.password) return badRequest(res, 'Bad url');
  const upstream = await fetch(parsed.href, { redirect: 'manual' });
  // Reject on content-length before buffering: this route accepts any path on the
  // distribution, so without a cap one preview can exhaust the process heap.
  if (Number(upstream.headers.get('content-length')) > PREVIEW_MAX_BYTES) return badRequest(res, 'Too large');
  const bytes = Buffer.from(await upstream.arrayBuffer());
  const contentType = url.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
  res.type(contentType).set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');

  const header = parseHeader(bytes);
  // Legacy plaintext: SEND the bytes, do not redirect to the CDN. A browser cannot follow
  // that redirect — CloudFront serves no Access-Control-Allow-Origin, so the cross-origin
  // fetch fails and every legacy preview breaks. We already hold the bytes; just send them.
  if (!header) return res.send(bytes);
  if (header.version !== 1) return badRequest(res, 'Unsupported seal version');

  const key = await getPackKey(packCode);
  if (!key) return notFound(res, 'No content key for this pack');
  stream.pipeline(Readable.from([bytes.subarray(HEADER_BYTES)]),
                  createUnsealStream(key, header.nonce), res,
                  (err) => { if (err) logger.error(...); });
}));
```

Dialog side: `new Audio` cannot send a header, so fetch with the bearer token already used for uploads and play a blob URL. Revoke it when the dialog closes.

```js
const res = await fetch(`${Api.getServiceUrl()}/admin/rfid/content-pack/preview?url=${encodeURIComponent(url)}&packCode=${this.form.packCode}`,
  { headers: { Authorization: `Bearer ${token}` } });
this.currentAudio = new Audio(URL.createObjectURL(await res.blob()));
```

Thumbnails are never sealed, so cover art is unchanged.

Item images are LVGL `.bin`, which the dashboard *does* render — it decodes them client-side in
`manager-web/src/utils/lvglBin.js`. Those must go through this same preview route when the pack
is sealed, passing `packCode`, or the decoder sees `CKE1` instead of the LVGL magic and the
artwork silently disappears. Callers with no pack code fall back to the plain content proxy, so
plaintext artwork is unaffected.

Character sprites are never sealed (ruled out 2026-09-10), so the template-management screen
keeps using the plain content proxy and needs no key.

---

## 9. Rollout and migration

1. Ship firmware that understands `CKE1` but tolerates plaintext. Old firmware given a sealed file would feed ciphertext to the decoder, so this order is not optional.
2. Wait for fleet adoption. `rfid_card_tap_log.client_version` already records firmware versions per device.
3. Set `CONTENT_MASTER_KEY` and `CONTENT_WRAP_SECRET` in production, the latter byte-identical to the shipped firmware build. New uploads are sealed from that moment.
4. Backfill: for each `content_item` audio or image URL on CloudFront, download, seal, upload under a new UUID-suffixed key with the existing helper, update the row. New keys sidestep the one-year edge cache. In-field SD cards keep their plaintext and keep playing. Those files already left the building. What the backfill closes is the public URLs.

**Known bug, independent of this work.** `ContentFileAlreadyDownloaded` in `content_manager.cc` skips any existing non-empty file, so a version bump rewrites the manifest and leaves old bytes. It does not block this rollout, because in-field cards are not asked to re-download. Fix it when a version bump next needs to refresh bytes, by writing a target-version marker at download start and skipping existing files only when the marker matches.

---

## 10. Tests

- Host test on the firmware side: known key, nonce and plaintext produce the expected ciphertext; round trip; a 2048-byte chunk boundary that is not 16-byte aligned. Wire into the CircleCI host-tests job.
- Jest test on the Node side producing the same expected bytes from the same vector, so both implementations are checked against one another.
- Wrap: the HMAC derivation vector, and a wrap/unwrap round trip.
- Gateway: `encryption` survives both the router path and the virtual-connection path.
- Lookup: **an unknown MAC still gets an `encryption` block.** This is the regression that would silently undo the main benefit of version 1.

Both sides assert these bytes literally. They are the only thing that catches a
mismatched secret or a wrong version byte before hardware does.

```
K         = 000102030405060708090a0b0c0d0e0f
nonce     = 1011121314151617
plaintext = "cheeko content encryption test!!"   (32 ASCII bytes)

sealed    = 434b4531 01 000000 1011121314151617
            ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a

wrap_secret = a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf
nonce_w     = 0909090909090909
wrap_key    = 94e5bea4747beb214b0cb91b3f8825d3
wrapped K   = 99cf47ac63e20dd29d679e9854465f87
```

---

## 11. Version 1 versus version 2

| | Version 1 (shipped) | Version 2 (deferred) |
|---|---|---|
| Key K | one per pack, in DB | one per pack, in DB |
| Wrap secret | one for the fleet, firmware build constant + env | S per device, self-generated in NVS |
| Device must be known to the server | no | yes, before any sealed pack plays |
| Stops SD copying and URL fetching | yes | yes |
| Copied SD works in another toy with the card | yes | no |
| Blast radius of the leaked wrap secret | every pack, every toy | one toy |
| Revoke or rotate | re-encrypt everything, OTA every device | per toy |
| Schema | `content_key` | plus `content_secret` |
| Backend touch points | upload, lookup, preview, backfill | plus device registration |
| Gateway change | whitelist one field, both senders | same |
| Firmware work | decrypt in two readers, HMAC unwrap, manifest field | plus NVS secret, registration, rotation recovery |
| Flash encryption | optional, same benefit either way | required for the design to hold |
| Mainboard swap / NVS erase | nothing to do | every card dead until re-registration |

Moving to version 2 later re-encrypts nothing: only the version byte and the source of
the wrap secret change.

---

## 12. Decisions, settled

1. **Version 1 now, version 2 not yet.** 2026-09-10, at ~100 customers. Trigger to revisit: the shared secret leaks, or content is found posted publicly.
2. **Keep the dashboard preview** via the server-side proxy (section 8).
3. **Parent-recorded custom-card files are in scope.** They also land on SD.
4. **Firmware ships before the key is turned on.** `rfid_card_tap_log.client_version` tracks adoption; see section 9, where the order is not optional.
5. **`CONTENT_MASTER_KEY` and `CONTENT_WRAP_SECRET` live in the environment**, in the same place as the rest of the deployment's secrets. Not KMS, not a commit.
6. **A mainboard swap is a non-event in version 1.** No MAC is consulted at lookup, so there is nothing to fall back from. This was the deciding argument.

**Still open, and it belongs to the firmware side.** A version bump never re-fetches
existing files (`ContentFileAlreadyDownloaded`, section 9). The staged-download branch
that fixes it must land **before any re-encryption backfill**, or migrated packs show as
updated while still holding plaintext bytes behind a new manifest.

---

## MCP impact

No routes, envelope or auth middleware change. `upload_pack_file` gets sealed output for free. If version 2 adds `packCode` as a required upload field, add it to the MCP's upload tool in the same commit.
