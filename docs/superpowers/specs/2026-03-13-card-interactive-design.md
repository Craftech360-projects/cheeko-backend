# card_interactive RFID Card Type — Design Spec

## Overview

Add a 4th RFID card type `card_interactive` to the Cheeko system. When an interactive card is scanned, the mqtt-gateway looks up the card via manager-api-node, resolves the kid's age from the device binding, and responds to the ESP32 with a structured payload containing the template, params, and asset bundle info.

## Target Response Format

When the ESP32 scans an interactive card, it receives:

```json
{
  "type": "card_interactive",
  "rfid_uid": "AABB1122",
  "template": "math_quiz",
  "display_name": "Math Fun",
  "params": {
    "difficulty": "easy",
    "age_group": 4
  },
  "assets": {
    "bundle_url": "https://cdn.example.com/bundles/story_icons.bndl",
    "bundle_version": 1,
    "bundle_size": 204800
  }
}
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template storage | New `rfid_interactive_template` table | Admin can manage templates as first-class entities |
| Assets location | On the template | All cards sharing a template share the same bundle |
| `params.age_group` | Resolved at lookup time from kid profile | Dynamic per-device, not stored on card |
| `params.difficulty` | Hardcoded `"easy"` for now | Will be dynamic later |
| Age floor | If kid age < 4, use 4 | Minimum age_group is always 4 |

---

## 1. Database Changes (Prisma Migration)

### New Prisma Model: `rfid_interactive_template`

```prisma
model rfid_interactive_template {
  id             BigInt   @id @default(autoincrement())
  template_code  String   @unique @db.VarChar(100)
  display_name   String   @db.VarChar(255)
  description    String?  @db.Text
  bundle_url     String?  @db.VarChar(500)
  bundle_version Int      @default(1)
  bundle_size    BigInt   @default(0)
  active         Boolean  @default(true)
  creator        BigInt?
  updater        BigInt?
  create_date    DateTime @default(now()) @db.Timestamptz
  update_date    DateTime @default(now()) @updatedAt @db.Timestamptz

  // Reverse relation
  card_mappings  rfid_card_mapping[]

  @@index([template_code])
  @@index([active])
}
```

### Update `rfid_card_mapping` Model

Add to existing model:

```prisma
interactive_template_id BigInt?
interactive_template    rfid_interactive_template? @relation(fields: [interactive_template_id], references: [id], onDelete: SetNull)

@@index([interactive_template_id])
```

### Run Migration

```bash
cd main/manager-api-node
npx prisma migrate dev --name add_interactive_template
```

---

## 2. Manager API Node Changes

### 2a. New CRUD — Interactive Templates

**Routes** (`src/routes/rfid.routes.js`):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin/rfid/interactive-template/page` | admin | Paginated list |
| GET | `/admin/rfid/interactive-template/list` | admin | All templates |
| GET | `/admin/rfid/interactive-template/active` | public | Active templates |
| GET | `/admin/rfid/interactive-template/:id` | admin | Get by ID |
| GET | `/admin/rfid/interactive-template/code/:code` | admin | Get by code |
| POST | `/admin/rfid/interactive-template` | admin | Create |
| PUT | `/admin/rfid/interactive-template` | admin | Update |
| DELETE | `/admin/rfid/interactive-template` | admin | Delete by IDs |

**Service** (`src/services/rfid.service.js`):
- `getInteractiveTemplatePage(page, limit, filters)`
- `getInteractiveTemplateList()`
- `getActiveInteractiveTemplates()`
- `getInteractiveTemplateById(id)`
- `getInteractiveTemplateByCode(code)`
- `createInteractiveTemplate(data)`
- `updateInteractiveTemplate(data)`
- `deleteInteractiveTemplates(ids)`

### 2b. Card Lookup Changes

In `lookupCardByUid()`, add a new track after existing ones:

**Track 5 — Interactive Template:**
```
if (mapping.interactive_template_id) {
  - Fetch template from rfid_interactive_template
  - Resolve kid age:
    1. Use device MAC → find agent config → find kid_id
    2. Query kid profile for date_of_birth
    3. Calculate age, floor at 4
  - Return:
    contentType: 'interactive'
    template: template.template_code
    displayName: template.display_name
    params: { difficulty: 'easy', age_group: resolvedAge }
    assets: { bundle_url, bundle_version, bundle_size }
}
```

**Priority**: Interactive template check should come after content_pack (Track 1) but before question tracks, since it's a distinct card type.

### 2c. Age Resolution

The lookup endpoint already receives the `rfid_uid`. The gateway calls it with context. To resolve age:

1. The gateway already knows the device MAC — pass it as query param: `GET /admin/rfid/card/lookup/:rfidUid?mac=AA:BB:CC:DD`
2. Service looks up `agent` table by MAC → gets `kid_id`
3. Queries kid profile for `date_of_birth`
4. Calculates age: `Math.floor((now - dob) / (365.25 * 24 * 60 * 60 * 1000))`
5. Applies floor: `Math.max(age, 4)`

**Alternative**: Gateway resolves age itself (it already has agent config) and the API just returns template data. This is simpler — the API doesn't need to know about device context.

**Recommendation**: Gateway resolves age (it already fetches agent config with kid info). API returns raw template data. Gateway builds the final `card_interactive` payload with params.

### 2d. Update `getRfidMappingOptions()`

Add interactive templates to the dropdown options response so the web dashboard can populate template selectors.

---

## 3. MQTT Gateway Changes

### File: `gateway/mqtt-gateway.js`

In the RFID card processing logic (around line 888-1070), add **Branch D**:

```
// After existing branches A, B, C...
// Branch D: Interactive Template
if (contentType === 'interactive') {
  const age = resolveKidAge(agentConfig);  // from cached agent config
  const ageGroup = Math.max(age || 4, 4);  // floor at 4

  const interactivePayload = {
    type: 'card_interactive',
    rfid_uid: rfidUid,
    template: data.template,
    display_name: data.displayName,
    params: {
      difficulty: 'easy',
      age_group: ageGroup
    },
    assets: {
      bundle_url: data.assets.bundle_url,
      bundle_version: data.assets.bundle_version,
      bundle_size: data.assets.bundle_size
    }
  };

  mqttPublish(responseTopic, interactivePayload);
  return;
}
```

**Age resolution**: Gateway already has `agentConfig` with kid profile info from the device session. Extract `date_of_birth` or `age` from there.

---

## 4. Manager Web Changes

### 4a. New Tab: "Interactive Templates"

In `RfidManagement.vue`, add a new tab between existing tabs showing a grid/table of templates with columns:
- Template Code
- Display Name
- Bundle URL (truncated)
- Bundle Version
- Bundle Size (formatted as KB/MB)
- Active (toggle)
- Actions (Edit / Delete)

### 4b. New Component: `RfidInteractiveTemplateDialog.vue`

Form fields:
- **Template Code** — text input, required, unique (e.g. `math_quiz`)
- **Display Name** — text input, required (e.g. "Math Fun")
- **Description** — textarea, optional
- **Bundle URL** — text input, optional (CDN URL)
- **Bundle Version** — number input, default 1
- **Bundle Size** — number input (bytes), show formatted KB/MB
- **Active** — toggle, default true

### 4c. Update `RfidCardDialog.vue`

Add 4th action type button:
```vue
<div class="type-option"
     :class="{ active: form.actionType === 'interactive' }"
     @click="setActionType('interactive')">
  <i class="el-icon-magic-stick"></i>
  <span>Interactive</span>
</div>
```

When `actionType === 'interactive'`:
- Show dropdown to select an interactive template (fetched from `/interactive-template/active`)
- Hide Q&A Pack and Content Pack selectors
- Clear incompatible references on type switch

### 4d. Card Mappings Table — New Badge

```vue
<el-tag v-else-if="scope.row.interactiveTemplateId" type="primary" size="small">
  <i class="el-icon-magic-stick"></i> Interactive
</el-tag>
```

### 4e. Stats Bar

Add count: "Total Interactive Cards" — filter by `interactiveTemplateId IS NOT NULL`.

### 4f. API Module (`src/apis/module/rfid.js`)

Add methods:
- `getInteractiveTemplatePage(params)`
- `getInteractiveTemplateList()`
- `getActiveInteractiveTemplates()`
- `getInteractiveTemplateById(id)`
- `addInteractiveTemplate(data)`
- `updateInteractiveTemplate(data)`
- `deleteInteractiveTemplate(ids)`

---

## 5. Files to Modify — Summary

| # | System | File | Change |
|---|--------|------|--------|
| 1 | DB | `manager-api-node/prisma/schema.prisma` | New model + relation |
| 2 | DB | Prisma migration (`npx prisma migrate dev`) | Generate + apply migration |
| 3 | API | `manager-api-node/src/services/rfid.service.js` | Template CRUD + lookup Track 5 |
| 4 | API | `manager-api-node/src/routes/rfid.routes.js` | Template routes + update card routes |
| 5 | GW | `mqtt-gateway/gateway/mqtt-gateway.js` | Branch D: card_interactive response |
| 6 | Web | `manager-web/src/views/RfidManagement.vue` | Interactive Templates tab + stats + badge |
| 7 | Web | `manager-web/src/components/RfidInteractiveTemplateDialog.vue` | **New** — template CRUD dialog |
| 8 | Web | `manager-web/src/components/RfidCardDialog.vue` | 4th action type + template selector |
| 9 | Web | `manager-web/src/apis/module/rfid.js` | Template API methods |

---

## 6. Implementation Order

1. **Prisma schema** — add `rfid_interactive_template` model + relation on `rfid_card_mapping`
2. **Prisma migration** — `npx prisma migrate dev --name add_interactive_template`
3. **API service** — template CRUD methods
4. **API routes** — template endpoints
5. **API lookup** — add interactive track to `lookupCardByUid()`
6. **Gateway** — Branch D for `card_interactive` response
7. **Web API module** — add template API calls
8. **Web template dialog** — new component
9. **Web card dialog** — add interactive action type
10. **Web management view** — new tab, badge, stats
