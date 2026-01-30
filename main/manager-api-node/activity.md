# Activity Log

## 2026-01-30 — RFID Content Pack Port (Tasks 1-10)

### Task 1: Verify content_item and rfid_content_pack table schema
- **Status**: DONE
- Created migration `20240101000008_add_content_pack_fields_and_content_item.sql`
- Added missing columns to `rfid_content_pack`: `cached_audio_urls` (TEXT), `version` (VARCHAR(50)), `content_hash` (VARCHAR(255))
- Created `content_item` table with all fields matching Java `ContentItemEntity`: `content_pack_id`, `item_number`, `title`, `description`, `audio_url`, `audio_size_bytes`, `audio_duration_ms`, `images_json` (JSONB), `lyrics_text`, audit fields
- Added indexes for `content_pack_id`, `(content_pack_id, item_number)`, and `active`

### Task 2: Create MdParserUtil
- **Status**: DONE
- Created `src/utils/mdParser.js` — direct port of Java `MdParserUtil.java`
- Implements: `extractBySequence(mdContent, sequence)`, `countItems(mdContent)`, `hasSequence(mdContent, sequence)`
- Regex pattern matches `## {N}. Title` followed by content until `---`, `## `, or EOF

### Task 3: Add content_item query methods
- **Status**: DONE
- Added to `rfid.service.js`:
  - `getContentItemsByPackId(contentPackId)` — ordered by item_number
  - `getContentItem(contentPackId, itemNumber)` — single item lookup
  - `getTotalAudioSize(contentPackId)` — SUM of audio_size_bytes
  - `countItemsWithImages(contentPackId)` — COUNT where images_json not empty
  - `transformContentItemToDTO(item)` — converts DB row to ContentItemDTO shape

### Task 4: Add content pack lookup with sequence support
- **Status**: DONE
- Added `lookupContentByRfidUid(rfidUid, sequence)` — matches Java implementation
- Fallback chain: content pack → question_ids[sequence] → single question → series range
- Returns `RfidContentLookupDTO` shape with `cachedAudioUrl` support
- Added `getCachedAudioUrl()` helper for JSON parsing

### Task 5: Add content download manifest methods
- **Status**: DONE
- Added `getContentDownloadManifest(rfidUid)` — returns ContentDownloadDTO
- Added `getContentDownloadManifestByPackId(contentPackId, rfidUid)` — core implementation
- Added `getHabitDownloadManifest(rfidUid, version, hash)` — HabitDownloadDTO with cache validation
- Added `getRhymeDownloadManifest(rfidUid)` — deprecated RhymeDownloadDTO

### Task 6: Add cached audio URL update method
- **Status**: DONE
- Added `updateCachedAudioUrl(packCode, sequence, audioUrl)`
- Parses existing JSON, adds/updates sequence entry, saves back

### Task 7: Add full rfid_content_pack CRUD methods
- **Status**: DONE
- Added to `rfid.service.js`:
  - `getContentPackPage(params)` — paginated with filters
  - `getContentPackList(params)` — unpaginated
  - `getContentPackByCode(packCode)` — by unique code
  - `getAllActiveContentPacks()` — active only
  - `getContentPacksByType(contentType)` — by type
  - `getContentPacksByLanguage(language)` — by language
  - `createContentPack(data, userId)` — with uniqueness check
  - `updateContentPack(data, userId)` — by id
  - `deleteContentPacks(ids)` — batch delete
  - `transformContentPackToCamelCase(pack)` — DTO helper

### Task 8: Add device-facing routes (P0 endpoints)
- **Status**: DONE
- Modified `GET /card/lookup/:rfidUid` to accept `?sequence` query param
- Added `GET /card/content/download/:rfidUid` — public, no auth
- Added `GET /card/habit/download/:rfidUid` — public, with ?version and ?hash
- Added `GET /card/rhyme/download/:rfidUid` — public, deprecated
- Added `PUT /card/content-pack/:packCode/sequence/:sequence/cached-audio`
- Added `GET /card/lookup-legacy/:rfidUid` — legacy question lookup
- All endpoints have Swagger JSDoc annotations

### Task 9: Add content pack CRUD routes (P2 endpoints)
- **Status**: DONE
- Added `GET /content-pack/page` — admin, paginated with filters
- Added `GET /content-pack/list` — admin, unpaginated
- Added `GET /content-pack/active` — public
- Added `GET /content-pack/type/:contentType` — admin
- Added `GET /content-pack/language/:language` — admin
- Added `GET /content-pack/code/:packCode` — admin
- Added `POST /content-pack` — admin, create
- Added `PUT /content-pack` — admin, update
- Added `DELETE /content-pack` — admin, batch delete
- Added `POST /content-pack/delete` — admin, POST alternative for delete
- All endpoints have Swagger JSDoc annotations

### Files Modified
- `supabase/migrations/20240101000008_add_content_pack_fields_and_content_item.sql` (NEW)
- `src/utils/mdParser.js` (NEW)
- `src/services/rfid.service.js` (MODIFIED — added ~600 lines of new service methods)
- `src/routes/rfid.routes.js` (MODIFIED — added ~500 lines of new routes)

### Task 10: Add integration tests
- **Status**: DONE
- Created `tests/unit/mdParser.test.js` — 25 unit tests for extractBySequence, countItems, hasSequence
- Updated `tests/integration/rfid.test.js` with tests for all new endpoints:
  - Content lookup with sequence: 3 tests
  - Content download manifest: 3 tests
  - Habit download manifest: 4 tests
  - Rhyme download manifest: 3 tests
  - Cached audio URL update: 3 tests
  - Legacy lookup: 2 tests
  - Content pack CRUD (page, list, active, type, language, code, create, update, delete): 16 tests
- **Test results**: All 25 MdParser unit tests PASS

### Verification
- All JS files pass syntax check via acorn parser
- All new service methods follow existing patterns (supabaseAdmin, logger, transform helpers)
- All new routes follow existing patterns (asyncHandler, requireAdmin, success/badRequest/notFound)
- Response shapes match Java DTOs per PRD specification
- MdParser unit tests: 25/25 pass
