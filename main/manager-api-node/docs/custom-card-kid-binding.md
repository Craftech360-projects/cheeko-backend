# Custom Cards Belong to the Child

Two changes, specified together because they touch the same code path:

1. **Ownership moves from the toy to the child.** A custom pack is keyed on
   `kid_profile.id`. There is no MAC-keyed pack any more — not as a fallback,
   not for unpaired toys.
2. **Deleting a recording is made to actually work.** It currently answers
   HTTP 200 while leaving the row in the database.

**Status:** specification. Nothing here is implemented. File references are
against `main/manager-api-node` on `fix/custom-card-thumb`.

---

## 0. Decisions locked

| | Decision |
|---|---|
| Ownership | Kid only. `pack_code = CUSTOM_KID_<kidId>`. No `CUSTOM_<MAC>` anywhere after migration. |
| Unpaired toy | Tapping a custom card plays nothing (`card_unknown`). This is a deliberate, accepted regression. |
| Parent-app API | Hard cutover to `/kids/:kidId/custom-card/...`. The `/devices/:mac/...` routes are **deleted**, not deprecated. |
| Schema | No new column. `pack_code` carries the owner, as it does today. |

**Why the hard cutover is safe:** the production database
(`cohtfpenuqwxawtcbdji`) currently holds 23 content packs and **zero** matching
`CUSTOM_%`. Nobody has recorded a custom card in production, so there is no
installed base to keep working. Confirm this on any other environment that holds
parent data before merging:

```sql
SELECT count(*) FROM rfid_content_pack WHERE pack_code LIKE 'CUSTOM=_%' ESCAPE '=';
```

If that returns non-zero somewhere, §7's migration still handles it — but the
app cutover then needs a version gate.

**Why no `kid_id` column:** an FK with `ON DELETE CASCADE` would drop the pack
when a child is deleted, but it cannot delete the S3 objects behind it. The
cleanup code in §2.6 has to exist either way, and once it does, the FK buys
nothing that `pack_code` does not already give. One owner, one derived code, one
lookup — the same shape as today.

---

## 1. The model

```
kid_profile (id=42)
     │  owns
     ▼
rfid_content_pack  pack_code = CUSTOM_KID_42
     │  1..10
     ▼
content_item       audio_url, image_url  →  S3 customcard_kid42/<uuid>.mp3|.bin
```

**The MAC does not disappear — it stops being an owner and stays an address.**
The toy knows only its own MAC, so the tap path has to start there:

```
ESP32 taps card ──uid + mac──> lookupCardByUid
                                  │
                                  │ 1. uid in custom_card allowlist?   (is this a custom card)
                                  │ 2. mac → ai_device.kid_id          (whose toy is this)
                                  │ 3. kid_id → CUSTOM_KID_<id> pack   (what plays)
                                  ▼
                            items → audio + image URLs
```

Step 2 is new. If the device is unknown, or `kid_id IS NULL`, the lookup returns
`null` and the gateway answers `card_unknown` — the same answer an issued card
with nothing recorded already gets today.

---

## 2. Backend changes

### 2.1 `src/utils/helpers.js`

```js
// Replaces packCodeForMac (line 211). Delete the old one — after the migration
// nothing in the codebase may construct a MAC-keyed pack code.
const packCodeForKid = (kidId) => `CUSTOM_KID_${BigInt(kidId)}`;
```

Keep it next to `ownerKeyForDevice` (line 230) and note in the comment that the
two encode the same ownership rule with different fallbacks: `ownerKeyForDevice`
falls back to `mac:` for unpaired toys because a workspace must always exist;
a custom pack has no fallback because it must never be shared between children.

`packCodeForMac` is still needed by the migration script in §7. Move it there
rather than leaving it exported from `helpers.js`.

### 2.2 `src/services/customCard.service.js`

Every public function's `(userId, mac, ...)` becomes `(userId, kidId, ...)`.

| Function | Line | Change |
|---|---|---|
| `assertDeviceOwnedByUser` | 320 | **Replace** with `assertKidOwnedByUser(userId, kidId)` — `kid_profile.findFirst({ where: { id: BigInt(kidId), user_id: BigInt(userId) } })`, 404 `"That child could not be found."` Not-found rather than forbidden, same reasoning as the function it replaces: the endpoint must not reveal which kid ids exist. Pattern already in use at `mobile.service.js:2047`. |
| `findPackForMac` | 337 | → `findPackForKid(kidId)` = `findFirst({ where: { pack_code: packCodeForKid(kidId) } })`. |
| `serializePack` | 345 | `macAddress`/`deviceAlias` → `kidId`/`kidName`. Add `deviceMac` (nullable) sourced from `ai_device.findFirst({ where: { kid_id } })` — the app shows *which toy this will play on*, and null means "not paired yet". |
| `getCustomCardForDevice` | 431 | → `getCustomCardForKid(userId, kidId)`. |
| `ensurePackForDevice` | 443 | → `ensurePackForKid`. `name` becomes `` `${kid.name} — Custom Card` ``. |
| `writePackItems` | 472 | Takes `kid` instead of `device`. **Also see §3** — this is where the delete fix lands. |
| `loadTargetItem` | 522 | `(userId, kidId, itemNumber)`. |
| `addCustomCardContent` | 550 | `(userId, kidId, files, opts)`. The `MAX_ITEMS` message at 573 now bounds a child's card, not a toy's — reword. |
| `replaceCustomCardItem` | 618 | `(userId, kidId, itemNumber, file, opts)`. |
| `setCustomCardItemImage` | 659 | `(userId, kidId, itemNumber, file)`. |
| `clearCustomCardItemImage` | 682 | `(userId, kidId, itemNumber)`. |
| `deleteCustomCardItem` | 699 | `(userId, kidId, itemNumber)`. |

`normalizeMacAddress` and the `packCodeForMac` import at line 21 go away.
`deleteOrphanedObjects` (417) and the hash/version logic are untouched.

### 2.3 `src/services/upload.service.js`

```js
// 336 — today
function customCardFolder(deviceMac) { return `customcard_${...mac...}`; }

// after
function customCardFolder(kidId) { return `customcard_kid${kidId}`; }
```

Call sites: `uploadCustomCardAudio` (340) and `uploadCustomCardImage` (376) take
`kidId` instead of `deviceMac`.

**The `customcard` prefix is load-bearing.** `deleteCustomCardObject` (398)
refuses any key not starting with it — that guard is what stops a pack that
somehow references catalogue audio from deleting it. `customcard_kid42` still
matches. A layout like `kid42/customcard/...` would not, and the orphan sweep
would go silently dead with no test catching it.

Existing objects are **not** moved. URLs are stored absolute in
`content_item.audio_url`, so old files keep resolving from `customcard_<mac>/`
and the sweep still deletes them by their own key. Only new uploads land in the
kid folder.

### 2.4 `src/services/rfid.service.js` — the tap path

`resolveCustomCardPack` (737) becomes:

```js
const resolveCustomCardPack = async (normalizedUid, mac) => {
  if (!mac) return null;
  try {
    const issued = await prisma.custom_card.findFirst({ where: { rfid_uid: normalizedUid } });
    if (!issued) return null;

    // The MAC is an address, not an owner: it says which toy tapped, and the
    // toy's paired child says whose recordings play. An unpaired toy has no
    // child and therefore no pack — deliberately, so a toy handed to a sibling
    // cannot play the previous child's recordings.
    const device = await prisma.ai_device.findFirst({
      where: { mac_address: normalizeMacAddress(mac) },
      select: { kid_id: true },
    });
    if (!device?.kid_id) return null;

    return await prisma.rfid_content_pack.findFirst({
      where: { pack_code: packCodeForKid(device.kid_id), active: true },
    });
  } catch (err) {
    logger.error('[RFID-LOOKUP] Custom card pack resolution error:', err);
    return null;
  }
};
```

One extra indexed read (`idx_ai_device_mac`), and only for UIDs already confirmed
to be in the allowlist — not on every tap.

Also update: the comment block at 984-1010 ("keyed on the MAC, not the UID" →
"keyed on the child paired to the tapping toy"), the header at 4668 ("one per
device" → "one per child"), and the log line at 745's caller so it prints
`kidId` alongside `mac`.

### 2.5 `src/services/rfid.service.js` — the admin list

`getCustomPackList` (4728) joins `ai_device` by string-stripping the MAC out of
the pack code. Replace with:

```sql
FROM rfid_content_pack p
JOIN kid_profile k
  ON k.id = NULLIF(REPLACE(p.pack_code, 'CUSTOM_KID_', ''), '')::bigint
LEFT JOIN ai_device d ON d.kid_id = k.id          -- which toy it is on right now
LEFT JOIN LATERAL (...) i ON true                  -- unchanged
WHERE p.pack_code LIKE 'CUSTOM=_KID=_%' ESCAPE '='
```

Returned rows gain `kidId`, `kidName`; `macAddress`/`deviceAlias` stay but now
mean *currently playing on*, and are null for a child with no toy.

### 2.6 `src/services/mobile.service.js` — kid deletion

`deleteKid` (2040) unpairs devices and deletes the profile. With `pack_code`
keying there is no FK, so the pack, its items and every S3 object leak.

Inside the existing transaction, before `kid_profile.delete`:

```js
const pack = await tx.rfid_content_pack.findFirst({ where: { pack_code: packCodeForKid(kidId) } });
let retired = [];
if (pack) {
  const items = await tx.content_item.findMany({
    where: { content_pack_id: pack.id },
    select: { audio_url: true, image_url: true },
  });
  retired = items.flatMap(i => [i.audio_url, i.image_url]).filter(Boolean);
  await tx.content_item.deleteMany({ where: { content_pack_id: pack.id } });
  await tx.rfid_content_pack.delete({ where: { id: pack.id } });
}
```

Return `retired` alongside `avatar_url`. The route (`mobile.routes.js:271`)
sweeps S3 **after** the commit, the same ordering the avatar cleanup already
uses — a failed delete must never leave rows pointing at objects that are gone.

`deleteUserAccount` (~2075) deletes every kid and needs the same treatment.

### 2.7 `src/routes/mobile.routes.js`

**Delete** lines 302-420 (the whole `─── Custom Card ───` block) and replace with
the same five handlers under `/kids/:kidId/custom-card`. Everything else in the
block — `customCardUpload`, `CUSTOM_CARD_IMAGE_FIELDS`, `handleUploadErrors`
(lines 44-81) — is reused unchanged.

Two handler-level notes:
- The body-vs-path guard at 331 (`bodyMac` must match `req.params.mac`) becomes
  the same check on `kidId`, for the same reason: the path segment is
  authoritative so a mismatched body cannot write to another child's card.
- Route order: `/content/:itemNumber/image` must stay registered **before**
  `/content/:itemNumber`, as it is today.

### 2.8 `src/services/device.service.js` — what does *not* change

Worth stating because the previous design needed it and this one does not. There
is never an unowned pack to adopt, so:

- `adoptUnattributedRows` (238) — no change. A pack is created against a child or
  not at all.
- `clearUnattributedDeviceRows` (213) — no change. No MAC-keyed pack exists to wipe.
- `pairDeviceToKid` (311), `unbindDevice` (466) — no change. The pack stays with
  the child; that is the entire point.

Add a one-line comment at `pairDeviceToKid` saying custom packs are deliberately
absent from the handover set, so the next person does not read it as an omission.

---

## 3. The delete-recording fix

### 3.1 Root cause

`DELETE .../content/:itemNumber` →
[`deleteCustomCardItem`](../src/services/customCard.service.js) (699) →
`writePackItems` (472) → **`rfidService.updateContentPack`**
(`rfid.service.js:4134`), which does the item write as delete-all-then-reinsert:

```js
// rfid.service.js:4183
try { await prisma.content_item.deleteMany({ ... }); }
catch (delErr) { logger.error('Failed to delete existing content items:', delErr); }   // ← swallowed

// rfid.service.js:4218
try { await prisma.content_item.createMany({ data: itemsData }); ... }
catch (itemsError) { logger.error('Failed to update content items:', itemsError); }    // ← swallowed
```

Neither rethrows, and the two are not in a transaction. Consequences:

| Failure | Result today |
|---|---|
| `deleteMany` throws | Rows survive, `createMany` adds renumbered duplicates, endpoint answers **200** |
| `createMany` throws | Every recording on the card is gone, endpoint answers **200** |
| Both succeed | Correct |

The route then returns a body built from a fresh re-read (`writePackItems:493`),
so the response *does* still contain the deleted recording — the app is trusting
the status code, not the payload.

### 3.2 Backend fix

```js
// rfid.service.js — inside updateContentPack, replacing lines 4182-4234
await prisma.$transaction(async (tx) => {
  await tx.content_item.deleteMany({ where: { content_pack_id: BigInt(data.id) } });
  if (itemsData.length > 0) {
    await tx.content_item.createMany({ data: itemsData });
  }
  await tx.rfid_content_pack.updateMany({
    where: { id: BigInt(data.id) },
    data: { total_items: itemsData.length },
  });
});
```

No try/catch. A failure rolls back and propagates, the route's `asyncHandler`
turns it into a 500, and the card is left exactly as it was.

This is a shared function — the admin dashboard's content-pack editor uses it
too. It will start surfacing errors it used to hide. That is the fix, not a side
effect, but it is worth telling whoever runs the dashboard.

Keep the pre-load of existing items (4176-4180) **outside** the transaction and
keep its catch: it feeds the "fall back to the existing row's value for anything
left undefined" behaviour, and failing to read it is not a reason to refuse a
write.

### 3.3 The second failure mode: stale item numbers

`deleteCustomCardItem` renumbers survivors so `item_number` stays contiguous
(line 713) — the toy selects by sequence and a gap would make it ask for an item
that is not there. That renumbering is correct and stays.

It does mean **an `itemNumber` is only valid against the list it came from.**
Delete #1 and then send a cached "delete #2" and you delete what used to be #3.

Fixing this server-side is not worth it: `content_item.id` is regenerated on
every write by the delete-and-reinsert above, so there is no stable per-item id
to key on either. The contract is instead:

> Every mutating custom-card endpoint returns the complete, current card. The
> client MUST replace its list from that response and MUST NOT reuse an
> `itemNumber` read before the last mutation.

§5.4 is the client side of that. It costs the app nothing — the response is
already the full card on all five endpoints.

---

## 4. API contract

Base: `{CONTEXT_PATH}/api/mobile`, default `/toy/api/mobile`.
Auth: `Authorization: Bearer <Firebase ID token>` on every request.
Envelope: `{ "code": 0, "msg": "success", "data": {...} }`; errors
`{ "code": <status>, "msg": "<human sentence>", "data": null }`.

### 4.1 The card object

Returned by all five endpoints.

```jsonc
{
  "kidId": "42",
  "kidName": "Aarav",
  "deviceMac": "AA:BB:CC:DD:EE:FF",   // null when the child has no toy paired
  "maxItems": 10,
  "contentPack": {                    // null before the first upload
    "id": "77",
    "packCode": "CUSTOM_KID_42",
    "kidId": "42",
    "title": "grandma-story.mp3",     // mirrors items[0], legacy single-recording shape
    "fileName": "grandma-story.mp3",
    "fileUrl": "https://.../customcard_kid42/<uuid>.mp3",
    "mimeType": null,
    "sizeBytes": 482119,
    "durationSeconds": null,
    "version": "4",
    "updatedAt": "2026-09-01T10:12:03.000Z",
    "totalItems": 3,
    "items": [
      {
        "itemNumber": 1,
        "title": "grandma-story.mp3",
        "fileUrl": "https://.../customcard_kid42/<uuid>.mp3",
        "sizeBytes": 482119,
        "imageUrl": "https://.../customcard_kid42/<uuid>.bin"   // null when no artwork
      }
    ]
  }
}
```

`contentPack: null` means nothing recorded yet — a normal state, not an error.
A pack whose last recording was just deleted returns `contentPack` non-null with
`totalItems: 0` and `items: []`.

### 4.2 Endpoints

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/kids/:kidId/custom-card` | — | 200, card |
| POST | `/kids/:kidId/custom-card/content` | multipart | 201, card |
| PUT | `/kids/:kidId/custom-card/content/:itemNumber` | multipart | 200, card |
| PUT | `/kids/:kidId/custom-card/content/:itemNumber/image` | multipart `image` | 200, card |
| DELETE | `/kids/:kidId/custom-card/content/:itemNumber/image` | — | 200, card |
| DELETE | `/kids/:kidId/custom-card/content/:itemNumber` | — | 200, card |

**POST multipart fields**

| Field | Notes |
|---|---|
| `files` | up to 10 parts, MP3 or WAV |
| `image_1` … `image_10` | optional, pairs with the Nth `files` part |
| `file` | single-recording alternative to `files` |
| `image` | optional, pairs with `file` |
| `title` | optional text |

Either `files` or `file`, not both patterns mixed. A picture with no matching
recording is rejected: `"Each picture must go with a recording."`

**PUT `/content/:itemNumber`** takes `file` (or a single-element `files`) and an
optional `image`. Sending only an image is refused with a message pointing at the
image endpoint — that route's meaning is "replace the recording".

### 4.3 Limits and validation

| Rule | Value | Enforced |
|---|---|---|
| Recordings per child | 10 | `MAX_ITEMS`, `customCard.service.js:41` |
| Recording size | 10 MB | multer + service |
| Audio formats | `.mp3`, `.wav` | extension **and** magic bytes must agree |
| Picture size | 5 MB | `MAX_IMAGE_BYTES` |
| Picture pixels | 40 MP | `MAX_IMAGE_PIXELS`, before decode |
| Picture formats | `.png`, `.jpg`, `.jpeg` | converted server-side to LVGL RGB565 `.bin` |

`application/octet-stream` is accepted at the multer filter because Flutter sends
it for byte-built parts; the magic-byte sniff in the service is the real control.

### 4.4 Errors

| Status | `msg` | When |
|---|---|---|
| 400 | `That recording is larger than 10 MB. Please choose a shorter one.` | multer limit |
| 400 | `Only MP3 or WAV recordings and PNG or JPEG pictures can be uploaded.` | mime filter |
| 400 | `Please choose a recording to upload.` | no file part |
| 400 | `Each picture must go with a recording.` | orphan image part |
| 400 | `This card holds up to 10 recordings…` | over `MAX_ITEMS` |
| 401 | — | missing/invalid Firebase token |
| 404 | `That child could not be found.` | kid missing **or** belongs to another parent |
| 404 | `This child has no custom card content.` | delete/replace before any upload |
| 404 | `That recording could not be found on this card.` | `itemNumber` not on the card |
| 500 | — | write failed; **the card is unchanged** (new, see §3.2) |

---

## 5. Frontend — parent app (Flutter)

### 5.1 What changes

| Today | After |
|---|---|
| `/devices/{mac}/custom-card…` | `/kids/{kidId}/custom-card…` |
| Screen reached from a toy | Screen reached from a child |
| `macAddress`, `deviceAlias` in the response | `kidId`, `kidName`, `deviceMac` |
| Card belongs to the toy in the parent's hand | Card belongs to the child, and follows them to a new toy |

The MAC endpoints are removed. Any build still calling them gets a 404 from the
router — plan the app release with the backend release.

### 5.2 Getting the `kidId`

`GET /api/mobile/kids` already returns everything needed, **unenveloped** (a bare
JSON array, unlike the custom-card endpoints):

```jsonc
[{ "id": "42", "name": "Aarav", "avatar_url": "…", "isPaired": true, "deviceMac": "AA:BB:…" }]
```

- Opening the card screen from a **toy**: `GET /kids?mac=<mac>` returns the child
  on that toy — a single-element array, or `[]` if the toy is unpaired, or 404 if
  the MAC is not this parent's. Use this rather than picking the head of the full
  list.
- Opening from a **child** (profile, settings): the id is already in hand.
- Opening from a global entry point with several children: show a picker. Do not
  default to the first element silently.

### 5.3 Screen states

| State | Condition | UI |
|---|---|---|
| Empty | `contentPack == null` or `items.isEmpty` | "No recordings yet" + record/upload CTA |
| List | `items.isNotEmpty` | One row per item: index, title, artwork thumb, play, replace, delete |
| Not paired | `deviceMac == null` | Non-blocking banner: "These recordings will play once {kidName} is paired to a toy." Uploading stays allowed. |
| Full | `items.length == maxItems` | Disable add, show "10 of 10 recordings" |
| Uploading | request in flight | Per-row or global progress; block a second mutation |

The **not paired** banner matters more than it did: an unpaired toy now plays
nothing on a custom card, so a parent who records before pairing needs to be told
why the card is silent.

### 5.4 Delete — the required flow

This is where the current bug is half client-side. The rules:

1. **Confirm first.** Deleting is irreversible — the S3 object is swept.
2. **Disable the row's delete control while the request is in flight**, and block
   any other mutation on the same card. Two overlapping deletes are what turn a
   stale `itemNumber` into "the wrong recording disappeared".
3. **Do not optimistically remove the row.** Remove nothing until the response
   arrives.
4. **On 2xx, replace the entire local list from `data.contentPack.items`.** Never
   splice locally — the server renumbers survivors, so positions after the
   deleted one all shift, and any locally-held `itemNumber` is stale the moment
   the response lands.
5. **On non-2xx, keep the row and surface `msg`.** A 500 now genuinely means
   nothing changed. A 404 means the list was stale — refetch with GET and show
   the fresh card rather than an error.
6. **Never treat 200 as "it worked" without reading the body.** After the §3.2
   fix a 200 is trustworthy, but rebuilding from the payload costs nothing and is
   correct regardless.

```dart
Future<void> deleteRecording(String kidId, int itemNumber) async {
  if (!await confirmDelete()) return;
  setState(() => _busy = true);
  try {
    final res = await api.delete('/api/mobile/kids/$kidId/custom-card/content/$itemNumber');
    // Rebuild wholesale. The server has renumbered whatever survived.
    setState(() => _card = CustomCard.fromJson(res.data['data']));
  } on ApiException catch (e) {
    if (e.status == 404) {
      await _refetch();                       // stale list, not a failure
      showSnack('That recording was already removed.');
    } else {
      showSnack(e.msg);                       // row stays; nothing was deleted
    }
  } finally {
    setState(() => _busy = false);
  }
}
```

The same "replace from the response" rule applies to upload, replace, set-image
and clear-image — all five return the full card.

### 5.5 Caching

Do not persist `itemNumber` across app sessions or screens (deep links, share
sheets, notifications). Fetch the card, act on what came back. Item identity is
positional by design and there is no stable per-recording id to hold onto.

---

## 6. Frontend — admin dashboard (`main/manager-web`)

`src/views/RfidManagement.vue`, custom packs table (598-620):

| Column | Today | After |
|---|---|---|
| 1 | Toy alias / MAC (owner) | **Child** — `kidName`, id underneath |
| 2 | — | **On toy** — `deviceAlias` / `macAddress`, or "not paired" |
| rest | version, hash, items, updated | unchanged |

Header copy at 556-561 ("Blank cards shipped for parent recordings… tapping any
issued card on that toy plays it") needs rewriting: tapping any issued card plays
**the pack of the child paired to that toy**, and plays nothing on an unpaired
toy.

`src/apis/module/rfid.js:880` needs no change — same endpoint, new fields. The
issued-UID table above it is untouched.

---

## 7. Migration

`supabase/migrations/20240101000016_custom_pack_by_kid.sql`

```sql
-- 1. Re-key every custom pack whose toy is paired to a child.
UPDATE rfid_content_pack p
   SET pack_code = 'CUSTOM_KID_' || d.kid_id,
       update_date = NOW()
  FROM ai_device d
 WHERE p.pack_code LIKE 'CUSTOM=_%' ESCAPE '='
   AND p.pack_code NOT LIKE 'CUSTOM=_KID=_%' ESCAPE '='
   AND UPPER(REPLACE(REPLACE(d.mac_address, ':', ''), '-', '')) = REPLACE(p.pack_code, 'CUSTOM_', '')
   AND d.kid_id IS NOT NULL
   -- One child, one pack. The invariant holds (releaseKidFromOtherDevices,
   -- device.service.js:283) but a duplicate pack_code would abort the migration.
   AND NOT EXISTS (
     SELECT 1 FROM rfid_content_pack q WHERE q.pack_code = 'CUSTOM_KID_' || d.kid_id
   );

-- 2. Park whatever is left: packs on toys with no child, and packs whose MAC no
--    longer matches a device. Renamed, never deleted — the recordings are a
--    parent's own voice and are recoverable with one UPDATE.
UPDATE rfid_content_pack
   SET pack_code = 'ORPHANED_' || pack_code,
       active = false,
       update_date = NOW()
 WHERE pack_code LIKE 'CUSTOM=_%' ESCAPE '='
   AND pack_code NOT LIKE 'CUSTOM=_KID=_%' ESCAPE '=';
```

`version` and `content_hash` are deliberately **not** bumped: the content did not
change, and bumping them would make every toy in the field re-download its whole
card on the next tap.

S3 objects are not moved and stay reachable through the URLs in `content_item`.

**Verification** — run before and after, diff:

```sql
SELECT pack_code, total_items,
       (SELECT count(*) FROM content_item i WHERE i.content_pack_id = p.id) AS items
  FROM rfid_content_pack p
 WHERE p.pack_code LIKE 'CUSTOM=_%' ESCAPE '=' OR p.pack_code LIKE 'ORPHANED=_%' ESCAPE '='
 ORDER BY pack_code;
```

Every row must appear on both sides with the same `items` count; only the codes
change. Report the `ORPHANED_` count to whoever owns support — those are parents
whose recordings just stopped playing.

---

## 8. Behaviour changes to sign off

| Scenario | Today | After |
|---|---|---|
| Toy handed to a sibling | New child hears the previous child's recordings | Each child hears only their own |
| Child moves to a new toy | Recordings stay on the old toy | Recordings follow the child |
| Child deleted | Pack and S3 objects orphaned forever | Deleted with the child |
| **Unpaired toy taps a custom card** | Plays that toy's pack | **Plays nothing** (`card_unknown`) |
| **Spare toy at a grandparent's** | Keeps its own recordings | Plays whichever child is paired to it, or nothing |
| Parent records before pairing | Works, tied to the toy | Works, tied to the child; silent until paired |
| `MAX_ITEMS` (10) | Per toy | Per child |
| Failed write | HTTP 200, card silently unchanged or corrupted | HTTP 500, card unchanged |

Rows 4 and 5 are the accepted cost of kid-only binding. If the spare-toy case is
real, the mitigation is a second child profile for it, not a MAC fallback.

---

## 9. Tests

| File | Change |
|---|---|
| `tests/unit/customCard.lookup.test.js` | `PACK.pack_code` → `CUSTOM_KID_42`; mock `ai_device.findFirst`. Cases: paired toy resolves; **unpaired toy resolves to null**; unknown MAC → null; no MAC → null; issued-but-nothing-recorded → null; UID not in allowlist → falls through to the legacy path. |
| `tests/unit/customCard.image.test.js` | Signatures take `kidId`; S3 keys become `customcard_kid42/…`. The literal assertions at 328 and 359 will fail loudly — intended. |
| `tests/integration/custom-card-image.test.js` | Routes move to `/kids/:kidId/…`; add 404-for-another-parent's-kid. |
| *(new)* `tests/unit/customCard.delete.test.js` | Delete removes exactly one item and renumbers survivors; **a throwing `content_item.deleteMany` propagates instead of answering 200**; the response's `items` matches the database. This is the regression test for §3. |
| *(new)* `tests/unit/customCard.kid-delete.test.js` | Deleting a child removes the pack, its items, and returns the URLs to sweep; the sweep runs after the commit. |
| `tests/unit/rfid.service.test.js` (or new) | `updateContentPack` rolls back both statements together. |
| `tests/unit/device.kid-pairing.test.js` | Assert pairing/unpairing does **not** touch custom packs — the guarantee §2.8 rests on. |

---

## 10. Order of work

1. **`updateContentPack` transaction + rethrow** (§3.2) + its test. Ships alone, fixes the live delete bug immediately. → verify: new unit test red before, green after.
2. `packCodeForKid` in helpers; delete `packCodeForMac` from the export surface. → verify: nothing but the migration script references MAC pack codes.
3. Read path: `resolveCustomCardPack` two-hop + lookup tests. → verify: unpaired toy returns null.
4. Write path: service signatures, upload folder, new routes; delete the MAC routes. → verify: image/integration suites green.
5. `deleteKid` / `deleteUserAccount` cleanup + test. → verify: no pack survives its child.
6. Migration on a restored copy of prod, before/after diff. → verify: item counts identical, `ORPHANED_` count reported.
7. Admin dashboard columns and copy.
8. Flutter app cutover — **released together with step 4**, not after.

Steps 1 and 2-8 are independent; 1 should go first regardless of what happens to
the rest.

---

## 11. Deliberately not doing

- **`custom_card` stays a flat allowlist.** `custom_card.kid_id` exists and is
  `@unique` (`prisma/schema.prisma:680`), left over from an earlier design and
  documented as legacy. Binding a physical UID to a child would mean a card only
  works for one kid — the opposite of the "any blank card, any toy" model the
  cards ship under. Leave it null; drop the column separately.
- **`custom_content_pack`** (`prisma/schema.prisma:692`) is a dead kid-keyed table
  from migration `20240101000014`, never wired to any code. Do not resurrect it:
  one file per kid, no item list, no ordering, no artwork. Drop it separately.
- **Moving existing S3 objects.** URLs are absolute and stored per item; a copy
  pass buys nothing and risks breaking playback mid-flight.
- **A stable per-recording id.** `content_item.id` is regenerated on every write
  by the delete-and-reinsert. Making ids stable means replacing that write
  strategy — a larger change than this, and §3.3's contract removes the need.
- **Gateway, firmware, tap logging, `content_item` schema.** All resolve the pack
  by id after lookup and are untouched.
