# Custom Card Artwork

A parent can attach one picture to each custom-card recording. The toy shows it
on the panel while that recording plays.

This describes what was built, why each decision went the way it did, and what
the parent app still has to do to use it.

**Status:** the backend is implemented and tested. The Flutter parent app is
**not** — §5 is the contract it needs to be written against, not shipped code.
Everything downstream of the API (gateway, firmware, admin dashboard) already
worked and was left untouched.

---

## 1. The path a picture takes

```
Parent app ──multipart PNG/JPEG──> manager-api-node
                                        │
                                        │  ffmpeg: decode → fit 296x240 → rgb24
                                        │  JS:     pack RGB565 + 12-byte header
                                        ▼
                                   S3 customcard_<mac>/<uuid>.bin
                                        │
                        content_item.image_url = CloudFront URL
                                        │
   ESP32 taps card ──> mqtt-gateway ──> /toy/admin/rfid/... lookup
                            │
                            │  items[].imageUrl → images:[{index,url}]
                            ▼
                    ESP32 downloads to <skill>/images/NN.bin, LVGL renders it
```

No database migration was needed: `content_item.image_url` and `images_json`
already exist ([`prisma/schema.prisma`](../prisma/schema.prisma), `content_item`).

---

## 2. Why the server converts to `.bin`

The toy's canonical image is an **LVGL v9 binary, RGB565** — the same format as
every asset already on the SD card. The server converts to it rather than
storing the parent's PNG or JPEG, for three reasons read off the firmware:

| Constraint | Where | Consequence |
|---|---|---|
| No JPEG decoder compiled in | `sdkconfig`: `LV_USE_TJPGD` and `LV_USE_LIBJPEG_TURBO` both off | A JPEG that reaches the device is **silently dropped** — blank screen, no error |
| PNG decodes but costs RAM | `CONFIG_LV_USE_LODEPNG=y` | Works, but decode memory on device and no bound on file size |
| File must be ≤ 300 KB | `kMaxImageBytes`, `cheeko_sd_image_loader.cc:15` | Anything larger is refused at load time |
| Panel is 296 × 240 | `DISPLAY_WIDTH` / `DISPLAY_HEIGHT`, `boards/cheeko-v2/config.h:56` | The useful output size |

296 × 240 RGB565 is a fixed **142,092 bytes** — comfortably under the cap, and
byte-for-byte the same shape as every existing asset.

### File layout

```
offset  size  value
0       u8    0x19    magic, LVGL v9
1       u8    0x12    LV_COLOR_FORMAT_RGB565
2       u16   0       flags — uncompressed
4       u16   296     width
6       u16   240     height
8       u16   592     stride (width * 2)
10      u16   0       reserved
12      ...           pixels, RGB565 little-endian, row-major
```

---

## 3. Backend

### 3.1 `src/utils/lvglImage.js` — new

[`toLvglRgb565Bin(buffer)`](../src/utils/lvglImage.js#L183) → `Buffer`. Pure:
no S3, no database, no request context, so it is unit-testable against fixtures.

**The ffmpeg filter chain** ([`decodeToRgb24`](../src/utils/lvglImage.js#L112)):

```
color=c=white:s=296x240,format=rgb24[bg];
[0:v]format=rgba,scale=296:240:force_original_aspect_ratio=decrease[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2:format=rgb,format=rgb24[out]
```

The white `color` source does double duty: it is the letterbox for a picture
whose aspect ratio is not 37:30, **and** the backdrop transparency is flattened
against — without it ffmpeg composites an alpha PNG onto black. `-frames:v 1`
is what turns an animated PNG into a still.

**The RGB565 packing is done in JS, not by ffmpeg**
([`packRgb565`](../src/utils/lvglImage.js#L96)). This is the one non-obvious
choice. `-pix_fmt rgb565le` looks like the natural way to ask for it, but
swscale *dithers* when it drops to 16 bits — measured at ±4 per channel on noise,
with ~50% of pixels differing from the firmware's own converter, which
truncates. Asking ffmpeg for `rgb24` is byte-exact, so the last step is six lines
of JS and the output matches the reference exactly:

```js
((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)   // little-endian u16
```

**Bounds.** ffmpeg is a subprocess per upload, so two are enforced: a hard
timeout (`IMAGE_CONVERT_TIMEOUT_MS`, default 15 s) that SIGKILLs the child, and a
concurrency gate (`IMAGE_CONVERT_CONCURRENCY`, default 2) so ten simultaneous
uploads are not ten decoders competing for the API box. Post-conditions assert
the exact byte length and the 300 KB ceiling before the buffer is returned — a
wrong length is a picture the firmware rejects at load time, on a device with no
way to tell us it did.

**Errors.** A file whose header is honest but whose body is not (a truncated PNG)
throws with `err.decodeFailed = true`; the service maps that to a 400. Anything
else — ffmpeg missing, a timeout — propagates and stays a 500, because it is our
problem, not the parent's.

`spawn` is used directly rather than `fluent-ffmpeg`: that dependency is in
`package.json` but unused anywhere in `src/`, and `spawn` is what gives the
timeout and kill control above.

### 3.2 `src/services/upload.service.js`

[`uploadCustomCardImage(binBuffer, deviceMac)`](../src/services/upload.service.js#L376)
mirrors `uploadCustomCardAudio`: a `randomUUID()` key under the **same**
`customcard_<mac>/` prefix, `application/octet-stream`.

> **Superseded, in part.** The edit endpoint changed the caching and keying rules
> described in this section — an edit now overwrites the object at its existing
> key and everything is served `Cache-Control: no-cache`. See
> [custom-card-item-edit.md](./custom-card-item-edit.md).

Two things about that prefix matter:

- `deleteCustomCardObject` refuses keys outside `customcard`, so sharing the
  prefix means the existing orphan sweep protects pictures too.
- It keeps a device's pictures inside its own namespace. `uploadContentFile` was
  **not** reused — its keys are `rfidcontent/images/<name>`, a global admin
  namespace with no per-device isolation and no cleanup guard.

The key is a fresh UUID for a picture that has none yet. A picture that
*replaces* one overwrites it at its existing key instead, so `imageUrl` survives
an edit — freshness comes from `Cache-Control: no-cache` plus the `ETag`, not
from a changing URL.

`deleteCustomCardAudio` was renamed to
[`deleteCustomCardObject`](../src/services/upload.service.js#L397) since it now
retires both kinds of file; the old export is kept as an alias.

### 3.3 `src/services/customCard.service.js` — the bulk of it

**[`validateImageUpload`](../src/services/customCard.service.js#L210)** — size,
then magic bytes, then agreement with the extension, then the dimension gate.

It differs from `validateAudioUpload` in one deliberate way: **the sniff comes
first and the extension is only a cross-check, because it is optional.** Flutter's
`MultipartFile.fromBytes()` sends no filename unless one is passed explicitly —
rejecting a perfectly good PNG for having no name is the exact bug the audio
validator already had to work around with its `fallbackName`. Magic bytes are the
control either way. `.jpeg` and `.jpg` are compared by MIME type so both agree
with a sniffed JPEG.

**The dimension gate**
([`imageDimensions`](../src/services/customCard.service.js#L236), 40 MP ceiling)
is on the canvas, not the file, because the two are only loosely related: zlib
expands 5 MB of flat-colour PNG into gigabytes, and ffmpeg allocates the whole
frame before anything is scaled down. Dimensions come out of the file's own
header, which needs no decoder:

- **PNG**: IHDR is mandated to be the first chunk, so width and height sit at
  fixed offsets 16 and 20.
- **JPEG**: walk the marker segments to the first SOFn, skipping fill bytes and
  standalone markers, stopping at SOS. Verified against real encoder output —
  baseline, progressive (SOF2), CMYK (APP14), EXIF-bearing, and grayscale.

40 MP is far above any photograph that fits in 5 MB, and puts the worst case at
~160 MB of RGBA per conversion, bounded in turn by the concurrency gate.
Unreadable dimensions are **let through** rather than rejected: a frame header we
cannot find is one ffmpeg cannot find either, so it fails on its own with the
timeout as backstop.

**[`pairCustomCardUploads`](../src/services/customCard.service.js#L289)** — a
picture is matched to a recording by its **field-name index** (`image_2` goes
with the second `files` part), never by the order the parts arrive in. Multipart
part ordering is not guaranteed across HTTP clients, and positional pairing would
silently put one recording's picture on another. An `image_N` past the end of
`files`, or a bare `image` with no `file`, is a 400 rather than a dropped
picture — dropping it silently would look like the upload having worked.

**The content hash now covers the image URL**
([line 479](../src/services/customCard.service.js#L479)):

```js
`${item.itemNumber}:${item.audioUrl}:${item.imageUrl || ''}`
```

This is the single most likely way to ship the feature and have it look broken on
hardware. The toy compares the hash first and falls back to version. Without the
image in the hash, changing *only* the artwork leaves the hash where it was, the
tap handshake answers `card_up_to_date`, and the new picture never reaches the
device.

**`toItemPayload` carries `imageUrl` explicitly, never `undefined`**
([line 515](../src/services/customCard.service.js#L515)). `updateContentPack`
re-matches rows by `item_number` and falls back to the existing row's value for
anything left undefined. On a renumber — delete item 1 of 3, and 2 and 3 slide
down — an absent `imageUrl` would graft item 2's old picture onto the new item 1.
One line, and it is what makes deletes safe.

**The orphan sweep**
([`deleteOrphanedObjects`](../src/services/customCard.service.js#L417)) now walks
both `audio_url` and `image_url`. It still runs **after** the DB write, never
before: if storage went first and the write then failed, rows would point at
objects that no longer exist and the card would go silent with nothing on the
server to explain why. An orphaned object is the cheaper failure.

**All-or-nothing on a batch.** Every picture is validated, then every picture is
converted, and only then does anything get uploaded. ffmpeg failing on the third
picture must not leave the first two sitting in the bucket.

**New:**
[`setCustomCardItemImage`](../src/services/customCard.service.js#L659) and
[`clearCustomCardItemImage`](../src/services/customCard.service.js#L682). Both go
through `writePackItems`, so the version bump, the hash and the sweep are handled
in one place. Clearing is idempotent — an item with no picture is already in the
state being asked for.

### 3.4 `src/routes/mobile.routes.js`

`customCardUpload` gained a `fileFilter`. `application/octet-stream` is on the
allowlist deliberately: Flutter sends it for any part built from bytes, and
rejecting it would turn away perfectly good uploads. The filter is a cheap first
pass, not the control — magic bytes decide in the service.

multer's `fileSize` limit is per-request and **cannot differ by field**, so it
stays at 10 MB (the recording ceiling) and the 5 MB picture ceiling is enforced in
the validator, with a message written for a parent.

---

## 4. Wire contract

All six endpoints return the whole card, so a client never has to merge state.

| Method | Path | Purpose |
|---|---|---|
| GET | `/toy/api/mobile/devices/:mac/custom-card` | Read the card |
| POST | `…/custom-card/content` | Append recordings, each with an optional picture |
| PUT | `…/custom-card/content/:itemNumber` | Replace a recording, optionally its picture too |
| DELETE | `…/custom-card/content/:itemNumber` | Remove a recording (survivors renumber) |
| **PUT** | `…/custom-card/content/:itemNumber/image` | **New** — change artwork only |
| **DELETE** | `…/custom-card/content/:itemNumber/image` | **New** — clear artwork, keep the recording |

Auth is a Firebase ID token; ownership of the MAC is enforced in the service.

### Multipart parts

| Part | On | Notes |
|---|---|---|
| `files` | POST | up to 10 recordings |
| `file` | POST, PUT | single recording |
| `image_1` … `image_10` | POST | pairs with the Nth **`files`** part by field-name index |
| `image` | POST, PUT, PUT `/image` | companion to the single `file` part |

### Response

One field added per item; nothing else changed.

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "contentPack": {
      "version": "4",
      "totalItems": 2,
      "items": [
        { "itemNumber": 1, "title": "Grandma story", "fileUrl": "https://…/a.mp3", "sizeBytes": 402118, "imageUrl": null },
        { "itemNumber": 2, "title": "Bedtime", "fileUrl": "https://…/b.mp3", "sizeBytes": 511220, "imageUrl": "https://…/customcard_aabbccddeeff/9f2c….bin" }
      ]
    }
  }
}
```

`imageUrl` is `null` when no artwork is set. It is a public CloudFront URL —
same rules as `fileUrl`. There is deliberately **no pack-level image mirror**:
the pack-level fields describe `items[0]` and predate artwork.

> The URL is stable across an edit, which means it is **not** an identity: an
> edit overwrites the bytes behind it. A cache keyed on the url alone would paint
> the first frame it ever saw for ever — key on `(url, packVersion)` or send
> `If-None-Match`. See [custom-card-item-edit.md](./custom-card-item-edit.md).

### Errors

`msg` is written for a parent and is safe to show verbatim on 400 and 404.

| Status | When | `msg` |
|---|---|---|
| 400 | Not an image, or corrupt | `Only PNG and JPEG pictures are supported.` |
| 400 | Over 5 MB | `That picture is larger than 5 MB. Please choose a smaller one.` |
| 400 | Canvas over 40 MP | `That picture is 30000 by 30000 pixels, which is too large to process. Please choose a smaller one.` |
| 400 | Extension disagrees with contents | `The file contents do not match its .png extension.` |
| 400 | `image_N` with no matching `files[N]` | `Each picture must go with a recording.` |
| 400 | Picture-only `PUT` of a recording | `To change only the picture, use the picture endpoint for this recording.` |
| 404 | Item not on the card | `That recording could not be found on this card.` |

---

## 5. Frontend

### 5.1 Admin dashboard (`manager-web`) — already works, unchanged

[`RfidContentPackDialog.vue`](../../manager-web/src/components/RfidContentPackDialog.vue)
already decodes `.bin` artwork to a canvas: it reads magic at 0, colour format at
1, width at 4, height at 6 and stride at 8, all little-endian, then unpacks
RGB565 — exactly what we emit. No change was needed, and it is the cheapest
visual check of the converter's output.

### 5.2 Parent app (Flutter) — **not built**

The app is outside this repo. Nothing about the change is breaking: older builds
ignore the new `imageUrl` field harmlessly, so there is no version gate. What a
new build needs to do:

**Attach a picture while uploading recordings.** The index in the field name is
what binds them, so send `image_2` for the second `files` part regardless of the
order the parts go on the wire:

```dart
final req = http.MultipartRequest('POST', uri)
  ..headers['Authorization'] = 'Bearer $idToken'
  ..files.add(await http.MultipartFile.fromPath('files', firstRecording))
  ..files.add(await http.MultipartFile.fromPath('files', secondRecording))
  // pairs with the SECOND `files` part, not the second part sent
  ..files.add(await http.MultipartFile.fromPath('image_2', drawing));
```

**Change artwork without re-uploading audio** — the reason the dedicated route
exists. Re-uploading a recording just to swap a picture costs the parent their
data and the toy a fresh download of audio it already has:

```dart
PUT  …/custom-card/content/1/image      // part name: `image`
DELETE …/custom-card/content/1/image    // no body
```

**Render `items[].imageUrl`.** Public URL; revalidate rather than cache by age
(see the note above). `null` means no artwork — show the placeholder, not an
error. The URL points at an **LVGL `.bin`, not a viewable image**, so the app
cannot render it with `Image.network`; it has to fetch the bytes, skip the
12-byte header and expand RGB565 → RGBA8888, the way the manager dashboard's
decoder does.

**Show `msg` verbatim on 400 and 404.** Every message in the table above is
written for a parent and says what to do next; a generic "upload failed" throws
that away.

Practical notes: filenames are optional (magic bytes are the control), a picture
must be PNG or JPEG under 5 MB and 40 MP, and a picture may only be sent
alongside a recording that exists — `image_3` with two recordings is a 400.

---

## 6. Downstream — already worked, untouched

- **Lookup**: `buildContentPackResponse` emits `items[].imageUrl`
  ([`rfid.service.js:829`](../src/services/rfid.service.js#L829)), and
  `transformContentItemToDTO` falls back from `images_json` to `image_url`
  ([`:3306`](../src/services/rfid.service.js#L3306)), so both the tap manifest and
  the download manifest carry the picture.
- **Gateway**: turns `items[].imageUrl` into `images: [{index, url}]` on
  `card_content` ([`mqtt-gateway.js:1189`](../../mqtt-gateway/gateway/mqtt-gateway.js#L1189))
  and into `image_<itemNumber>` in the download response
  ([`:2084`](../../mqtt-gateway/gateway/mqtt-gateway.js#L2084)).
- **Firmware**: downloads to `<skill>/images/NN.bin`
  (`content_manager.cc:1260`) and LVGL renders it.

---

## 7. Tests

| File | Covers |
|---|---|
| [`tests/unit/customCard.image.test.js`](../tests/unit/customCard.image.test.js) | Validator by magic bytes; the dimension gate against forged IHDR/SOF headers; multipart pairing; the hash moving on an image-only change; a renumber keeping each picture with its own recording; all-or-nothing on a bad picture in a batch; converter header, packing, letterboxing and decode failure |
| [`tests/unit/customCard.lookup.test.js`](../tests/unit/customCard.lookup.test.js) | A custom pack with `image_url` surfaces `imageUrl` in the device lookup |
| [`tests/integration/custom-card-image.test.js`](../tests/integration/custom-card-image.test.js) | The real Express + multer stack: field names, which part becomes which item's picture, and the sentence a parent is shown for each rejection |

The converter tests build PNGs with `zlib` and a hand-rolled CRC32 — no image
library needed — and skip with a warning where ffmpeg is absent, since the
runtime image installs it but a bare dev box may not have it.

The integration test stubs storage, database and ffmpeg. A real
add → set-image → delete cycle would write objects to the live S3 bucket and
could not be run twice.

**Parity gate.** The converter's output was byte-compared against the firmware's
own `imageConverter/image_to_bin_converter.py` (in the `cheeko-os-v2` repo) on
296 × 240 fixtures — random noise and a gradient. **Byte-identical, header included.**
Alpha PNGs differ by ≤ 2/255 per channel, because the reference blends with `>>8`
(divide by 256) where ffmpeg divides by 255; ffmpeg is the more correct of the
two. This gate is run by hand — it needs the firmware repo and Pillow, so it is
not committed here. The durable half of it lives in the unit tests, which assert
the exact header bytes and the exact packing formula.

---

## 8. Still to verify — needs hardware

None of this is automatable from the API side.

- [ ] Upload audio + picture, tap the card → picture shows during playback.
- [ ] Change **only** the picture, tap → the toy re-downloads. This is the test
      for the content-hash fix in §3.3; if it fails, the toy keeps its cached copy.
- [ ] Delete item 1 of 3, tap → each surviving picture is still with its own
      audio, not shifted by one.
- [ ] A portrait phone photo → letterboxed to 296 × 240 on white, under 300 KB.
- [ ] Tap a custom card on a different toy → that toy's own pack plays,
      unaffected.
