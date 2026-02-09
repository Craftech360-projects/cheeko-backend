# Kid Toy Mode — Implementation Plan

> **Board:** jiuchuan-s3 (ESP32-S3)
> **Status:** T1-T5 verified ✅ | T6-T8 awaiting test | T12-T15 implementation complete — ready for hardware test | Phase 9 (Content Mapping) planned
> For project context see [CLAUDE.md](../CLAUDE.md) and [File Understanding](file-understanding.md).

## Summary

Add RFID-triggered MP3 playback from SD card + rotary encoder control to the jiuchuan-s3 board, with a server-driven content mapping & download system (Cheeko cards → skills → audio/image content). Existing AI voice features are hidden via compile-time flag but preserved for later use.

## Architecture

```
PN532 (I2C) ──► CardAudioMapper ──► Mp3Player ──► AudioCodec (ES8311) ──► Speaker
                    ▲                    ▲
SD Card (SDMMC) ────┘                    │
Rotary Encoder ──────────────────────────┘ (next track / volume)
```

All new components are orchestrated by a `KidToyController` initialized at the board level.

## Pin Assignments

| Component | Pin | GPIO |
|-----------|-----|------|
| Rotary Encoder CLK | A | GPIO 8 |
| Rotary Encoder DT | B | GPIO 15 |
| Rotary Encoder SW | Press | GPIO 16 |
| PN532 RFID SDA | I2C Data | GPIO 17 |
| PN532 RFID SCL | I2C Clock | GPIO 18 |
| SD Card CLK | SDMMC Clock | GPIO 47 |
| SD Card CMD | SDMMC Command | GPIO 48 |
| SD Card DAT0 | SDMMC Data | GPIO 21 |

---

## Phase 1: Config & Build Setup — ✅ Done

### 1.1 Update pin config
**File:** `main/boards/jiuchuan-s3/config.h`
- Add all pin definitions from table above
- Add feature flags: `KIDTOY_MODE_ENABLED 1` and `AI_VOICE_ENABLED 0`

### 1.2 Update CMakeLists.txt
**File:** `main/CMakeLists.txt`
- Add new source files to `SOURCES` list:
  - `boards/common/sd_manager.cc`
  - `boards/common/pn532_reader.cc`
  - `boards/common/card_audio_mapper.cc`
  - `boards/common/kid_toy_controller.cc`
  - `audio/mp3_player.cc`

---

## Phase 2: SD Card Manager — ✅ Done

### 2.1 Create `main/boards/common/sd_manager.h` and `sd_manager.cc`
- `Mount(mount_point, clk, cmd, d0)` — mount SD card via SDMMC 1-line mode using `esp_vfs_fat_sdmmc_mount()`
- `Unmount()`
- `ListAudioFiles(directory)` → returns `std::vector<std::string>` of .mp3 file paths
- `IsMounted()` — check mount status
- Uses ESP-IDF built-in `sdmmc_cmd.h`, `driver/sdmmc_host.h`, `esp_vfs_fat.h`
- SDMMC 1-line mode: CLK (GPIO 47), CMD (GPIO 48), DAT0 (GPIO 21)

---

## Phase 3: MP3 Player — ✅ Done

### 3.1 Create `main/audio/mp3_player.h` and `mp3_player.cc`
- `Initialize(AudioCodec* codec)` — store codec pointer for output
- `PlayFile(path)` — open MP3 file, start decode task
- `Stop()`, `Pause()`, `Resume()`
- `SetPlaylist(files)` + `NextTrack()` + `PreviousTrack()`
- `SetOnTrackChanged(callback)` — notify controller of track changes
- `IsPlaying()` — current state

**Decode flow (FreeRTOS task):**
1. Read MP3 chunks from file (2048 bytes at a time)
2. Decode via `esp_mp3_dec_decode()` from existing `espressif/esp_audio_codec` component
3. Resample PCM if MP3 sample rate != codec output rate (24000 Hz)
4. Call `codec->OutputData(pcm_vector)` to play through speaker

**Reuse:** `AudioCodec::OutputData()` (`main/audio/audio_codec.h:27`) writes PCM to I2S — same path used by cloud TTS.

---

## Phase 4: PN532 RFID Reader — ✅ Done

### 4.1 Create `main/boards/common/pn532_reader.h` and `pn532_reader.cc`
- `Initialize(i2c_master_bus_handle_t bus, uint8_t addr)` — add device to I2C bus
- `StartPolling()` — create FreeRTOS task that polls every 200ms
- `StopPolling()`
- `OnCardDetected(callback)` — callback with UID bytes
- `OnCardRemoved(callback)` — callback when card leaves

**PN532 I2C protocol implementation:**
1. Send SAMConfiguration command (normal mode)
2. Poll with InListPassiveTarget (ISO14443A)
3. Parse response for UID (4 or 7 bytes)
4. Track last UID to detect removal (no card response = removed)

**Reuse:** `I2cDevice` pattern from `main/boards/common/i2c_device.cc/h` for I2C register access.

---

## Phase 5: Card-to-Audio Mapper — ⬜ Not started

### 5.1 Create `main/boards/common/card_audio_mapper.h` and `card_audio_mapper.cc`
- `LoadMappings(json_path)` — read `/sdcard/card_mappings.json`
- `GetMapping(uid)` → returns `AudioMapping` struct (type: file/playlist/directory, path)
- `HasMapping(uid)` — check if card is known

**SD card config file format** (`/sdcard/card_mappings.json`):
```json
{
  "cards": [
    {"uid": "04A1B2C3", "name": "Bear", "path": "/music/lullaby.mp3"},
    {"uid": "04D4E5F6", "name": "Story", "directory": "/stories/adventure"}
  ],
  "default_directory": "/music"
}
```

Uses `cJSON` (already available in ESP-IDF) for JSON parsing.

---

## Phase 6: Kid Toy Controller — ⬜ Not started

### 6.1 Create `main/boards/common/kid_toy_controller.h` and `kid_toy_controller.cc`
- Orchestrates: PN532Reader + SdManager + CardAudioMapper + Mp3Player
- `Initialize(codec, display)` — set up all components
- `Start()` / `Stop()`

**Event handling:**
- Card detected → look up mapping → start playback
- Card removed → stop playback (optional, configurable)
- Encoder turn → volume up/down (reuse `AudioCodec::SetOutputVolume()`)
- Encoder press → next track in playlist
- Display feedback → show track name, card name, volume

---

## Phase 7: Board Integration — 🔄 In progress (partial)

### 7.1 Modify `main/boards/jiuchuan-s3/jiuchuan_dev_board.cc`
- Add `#if KIDTOY_MODE_ENABLED` blocks:
  - Create separate I2C bus for PN532 (I2C port 0, since codec uses port 1)
  - Initialize SD card via SDMMC (CLK: 47, CMD: 48, DAT0: 21)
  - Initialize rotary encoder: `Knob(GPIO 8, GPIO 15)` for turn + `Button(GPIO 16)` for press
  - Create and start `KidToyController`
- Modify button handlers:
  - When `KIDTOY_MODE_ENABLED`: power button pauses/resumes, vol buttons still work for volume
  - When `AI_VOICE_ENABLED`: existing behavior (toggle chat, etc.)

### 7.2 Modify `main/application.cc`
- Wrap wake word detection setup in `#if AI_VOICE_ENABLED`
- Wrap protocol initialization in `#if AI_VOICE_ENABLED`
- Keep `AudioService` initialization (needed for codec access)
- Keep network initialization (needed for future streaming)

---

## Phase 8: Display & LED Feedback — ⬜ Not started

### 8.1 Modify display in board (optional, low priority)
- Show current track name on LCD
- Show card name when detected
- Show volume level on encoder turn
- Use existing `Display::ShowNotification()` method

---

## Phase 9: RFID Content Mapping & Download — ⬜ Not started

> Replaces the simple `card_audio_mapper` (Phase 5) with a server-driven content management system. Cards are sold in bulk (Cheeko1-Cheeko1000) and grouped into **skills** (content packs). The device downloads content on first card tap and plays offline thereafter.

### 9.1 Core Design: Card → Skill → Content

```
Card UID (E96C8A82)  ──┐
Card UID (5C42C905)  ──┼──► Skill "how_to_brush" ──► /sdcard/cheeko/skills/how_to_brush/
Card UID (A1B2C3D4)  ──┘                                ├── audio/ (10 MP3s)
                                                         ├── images/ (10 BINs)
                                                         └── manifest.json
```

**Key insight**: Map UIDs to skill_ids (not files). Multiple UIDs can point to the same skill_id and therefore the same folder. Download happens per-skill, not per-card.

### 9.2 Card Tap Flow

```
Card Tap (UID)
    │
    ▼
[1] Look up UID in memory map (O(1) unordered_map)
    │
    ├── FOUND + skill downloaded ──► PLAY IMMEDIATELY (offline, ~50ms)
    │
    ├── FOUND + skill NOT downloaded ──► DOWNLOAD skill, then play
    │
    └── NOT FOUND ──► [2] Publish MQTT request to server
                           │
                           ▼
                      [3] Server responds with skill_id + download URLs
                           │
                           ▼
                      [4] Check: skill folder already on SD?
                           │
                           ├── YES ──► Just add UID→skill mapping, PLAY
                           │
                           └── NO ──► DOWNLOAD all files, save mapping, PLAY
```

### 9.3 SD Card Directory Structure

```
/sdcard/
├── cheeko/
│   ├── card_map.json              ← UID → skill_id mappings (loaded into RAM on boot)
│   └── skills/
│       ├── how_to_brush/          ← skill_id as folder name
│       │   ├── audio/
│       │   │   ├── 01.mp3
│       │   │   ├── 02.mp3
│       │   │   └── ...10 files
│       │   ├── images/
│       │   │   ├── 01.bin         ← RGB565 LVGL v9 binary (pre-converted on server)
│       │   │   ├── 02.bin
│       │   │   └── ...10 files
│       │   └── manifest.json      ← skill metadata (written LAST = download complete marker)
│       └── animal_sounds/
│           ├── audio/
│           ├── images/
│           └── manifest.json
├── images/                         ← (existing test images, keep for now)
└── ...
```

**card_map.json** — loaded into `std::unordered_map<std::string, std::string>` on boot (~20KB for 1000 cards):
```json
{
  "cards": {
    "E96C8A82": "how_to_brush",
    "5C42C905": "how_to_brush",
    "A1B2C3D4": "animal_sounds"
  }
}
```

**manifest.json** (per skill) — existence = download complete:
```json
{
  "skill_id": "how_to_brush",
  "skill_name": "How to Brush Daily",
  "version": 1,
  "audio_count": 10,
  "image_count": 10
}
```

### 9.4 MQTT Communication

**Device → Server** (unknown card tap)
- **Topic**: `cheeko/device/{DEVICE_ID}/request`
```json
{
  "type": "card_lookup",
  "rfid_uid": "E96C8A82",
  "device_id": "aa:bb:cc:dd:ee:ff",
  "timestamp": 1707225600000
}
```

**Server → Device** (content response)
- **Topic**: `cheeko/device/{DEVICE_ID}/response`
```json
{
  "type": "card_content",
  "rfid_uid": "E96C8A82",
  "skill_id": "how_to_brush",
  "skill_name": "How to Brush Daily",
  "version": 1,
  "audio": [
    {"index": 1, "url": "https://cdn.cheeko.com/skills/how_to_brush/audio/01.mp3"},
    {"index": 2, "url": "https://cdn.cheeko.com/skills/how_to_brush/audio/02.mp3"}
  ],
  "images": [
    {"index": 1, "url": "https://cdn.cheeko.com/skills/how_to_brush/images/01.bin"},
    {"index": 2, "url": "https://cdn.cheeko.com/skills/how_to_brush/images/02.bin"}
  ]
}
```

**Server → Device** (unknown card)
```json
{
  "type": "card_unknown",
  "rfid_uid": "E96C8A82"
}
```

### 9.5 Download Strategy: Block & Download

**Why block (not background)?**
- ESP32-S3 already runs: MQTT task + PN532 polling task + MP3 decode task + LVGL task
- HTTP download + file write is I/O heavy (~12KB stack per task)
- Concurrent HTTP download + MP3 decode = competing for PSRAM bandwidth
- 20-50 MB download only happens ONCE per skill — acceptable one-time wait

**Download flow:**
1. Show "Downloading: How to Brush Daily" on display
2. Create skill folder: `/sdcard/cheeko/skills/{skill_id}/audio/` and `/images/`
3. Download each file sequentially: HTTP GET → stream 4KB chunks → fwrite to SD
4. Show progress: "Downloading 3/20..."
5. After ALL files downloaded, write `manifest.json` (completion marker)
6. Update `card_map.json` with UID → skill_id
7. Update in-memory map
8. Start playback

**Handling partial downloads (power loss):**
- `manifest.json` is written LAST — if it doesn't exist, skill is incomplete
- On boot: scan skill folders, delete any without `manifest.json`
- Re-download happens automatically on next card tap

### 9.6 Fast Lookup Design

**On boot (one-time, ~10ms):**
1. Mount SD card
2. Read `/sdcard/cheeko/card_map.json`
3. Parse into `std::unordered_map<string, string> card_map_`
4. Scan `/sdcard/cheeko/skills/` for folders with `manifest.json`
5. Build `std::unordered_set<string> downloaded_skills_`

**On card tap (<1ms lookup):**
1. Format UID as hex string `"E96C8A82"`
2. `card_map_.find(uid)` — O(1) hash lookup, ~microseconds
3. If found and skill downloaded → instant play from known directory path

### 9.7 Lost Card Scenario (Avoiding Re-downloads)

```
User has Cheeko1 (UID: E96C8A82) → skill: "how_to_brush" (already downloaded)
User loses Cheeko1, buys Cheeko2 (UID: 1234ABCD) → same skill: "how_to_brush"

Tap Cheeko2:
  1. card_map_ lookup: "1234ABCD" → NOT FOUND
  2. Send MQTT request to server
  3. Server responds: skill_id = "how_to_brush"
  4. Check: downloaded_skills_.count("how_to_brush") → TRUE (already on SD!)
  5. Just add mapping: card_map_["1234ABCD"] = "how_to_brush"
  6. Save card_map.json
  7. PLAY IMMEDIATELY — zero download needed
```

### 9.8 ContentManager Class

**Files**: `main/boards/common/content_manager.h` and `content_manager.cc`

```cpp
class ContentManager {
public:
    bool Initialize(const std::string& base_path);  // "/sdcard/cheeko"
    std::string OnCardTapped(const std::string& uid);
    bool IsSkillDownloaded(const std::string& skill_id);
    std::vector<std::string> GetAudioFiles(const std::string& skill_id);
    std::vector<std::string> GetImageFiles(const std::string& skill_id);
    void HandleServerResponse(const std::string& json_response);

    // Callbacks
    void SetOnDownloadProgress(std::function<void(int current, int total,
                               const std::string& skill_name)> cb);
    void SetOnContentReady(std::function<void(const std::string& uid,
                            const std::string& skill_id)> cb);
    void SetOnUnknownCard(std::function<void(const std::string& uid)> cb);

private:
    std::string base_path_;
    std::unordered_map<std::string, std::string> card_map_;
    std::unordered_set<std::string> downloaded_skills_;

    bool LoadCardMap();
    bool SaveCardMap();
    void ScanDownloadedSkills();
    bool DownloadFile(const std::string& url, const std::string& local_path);
    bool DownloadSkill(const std::string& skill_id, cJSON* audio_arr,
                       cJSON* images_arr, const std::string& skill_name, int version);
    void CleanIncompleteDownloads();
};
```

**HTTP download**: Uses `Board::GetInstance().GetNetwork()->CreateHttp()` → `HttpClient` via `EspNetwork`. Pattern from `main/ota.cc` (4KB chunk streaming) and `main/mcp_server.cc` (image download).

### 9.9 Integration in jiuchuan_dev_board.cc

**On boot** (in `InitializeKidToyHardware`):
```cpp
content_manager_.Initialize("/sdcard/cheeko");
content_manager_.SetOnDownloadProgress([this](int current, int total, const std::string& name) {
    GetDisplay()->ShowNotification("Downloading " + name + " " +
                                    std::to_string(current) + "/" + std::to_string(total));
});
content_manager_.SetOnContentReady([this](const std::string& uid, const std::string& skill_id) {
    auto audio = content_manager_.GetAudioFiles(skill_id);
    auto images = content_manager_.GetImageFiles(skill_id);
    mp3_player_.SetPlaylist(audio);
    image_files_ = images;
    image_index_ = 0;
    if (!images.empty()) ShowImageFromSd(images[0]);
    if (!audio.empty()) mp3_player_.NextTrack();
});
```

**On card tap** (replaces current hardcoded callback):
```cpp
pn532_reader_.OnCardDetected([this](const std::vector<uint8_t>& uid) {
    std::string uid_str = FormatUid(uid);
    std::string skill_id = content_manager_.OnCardTapped(uid_str);
    if (!skill_id.empty()) {
        // Content ready — play immediately
        auto audio = content_manager_.GetAudioFiles(skill_id);
        auto images = content_manager_.GetImageFiles(skill_id);
        mp3_player_.SetPlaylist(audio);
        image_files_ = images;
        image_index_ = 0;
        if (!images.empty()) ShowImageFromSd(images[0]);
        if (!audio.empty()) mp3_player_.NextTrack();
    }
    // else: MQTT request sent, OnContentReady fires after download
});
```

**MQTT wiring** (Option B — board wires MQTT, ContentManager stays independent):
- Board code creates MQTT client via `Board::GetInstance().GetNetwork()->CreateMqtt()`
- Subscribes to `cheeko/device/{DEVICE_ID}/response`
- Forwards incoming JSON to `content_manager_.HandleServerResponse(payload)`
- When ContentManager needs to send a request, board code calls `mqtt->Publish(topic, json)`

---

## File Summary

### New Files (12 files)

| File | Purpose | Phase |
|------|---------|-------|
| `main/boards/common/sd_manager.h` | SD card mount/unmount/file listing | 2 |
| `main/boards/common/sd_manager.cc` | SD card implementation | 2 |
| `main/boards/common/pn532_reader.h` | PN532 RFID reader interface | 4 |
| `main/boards/common/pn532_reader.cc` | PN532 I2C protocol + polling task | 4 |
| `main/boards/common/card_audio_mapper.h` | Card UID to audio mapping (replaced by ContentManager) | 5 |
| `main/boards/common/card_audio_mapper.cc` | JSON config loading + lookup (replaced by ContentManager) | 5 |
| `main/boards/common/kid_toy_controller.h` | Main controller orchestrator | 6 |
| `main/boards/common/kid_toy_controller.cc` | Controller implementation | 6 |
| `main/audio/mp3_player.h` | MP3 file decoder/player | 3 |
| `main/audio/mp3_player.cc` | MP3 decode task + playback | 3 |
| `main/boards/common/content_manager.h` | Content mapping, download & skill management | 9 |
| `main/boards/common/content_manager.cc` | Card→skill lookup, HTTP download, SD persistence | 9 |

### Modified Files (3 files)

| File | Change |
|------|--------|
| `main/boards/jiuchuan-s3/config.h` | Add pin defs + feature flags |
| `main/boards/jiuchuan-s3/jiuchuan_dev_board.cc` | Init kid toy components, modify buttons |
| `main/CMakeLists.txt` | Add new source files to SOURCES |

### Possibly Modified (1 file)

| File | Change |
|------|--------|
| `main/application.cc` | Wrap AI voice init in `#if AI_VOICE_ENABLED` |

### Reused Existing Code

| File | What's Reused |
|------|---------------|
| `main/boards/common/knob.cc/h` | Rotary encoder — `Knob(pin_a, pin_b)`, `OnRotate(callback)` |
| `main/boards/common/button.cc/h` | Encoder press — `Button(gpio)`, `OnClick(callback)` |
| `main/audio/audio_codec.h` | `OutputData(pcm)` for speaker output, `SetOutputVolume()` |
| `main/boards/common/i2c_device.cc/h` | I2C read/write pattern for PN532 |
| `managed_components/espressif__esp_audio_codec/` | `esp_mp3_dec_open/decode/close` for MP3 decoding |

---

## Hardware Test Plan

### Layer 1: Hardware Basics (T1–T5) — ✅ All verified on hardware

| # | Test | Status | What to check in serial monitor |
|---|------|--------|------|
| T1 | SD card mount + list files | ✅ | `SD card mounted at /sdcard` + file list |
| T2 | Read MP3 file size from SD | ✅ | File sizes printed in log (incl. subdirs) |
| T3 | PN532 tap card → print UID | ✅ | `Card detected: XX:XX:XX:XX` |
| T4 | Encoder turn → CW/CCW log | ✅ | `Encoder: CW` or `Encoder: CCW` |
| T5 | Encoder press → log | ✅ | `Encoder: PRESSED` |

### Layer 2: Audio Playback (T6–T8) — Code ready, awaiting hardware test

| # | Test | Status | What it proves |
|---|------|--------|------|
| T6 | Decode MP3 from SD → play through speaker | ⬜ | Press encoder → first track plays from speaker |
| T7 | Play MP3, press encoder → pause/resume | ⬜ | Press again → pauses, press again → resumes |
| T8 | Play MP3, turn encoder → volume | ⬜ | Volume control during playback (already wired from T4) |

### Layer 3: Display Feedback (T9–T11) — Code ready, awaiting hardware test

| # | Test | Status | What it proves |
|---|------|--------|------|
| T9 | Tap RFID → show image on LCD (alternates image1/image2) | ⬜ | SD → RGB565 → LVGL SetPreviewImage pipeline |
| T10 | Remove card → image clears from LCD | ⬜ | SetPreviewImage(nullptr) on card removal |
| T11 | Tap card again → shows other image (alternating) | ⬜ | image_toggle_ alternation works |

### Layer 4: Integration (T12–T15) — Code ready, awaiting hardware test

| # | Test | Status | What it proves |
|---|------|--------|------|
| T12 | Tap any RFID card → play first MP3 from SD | ⬜ | Card tap → starts playback from track 1 |
| T13 | While playing, turn encoder CW/CCW → next/prev track | ⬜ | Encoder rotation = track navigation |
| T14 | While playing, press encoder → pause/resume | ⬜ | Encoder press = play/pause toggle |
| T15 | Remove card → stop playback | ⬜ | Card removal → mp3_player_.Stop() |

### Layer 5: Full Integration (T16–T20) — Not started

| # | Test | Status | What it proves |
|---|------|--------|------|
| T16 | Load card_mappings.json, tap mapped card → correct file | ⬜ | Full card-to-audio mapping |
| T17 | Tap unknown card → fallback behavior | ⬜ | Fallback handling |
| T18 | Full flow: card → play → volume → next → switch card | ⬜ | Everything together |
| T19 | Power cycle → auto-mount → tap → plays | ⬜ | Boot reliability |
| T20 | AI_VOICE_ENABLED=1 → voice assistant works | ⬜ | No regression |

### Layer 6: Content Mapping & Download (T21–T27) — Not started

| # | Test | Status | What it proves |
|---|------|--------|------|
| T21 | Boot → ContentManager loads card_map.json + scans skills | ⬜ | `card_map_` and `downloaded_skills_` populated in <50ms |
| T22 | Tap known card (skill on SD) → instant play, no server contact | ⬜ | Offline-first O(1) lookup works |
| T23 | Tap unknown card (online) → MQTT request sent → server responds → files download → playback starts | ⬜ | Full MQTT + HTTP download pipeline |
| T24 | Tap same card again (offline) → instant play from SD | ⬜ | Card mapping persisted, no re-download |
| T25 | New card, same skill → MQTT request → server says same skill → no download, instant play | ⬜ | Lost card scenario: skill already on SD |
| T26 | Power loss during download → reboot → incomplete folder cleaned up → re-download on next tap | ⬜ | manifest.json as completion marker, CleanIncompleteDownloads() |
| T27 | No WiFi + unknown card → show "Connect to WiFi" message | ⬜ | Graceful offline fallback for unknown cards |
