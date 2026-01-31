# RFID Management UI Refactoring - Complete

## Summary
Successfully refactored the RFID Management UI in `manager-web` to support the new "Smart Routing" architecture, which separates static content delivery (Story/Rhyme Packs) from dynamic Q&A generation.

## Changes Made

### 1. Frontend Components (manager-web)

#### **RfidQuestionDialog.vue** ✅
**Purpose:** Manage Q&A prompts with Smart Caching support

**New Fields Added:**
- `allowCaching` (Boolean Switch) - Enable/disable response caching
- `cachedAudioUrl` (Text Input) - Pre-generated audio URL for instant playback
- `systemPromptOverride` (Textarea) - Optional custom system persona

**UI Updates:**
- Added "Smart Caching" toggle with explanatory hint
- Conditional "Cached Audio" field (only shown when caching is enabled)
- Added "System Override" field for advanced customization
- Updated form defaults to include new fields

---

#### **RfidContentPackDialog.vue** ✅
**Purpose:** Manage Story/Rhyme Packs with structured content items

**Major Refactor:**
- **Removed:** Raw markdown `contentMd` field
- **Added:** Structured "Pack Items" table (max 10 items)
  - Each item has: Sequence #, Title, Audio URL, Image URL
  - Add/Remove item controls
  - Visual sequence badges
- **Added:** Status field (Draft/Published)
- **Added:** Version field (Integer)
- **Updated:** Form validation to require at least 1 item

**UI Structure:**
```
Pack Metadata:
  - Pack Code
  - Name
  - Description
  - Content Type
  - Language
  - Status (Draft/Published)
  - Version

Pack Items (1-10):
  [Seq] Title          | Audio URL        | Image URL       | [Delete]
  [ 1 ] "Story Title"  | https://...      | https://...     | [X]
  [ 2 ] ...
  [Add Item Button]
```

---

#### **RfidCardDialog.vue** ✅
**Purpose:** Map RFID cards to content

**Major Simplification:**
- **Added:** Content Type radio selector:
  - 📓 Story/Rhyme Pack
  - 💬 Q&A Playlist
- **Conditional Display:**
  - If "Story/Rhyme Pack": Show `contentPackId` selector
  - If "Q&A Playlist": Show `questionIds` multi-select (max 10)
- **Added:** Field hint for Q&A playlist limit
- **Added:** `packId` (Product SKU) as optional mapping

**Flow:**
1. User selects content type (Pack OR Q&A)
2. Appropriate selector appears
3. Only one content type can be active per card

---

#### **RfidManagement.vue** ✅
**Purpose:** Main orchestration view

**Data Structure Updates:**
- `questionForm`: Added `allowCaching`, `cachedAudioUrl`, `systemPromptOverride`
- `contentPackForm`: Added `status`, `version`, `items[]`, removed `contentMd`, `totalItems`
- `cardForm`: Added `actionType`, reordered fields for clarity

---

### 2. Backend Service (manager-api-node)

#### **rfid.service.js** ✅

**Question Management:**
- `createQuestion()`: Now saves `allow_caching`, `cached_audio_url`, `system_prompt_override`
- `updateQuestion()`: Handles updates to new Smart Q&A fields
- `transformQuestionToCamelCase()`: Returns new fields to frontend

**Content Pack Management:**
- `createContentPack()`: 
  - Inserts pack metadata
  - **NEW:** Iterates over `data.items[]` and inserts into `content_item` table
  - Maps UI fields (`audioUrl`, `imageUrl`) to DB columns (`audio_url`, `image_url`)
  
- `updateContentPack()`:
  - Updates pack metadata
  - **NEW:** Deletes existing items, re-inserts from `data.items[]`
  - Ensures sequence integrity (1-based `item_number`)

**Item Structure:**
```javascript
{
  content_pack_id: <pack_id>,
  item_number: 1-10,
  title: "...",
  audio_url: "https://...",
  image_url: "https://...",
  active: true
}
```

---

### 3. Database Schema (Already Applied)

**Tables Updated:**
- `rfid_question`: Added `allow_caching`, `cached_audio_url`, `system_prompt_override`
- `rfid_content_pack`: Added `status`, `version`, `thumbnail_url`, `age_range`
- `content_item`: Has `item_number`, `title`, `audio_url`, `image_url`, `content_text`
- `rfid_card_mapping`: Added `question_ids` (JSONB array), `action_type`

---

## Architecture: Two-Track System

### Track 1: Static Content (Story/Rhyme Packs)
```
RFID Card → content_pack_id → rfid_content_pack → content_item (1-10)
                                                    ↓
                                            Pre-recorded Audio
                                            Pre-loaded Images
```

**Use Case:** Bedtime stories, nursery rhymes, habits
**Delivery:** Instant playback, no AI generation

---

### Track 2: Dynamic Q&A
```
RFID Card → question_ids[] → rfid_question (1-10)
                              ↓
                        AI Agent (Gemini)
                        ↓
                  Live Response Generation
                  (with optional caching)
```

**Use Case:** Educational prompts, interactive learning
**Delivery:** Real-time AI responses, cached when beneficial

---

## Testing Checklist

### Frontend
- [ ] Create new Content Pack with 5 items
- [ ] Edit existing Content Pack, add/remove items
- [ ] Verify Status (Draft/Published) toggle works
- [ ] Create Q&A Prompt with caching enabled
- [ ] Create Q&A Prompt with system override
- [ ] Map card to Content Pack
- [ ] Map card to Q&A Playlist (5 questions)
- [ ] Verify conditional fields show/hide correctly

### Backend
- [ ] POST `/api/rfid/content-pack` with items array
- [ ] PUT `/api/rfid/content-pack/:id` with updated items
- [ ] Verify `content_item` records created in DB
- [ ] POST `/api/rfid/question` with Smart Q&A fields
- [ ] GET `/api/rfid/question/:id` returns new fields
- [ ] Verify card lookup returns correct structure

### Integration
- [ ] Device scans card → receives content pack with 10 items
- [ ] Device scans card → receives Q&A playlist
- [ ] Cached audio URL is returned when `allowCaching=true`
- [ ] System prompt override is applied in AI agent

---

## Files Modified

### Frontend (manager-web)
1. `src/components/RfidQuestionDialog.vue`
2. `src/components/RfidContentPackDialog.vue`
3. `src/components/RfidCardDialog.vue`
4. `src/views/RfidManagement.vue`

### Backend (manager-api-node)
1. `src/services/rfid.service.js`

### Database
- Schema already updated via `complete-schema.sql`

---

## Next Steps

1. **Test End-to-End Flow:**
   - Create a Story Pack with 3 items
   - Create a Q&A Playlist with 5 questions
   - Map 2 different RFID cards
   - Scan from device and verify correct content delivery

2. **Gateway Integration:**
   - Ensure `mqtt-gateway` correctly handles `content_pack_id` vs `question_ids`
   - Verify sequence-based item selection for packs
   - Test Q&A playlist rotation logic

3. **Content Migration (if needed):**
   - Migrate any existing `contentMd` markdown to structured `items`
   - Update any hardcoded pack references

4. **UI Polish:**
   - Add loading states for item operations
   - Add confirmation dialogs for destructive actions
   - Improve error messages for validation failures

---

## Design Decisions

1. **Delete-All-Reinsert for Items:** Simplifies sync logic, acceptable for small lists (max 10)
2. **Sequence = Array Index + 1:** Ensures 1-based indexing matches user expectations
3. **Single Content Type per Card:** Prevents ambiguity, enforces clear routing
4. **Caching Default = True:** Optimizes for performance, can be disabled per-question
5. **Status Field:** Enables draft/publish workflow for content review

---

## Known Limitations

1. **No Partial Item Updates:** Full replacement on every save (acceptable for small lists)
2. **No Item Reordering UI:** Items are ordered by array position (can be added later)
3. **No Audio/Image Upload:** URLs must be provided manually (CDN integration pending)
4. **No Version History:** Only current version stored (can add audit log later)

---

## Success Metrics

✅ **UI Simplification:** Reduced cognitive load with clear 2-option flow
✅ **Data Integrity:** Structured items prevent markdown parsing errors
✅ **Scalability:** Supports up to 10 items per pack (device memory constraint)
✅ **Flexibility:** System prompt override enables persona customization
✅ **Performance:** Smart caching reduces AI generation latency

---

**Status:** ✅ **COMPLETE** - Ready for testing
**Date:** 2026-01-31
**Complexity:** High (Full-stack refactor with DB schema changes)
