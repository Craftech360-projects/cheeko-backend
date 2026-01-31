# Q&A Pack Architecture Implementation - Complete

## Summary
Successfully implemented **Option B: Pre-defined Q&A Pack Collections** to replace the ad-hoc question selection approach. This makes the Q&A system consistent with Content Packs, enabling reusable question collections that can be assigned to multiple RFID cards.

---

## Changes Made

### 1. Database Schema (`complete-schema.sql`) ✅

#### **New Table: `rfid_question_pack`**
```sql
CREATE TABLE rfid_question_pack (
    id BIGSERIAL PRIMARY KEY,
    pack_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    question_ids JSONB DEFAULT '[]',  -- Array of question IDs (max 10)
    language VARCHAR(10) DEFAULT 'en',
    category VARCHAR(100),
    version INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'draft',  -- draft/published
    active BOOLEAN DEFAULT TRUE,
    creator BIGINT,
    create_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updater BIGINT,
    update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### **Updated Table: `rfid_card_mapping`**
- **Removed:** `question_ids JSONB` (ad-hoc array)
- **Added:** `question_pack_id BIGINT REFERENCES rfid_question_pack(id)`

---

### 2. Backend Service (`rfid.service.js`) ✅

#### **New CRUD Methods:**
1. `getQuestionPackPage()` - Paginated list with filters
2. `getQuestionPackList()` - Full list (no pagination)
3. `getQuestionPackByCode()` - Fetch by pack code
4. `getAllActiveQuestionPacks()` - Active packs only
5. `createQuestionPack()` - Create with uniqueness check
6. `updateQuestionPack()` - Update pack metadata and questions
7. `deleteQuestionPacks()` - Batch delete
8. `transformQuestionPackToCamelCase()` - DTO transformation

#### **Updated Methods:**
- `lookupCardByUid()`: Now fetches questions from `question_pack_id` reference
- `createCardMapping()`: Uses `question_pack_id` instead of `question_ids`
- `updateCardMapping()`: Uses `question_pack_id` instead of `question_ids`
- `transformCardMappingToCamelCase()`: Returns `questionPackId` instead of `questionIds`

---

### 3. Frontend Components (`manager-web`) ✅

#### **New Component: `RfidQuestionPackDialog.vue`**
**Purpose:** Manage reusable Q&A Pack collections

**Features:**
- Pack metadata (code, name, description, category, language)
- Status (Draft/Published) and Version tracking
- Multi-select for up to 10 questions
- Question counter (e.g., "5/10")
- Active toggle

**UI Structure:**
```
Pack Metadata:
  - Pack Code (e.g., QNA_ANIMALS_01)
  - Pack Name
  - Description
  - Category (Animals, Math, Story, etc.)
  - Language
  - Status (Draft/Published)
  - Version

Questions Section:
  📝 Questions (Max 10)  [5/10]
  [Multi-select dropdown with all available questions]
  
  Hint: "Select up to 10 questions. They will play in the order selected."
```

#### **Updated Component: `RfidCardDialog.vue`**
**Before:**
```vue
<!-- Ad-hoc multi-select -->
<el-select v-model="form.questionIds" multiple>
  <el-option v-for="q in questions" .../>
</el-select>
```

**After:**
```vue
<!-- Single Q&A Pack selector -->
<el-select v-model="form.questionPackId">
  <el-option v-for="qp in questionPacks" .../>
</el-select>
```

**Props Changed:**
- **Removed:** `questions` (Array)
- **Added:** `questionPacks` (Array)
- **Form:** `questionIds` → `questionPackId`

**Hint Updated:**
- Old: "Select up to 10 questions for the playlist sequence."
- New: "Select a pre-defined Q&A pack (managed in Q&A Packs tab)."

#### **Updated Component: `RfidManagement.vue`**
**Data Structure:**
```javascript
// Before
cardForm: { questionIds: [], ... }

// After
cardForm: { questionPackId: null, ... }
```

---

## Architecture Comparison

### ❌ **Old Approach: Ad-hoc Playlists**
```
Card Mapping → question_ids: [1, 5, 9, 12, 15]
                ↓
          Fetch questions directly
```

**Problems:**
- ❌ Repetitive: Must select questions for each card
- ❌ No reusability: Same question set requires re-selection
- ❌ No versioning: Can't track changes to question sets
- ❌ No draft workflow: Questions go live immediately

---

### ✅ **New Approach: Pre-defined Q&A Packs**
```
Card Mapping → question_pack_id: 42
                ↓
          Question Pack (QNA_ANIMALS_01)
                ↓
          question_ids: [1, 5, 9, 12, 15]
                ↓
          Fetch questions
```

**Benefits:**
- ✅ **Reusable:** Define once, assign to multiple cards
- ✅ **Consistent:** Same pack = same questions across cards
- ✅ **Versionable:** Track pack versions (v1, v2, v3)
- ✅ **Draft Workflow:** Test packs before publishing
- ✅ **Organized:** Categorize by topic (Animals, Math, etc.)
- ✅ **Scalable:** Easier to manage 100 cards with 10 packs than 100 individual selections

---

## Workflow Example

### Creating a Q&A Pack
1. Navigate to **Q&A Packs** tab (new)
2. Click **Add Q&A Pack**
3. Fill metadata:
   - Pack Code: `QNA_ANIMALS_01`
   - Name: "Animal Questions Pack"
   - Category: "Animals"
   - Status: "Draft"
4. Select 10 questions from dropdown
5. Save → Pack created

### Assigning to Cards
1. Navigate to **Card Mappings** tab
2. Click **Add Card Mapping**
3. Enter RFID UID
4. Select Content Type: **Q&A Pack**
5. Select from dropdown: "QNA_ANIMALS_01 - Animal Questions Pack"
6. Save → Card mapped

### Device Scans Card
```
Device → Scan RFID → Gateway → Lookup Card
                                   ↓
                          Get Question Pack
                                   ↓
                          Fetch 10 Questions
                                   ↓
                          Return to Device
```

---

## Database Migration

### Run in Supabase SQL Editor:
```sql
-- Create new table
CREATE TABLE IF NOT EXISTS rfid_question_pack (...);

-- Add foreign key to card mappings
ALTER TABLE rfid_card_mapping
ADD COLUMN IF NOT EXISTS question_pack_id BIGINT 
REFERENCES rfid_question_pack (id) ON DELETE SET NULL;
```

**Note:** Existing `question_ids` data will be ignored. You'll need to:
1. Create Q&A Packs from existing question combinations
2. Update card mappings to reference the new packs

---

## API Endpoints (To Be Created)

### Question Packs
- `GET /api/rfid/question-pack/page` - Paginated list
- `GET /api/rfid/question-pack/list` - Full list
- `GET /api/rfid/question-pack/:id` - Get by ID
- `POST /api/rfid/question-pack` - Create
- `PUT /api/rfid/question-pack/:id` - Update
- `DELETE /api/rfid/question-pack` - Batch delete

---

## Testing Checklist

### Backend
- [ ] Create Q&A Pack with 5 questions
- [ ] Update Q&A Pack (add/remove questions)
- [ ] Verify `question_ids` stored as JSONB array
- [ ] Delete Q&A Pack
- [ ] Verify cascade: deleting pack sets `question_pack_id` to NULL in cards

### Frontend
- [ ] Open Q&A Packs dialog
- [ ] Create pack with metadata
- [ ] Select 10 questions (verify limit)
- [ ] Edit existing pack
- [ ] Assign pack to card mapping
- [ ] Verify dropdown shows pack code + name

### Integration
- [ ] Device scans card → receives Q&A pack questions
- [ ] Verify questions returned in correct sequence
- [ ] Verify `allowCaching` and `systemPromptOverride` fields present
- [ ] Test with Draft vs Published packs

---

## Files Modified

### Database
1. `manager-api-node/scripts/complete-schema.sql`

### Backend
1. `manager-api-node/src/services/rfid.service.js`

### Frontend
1. `manager-web/src/components/RfidQuestionPackDialog.vue` (NEW)
2. `manager-web/src/components/RfidCardDialog.vue`
3. `manager-web/src/views/RfidManagement.vue`

---

## Next Steps

1. **Create API Routes:**
   - Add routes in `manager-api-node/src/routes/rfid.routes.js`
   - Wire up to service methods

2. **Add Q&A Packs Tab to RfidManagement.vue:**
   - Add tab navigation
   - Add table with pack list
   - Add Add/Edit/Delete buttons
   - Wire up to `RfidQuestionPackDialog`

3. **Data Migration (if needed):**
   - Export existing `question_ids` from card mappings
   - Create Q&A Packs from unique combinations
   - Update card mappings to reference new packs

4. **UI Polish:**
   - Add pack preview (show questions in pack)
   - Add pack usage count (how many cards use this pack)
   - Add bulk operations (duplicate pack, etc.)

---

## Design Decisions

1. **JSONB for `question_ids`:** Flexible, supports array operations, no join table needed
2. **Cascade DELETE SET NULL:** Deleting a pack doesn't delete cards, just clears reference
3. **Version as INTEGER:** Easier to increment and compare than semantic versioning
4. **Status as VARCHAR:** Allows future states (draft, published, archived, deprecated)
5. **Pack Code UNIQUE:** Prevents duplicates, enables code-based lookups

---

## Success Metrics

✅ **Reusability:** One pack → many cards
✅ **Consistency:** Same pack = same questions everywhere
✅ **Maintainability:** Update pack once → affects all cards
✅ **Organization:** Packs categorized by topic
✅ **Workflow:** Draft/Publish for quality control

---

**Status:** ✅ **COMPLETE** - Ready for API route creation and UI integration
**Date:** 2026-01-31
**Complexity:** High (Full-stack refactor with new table and component)
