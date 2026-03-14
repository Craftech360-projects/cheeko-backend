# RFID Category + Story-Page Structure — Implementation Plan

## Goal

Add a **category management system** for RFID cards (e.g., "Explore Cards", "Forest Tales") and support **multi-story cards** where each story has multiple sequential pages (audio narration + image illustration per page).

---

## Data Structure

```
Category: "Explore Cards"
  └── Card: "Forest Tales" (1 physical RFID card)
        ├── Story 1: "The Lost Fox" (10 pages)
        │     ├── Page 1: audio_url, image_url
        │     ├── Page 2: audio_url, image_url
        │     └── ... (10 pages)
        ├── Story 2: "River Song" (10 pages)
        └── ... (5 stories total = 50 audio + 50 images)
```

**On card tap:** ESP32 taps card → gateway looks up → returns ALL stories with ALL pages + category name as JSON.

---

## JSON Response to Firmware

When a card is tapped, the ESP32 receives:

```json
{
  "type": "card_content",
  "rfid_uid": "04A3B2C1",
  "category": "Explore Cards",
  "version": 1,
  "stories": [
    {
      "story_number": 1,
      "story_title": "The Lost Fox",
      "pages": [
        { "page": 1, "audio_url": "https://cdn.example.com/forest/s1_p1.mp3", "image_url": "https://cdn.example.com/forest/s1_p1.jpg" },
        { "page": 2, "audio_url": "https://cdn.example.com/forest/s1_p2.mp3", "image_url": "https://cdn.example.com/forest/s1_p2.jpg" },
        { "page": 3, "audio_url": "https://cdn.example.com/forest/s1_p3.mp3", "image_url": "https://cdn.example.com/forest/s1_p3.jpg" }
      ]
    },
    {
      "story_number": 2,
      "story_title": "River Song",
      "pages": [
        { "page": 1, "audio_url": "https://cdn.example.com/forest/s2_p1.mp3", "image_url": "https://cdn.example.com/forest/s2_p1.jpg" },
        { "page": 2, "audio_url": "https://cdn.example.com/forest/s2_p2.mp3", "image_url": "https://cdn.example.com/forest/s2_p2.jpg" }
      ]
    }
  ]
}
```

**Key changes from current format:**
- `skill_id` and `skill_name` are **removed**, replaced by `category`
- `audio[]` and `images[]` flat arrays are **removed**, replaced by nested `stories[].pages[]`
- Firmware will need to be updated to parse the new nested structure

---

## Database Changes

### New Table: `rfid_category`

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PK | Auto-increment ID |
| `code` | VARCHAR(100) UNIQUE | Slug: `explore_cards`, `forest_tales` |
| `name` | VARCHAR(255) | Display name: "Explore Cards" |
| `description` | TEXT | Optional description |
| `icon_url` | VARCHAR(500) | Category icon/image URL |
| `display_order` | INTEGER | Sort order (lower = first) |
| `active` | BOOLEAN | Enabled/disabled |

### Modified Table: `rfid_content_pack`

| New Column | Type | Description |
|------------|------|-------------|
| `category_id` | BIGINT FK → rfid_category | Links pack to a category (nullable) |

### Modified Table: `content_item`

| New Column | Type | Description |
|------------|------|-------------|
| `story_number` | INTEGER (default 1) | Which story this page belongs to (1-5) |
| `story_title` | VARCHAR(255) | Story name: "The Lost Fox" |

**Existing columns used as-is:**
- `item_number` → page number within the story (1-10)
- `audio_url` → narration audio for this page
- `image_url` → illustration for this page

---

## API Changes

### New Endpoints: Category Management

All under `/toy/admin/rfid/category`, require admin auth.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/category/page` | Paginated list with filters |
| GET | `/category/list` | All categories (for dropdowns) |
| GET | `/category/code/:code` | Get by code |
| GET | `/category/:id` | Get by ID (includes content pack count) |
| POST | `/category` | Create category |
| PUT | `/category` | Update category |
| DELETE | `/category` | Delete category (batch) |
| POST | `/category/delete` | Delete (POST alternative) |

### Updated Endpoints

- `GET /content-pack/page` — new optional `categoryId` query param
- `GET /content-pack/list` — new optional `categoryId` query param
- `POST /content-pack` — accepts `categoryId` in body
- `PUT /content-pack` — accepts `categoryId` in body
- `GET /card/lookup/:rfidUid` — response now includes `categoryName`, `categoryCode`, and nested `stories[]`

---

## Gateway Changes

**File:** `mqtt-gateway/gateway/mqtt-gateway.js`

Branch A (Content Pack → device) updated:
- Remove `skill_id` and `skill_name` from manifest
- Add `category` field from lookup response
- Add `stories` nested array from lookup response
- Remove flat `audio[]` and `images[]` arrays

---

## Dashboard Changes

### New: Categories Tab
- Table showing: Code, Name, Description, Icon, Display Order, Content Pack Count, Active, Actions
- Add/Edit/Delete functionality via dialog

### Updated: Content Packs Tab
- New category filter dropdown
- Category column in table
- Category selector in Content Pack create/edit dialog

### Updated: Content Pack Dialog
- Category dropdown field
- Story management: items grouped by `story_number` with `story_title`

---

## Files to Create/Modify

| # | File | Action |
|---|------|--------|
| 1 | `manager-api-node/supabase/migrations/20240101000009_create_rfid_category_and_story.sql` | **NEW** |
| 2 | `manager-api-node/prisma/schema.prisma` | MODIFY |
| 3 | `manager-api-node/src/services/rfid.service.js` | MODIFY |
| 4 | `manager-api-node/src/routes/rfid.routes.js` | MODIFY |
| 5 | `mqtt-gateway/gateway/mqtt-gateway.js` | MODIFY |
| 6 | `manager-web/src/apis/module/rfid.js` | MODIFY |
| 7 | `manager-web/src/views/RfidManagement.vue` | MODIFY |
| 8 | `manager-web/src/components/RfidCategoryDialog.vue` | **NEW** |
| 9 | `manager-web/src/components/RfidContentPackDialog.vue` | MODIFY |

---

## Verification Plan

1. **Migration:** Run `npx supabase db push` + `npx prisma db pull && npx prisma generate`
2. **API Start:** `cd main/manager-api-node && npm run dev`
3. **Create Category:** `POST /toy/admin/rfid/category` with `{ "code": "explore_cards", "name": "Explore Cards" }`
4. **Create Content Pack:** with `categoryId` and items having `story_number`/`story_title`
5. **Test Lookup:** `GET /toy/admin/rfid/card/lookup/{uid}` → verify nested stories + category
6. **Test Gateway:** Simulate RFID tap → verify `card_content` JSON has `category` and `stories`
7. **Dashboard:** Open admin panel → verify Categories tab CRUD, content pack category assignment

---

## Backward Compatibility Notes

- `category_id` on `rfid_content_pack` is **nullable** (ON DELETE SET NULL) — existing packs without a category continue to work
- `story_number` defaults to `1` — existing content items remain valid as "story 1"
- **Breaking change for firmware:** The `card_content` JSON format changes (no more `skill_id`/`skill_name`, nested `stories` instead of flat `audio`/`images`). Firmware must be updated to parse the new format.
