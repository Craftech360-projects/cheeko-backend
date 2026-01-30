# RFID Content Pack Port (Java → Node.js) - Product Requirements Document

## Overview

Port the missing RFID Content Pack features from the Java `manager-api` to the Node.js `manager-api-node`. The Java API has evolved to include a full RAG-based content delivery system (content packs, content items, download manifests, markdown parsing, cached audio) that ESP32 devices depend on. The Node.js API currently lacks these features, preventing it from being a drop-in replacement.

## Target Audience

- **ESP32 Devices**: Call content download and lookup endpoints to fetch habits, rhymes, and stories
- **LiveKit Agent (Python)**: Calls cached audio URL update endpoint after TTS generation
- **Admin Dashboard (Vue.js)**: Needs full CRUD for content packs and content items

## Core Features (Priority Order)

### P0 — Device-Facing (Blocks ESP32 Functionality)
1. **Content lookup with sequence support** — `GET /card/lookup/:rfidUid?sequence=N`
2. **Unified content download manifest** — `GET /card/content/download/:rfidUid`
3. **Habit download manifest** — `GET /card/habit/download/:rfidUid`
4. **Rhyme download manifest** — `GET /card/rhyme/download/:rfidUid` (deprecated but still used)
5. **Cached audio URL update** — `PUT /card/content-pack/:packCode/sequence/:sequence/cached-audio`

### P1 — Content Infrastructure
6. **Markdown parser utility** — `MdParserUtil` equivalent for extracting content by sequence
7. **`content_item` table queries** — Service methods to query individual items by pack

### P2 — Admin CRUD
8. **Full `rfid_content_pack` CRUD** — Page, list, get-by-code, create, update, delete
9. **Legacy lookup endpoint** — `GET /card/lookup-legacy/:rfidUid`

## Tech Stack

- **Runtime**: Node.js 20+ (existing)
- **Framework**: Express.js (existing)
- **Database**: Supabase / PostgreSQL (existing)
- **ORM**: Supabase JS Client (existing)
- **Auth**: Supabase Auth + service key middleware (existing)

No new dependencies required. All work is within the existing `manager-api-node` codebase.

## Architecture

Follows the existing Node.js project patterns:
- Routes in `src/routes/rfid.routes.js` (add new endpoints to existing file)
- Service methods in `src/services/rfid.service.js` (add new methods to existing file)
- Utility in `src/utils/mdParser.js` (new file)
- Database migration in `supabase/migrations/` (if `content_item` table or new columns don't exist)

## Data Model

### Existing Tables (already in Supabase schema)
- `rfid_content_pack` — content packs with markdown, version, hash, cachedAudioUrls
- `rfid_card_mapping` — links RFID UIDs to content packs via `content_pack_id`

### Table to Verify/Add: `content_item`
```
content_item:
  id              BIGSERIAL PRIMARY KEY
  content_pack_id BIGINT FK → rfid_content_pack(id)
  item_number     INTEGER (1-based sequence)
  title           VARCHAR(255)
  description     TEXT
  audio_url       VARCHAR(500)
  audio_size_bytes BIGINT
  audio_duration_ms BIGINT
  images_json     JSONB (array of {url, sizeBytes, sequence})
  lyrics_text     TEXT
  active          BOOLEAN DEFAULT true
  creator         BIGINT
  create_date     TIMESTAMP
  updater         BIGINT
  update_date     TIMESTAMP
```

### Response Shapes (Match Java DTOs exactly)

**RfidContentLookupDTO** (returned by `/card/lookup/:rfidUid?sequence=N`):
```json
{
  "rfidUid": "04A3B2C1D00000",
  "contentType": "read_only",
  "title": "Twinkle Twinkle",
  "contentText": "Twinkle twinkle little star...",
  "promptText": null,
  "sequence": 1,
  "packCode": "RHYMES_EN_01",
  "language": "en",
  "cachedAudioUrl": "https://cdn.../twinkle.mp3",
  "cached": true
}
```

**ContentDownloadDTO** (returned by `/card/content/download/:rfidUid`):
```json
{
  "rfidUid": "04A3B2C1D00000",
  "contentType": "read_only",
  "packCode": "RHYMES_EN_01",
  "packName": "English Nursery Rhymes",
  "description": "10 classic rhymes",
  "version": "1.0",
  "contentHash": "abc123",
  "totalItems": 10,
  "language": "en",
  "thumbnailUrl": null,
  "items": [
    {
      "itemNumber": 1,
      "title": "Twinkle Twinkle",
      "description": "A classic lullaby",
      "lyricsText": "Twinkle twinkle...",
      "audio": { "url": "https://...", "sizeBytes": 245000, "durationMs": 30000 },
      "images": []
    }
  ]
}
```

**HabitDownloadDTO** (returned by `/card/habit/download/:rfidUid`):
```json
{
  "rfidUid": "04A3B2C1D00000",
  "contentType": "habit",
  "habitCode": "BRUSH_TEETH_01",
  "habitName": "Brush Your Teeth",
  "version": "1.0",
  "contentHash": "def456",
  "totalSteps": 5,
  "thumbnailUrl": "https://cdn.../thumb.jpg",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Wet your toothbrush",
      "instructionText": "Turn on the tap...",
      "audio": { "url": "https://...", "sizeBytes": 120000, "durationMs": 15000 },
      "images": [{ "url": "https://...", "sizeBytes": 50000, "sequence": 1 }]
    }
  ]
}
```

**RhymeDownloadDTO** (returned by `/card/rhyme/download/:rfidUid`):
```json
{
  "rfidUid": "04A3B2C1D00000",
  "contentType": "rhyme",
  "packCode": "RHYMES_EN_01",
  "packName": "English Nursery Rhymes",
  "version": "1.0",
  "contentHash": "abc123",
  "totalItems": 10,
  "language": "en",
  "items": [
    {
      "itemNumber": 1,
      "title": "Twinkle Twinkle",
      "lyricsText": "Twinkle twinkle...",
      "audio": { "url": "https://...", "sizeBytes": 245000, "durationMs": 30000 }
    }
  ]
}
```

## Security Considerations

- **Public endpoints** (no auth): `/card/lookup/:rfidUid`, `/card/content/download/:rfidUid`, `/card/habit/download/:rfidUid`, `/card/rhyme/download/:rfidUid`, cached audio update (service-to-service key)
- **Admin endpoints** (require admin auth): All content pack CRUD, content item queries
- UID normalization must sanitize input (strip non-hex characters, uppercase)

## Third-Party Integrations

None new. Uses existing Supabase client.

## Constraints & Assumptions

- Response shapes must exactly match Java API DTOs for backward compatibility with ESP32 firmware and LiveKit agent
- The `content_item` table may already exist in Supabase from a previous migration — verify before creating
- The `rfid_content_pack` table fields (`version`, `content_hash`, `cached_audio_urls`) may need to be added if not present
- All new code goes into existing files (`rfid.routes.js`, `rfid.service.js`) plus one new utility file (`mdParser.js`)
- Follow existing code patterns (asyncHandler, success/badRequest/notFound helpers, Swagger JSDoc)

## Success Criteria

- All 5 P0 endpoints return responses matching the Java API DTOs exactly
- ESP32 devices can call `/card/lookup/:rfidUid?sequence=1` and receive correct content
- ESP32 devices can call `/card/content/download/:rfidUid` and receive full manifest
- LiveKit agent can call `PUT /card/content-pack/:packCode/sequence/:sequence/cached-audio` successfully
- Admin dashboard can list, create, edit, and delete content packs
- All existing RFID endpoints continue to work (no regressions)

---

## Task List

```json
[
  {
    "category": "setup",
    "description": "Verify content_item and rfid_content_pack table schema in Supabase",
    "steps": [
      "Check if content_item table exists in Supabase migrations",
      "Check if rfid_content_pack has version, content_hash, cached_audio_urls columns",
      "Create migration to add any missing tables/columns",
      "Test migration applies cleanly"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Create MdParserUtil (src/utils/mdParser.js)",
    "steps": [
      "Create src/utils/mdParser.js with extractBySequence(mdContent, sequence) method",
      "Implement countItems(mdContent) method",
      "Implement hasSequence(mdContent, sequence) method",
      "Regex pattern: ## {N}. Title followed by content until next --- or ## or EOF",
      "Export all three methods"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add content_item query methods to rfid.service.js",
    "steps": [
      "Add getContentItemsByPackId(contentPackId) — select from content_item ordered by item_number",
      "Add getContentItem(contentPackId, itemNumber) — single item lookup",
      "Add getTotalAudioSize(contentPackId) — SUM(audio_size_bytes)",
      "Add countItemsWithImages(contentPackId) — COUNT where images_json is not empty",
      "Add transformContentItemToDTO(item) helper matching ContentItemDTO shape"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add content pack lookup with sequence support to rfid.service.js",
    "steps": [
      "Add lookupContentByRfidUid(rfidUid, sequence) method",
      "Lookup card mapping by rfidUid, get content_pack_id",
      "If content pack found: parse markdown with MdParserUtil.extractBySequence()",
      "Check cached_audio_urls JSON for pre-rendered audio URL",
      "Fallback chain: content pack → question_ids[sequence] → single question → series range",
      "Return RfidContentLookupDTO shape"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add content download manifest methods to rfid.service.js",
    "steps": [
      "Add getContentDownloadManifest(rfidUid) — returns ContentDownloadDTO",
      "Lookup card mapping → content_pack_id → content_item rows",
      "Transform items to ContentItemDTO array with audio/images nested objects",
      "Add getHabitDownloadManifest(rfidUid, version, hash) — returns HabitDownloadDTO",
      "Convert content items to HabitStepDTO array with stepNumber, instructionText, audio, images",
      "Support version/hash cache check (return 304-equivalent if unchanged)",
      "Add getRhymeDownloadManifest(rfidUid) — returns RhymeDownloadDTO",
      "Convert content items to RhymeItemDTO array with itemNumber, title, lyricsText, audio"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add cached audio URL update method to rfid.service.js",
    "steps": [
      "Add updateCachedAudioUrl(packCode, sequence, audioUrl) method",
      "Fetch content pack by packCode",
      "Parse existing cached_audio_urls JSON (or create empty {})",
      "Add/update entry for the sequence key",
      "Save updated JSON back to rfid_content_pack row"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add full rfid_content_pack CRUD methods to rfid.service.js",
    "steps": [
      "Add getContentPackPage(params) — paginated listing with filters (packCode, name, contentType, language, active)",
      "Add getContentPackList(params) — unpaginated listing with same filters",
      "Add getContentPackByCode(packCode) — lookup by unique code",
      "Add getAllActiveContentPacks() — active packs only",
      "Add getContentPacksByType(contentType) — filter by read_only/prompt",
      "Add getContentPacksByLanguage(language) — filter by language",
      "Add createContentPack(data) — create with packCode uniqueness check",
      "Add updateContentPack(data) — update by id",
      "Add deleteContentPacks(ids) — batch delete",
      "Add transformContentPackToCamelCase(pack) helper"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add device-facing routes to rfid.routes.js (P0 endpoints)",
    "steps": [
      "Modify GET /card/lookup/:rfidUid to accept ?sequence query param and call lookupContentByRfidUid when sequence is provided",
      "Add GET /card/content/download/:rfidUid route (public, no auth) calling getContentDownloadManifest()",
      "Add GET /card/habit/download/:rfidUid route (public, no auth) with ?version and ?hash query params calling getHabitDownloadManifest()",
      "Add GET /card/rhyme/download/:rfidUid route (public, no auth) calling getRhymeDownloadManifest()",
      "Add PUT /card/content-pack/:packCode/sequence/:sequence/cached-audio route calling updateCachedAudioUrl()",
      "Add GET /card/lookup-legacy/:rfidUid route calling existing question lookup",
      "Add Swagger JSDoc annotations for all new endpoints"
    ],
    "passes": true
  },
  {
    "category": "feature",
    "description": "Add content pack CRUD routes to rfid.routes.js (P2 endpoints)",
    "steps": [
      "Add GET /content-pack/page route (admin auth) calling getContentPackPage()",
      "Add GET /content-pack/list route (admin auth) calling getContentPackList()",
      "Add GET /content-pack/code/:packCode route (admin auth) calling getContentPackByCode()",
      "Add GET /content-pack/active route (public) calling getAllActiveContentPacks()",
      "Add GET /content-pack/type/:contentType route (admin auth) calling getContentPacksByType()",
      "Add GET /content-pack/language/:language route (admin auth) calling getContentPacksByLanguage()",
      "Add POST /content-pack route (admin auth) calling createContentPack()",
      "Add PUT /content-pack route (admin auth) calling updateContentPack()",
      "Add DELETE /content-pack route (admin auth) calling deleteContentPacks()",
      "Add POST /content-pack/delete route (admin auth) calling deleteContentPacks()",
      "Add Swagger JSDoc annotations for all new endpoints"
    ],
    "passes": true
  },
  {
    "category": "testing",
    "description": "Add integration tests for new RFID content endpoints",
    "steps": [
      "Add tests for GET /card/lookup/:rfidUid?sequence=1 with content pack",
      "Add tests for GET /card/content/download/:rfidUid",
      "Add tests for GET /card/habit/download/:rfidUid",
      "Add tests for GET /card/rhyme/download/:rfidUid",
      "Add tests for PUT /card/content-pack/:packCode/sequence/1/cached-audio",
      "Add tests for content pack CRUD (page, list, create, update, delete)",
      "Add tests for MdParserUtil methods",
      "Verify response shapes match Java DTOs exactly"
    ],
    "passes": true
  }
]
```

---

## Agent Instructions

1. Read `activity.md` first to understand current state
2. Find next task with `"passes": false`
3. Complete all steps for that task
4. Verify in browser using agent-browser
5. Update task to `"passes": true`
6. Log completion in `activity.md`
7. Repeat until all tasks pass

**Important:** Only modify the `passes` field. Do not remove or rewrite tasks.

---

## Completion Criteria
All tasks marked with `"passes": true`
