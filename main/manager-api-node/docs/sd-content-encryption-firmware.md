# SD content decryption: firmware implementation guide

This guide is for the developer or AI agent who implements content decryption in the ESP32 firmware at `cheeko-os-v2`.

**Status.** The backend, gateway and a Python device mimic are done and verified end to end against live services. The firmware is the remaining piece. Nothing in the firmware has been changed yet.

**Anchors.** Firmware file and line references are current as of firmware HEAD `270a9a9`. Backend references are to branch `feat/sd-content-encryption` in `cheeko-backend`. If lines have moved, search for the function name given alongside.

**How to use this with an AI agent.** Give it this file and `sd-content-encryption.md` (the design spec in the same folder). Tell it to do the tasks in section 6 in order, to treat section 4 (contracts) as fixed, and to run each task's "Done when" check before moving on. The Python reference in section 3 is runnable and shows the exact behaviour to match.

---

## 1. What you are building

Pack audio and images on the toy's SD card are now stored **sealed**: encrypted with AES-128-CTR under a per-pack key. The server never sends that key in the clear. It sends the key **wrapped** under a secret that only this toy knows. The toy keeps the wrapped key on the SD card and unwraps it in RAM only while playing.

So a copied SD card, or one opened on a PC through USB Drive Mode, holds only ciphertext. A second toy cannot play a card copied from the first, because its secret is different.

The firmware work is:

1. Generate a 32-byte device secret once, keep it in NVS, and send it to the server on the OTA check.
2. Read an `encryption` block from `card_content` (and `character.encryption` from `card_ai`), and store the wrapped key next to the pack on the SD card.
3. At playback, unwrap the pack key using the NVS secret, then decrypt MP3 and LVGL `.bin` files as they are read.
4. Recover cleanly when the secret changes (an NVS erase), and fail loudly and safely when a key is wrong or missing.

**Do not change:**

- the backend, gateway or wire contracts in section 4;
- anything that reads non-pack SD files: UI art, themes, game sounds, game PNGs, the SD-root playlist, app manifests.

**Out of scope:**

- flash encryption, NVS encryption and Secure Boot (see section 9 for why they matter);
- moving the secret into the eFuse HMAC peripheral;
- integrity checking (AES-CTR gives confidentiality only).

---

## 2. How it works, end to end

1. **First OTA check after Wi-Fi is up.** The toy generates secret **S** (32 random bytes) if NVS has none. It stores S as 64 lowercase hex characters in NVS and marks it "registration pending". The OTA POST body carries `"content_secret": "<64 hex>"`. The server stores S encrypted at rest, keyed by MAC. On HTTP 200 the toy clears "pending".
2. **Upload (server side, already done).** Every pack file is sealed under that pack's key **K** before it reaches S3. The URLs do not change.
3. **Card tap.** The toy sends `card_lookup` as today. The server looks up K and this MAC's S. It computes `wrap_key = HMAC-SHA256(S, "cheeko-wrap-v1")[0:16]`, and `wrapped = AES-128-CTR(wrap_key, nonce_w, K)` with a fresh random `nonce_w`. The gateway forwards `encryption: {v: 2, key: <wrapped hex>, nonce: <nonce_w hex>}` inside `card_content`.
4. **Download.** Files are written to SD exactly as served, still sealed. `manifest.jsn` gains an `enc` block holding the **wrapped** key and `nonce_w`. The plain key K is never written anywhere.
5. **Playback, fully offline.** The toy reads S from NVS, recomputes `wrap_key`, and unwraps K in RAM. It then decrypts each file chunk as it is read, and wipes K when playback ends.
6. **NVS erased.** A new S is generated, so every wrapped key on the card is now useless. The files themselves are still fine, because they are sealed under K, not S. The toy detects the change from a fingerprint file on the card and invalidates the manifests of sealed packs. It re-registers the new S **before** the next lookup. The next tap then fetches a fresh wrapped key, and the existing files are reused.

---

## 3. Sources of truth, in priority order

1. **Section 4 of this guide (contracts).** These are byte-exact and fixed.
2. **The Python reference implementation** at the root of `cheeko-backend`. It passes the live end-to-end test: 20 files played, 0 failed.

   | File | What it shows |
   |---|---|
   | `client_crypto.py` | header parse, seal/unseal, streaming decrypt, key unwrap |
   | `client_storage.py` | NVS stand-in, SD layout, fingerprint, reconcile-on-rotation |
   | `client.py` → `download_card_content`, `skill_key`, `read_skill_file`, `play_skill`, `_ensure_secret_registered`, `run_rfid_test` | the device behaviour: store sealed, unwrap at play, fail closed, register before lookup |
   | `test_client_*.py` | runnable checks, including the shared vectors |

3. **The design spec**, `main/manager-api-node/docs/sd-content-encryption.md`.

Where the firmware should **deliberately differ** from the Python mimic:

- **Pending flag location.** The mimic keeps it on the SD card as `secret.pending`. That name is **not 8.3-safe** (a 7-character extension), so it would fail on the toy. The firmware keeps the flag in NVS. See §4.4.
- **Rotation recovery.** The mimic wipes `skills/` wholesale. The firmware must invalidate only the manifests of sealed packs; §6 Task 5 explains why. Both reach the same result: the next tap fetches a fresh wrapped key.

---

## 4. Contracts (do not change)

### 4.1 Sealed file format

```
offset  size  field
0       4     magic, ASCII "CKE1"  (0x43 0x4B 0x45 0x31)
4       1     version = 2
5       3     reserved, zero
8       8     nonce, random per file
16      n     AES-128-CTR ciphertext of the original file
```

- **Counter block.** It is `nonce (8 bytes) || 64-bit big-endian block counter starting at 0`. In mbedTLS terms, `nonce_counter` starts as the nonce followed by 8 zero bytes, and `mbedtls_aes_crypt_ctr` increments it. That behaves identically for any file under 2^64 blocks.
- **Size and padding.** There is no padding. A sealed file is exactly 16 bytes longer than the original.
- **Plaintext files.** A file **without** the magic is plaintext and must be read exactly as today. Old packs, custom-card recordings (not sealed yet, see §9) and every non-pack file take this path.
- **Unknown versions.** Only version 2 exists. Treat any other version as a hard failure, not as plaintext.
- **Filenames.** They are unchanged: `audio/01.mp3`, `images/01.bin`, `s01/audio/01.mp3`. The card is mounted without long filenames (`CONFIG_FATFS_LFN_NONE=y`), so every new file you create must be 8.3.

### 4.2 Keys and derivations

| Name | Size | Where it lives |
|---|---|---|
| S, device secret | 32 bytes | NVS only. Sent once per OTA check. Never logged, never on SD. |
| K, pack key | 16 bytes | Server only. On the toy it exists only in RAM during playback, then is wiped. |
| wrapped K | 16 bytes | `manifest.jsn` on SD, as 32 hex characters |
| nonce_w | 8 bytes | `manifest.jsn` on SD, as 16 hex characters |

```
wrap_key    = HMAC-SHA256(key = S, message = ASCII "cheeko-wrap-v1")[0:16]
K           = AES-128-CTR(key = wrap_key, counter = nonce_w || 0x00*8, data = wrapped)
fingerprint = lowercase hex of SHA-256(S)[0:4]          -> 8 characters
```

- The message is exactly the 14 ASCII bytes `cheeko-wrap-v1`, with no terminator.
- CTR is symmetric, so unwrapping uses the same operation as wrapping.
- Hex from the server is lowercase. Parse it case-insensitively.

### 4.3 Wire messages

**OTA check request body** (`POST <ota_url>`). Add one top-level field and change nothing else:

```json
{ "content_secret": "a0a1a2...bf", "version": 2, "mac_address": "..." }
```

- The server stores S and never returns it.
- A missing or malformed value is ignored and never fails the OTA check.
- The server redacts the value in its logs.

**`card_content`.** The `encryption` field is optional:

```json
{
  "type": "card_content",
  "rfid_uid": "04A1B2C3",
  "skill_id": "ENCTEST-20260909-1046",
  "version": 1,
  "audio":  [ { "index": 1, "url": "https://.../01-fdcc897e.MP3" } ],
  "images": [ { "index": 1, "url": "https://.../01-263ff30a.BIN" } ],
  "update_required": true,
  "encryption": { "v": 2, "key": "925e848d895bea93b0699115da8708fa", "nonce": "42e34e07b5b1aeb7" }
}
```

- Grouped packs carry `stories[]` in place of `audio` and `images`, and the same `encryption` block.
- `encryption` is **absent** when the pack is plaintext, the feature is off, or the server has no S for this MAC. Treat absent and `null` the same way.
- A block that is present but malformed must be treated as absent, with a warning. "Malformed" means `v` is not 2, `key` is not 32 hex characters, or `nonce` is not 16 hex characters.

**`card_ai`.** The existing `character` object may gain the same block:

```json
{ "type": "card_ai", "character": { "folder": "tara", "version": 1,
    "assets": [ { "state": "connect", "url": "..." } ],
    "encryption": { "v": 2, "key": "<32 hex>", "nonce": "<16 hex>" } } }
```

The key is the **character's** key, wrapped under S. It is not a pack key.

### 4.4 On-device storage

**NVS**, namespace `cheeko`, which already exists:

| Key | Type | Meaning |
|---|---|---|
| `dev_secret` | string, 64 lowercase hex | S. Created once, never rewritten except after an NVS erase. |
| `dev_sec_pend` | bool | `true` from the moment S is created until the server returns HTTP 200 for an OTA check that carried it. Clear it with `SetBool(false)`, never with `EraseKey` (see §5, fact 9). |

**SD card**, under `/sdcard/cheeko`:

| Path | Content |
|---|---|
| `secret.fp` | 8 lowercase hex characters, no newline: the fingerprint of the S that the card's wrapped keys were made for |
| `skills/<skill_id>/manifest.jsn` | existing fields, plus `"enc": {"v": 2, "key": "<32 hex>", "nonce": "<16 hex>"}` for sealed packs only |
| `chars/<folder>/enc.jsn` | `{"v":2,"key":"<32 hex>","nonce":"<16 hex>"}`, present only for sealed character art. It is a separate file so that `char.jsn`, which is read with small fixed buffers, is left alone. |

### 4.5 Test vectors

These were checked against both the Node server code and the Python reference. Assert them literally in the host test.

**File vector:**

- K = `000102030405060708090a0b0c0d0e0f`
- nonce = `1011121314151617`
- plaintext = the 32 ASCII bytes `cheeko content encryption test!!`

```
sealed file = 434b4531 02 000000 1011121314151617
              ee8ebda5b634ecfbb0284eaf8e810a10f157b1d9994c6ed0d18d36af05616b0a
```

**Wrap vector:**

- S = `a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf`
- nonce_w = `0909090909090909`
- K as above

```
wrap_key    = 94e5bea4747beb214b0cb91b3f8825d3
wrapped K   = 99cf47ac63e20dd29d679e9854465f87
fingerprint = 00e98867
```

---

## 5. Firmware facts that shape the design

These came from a read-only scan of the firmware, and several contradict what you would assume. Each one says what it forces.

1. **Hardware AES is off on purpose.**
   - `sdkconfig:2333` leaves `CONFIG_MBEDTLS_HARDWARE_AES` unset. `sdkconfig.defaults.esp32s3:54-62` explains that AES-DMA from PSRAM failed on large TLS records.
   - Software AES is far faster than MP3 needs: 128 kbps is 16 KB/s.
   - **Do not turn hardware AES back on for this work.**
   - Hardware SHA is on, and CTR mode compiles today, because `mqtt_protocol.cc:243-251` uses it.
2. **The MP3 decoder hides garbage.**
   - On a bad frame, `Mp3Player::DecodeLoop` skips one byte and carries on (`mp3_player.cc:374-384`). Ciphertext, or data decrypted with the wrong key, plays as silence until EOF.
   - A decrypt failure therefore cannot be left for the decoder to notice. Check the decrypted bytes yourself (Task 7).
3. **Every end of decoding autoplays the next track.**
   - `DecodeTask` fires `on_playback_finished_` whenever decoding ends without `stop_requested_`, and that includes early failures (`mp3_player.cc:269-275`).
   - All tracks in a pack share one key. A wrong key would therefore race through the whole playlist, one failure per track.
   - A decrypt failure needs its own path that does **not** autoplay.
4. **`Mp3Player` leaks audio ownership on its early returns.**
   - The `fopen`, decoder-open and buffer-allocation failures (`mp3_player.cc:285-308`) return before `SetExternalOutputActive(false)` and `CheekoAudioSession::Release(kMp3)` (`:433-434`).
   - That leaked ownership then blocks radio (`cheeko_audio_session.cc:51-52`).
   - Your new failure exit must go through that cleanup, and the three existing early returns should be fixed in the same change.
5. **The decode worker's stack is only 4 KB.**
   - `kMp3WorkerStackBytes = 4096`, static `.bss` (`mp3_player.cc:24-26`). `TASK_STACK_SIZE = 8192` in `mp3_player.h:91` is unused.
   - A `mbedtls_aes_context` plus CTR state is roughly 330 bytes. Keep the decryptor as an `Mp3Player` member, not on the stack.
6. **Plain `new` of a small object lands in internal RAM.**
   - With `CONFIG_SPIRAM_USE_MALLOC=y` and `ALWAYSINTERNAL=512` (`sdkconfig:1707-1709`), a 330-byte allocation goes to internal RAM, which is the binding constraint on this board.
   - Allocate decryptors through `mbedtls_calloc`. ESP-IDF routes that to PSRAM because `CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC=y` (`sdkconfig:2299`). Alternatively use `heap_caps_malloc(..., MALLOC_CAP_SPIRAM)`.
   - Verify the result with `esp_ptr_external_ram()`.
7. **Nothing can delete a skill today, by design.**
   - `CleanSkillFolder` only logs "deletion disabled" (`content_manager.cc:1227-1233`), and the boot comment at `:93-96` explains why.
   - `InvalidateSkill` (`:214-221`) unlinks `manifest.jsn` and drops the skill from `downloaded_skills_` and `skill_metadata_`. It has no callers yet. It is exactly the primitive rotation recovery needs.
8. **Re-downloading a pack skips files that already exist.**
   - `ContentFileAlreadyDownloaded` (`:1241-1244`) returns true for any existing file larger than zero bytes. It is used at `:1576`, `:1633`, `:1904` and `:1949`.
   - Consequence: after `InvalidateSkill`, the next `card_content` rewrites **only the manifest**. No audio or image is fetched again. Recovery from rotation therefore costs one lookup, not a re-download.
9. **The NVS wrapper only commits in its destructor, and never for an erase.**
   - `Settings` commits only when constructed read-write **and** something was *set* (`settings.cc:12-19`). `EraseKey` does not mark the handle dirty (`:91-108`), so an erase alone is never committed.
   - Set values and let the destructor commit. Clear the pending flag with `SetBool(false)`.
10. **`GetSystemInfoJson` is also exposed through MCP.**
    - `mcp_server.cc:137` returns `board.GetSystemInfoJson()` from an MCP tool, and the MCP channel reaches the server-side AI agent.
    - **Never add the secret to `GetSystemInfoJson`.** Inject it only into the OTA request body inside `Ota::CheckVersion` (Task 3).
11. **The OTA check runs before MQTT, but card processing is not strictly ordered after it.**
    - The activation task runs `CheckNewVersion()` (3 attempts) before `InitializeProtocol()` (`application.cc:1392-1435`).
    - If every attempt fails and cached endpoints exist, the protocol starts anyway (`:1416-1422`). RFID polling runs from its own task (`cheeko_v2_board.cc:4309-4315`).
    - So a tap can reach the server while a new secret is still unregistered, and the pending gate (Task 4) must handle that.
12. **Random numbers are not truly random until the RF is on.**
    - `esp_random` and `esp_fill_random` are only true-random once Wi-Fi or BT RF is running, per the ESP-IDF docs. The `Board` constructor runs before Wi-Fi.
    - Generate S lazily, on the first OTA request body, which is always built after the network is up. Never generate it at boot.
13. **The board drops some replies before `ContentManager` sees them.**
    - `StartContentDownloadTask` returns early for `"update_required": false` when the card already has local content (`cheeko_v2_board.cc:2189-2200`).
    - `HasLocalContent` is `card_map_` plus `downloaded_skills_` (`content_manager.cc:177-181`). Once `InvalidateSkill` removes the skill, the next reply is no longer dropped. The lookup also reports no local version, so the server answers with a full `card_content` rather than `card_up_to_date`.
14. **Reply handling runs on the `card_dl` task.**
    - The chain is `OnIncomingJson`, then `Schedule()`, then `OnCardResponse` (`cheeko_v2_board.cc:3664-3690`), then `CheekoContentDownloadTask::Start`. That task has a 7680-byte stack in internal RAM (`cheeko_content_download_task.cc:22`, `:63-94`), and it already runs HTTP downloads.
    - `on_content_ready_` and then `PlayContentSkill` run on `card_dl` too for freshly downloaded content. For cached content they run on `card_worker`.
15. **Taking the display lock can block for 30 seconds.**
    - `ShowCardFeedback` (`cheeko_v2_board.cc:857`) and `ShowNotification` take `DisplayLockGuard`, which waits up to 30 s (`display.h:127`).
    - They are already called from the main loop, `card_worker` and `card_dl`. Do not call them from the `mp3_decode` task; marshal onto the main loop with `Application::Schedule` (`application.h:83`).
16. **The dev OTA preset uses plain HTTP.**
    - `http://157.245.108.139:8002/toy/ota/` is among the presets (`cheeko_os/cheeko_os.cc:80-87`), so the secret crosses the network unencrypted when that preset is selected.
    - The production presets are HTTPS. This is acceptable for test builds only.

---

## 6. Implementation tasks

Do these in order. Each task ends with a check.

### Task 1: Crypto module, host test and CI

**Files:**

- create `main/boards/common/content_crypto.h` and `main/boards/common/content_crypto.cc`;
- create `tests/content_crypto_test.cc`;
- edit `main/CMakeLists.txt`;
- edit `.circleci/config.yml`.

The module is pure mbedTLS, with no ESP-IDF headers, so the same file compiles on the device and in the host test. It uses only APIs present in both mbedTLS 2.28 (Ubuntu) and 3.x (ESP-IDF 5.5): `aes`, `md`, `platform`, `platform_util`.

`content_crypto.h`:

```cpp
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <mbedtls/aes.h>

// CKE1 sealed-content support. Contract: docs/sd-content-encryption-firmware.md §4.
// Pure mbedTLS so it builds in the host test too.
namespace ContentCrypto {
constexpr size_t kHeaderBytes = 16;
constexpr uint8_t kSealVersion = 2;

struct Header {
  uint8_t version;
  uint8_t nonce[8];
};

// True, and fills *out, when head[0..15] starts with "CKE1". False = plaintext.
bool ParseHeader(const uint8_t *head, size_t len, Header *out);

// K = AES-128-CTR(HMAC-SHA256(S, "cheeko-wrap-v1")[0:16], nonce_w||0^8, wrapped)
bool UnwrapPackKey(const uint8_t secret[32], const uint8_t wrapped[16],
                   const uint8_t nonce_w[8], uint8_t key_out[16]);

// Lowercase hex of SHA-256(secret)[0:4] (8 chars). Empty string on failure.
std::string SecretFingerprint(const uint8_t secret[32]);

// Exactly 2*n hex chars -> n bytes, case-insensitive. False on bad input.
bool HexToBytes(const char *hex, uint8_t *out, size_t n);

// Zeroise so the compiler cannot elide it.
void Wipe(void *p, size_t len);
}  // namespace ContentCrypto

// Sequential AES-128-CTR decryptor for ONE sealed file. Feed ciphertext in
// file order, in any chunk sizes, in place; keystream position carries over.
class ContentDecryptor {
 public:
  ContentDecryptor();
  ~ContentDecryptor();
  ContentDecryptor(const ContentDecryptor &) = delete;
  ContentDecryptor &operator=(const ContentDecryptor &) = delete;

  bool Init(const uint8_t key[16], const uint8_t nonce[8]);
  bool Update(uint8_t *buf, size_t len);  // decrypts in place
  void Clear();                           // wipes key schedule and CTR state

 private:
  mbedtls_aes_context ctx_;
  uint8_t counter_[16];
  uint8_t stream_block_[16];
  size_t nc_off_ = 0;
  bool ready_ = false;
};

// Allocate through mbedtls_calloc. On device that goes to PSRAM
// (CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC=y); plain `new` would put this ~330-byte
// object in INTERNAL RAM because of CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=512.
ContentDecryptor *NewContentDecryptor();
void DeleteContentDecryptor(ContentDecryptor *d);
```

`content_crypto.cc`:

```cpp
#include "content_crypto.h"

#include <cstring>
#include <new>
#include <mbedtls/md.h>
#include <mbedtls/platform.h>
#include <mbedtls/platform_util.h>

namespace {
const uint8_t kMagic[4] = {'C', 'K', 'E', '1'};
const char kWrapInfo[] = "cheeko-wrap-v1";  // 14 bytes are hashed, not the NUL
}  // namespace

ContentDecryptor::ContentDecryptor() { mbedtls_aes_init(&ctx_); }
ContentDecryptor::~ContentDecryptor() { Clear(); mbedtls_aes_free(&ctx_); }

bool ContentDecryptor::Init(const uint8_t key[16], const uint8_t nonce[8]) {
  Clear();
  // CTR uses the ENCRYPT key schedule for both directions.
  if (mbedtls_aes_setkey_enc(&ctx_, key, 128) != 0) return false;
  memcpy(counter_, nonce, 8);
  memset(counter_ + 8, 0, 8);  // 64-bit big-endian block counter from 0
  memset(stream_block_, 0, sizeof(stream_block_));
  nc_off_ = 0;
  ready_ = true;
  return true;
}

bool ContentDecryptor::Update(uint8_t *buf, size_t len) {
  if (!ready_) return false;
  return mbedtls_aes_crypt_ctr(&ctx_, len, &nc_off_, counter_, stream_block_,
                               buf, buf) == 0;
}

void ContentDecryptor::Clear() {
  mbedtls_aes_free(&ctx_);  // zeroises the round keys
  mbedtls_aes_init(&ctx_);
  mbedtls_platform_zeroize(counter_, sizeof(counter_));
  mbedtls_platform_zeroize(stream_block_, sizeof(stream_block_));
  nc_off_ = 0;
  ready_ = false;
}

ContentDecryptor *NewContentDecryptor() {
  void *mem = mbedtls_calloc(1, sizeof(ContentDecryptor));
  return mem ? new (mem) ContentDecryptor() : nullptr;
}

void DeleteContentDecryptor(ContentDecryptor *d) {
  if (!d) return;
  d->~ContentDecryptor();
  mbedtls_free(d);
}

namespace ContentCrypto {

bool ParseHeader(const uint8_t *head, size_t len, Header *out) {
  if (head == nullptr || len < kHeaderBytes || memcmp(head, kMagic, 4) != 0) {
    return false;
  }
  out->version = head[4];
  memcpy(out->nonce, head + 8, 8);
  return true;
}

bool UnwrapPackKey(const uint8_t secret[32], const uint8_t wrapped[16],
                   const uint8_t nonce_w[8], uint8_t key_out[16]) {
  const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (sha256 == nullptr) return false;
  uint8_t mac[32];
  if (mbedtls_md_hmac(sha256, secret, 32,
                      reinterpret_cast<const uint8_t *>(kWrapInfo),
                      sizeof(kWrapInfo) - 1, mac) != 0) {
    return false;
  }
  ContentDecryptor *d = NewContentDecryptor();  // off the caller's stack
  bool ok = d != nullptr && d->Init(mac, nonce_w);  // first 16 bytes = wrap_key
  Wipe(mac, sizeof(mac));
  if (ok) {
    memcpy(key_out, wrapped, 16);
    ok = d->Update(key_out, 16);  // CTR is symmetric: unwrap == wrap
  }
  DeleteContentDecryptor(d);
  if (!ok) Wipe(key_out, 16);
  return ok;
}

std::string SecretFingerprint(const uint8_t secret[32]) {
  const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  uint8_t digest[32];
  if (sha256 == nullptr || mbedtls_md(sha256, secret, 32, digest) != 0) return "";
  static const char kHex[] = "0123456789abcdef";
  std::string fp(8, '0');
  for (int i = 0; i < 4; ++i) {
    fp[2 * i] = kHex[digest[i] >> 4];
    fp[2 * i + 1] = kHex[digest[i] & 0x0F];
  }
  Wipe(digest, sizeof(digest));
  return fp;
}

static int HexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool HexToBytes(const char *hex, uint8_t *out, size_t n) {
  if (hex == nullptr || strlen(hex) != 2 * n) return false;
  for (size_t i = 0; i < n; ++i) {
    int hi = HexNibble(hex[2 * i]), lo = HexNibble(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = static_cast<uint8_t>((hi << 4) | lo);
  }
  return true;
}

void Wipe(void *p, size_t len) { mbedtls_platform_zeroize(p, len); }

}  // namespace ContentCrypto
```

**Host test, `tests/content_crypto_test.cc`.** Use plain `assert`, no framework, and assert these cases:

1. `ParseHeader` on the §4.5 sealed-file vector returns version 2 and nonce `1011121314151617`. It returns false for 16 bytes starting `ID3`, and false for 15 bytes.
2. Decrypting the 32 ciphertext bytes **in place** with one `Update` yields `cheeko content encryption test!!`.
3. The same result comes from split calls of 7 + 9 + 16 bytes. This proves the keystream carries across calls and that in-place works.
4. A random 5000-byte buffer, sealed with a helper (re-encrypting is the same operation), decrypts correctly with chunk sizes 2048, 7 and the remainder.
5. `UnwrapPackKey` on the §4.5 wrap vector returns K = `000102...0f`. Pin the literal `"cheeko-wrap-v1"` in the test itself by recomputing `wrap_key` with `mbedtls_md_hmac` and comparing it to `94e5bea4747beb214b0cb91b3f8825d3`. Then a change to the constant in the module is caught.
6. `SecretFingerprint` of the §4.5 S is `00e98867`.
7. `HexToBytes` rejects a wrong length and a non-hex character, and accepts uppercase.

**Build wiring:**

- Add `"boards/common/content_crypto.cc"` to the hand-listed `SOURCES` next to `"boards/common/content_manager.cc"` (`main/CMakeLists.txt:148`). Only `boards/<board>/*.cc` is globbed (`:228-239`), so `boards/common/` files are not picked up automatically.
- Add `mbedtls` to `PRIV_REQUIRES` (`:447-467`). Today it only arrives transitively through `esp-tls`.

**CI**, in the `host-tests` job (`.circleci/config.yml:41-65`, image `cimg/python:3.11`, which has no mbedTLS):

```yaml
            sudo apt-get update && sudo apt-get install -y libmbedtls-dev
            c++ -std=c++17 -Wall -Wextra -Werror -I main/boards/common \
              tests/content_crypto_test.cc main/boards/common/content_crypto.cc \
              -lmbedcrypto -o /tmp/content_crypto_test
            /tmp/content_crypto_test
```

Do not use the `tests/host/cjson_stub`: its `cJSON_Parse` always returns NULL. Keep this test free of cJSON.

**Done when:**

- the host test passes locally (WSL is fine on Windows) and in CI;
- `idf.py build` succeeds;
- on device, a boot-time log confirms that `NewContentDecryptor()` returns memory where `esp_ptr_external_ram()` is true. Remove that log afterwards.

---

### Task 2: Device secret, fingerprint and the pending flag

**Files:** create `main/boards/common/device_secret.h` and `device_secret.cc`, and add them to `SOURCES`.

```cpp
// device_secret.h — S lives only here (NVS "cheeko": "dev_secret", "dev_sec_pend").
namespace DeviceSecret {
// Read S if it exists. NEVER generates. Use at boot, in reconcile, at playback.
bool Peek(uint8_t out[32]);

// Return S, generating it first if absent. Generation also sets pending=true.
// ONLY call when Wi-Fi RF is up (the OTA body builder), for true randomness.
bool GetOrCreate(uint8_t out[32]);

bool RegistrationPending();
void SetRegistrationPending(bool pending);  // uses SetBool; never EraseKey
}  // namespace DeviceSecret
```

**Implementation notes:**

- Store S as 64 lowercase hex characters with `Settings("cheeko", true).SetString("dev_secret", hex)`. The commit happens when that object goes out of scope.
- Generate S with `esp_fill_random(buf, 32)`.
- Guard `GetOrCreate` with a static mutex. It can run on the activation task, on the settings-screen `sw_update` task (`cheeko_os.cc:2248-2292`), and on `card_dl` (Task 3). Two tasks must not both generate a secret.
- `Peek` and `GetOrCreate` must reject a stored value that is not exactly 64 hex characters. Treat it as absent.
- Callers wipe their copy of S with `ContentCrypto::Wipe` as soon as they are done with it.
- Never log S, the unwrapped key or the wrapped key. Log fingerprints only.

**Done when:**

- the first boot on an erased NVS logs "generated device content secret" exactly once, after Wi-Fi connects;
- a reboot does not regenerate the secret;
- `dev_sec_pend` reads true before the first successful OTA check and false after it.

---

### Task 3: Send S on the OTA check, and re-register when needed

**File:** `main/ota.cc`, in `Ota::CheckVersion` (`:92-126`).

1. After `std::string data = board.GetSystemInfoJson();` at `:108`, inject the secret into **this request only**:

   ```cpp
   // Only the OTA request carries S. GetSystemInfoJson() is also served over
   // MCP (mcp_server.cc:137), so the secret must never be added there.
   uint8_t s[32];
   if (DeviceSecret::GetOrCreate(s) && !data.empty() && data[0] == '{') {
     char hex[65];
     for (int i = 0; i < 32; ++i) snprintf(hex + 2 * i, 3, "%02x", s[i]);
     data.insert(1, std::string("\"content_secret\":\"") + hex + "\",");
     ContentCrypto::Wipe(hex, sizeof(hex));
   }
   ContentCrypto::Wipe(s, sizeof(s));
   ```

   Check that nothing logs `data` before it is sent. It is not logged today.

2. Right after the `status_code != 200` check passes (`:118-122`), call `DeviceSecret::SetRegistrationPending(false)`. A 200 means the server ran its registration step.
   - Known gap: a 200 does not *prove* the secret was stored. The server silently drops it for an unregistered MAC, and does nothing when the feature is off. See §9 for the recommended backend acknowledgement.
   - That does not break anything, because the toy re-sends S on **every** OTA check, so the server converges at the next boot.

3. **Runtime re-registration.** This matters when the boot check failed but the protocol started from cached endpoints (§5, fact 11). Do it inside the pending gate of Task 4, on the `card_dl` task, which already runs HTTP.
   - The call is `Ota ota; esp_err_t r = ota.CheckVersion();`, the same call the settings screen makes at runtime.
   - Its side effect of rewriting the MQTT, websocket and openclaw NVS entries is identical to boot. The new MQTT credentials only apply at the next reconnect.
   - Measure `uxTaskGetStackHighWaterMark()` on `card_dl` during this call. If less than 1 KB is left, move the call to a short-lived task instead. Use a static stack if the internal heap cannot supply one reliably.

**Done when:**

- the server's `ai_device.content_secret` is non-null for the toy's MAC after boot;
- the server log shows `content_secret: [REDACTED]`;
- running `grep content_secret` on a UART log of the whole boot finds nothing.

---

### Task 4: Parse and store wrapped keys, plus the pending gate

**File:** `main/boards/common/content_manager.{h,cc}`.

1. **Data.** Add to `SkillMetadata` (`content_manager.h:27-33`):

   ```cpp
   std::string wrapped_key_hex;  // 32 hex, empty = plaintext pack
   std::string wrap_nonce_hex;   // 16 hex
   ```

   Add a small value type, and pass it by const reference into `DownloadSkill` and `DownloadGroupedSkill` (`content_manager.h:303-312`):

   ```cpp
   struct WrappedKey { std::string key_hex, nonce_hex; bool present() const { return !key_hex.empty(); } };
   ```

2. **Parse `card_content`** (`HandleServerResponse`, fields at `:673-681`). Read `encryption`. Accept it only when `v == 2`, `key` is 32 hex characters and `nonce` is 16 hex characters. Anything else becomes "absent", with an `ESP_LOGW`.

3. **The pending gate.** This is the most important ordering rule in the whole design. Place it at the top of the `card_content` branch, before any download decision (`:728`):
   - If `DeviceSecret::RegistrationPending()` is true, the reply you are holding was wrapped for whatever secret the server had, and that may be the old one. **Do not download it.**
   - Run the Task 3 re-registration on this `card_dl` task.
   - On success, clear pending and discard this reply. Then re-send the lookup through `Application::SendCardLookup(uid, BuildCardLookupPayload(uid))`, so that the reply you use is wrapped under the current secret.
   - On failure, keep pending, show "Can't reach Cheeko right now — try again" once, and return.
   - Why "register before the lookup" and not "before the download": the server bakes the wrap into the lookup response itself. The Python reference hit exactly this bug before the gate moved.

4. **Manifest writers.**
   - In the flat writer (`:1675-1735`) and the grouped writer (`:1991-2061`), when `wk.present()`, add `enc` with `cJSON_AddObjectToObject(manifest, "enc")` and the three fields `v`, `key` and `nonce`.
   - Keep the existing `manifest.tmp` → fsync → rename sequence.
   - Stay under the reader's 8192-byte limit (`:1153`). `enc` adds about 70 bytes.

5. **The reader.** In `ScanDownloadedSkills` (`:1142-1204`), read `enc` into the two new `SkillMetadata` fields.

6. **In-memory updates.** Every place that refreshes `skill_metadata_` without a reboot must set, or clear, the two new fields:
   - `DownloadSkill` `:1733-1734` (today it only updates version and hash);
   - `DownloadGroupedSkill` `:2059-2061`;
   - `HandleServerResponse` `:805-810`.

   The `card_up_to_date` branch (`:619-627`) must **not** touch them.

7. **`card_ai` character art** (`:511-550`, then `EnsureCharacterArt` `:319-439`):
   - Parse `character.encryption` the same way, and apply the pending gate. While pending, skip the art download: the drawn face is the existing fallback.
   - Write `chars/<folder>/enc.jsn` **before** `char.jsn`, because `char.jsn` is the completion marker checked by `HasCharacterArt` (`:301-311`).
   - If a character arrives without `encryption`, delete any stale `enc.jsn`.

**Done when:**

- after a tap on a sealed pack, `manifest.jsn` on the SD card contains an `enc` block with a 32-hex-character key;
- the files under `audio/` and `images/` start with `CKE1`;
- no file on the SD card contains the unwrapped key. Check this on a PC by searching the card for the key printed by a temporary debug build, then remove that print.

---

### Task 5: Boot-time reconcile and targeted invalidation

**File:** `content_manager.cc`. Add `ReconcileSecret()` and call it in `ContentManager::Initialize` right after `ScanDownloadedSkills()` (`:91`). Call it again at the start of the `card_content` branch, before the pending gate. It is cheap and idempotent: one tiny file read and one SHA-256.

It handles five cases. S comes from `DeviceSecret::Peek` (never create it here), and `fp` is the content of `/sdcard/cheeko/secret.fp`:

| S present? | `secret.fp` | Meaning | Action |
|---|---|---|---|
| yes | absent | Card from before this feature, or a first run | Write `fp(S)`. **Do not invalidate.** |
| yes | equals `fp(S)` | Normal | Nothing |
| yes | differs | Card written for another secret: an NVS erase followed by regeneration, or an SD card moved from another toy | Invalidate sealed content, then write `fp(S)` |
| no | absent | Fresh device with a fresh card | Nothing |
| no | present | NVS erased and the old S is gone for good | Invalidate sealed content and delete `secret.fp`. Case 1 writes the new one later. |

"Invalidate sealed content" means:

- **Packs:** for every skill whose metadata has `wrapped_key_hex` non-empty, call the existing `InvalidateSkill(skill_id)` (`:214-221`). Plaintext packs are left alone, because they do not depend on S.
- **Characters:** for every `chars/<folder>/enc.jsn`, delete `enc.jsn` and `char.jsn`. `HasCharacterArt` then goes false and the four sprites download again. `EnsureCharacterArt` has no resume-skip, but the sprites are small.
- Log once, with the old and new fingerprints and the number of skills invalidated.

**Why targeted rather than wiping `skills/`:**

1. The files are sealed under K, which never changes when S does. Only the wrapped key is dead.
2. The resume-skip (§5, fact 8) means the next `card_content` rewrites only the manifest, with zero file bandwidth.
3. Folder deletion is deliberately disabled in this firmware (§5, fact 7).

The card map is left alone. An invalidated skill makes `OnCardTapped` take the "known card, skill not on SD" path (`:145-148`), which sends a lookup.

**Done when:**

- a single boot with NVS erased (for example via `idf.py erase-region` on the nvs partition, or the factory-reset path) logs the invalidation;
- the next tap, once connected, re-registers, re-fetches only the manifest (no file downloads in the log), and plays.

---

### Task 6: Key plumbing from manifest to player

1. **`ContentManager::GetSkillKey(const std::string& skill_id, uint8_t key_out[16]) const`** returns a status enum:

   ```cpp
   enum class KeyStatus { kPlaintext, kOk, kNoSecret, kMalformed, kUnwrapFailed };
   ```

   It reads the metadata `enc`, converts it with `HexToBytes`, calls `DeviceSecret::Peek`, then `UnwrapPackKey`, and wipes S. `kPlaintext` means the pack needs no key. It unwraps on every call and caches nothing.

2. **A character key helper**, `GetCharacterKeyForFile(const std::string& bin_path, uint8_t key_out[16])`. It reads `enc.jsn` from `dirname(bin_path)`. That sidesteps the catalog-id versus folder mapping (`lcd_display.cc:2329` passes the catalog id, not the folder).

3. **The router** (`cheeko_content_router.cc`) holds the current key for the skill that is playing:
   - Set it in `PlaySkill` (`:86-132`) before `SetPlaylist`.
   - Pass it to `Mp3Player` and use it when loading pack images.
   - Grouped packs share one key, so `SwitchToGroup` (`:44-84`) must **not** clear it.

4. **Clear and wipe the key wherever pack playback ends or the speaker is handed to something else:**
   - `PrepareForContentDownload` (`cheeko_card_playback_controller.cc:146-147`)
   - `StopForCardRemoval` (`:165-174`)
   - the low-battery shutdown (`cheeko_v2_board.cc:1842`)
   - the `AudioService` external stopper used by TTS and AI speech (`:4951-4959`)
   - USB Drive Mode (`:5231`)
   - the boot SD-root playlist (`:3959`)

   Plaintext files never use a key, so a stale key cannot break them. Clearing is for key hygiene, not correctness.

5. **`Mp3Player` API.**
   - `SetPlaylist(files)` clears the key, and a new `SetPlaylist(files, key16)` sets it.
   - Game sounds call the public `PlayFile` directly on the same player (`cheeko_animal_sound_player.cc:54`, `:86`). Make public `PlayFile(path)` clear the key.
   - Have `NextTrack`, `PreviousTrack` and `PlayTrackAt` use a private `PlayFileInternal(path)` that keeps it.

**Done when:** a sealed pack plays; a game sound played right after it still plays; radio still plays afterwards.

---

### Task 7: MP3 decryption, plaintext check and failing closed

**File:** `main/audio/mp3_player.{h,cc}`.

1. **Members.**
   - `ContentDecryptor* decryptor_`, allocated once with `NewContentDecryptor()` when the player is set up, and never on the 4 KB decode stack.
   - The current key: 16 bytes plus a flag, guarded by a small mutex.
   - `DecodeLoop` copies the key under the mutex at the start of each file.
   - A new `std::function<void(const std::string&)> on_decrypt_failed_`.

2. **Header detection without seeking.** `DecodeLoop` never seeks today; keep it that way. After the first `fread(read_buf, 1, READ_BUF_SIZE, file)` at `:312`:

   ```cpp
   bool sealed = false;
   ContentCrypto::Header hdr{};
   if (ContentCrypto::ParseHeader(read_buf, bytes_in_buf, &hdr)) {
     if (!has_key || hdr.version != ContentCrypto::kSealVersion ||
         !decryptor_->Init(key, hdr.nonce)) {
       fail_reason = !has_key ? "sealed file, no key" : "bad seal header";
       goto decrypt_failed;
     }
     bytes_in_buf -= ContentCrypto::kHeaderBytes;
     memmove(read_buf, read_buf + ContentCrypto::kHeaderBytes, bytes_in_buf);
     decryptor_->Update(read_buf, bytes_in_buf);
     sealed = true;
     if (!LooksLikeMp3(read_buf, bytes_in_buf)) {
       fail_reason = "wrong key";
       goto decrypt_failed;
     }
   }
   ```

   `LooksLikeMp3` accepts `"ID3"` at offset 0, or an MPEG frame sync: `b[0] == 0xFF && (b[1] & 0xE0) == 0xE0`.
   - This check is the **only** wrong-key detector, because CTR has no integrity check and the decoder hides garbage (§5, fact 2).
   - Apply it to sealed files only. Plaintext files keep today's behaviour.
   - After the `memmove` the buffer has 16 bytes of room, and `eof` must still be computed from the raw read size, exactly as today.

3. **Refill.** After the refill `fread` at `:340`, when `sealed` is set, call `decryptor_->Update(read_buf + bytes_in_buf_before_read, got)`. The decryptor carries the keystream position, so chunk sizes do not matter.

4. **One cleanup path.** Route the new failure, **and the three existing early returns** (`:285-308`), through the block that ends with `SetExternalOutputActive(false)` and `CheekoAudioSession::GetInstance().Release(CheekoAudioOwner::kMp3)` (`:433-434`). Then call `decryptor_->Clear()`. This fixes the pre-existing ownership leak (§5, fact 4).
   - A small scope guard (RAII) is the simplest way to do it.
   - The `goto` in the step 2 snippet only shows the intent. In C++ a `goto` may not jump over locals that have initializers, such as `buf_offset` and `first_frame`. Either hoist those declarations above the jump, or use the guard.
   - Compute `eof` from the raw `fread` size **before** subtracting the 16 header bytes, or a short sealed file will be treated as ending early.

5. **No autoplay cascade.** Set a `decrypt_failed_` flag. In `DecodeTask` (`:269-275`), when it is set, fire `on_decrypt_failed_(current_path_)` **instead of** `on_playback_finished_`, and do not advance.

6. **Board handler for `on_decrypt_failed_`.** It runs on `mp3_decode`, so marshal everything through `Application::GetInstance().Schedule(...)`:
   - stop the playlist;
   - show "This card needs an update — tap again while connected" once, using `ShowCardFeedback`;
   - call `ContentManager::InvalidateSkill(skill_id)`, so the next tap does a lookup instead of replaying the broken copy;
   - if the reason was "wrong key", also call `DeviceSecret::SetRegistrationPending(true)`, so the next download re-registers first.

   This closes a loop that would otherwise stick forever. A known card with a dead or missing key plays locally on every tap, and a lookup for it would only return `card_up_to_date`, so it would never be repaired.

7. **Logging.** Use one stable tag, for example `ESP_LOGE("CONTENT-CRYPTO", "skill=%s file=%s reason=%s", ...)`. Never log key material.

**Done when:**

- the sealed pack plays all tracks;
- a tampered `manifest.jsn` key (flip one hex digit) produces one on-screen message, no noise, no rapid skipping through tracks, and radio still works afterwards;
- the next connected tap repairs it.

---

### Task 8: Decrypting pack images

**File:** `main/boards/cheeko-v2/cheeko_sd_image_loader.cc`, `CheekoSdImageLoader::Load` (`:19-118`).

1. Add a parameter, `Load(const std::string& path, const uint8_t* key16 = nullptr)`.
2. After the whole-file read into the PSRAM buffer, and before the LVGL header check (`:73`), handle a sealed file:
   - fail if there is no key or the version is not 2;
   - `Init`, then `Update(buffer + 16, file_size - 16)`, then `memmove(buffer, buffer + 16, file_size - 16)`, then `file_size -= 16`;
   - use a decryptor from `NewContentDecryptor()` and delete it straight away.
3. For a sealed file, the decrypted content **must** pass the existing LVGL RGB565 validation (`:85-99`). If it does not, return `nullptr`. Do **not** fall through to the PNG/JPG path at `:112`, which would hand garbage to the image decoder.
4. **Callers:**
   - `ShowImageFromSd` (`cheeko_v2_board.cc:2839`) handles pack content, so it passes the router's current key;
   - the game renderer (`cheeko_game_renderer.cc:166-173`) and the SD-root image list pass `nullptr`.
5. The internal-heap guard (`:24-30`) and the internal-RAM fallback allocation (`:49-54`) are unchanged. There is no new large allocation.

**Done when:** every pack image shows while its track plays, and game PNGs still render.

---

### Task 9: Decrypting character sprites

**File:** `main/display/cheeko_character_art.cc`, `LoadBinFile` (`:201-320`).

Today it reads the 12-byte LVGL header (`:253`), seeks to the end to get the size (`:274-278`), checks payload bounds (`:284`), allocates the payload in PSRAM (`:293`), then seeks to `kHeaderSize` and reads the payload (`:300-301`).

For a sealed file:

1. Read the first 16 bytes. If `ParseHeader` fails, `fseek(f, 0, SEEK_SET)` and run the existing code unchanged.
2. If sealed, get the key with `GetCharacterKeyForFile(path)`. With no key, return `nullptr` without setting the "deferred" flag, since retrying will not help.
3. `Init` one decryptor. Read the 12 bytes at offset 16 and `Update` them, then validate them as today's LVGL header.
4. The payload size is `file_size - 16 - 12`. Apply the existing min and max bounds to it.
5. `fseek(f, 16 + 12, SEEK_SET)`, read the payload, then `Update` it with the **same** decryptor, which continues the keystream correctly.
6. Clear and delete the decryptor.
7. The 12 KB internal-heap guard (`:215-232`) stays in front of all of this.

The UI-art callers (`CheekoHeroArt::Get` `:415`, `GetThemePreview` `:468`) read plaintext files and are unaffected.

**Done when:** a character card whose sprites were uploaded sealed shows all four faces (connect, listen, think, talk).

---

### Task 10: User-facing behaviour

| Situation | What the toy does |
|---|---|
| Sealed pack, correct key | Plays normally. Online and offline behave the same. |
| Plaintext pack | Plays exactly as today |
| Sealed file with no usable key: no S yet, no `enc`, or unwrap failed | No audio. Message: "This card needs an update — tap again while connected". The skill is invalidated. |
| Unwrap succeeded but content is not MP3 or LVGL (wrong key) | As above, and additionally sets registration pending |
| Registration pending and server unreachable | No download. Message: "Can't reach Cheeko right now — try again" |
| SD card moved from another toy | Reconcile invalidates its sealed packs at boot. Once connected, the next tap fetches this toy's keys and reuses the files. |

The wording of these messages belongs to the product team. The behaviour does not.

---

## 7. Test plan

### 7.1 Host test

This is Task 1. It is also the only automated guard on the byte format, so keep it in CI.

### 7.2 Server setup for device testing

- **Backend.** Run `cheeko-backend` branch `feat/sd-content-encryption` (manager-api-node and mqtt-gateway) on a machine the toy can reach, with `CONTENT_MASTER_KEY` set in the API's `.env`. Point the toy's OTA URL at it.
  - If you use a plain-HTTP preset, remember the secret crosses the network in the clear.
- **Device binding.** The toy's MAC must be bound to a user, so that it has an `ai_device` row. Without one the server drops the secret.
- **Test packs.** These already exist in the shared test database:

  | Pack | Id | Contents |
  |---|---|---|
  | `ENCTEST-20260909-1046` | 72 | sealed: 10 MP3 and 10 LVGL `.bin` |
  | `ENCTEST-LEGACY-20260909-1046` | 73 | plaintext control |

- **Card binding.** The card UIDs used in software tests are synthetic, so bind **real** RC522 cards to those packs. Use the dashboard's RFID page, or an admin call:

  ```bash
  curl -X POST http://<server>:8002/toy/admin/rfid/card -H "Authorization: Bearer <admin token>" -H "Content-Type: application/json" -d "{\"rfidUid\":\"<UID uppercase hex, no separators>\",\"contentPackId\":72}"
  ```

- **Never** modify or delete existing S3 content, and never run `scripts/backfill-seal-content.js`. Create new packs if you need more test data.

### 7.3 Device checklist

| # | Step | Expected |
|---|---|---|
| 1 | Erase NVS, boot, connect Wi-Fi | "generated device content secret" appears once. The server's `ai_device.content_secret` is non-null. |
| 2 | Tap the sealed card | Downloads. `manifest.jsn` has `enc`. All 10 tracks play and all 10 images show. |
| 3 | USB Drive Mode, then open `skills/enctest-20260909-1046/audio/01.mp3` on a PC | Starts with `CKE1`. It is not playable. |
| 4 | Disconnect Wi-Fi and tap the sealed card again | Plays fully offline |
| 5 | Tap the plaintext card | Plays. No crypto logs. |
| 6 | Move the SD card to a second toy that has its own secret, and tap offline | No audio. One message. No track skipping. Radio still works. |
| 7 | Second toy, connected, tap again | Re-registers if needed, re-fetches only the manifest (no file downloads), and plays |
| 8 | Erase NVS on the first toy and reboot | Reconcile logs the invalidation with both fingerprints |
| 9 | Tap while the server is unreachable | "Can't reach Cheeko" message, no download, pending stays set |
| 10 | Server reachable, tap | Registration first, then a fresh wrapped key, then it plays. Files are not re-downloaded. |
| 11 | Flip one hex digit of `enc.key` in `manifest.jsn` on a PC, then tap | One message, no noise, the skill is invalidated, and the next connected tap repairs it |
| 12 | Character card with sealed sprites | All four faces render |
| 13 | Regression: game sounds, radio, TTS and AI speech, the boot SD-root playlist, app cards | All unchanged |
| 14 | Stack headroom | `uxTaskGetStackHighWaterMark` on `mp3_decode`, `card_dl` and `card_worker` during the steps above stays above 1 KB |

---

## 8. Acceptance criteria

- [ ] The host test passes in CI with the §4.5 vectors asserted literally.
- [ ] S is generated only after Wi-Fi is up, only once, stored as 64 hex characters in NVS `cheeko/dev_secret`, and never logged.
- [ ] S appears only in the OTA POST body, never in `GetSystemInfoJson`.
- [ ] `dev_sec_pend` is set on generation, cleared on an OTA HTTP 200, and set again after a wrong-key failure.
- [ ] No download happens while registration is pending. A pending state triggers re-registration and then a fresh lookup.
- [ ] Sealed packs store their files as served, plus `enc` in `manifest.jsn`. The plain key is never written.
- [ ] MP3 and LVGL decryption are in place, with no new internal-RAM allocations, and the decryptor never sits on the 4 KB decode stack.
- [ ] A sealed file never reaches the decoder or the image decoder undecrypted. A wrong key produces one message, no autoplay cascade, no leaked audio ownership, and an invalidated skill.
- [ ] Boot reconcile covers the five cases in Task 5, with targeted invalidation only. Nothing is deleted except manifests, `enc.jsn` and `char.jsn`.
- [ ] All plaintext paths behave exactly as before.
- [ ] Every new file name is 8.3.
- [ ] The device checklist in §7.3 passes.

---

## 9. Rollout, dependencies and limits

- **Order matters.**
  1. Ship this firmware first. It plays plaintext exactly as before, so it is safe to release before any content is sealed.
  2. Wait for the fleet to adopt it. The server's tap log records `client_version` per device.
  3. Only then set `CONTENT_MASTER_KEY` in production.

  Turning the flag on early makes every newly uploaded pack unplayable on older firmware. Sealing is a property of the single S3 object, so there is no plaintext copy to fall back to.
- **Backend dependency that is not yet built.** The OTA response does not acknowledge the secret. The recommended addition is `content_secret_fp` in the OTA response: the fingerprint of the secret the server now holds. The toy could then clear `dev_sec_pend` only on an exact match. Until that exists, HTTP 200 is the signal (Task 3).
- **Custom-card recordings are not sealed yet.** The server deliberately skips them, because the parent app cannot decrypt. When that changes, they arrive through the same `card_content.encryption` path and need no extra firmware work.
- **Hardware AES stays off**, as described in §5, fact 1.
- **Flash encryption, NVS encryption and Secure Boot are all off** (`sdkconfig:494-495`, `:2472`). S is therefore readable from a flash dump. This design stops casual copying of SD cards, including through USB Drive Mode. It does not stop someone with a flash reader. Plan flash encryption as a separate project, starting in development mode, because release mode is one-way per chip.
- **Unauthenticated registration (a backend concern, noted for completeness).** Anyone can post a different secret for a MAC. The toy then sees "unwrap succeeded, content does not decode", shows the message and sets pending. It heals itself at the next OTA check, because the toy re-sends its real secret every time.

---

## 10. Existing firmware issues found during the scan

None of these are caused by this work, but several interact with it. They are worth fixing or ticketing.

1. **A pack update never re-fetches files that already exist.** The resume-skip combined with the disabled `CleanSkillFolder` means a new version keeps the old files and writes a new manifest over them (`content_manager.cc:1227-1233`, `:1241-1244`). Rotation recovery in Task 5 relies on this. Real content updates are broken by it.
2. **`card_up_to_date` updates metadata in memory only** (`:619-627`). Until the next reboot, the lookup reports a local version newer than what is on disk.
3. **`HasLocalContent` does not lowercase the skill id** (`:177-181`), while `OnCardTapped` does (`:135-138`).
4. **`char.jsn` is written without a temp file and rename** (`EnsureCharacterArt`, `:428-434`). A power cut can leave it half-written.
5. **`Mp3Player` leaks audio ownership on its early returns** (`mp3_player.cc:285-308`). Task 7 fixes it.
6. **Undecodable MP3 data plays as silence and then autoplays the next track** (`:374-384`, `:269-275`). Task 7 guards sealed files. Corrupt plaintext files still behave this way.
7. **`TASK_STACK_SIZE = 8192` in `mp3_player.h:91` is dead.** The real stack is 4 KB (`mp3_player.cc:24-26`).
8. **The host-test cJSON stub always returns NULL from `cJSON_Parse`**, so no host test can cover manifest parsing yet.

---

## Appendix A: Example `manifest.jsn` for a sealed flat pack

```json
{
  "skill_id": "enctest-20260909-1046",
  "skill_name": "ENCTEST-20260909-1046",
  "version": 1,
  "audio_count": 10,
  "image_count": 10,
  "enc": { "v": 2, "key": "d0bed8c7ab3cc5a61b26cfc58ed34633", "nonce": "adf6872b79fe0251" }
}
```

The `key` shown is a *wrapped* key, which is useless without that toy's S. It is a real example from a test run.

## Appendix B: Glossary

| Term | Meaning |
|---|---|
| Sealed | A file carrying the 16-byte `CKE1` header followed by AES-128-CTR ciphertext |
| S | The per-device 32-byte secret, kept in NVS |
| K | The per-pack (or per-character) 16-byte content key, which lives on the server |
| Wrapped key | K encrypted under a key derived from S. It is safe to store on SD and to send over the network. |
| Fingerprint | The first 4 bytes of SHA-256(S) as 8 hex characters. It identifies which S a card was written for, without revealing S. |
| Registration pending | The toy has an S the server may not have yet. No downloads are allowed until it is re-registered. |
| Reconcile | The boot check comparing the card's fingerprint with the current S, and invalidating sealed content on a mismatch |
