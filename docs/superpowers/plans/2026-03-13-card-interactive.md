# card_interactive Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th RFID card type `card_interactive` with template-based lookup, dynamic age resolution, and admin CRUD across all 3 systems.

**Architecture:** New `rfid_interactive_template` table stores template definitions (code, display name, assets). Card mappings reference templates via FK. Gateway resolves kid age from VirtualConnection's `childProfile` and builds the `card_interactive` payload. Admin dashboard gets a new tab + dialog for template management.

**Tech Stack:** Prisma (PostgreSQL), Express.js, Vue.js (Element UI), MQTT Gateway (Node.js)

**Spec:** `docs/superpowers/specs/2026-03-13-card-interactive-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `manager-api-node/prisma/schema.prisma` | Add `rfid_interactive_template` model + FK on `rfid_card_mapping` |
| Modify | `manager-api-node/src/services/rfid.service.js` | Template CRUD + interactive track in `lookupCardByUid()` |
| Modify | `manager-api-node/src/routes/rfid.routes.js` | Template REST endpoints + update card create/update for `interactive_template_id` |
| Modify | `mqtt-gateway/gateway/mqtt-gateway.js` | Branch D: build `card_interactive` response with age from childProfile |
| Create | `manager-web/src/components/RfidInteractiveTemplateDialog.vue` | Template create/edit dialog |
| Modify | `manager-web/src/views/RfidManagement.vue` | Interactive Templates tab, stats, card badge |
| Modify | `manager-web/src/components/RfidCardDialog.vue` | 4th action type "Interactive" + template selector |
| Modify | `manager-web/src/apis/module/rfid.js` | API methods for template CRUD |

---

## Task 1: Prisma Schema — Add Interactive Template Model

**Files:**
- Modify: `main/manager-api-node/prisma/schema.prisma:553` (after `rfid_card_mapping` model)

- [ ] **Step 1: Add `rfid_interactive_template` model to schema.prisma**

Add after the `rfid_card_mapping` model (line ~553):

```prisma
model rfid_interactive_template {
  id             BigInt    @id @default(autoincrement())
  template_code  String    @unique @db.VarChar(100)
  display_name   String    @db.VarChar(255)
  description    String?
  bundle_url     String?   @db.VarChar(500)
  bundle_version Int       @default(1)
  bundle_size    BigInt    @default(0)
  active         Boolean   @default(true)
  creator        BigInt?
  updater        BigInt?
  create_date    DateTime  @default(now()) @db.Timestamptz(6)
  update_date    DateTime  @default(now()) @db.Timestamptz(6)

  rfid_card_mapping rfid_card_mapping[]

  @@index([template_code])
  @@index([active])
}
```

- [ ] **Step 2: Add FK to `rfid_card_mapping` model**

In the `rfid_card_mapping` model (line ~525), add these two lines before the closing brace:

```prisma
  interactive_template_id  BigInt?
  rfid_interactive_template rfid_interactive_template? @relation(fields: [interactive_template_id], references: [id], onDelete: SetNull, onUpdate: NoAction)
```

And add this index alongside existing indexes:

```prisma
  @@index([interactive_template_id], map: "idx_rfid_card_mapping_interactive")
```

- [ ] **Step 3: Run Prisma migration**

```bash
cd main/manager-api-node
npx prisma migrate dev --name add_interactive_template
```

Expected: Migration created and applied. New table `rfid_interactive_template` exists. Column `interactive_template_id` added to `rfid_card_mapping`.

- [ ] **Step 4: Verify migration**

```bash
npx prisma studio
```

Check that both the new table and the new column appear.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(rfid): add rfid_interactive_template table and FK on card_mapping"
```

---

## Task 2: API Service — Interactive Template CRUD

**Files:**
- Modify: `main/manager-api-node/src/services/rfid.service.js`

- [ ] **Step 1: Add template CRUD methods**

Add these methods to `rfid.service.js` (before the `module.exports`). Follow the same patterns used by existing pack/question CRUD:

```javascript
// =============================================
// Interactive Template Methods
// =============================================

const getInteractiveTemplatePage = async (page = 1, limit = 10, filters = {}) => {
  const where = {};
  if (filters.templateCode) where.template_code = { contains: filters.templateCode, mode: 'insensitive' };
  if (filters.active !== undefined) where.active = filters.active === 'true' || filters.active === true;

  const skip = (page - 1) * limit;
  const [list, total] = await Promise.all([
    prisma.rfid_interactive_template.findMany({ where, skip, take: limit, orderBy: { create_date: 'desc' } }),
    prisma.rfid_interactive_template.count({ where }),
  ]);

  return {
    list: list.map(transformInteractiveTemplateToCamelCase),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
};

const getInteractiveTemplateList = async () => {
  const list = await prisma.rfid_interactive_template.findMany({ orderBy: { create_date: 'desc' } });
  return list.map(transformInteractiveTemplateToCamelCase);
};

const getActiveInteractiveTemplates = async () => {
  const list = await prisma.rfid_interactive_template.findMany({
    where: { active: true },
    orderBy: { display_name: 'asc' },
  });
  return list.map(transformInteractiveTemplateToCamelCase);
};

const getInteractiveTemplateById = async (id) => {
  const template = await prisma.rfid_interactive_template.findFirst({ where: { id: BigInt(id) } });
  return template ? transformInteractiveTemplateToCamelCase(template) : null;
};

const getInteractiveTemplateByCode = async (code) => {
  const template = await prisma.rfid_interactive_template.findFirst({ where: { template_code: code } });
  return template ? transformInteractiveTemplateToCamelCase(template) : null;
};

const createInteractiveTemplate = async (data) => {
  const existing = await prisma.rfid_interactive_template.findFirst({
    where: { template_code: data.templateCode },
  });
  if (existing) throw new Error('Template code already exists');

  await prisma.rfid_interactive_template.create({
    data: {
      template_code: data.templateCode,
      display_name: data.displayName,
      description: data.description || null,
      bundle_url: data.bundleUrl || null,
      bundle_version: data.bundleVersion || 1,
      bundle_size: data.bundleSize ? BigInt(data.bundleSize) : BigInt(0),
      active: data.active !== false,
    },
  });
  return null;
};

const updateInteractiveTemplate = async (data) => {
  if (!data.id) throw new Error('Template ID is required');

  const updateData = { update_date: new Date() };
  if (data.templateCode !== undefined) updateData.template_code = data.templateCode;
  if (data.displayName !== undefined) updateData.display_name = data.displayName;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.bundleUrl !== undefined) updateData.bundle_url = data.bundleUrl;
  if (data.bundleVersion !== undefined) updateData.bundle_version = data.bundleVersion;
  if (data.bundleSize !== undefined) updateData.bundle_size = BigInt(data.bundleSize);
  if (data.active !== undefined) updateData.active = data.active;

  await prisma.rfid_interactive_template.update({
    where: { id: BigInt(data.id) },
    data: updateData,
  });
  return null;
};

const deleteInteractiveTemplates = async (ids) => {
  const bigIds = ids.map((id) => BigInt(id));
  // Clear FK references first
  await prisma.rfid_card_mapping.updateMany({
    where: { interactive_template_id: { in: bigIds } },
    data: { interactive_template_id: null },
  });
  await prisma.rfid_interactive_template.deleteMany({ where: { id: { in: bigIds } } });
  return null;
};

const transformInteractiveTemplateToCamelCase = (t) => ({
  id: String(t.id),
  templateCode: t.template_code,
  displayName: t.display_name,
  description: t.description,
  bundleUrl: t.bundle_url,
  bundleVersion: t.bundle_version,
  bundleSize: String(t.bundle_size || 0),
  active: t.active,
  createDate: t.create_date,
  updateDate: t.update_date,
});
```

- [ ] **Step 2: Export the new methods**

Add to the `module.exports` block:

```javascript
  getInteractiveTemplatePage,
  getInteractiveTemplateList,
  getActiveInteractiveTemplates,
  getInteractiveTemplateById,
  getInteractiveTemplateByCode,
  createInteractiveTemplate,
  updateInteractiveTemplate,
  deleteInteractiveTemplates,
```

- [ ] **Step 3: Update `getRfidMappingOptions()`**

Find the `getRfidMappingOptions` method and add interactive templates to the response. Add this query alongside the existing parallel queries:

```javascript
const interactiveTemplates = await prisma.rfid_interactive_template.findMany({
  where: { active: true },
  select: { id: true, template_code: true, display_name: true },
  orderBy: { display_name: 'asc' },
});
```

Add to the return object:

```javascript
interactiveTemplates: interactiveTemplates.map(t => ({
  id: String(t.id),
  templateCode: t.template_code,
  displayName: t.display_name,
})),
```

- [ ] **Step 4: Commit**

```bash
git add src/services/rfid.service.js
git commit -m "feat(rfid): add interactive template CRUD service methods"
```

---

## Task 3: API Service — Add Interactive Track to lookupCardByUid

**Files:**
- Modify: `main/manager-api-node/src/services/rfid.service.js:375-553`

- [ ] **Step 1: Add Track 5 for interactive template**

In `lookupCardByUid()`, add this block **after Track 1 (content_pack_id check, ~line 423) and before the AI card check (~line 427)**. This ensures interactive cards take priority over AI fallback:

```javascript
  // Track 5: Interactive Template
  if (mapping.interactive_template_id) {
    logger.info(`[RFID-LOOKUP] Track 5: Interactive Template lookup, template_id=${mapping.interactive_template_id}`);
    try {
      const template = await prisma.rfid_interactive_template.findFirst({
        where: { id: mapping.interactive_template_id, active: true },
      });

      if (template) {
        logger.info(`[RFID-LOOKUP] Interactive Template resolved: code="${template.template_code}", name="${template.display_name}"`);
        return {
          rfid_uid: normalizedUid,
          contentType: 'interactive',
          template: template.template_code,
          displayName: template.display_name,
          assets: {
            bundle_url: template.bundle_url,
            bundle_version: template.bundle_version,
            bundle_size: Number(template.bundle_size || 0),
          },
        };
      } else {
        logger.warn(`[RFID-LOOKUP] Interactive template id=${mapping.interactive_template_id} not found or inactive`);
      }
    } catch (tplErr) {
      logger.error('[RFID-LOOKUP] Interactive template query error:', tplErr);
    }
  }
```

- [ ] **Step 2: Update `createCardMapping` to accept `interactiveTemplateId`**

In the `createCardMapping` function (~line 562), add to the Prisma create data object:

```javascript
interactive_template_id: data.interactiveTemplateId ? BigInt(data.interactiveTemplateId) : null,
```

- [ ] **Step 3: Update `updateCardMapping` to accept `interactiveTemplateId`**

In the `updateCardMapping` function, add to the conditional update fields:

```javascript
if (data.interactiveTemplateId !== undefined) {
  updateData.interactive_template_id = data.interactiveTemplateId ? BigInt(data.interactiveTemplateId) : null;
}
```

- [ ] **Step 4: Update `transformCardMappingToCamelCase`**

Add to the transform function:

```javascript
interactiveTemplateId: mapping.interactive_template_id ? String(mapping.interactive_template_id) : null,
```

- [ ] **Step 5: Commit**

```bash
git add src/services/rfid.service.js
git commit -m "feat(rfid): add interactive template track to card lookup + create/update support"
```

---

## Task 4: API Routes — Interactive Template Endpoints

**Files:**
- Modify: `main/manager-api-node/src/routes/rfid.routes.js`

- [ ] **Step 1: Add interactive template routes**

Add these routes in `rfid.routes.js`. Follow the same pattern as existing pack routes (swagger docs optional for now):

```javascript
// =============================================
// Interactive Template Routes
// =============================================

router.get('/interactive-template/page', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, templateCode, active } = req.query;
  const result = await rfidService.getInteractiveTemplatePage(
    parseInt(page), parseInt(limit), { templateCode, active }
  );
  return success(res, result);
}));

router.get('/interactive-template/list', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const list = await rfidService.getInteractiveTemplateList();
  return success(res, list);
}));

router.get('/interactive-template/active', asyncHandler(async (req, res) => {
  const list = await rfidService.getActiveInteractiveTemplates();
  return success(res, list);
}));

router.get('/interactive-template/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const template = await rfidService.getInteractiveTemplateById(req.params.id);
  if (!template) return notFound(res, 'Template not found');
  return success(res, template);
}));

router.get('/interactive-template/code/:code', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const template = await rfidService.getInteractiveTemplateByCode(req.params.code);
  if (!template) return notFound(res, 'Template not found');
  return success(res, template);
}));

router.post('/interactive-template', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { templateCode, displayName } = req.body;
  if (!templateCode || !displayName) return badRequest(res, 'templateCode and displayName are required');
  await rfidService.createInteractiveTemplate(req.body);
  return success(res, null);
}));

router.put('/interactive-template', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  if (!req.body.id) return badRequest(res, 'id is required');
  await rfidService.updateInteractiveTemplate(req.body);
  return success(res, null);
}));

router.delete('/interactive-template', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return badRequest(res, 'Array of IDs required');
  await rfidService.deleteInteractiveTemplates(ids);
  return success(res, null);
}));

router.post('/interactive-template/delete', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const ids = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return badRequest(res, 'Array of IDs required');
  await rfidService.deleteInteractiveTemplates(ids);
  return success(res, null);
}));
```

- [ ] **Step 2: Verify server starts**

```bash
cd main/manager-api-node
npm run dev
```

Expected: Server starts on port 8002 without errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/rfid.routes.js
git commit -m "feat(rfid): add interactive template REST endpoints"
```

---

## Task 5: MQTT Gateway — Branch D for card_interactive

**Files:**
- Modify: `main/mqtt-gateway/gateway/mqtt-gateway.js:935-960`

- [ ] **Step 1: Add Branch D before Branch C**

Insert this block **after Branch A (line ~935, after the `return;`)** and **before Branch C (the `isAiPromptCard` check at line ~938)**:

```javascript
        // ====== BRANCH D: INTERACTIVE CARD — send card_interactive directly via MQTT ======
        if (rfidContent.contentType === 'interactive') {
          // Resolve kid age from VirtualConnection's childProfile
          let ageGroup = 4; // default floor
          const devInfo = this.deviceConnections.get(deviceId);
          if (devInfo && devInfo.connection && devInfo.connection.childProfile) {
            const kidAge = devInfo.connection.childProfile.age;
            ageGroup = (typeof kidAge === 'number' && kidAge >= 4) ? kidAge : 4;
          }

          const interactivePayload = {
            type: 'card_interactive',
            rfid_uid: rfidUid,
            template: rfidContent.template,
            display_name: rfidContent.displayName,
            params: {
              difficulty: 'easy',
              age_group: ageGroup,
            },
            assets: rfidContent.assets || {},
          };

          logger.info(
            `🎮 [RFID-ROUTING] Interactive card detected: template="${rfidContent.template}", ` +
            `age_group=${ageGroup}. Sending card_interactive to device ${deviceId}`
          );

          this.mqttPublish(`devices/p2p/${clientId}`, interactivePayload);
          return;
        }
```

- [ ] **Step 2: Update the `fetchRfidContentFromManagerApi` return to pass through interactive fields**

In the `fetchRfidContentFromManagerApi` function (line ~143), the return block already returns the full `data` object fields. Verify that the return at line ~143 includes all fields. The current code returns `contentType`, `title`, etc. Since we added `template`, `displayName`, and `assets` to the API response, they will be in `data` and need to be passed through.

Check the return statement. If it destructures specific fields, add:

```javascript
    return {
      contentType,
      title,
      // ... existing fields ...
      // Interactive template fields (passed through if present)
      template: data.template || null,
      displayName: data.displayName || null,
      assets: data.assets || null,
    };
```

- [ ] **Step 3: Test manually**

1. Create an interactive template via API:
```bash
curl -X POST http://localhost:8002/toy/admin/rfid/interactive-template \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"templateCode":"math_quiz","displayName":"Math Fun","bundleUrl":"https://cdn.example.com/bundles/math.bndl","bundleVersion":1,"bundleSize":204800}'
```

2. Create a card mapping pointing to the template:
```bash
curl -X POST http://localhost:8002/toy/admin/rfid/card \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"rfidUid":"AABB1122","interactiveTemplateId":"<template_id>","actionType":"interactive"}'
```

3. Test lookup:
```bash
curl http://localhost:8002/toy/admin/rfid/card/lookup/AABB1122
```

Expected response should include `contentType: "interactive"`, `template: "math_quiz"`, etc.

- [ ] **Step 4: Commit**

```bash
git add gateway/mqtt-gateway.js
git commit -m "feat(rfid): add Branch D for card_interactive in MQTT gateway"
```

---

## Task 6: Web — API Module for Interactive Templates

**Files:**
- Modify: `main/manager-web/src/apis/module/rfid.js`

- [ ] **Step 1: Add API methods**

Add these methods following the existing pattern in `rfid.js`:

```javascript
// Interactive Template APIs
export function getInteractiveTemplatePage(params) {
  return request({ url: '/admin/rfid/interactive-template/page', method: 'get', params });
}

export function getInteractiveTemplateList() {
  return request({ url: '/admin/rfid/interactive-template/list', method: 'get' });
}

export function getActiveInteractiveTemplates() {
  return request({ url: '/admin/rfid/interactive-template/active', method: 'get' });
}

export function getInteractiveTemplateById(id) {
  return request({ url: `/admin/rfid/interactive-template/${id}`, method: 'get' });
}

export function addInteractiveTemplate(data) {
  return request({ url: '/admin/rfid/interactive-template', method: 'post', data });
}

export function updateInteractiveTemplate(data) {
  return request({ url: '/admin/rfid/interactive-template', method: 'put', data });
}

export function deleteInteractiveTemplate(ids) {
  return request({ url: '/admin/rfid/interactive-template', method: 'delete', data: ids });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/apis/module/rfid.js
git commit -m "feat(rfid): add interactive template API methods to web dashboard"
```

---

## Task 7: Web — Interactive Template Dialog Component

**Files:**
- Create: `main/manager-web/src/components/RfidInteractiveTemplateDialog.vue`

- [ ] **Step 1: Create the dialog component**

Create `RfidInteractiveTemplateDialog.vue` following the same pattern as `RfidPackDialog.vue`. The dialog should have:

- Form fields: Template Code (required), Display Name (required), Description, Bundle URL, Bundle Version (number, default 1), Bundle Size (number, display as KB), Active toggle
- Props: `visible` (Boolean), `editData` (Object or null)
- Events: `update:visible`, `saved`
- Uses Element UI `el-dialog`, `el-form`, `el-input`, `el-switch`, `el-input-number`
- Calls `addInteractiveTemplate` or `updateInteractiveTemplate` on save
- Validates required fields (templateCode, displayName)
- Bundle size input in bytes, shows formatted KB/MB as helper text

```vue
<template>
  <el-dialog
    :title="isEdit ? 'Edit Interactive Template' : 'New Interactive Template'"
    :visible.sync="dialogVisible"
    width="500px"
    @close="handleClose"
  >
    <el-form ref="form" :model="form" :rules="rules" label-width="120px" size="small">
      <el-form-item label="Template Code" prop="templateCode">
        <el-input v-model="form.templateCode" placeholder="e.g. math_quiz" :disabled="isEdit" />
      </el-form-item>
      <el-form-item label="Display Name" prop="displayName">
        <el-input v-model="form.displayName" placeholder="e.g. Math Fun" />
      </el-form-item>
      <el-form-item label="Description">
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="Bundle URL">
        <el-input v-model="form.bundleUrl" placeholder="https://cdn.example.com/bundles/..." />
      </el-form-item>
      <el-form-item label="Bundle Version">
        <el-input-number v-model="form.bundleVersion" :min="1" :max="9999" />
      </el-form-item>
      <el-form-item label="Bundle Size">
        <el-input-number v-model="form.bundleSize" :min="0" placeholder="bytes" />
        <span class="size-hint" v-if="form.bundleSize > 0">
          {{ (form.bundleSize / 1024).toFixed(1) }} KB
        </span>
      </el-form-item>
      <el-form-item label="Active">
        <el-switch v-model="form.active" />
      </el-form-item>
    </el-form>
    <div slot="footer">
      <el-button size="small" @click="dialogVisible = false">Cancel</el-button>
      <el-button size="small" type="primary" :loading="saving" @click="handleSave">Save</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { addInteractiveTemplate, updateInteractiveTemplate } from '@/apis/module/rfid';

export default {
  name: 'RfidInteractiveTemplateDialog',
  props: {
    visible: Boolean,
    editData: { type: Object, default: null },
  },
  data() {
    return {
      saving: false,
      form: this.defaultForm(),
      rules: {
        templateCode: [{ required: true, message: 'Required', trigger: 'blur' }],
        displayName: [{ required: true, message: 'Required', trigger: 'blur' }],
      },
    };
  },
  computed: {
    dialogVisible: {
      get() { return this.visible; },
      set(v) { this.$emit('update:visible', v); },
    },
    isEdit() { return !!(this.editData && this.editData.id); },
  },
  watch: {
    visible(v) {
      if (v) {
        if (this.editData) {
          this.form = { ...this.defaultForm(), ...this.editData };
          this.form.bundleSize = Number(this.form.bundleSize || 0);
        } else {
          this.form = this.defaultForm();
        }
        this.$nextTick(() => this.$refs.form && this.$refs.form.clearValidate());
      }
    },
  },
  methods: {
    defaultForm() {
      return {
        id: null, templateCode: '', displayName: '', description: '',
        bundleUrl: '', bundleVersion: 1, bundleSize: 0, active: true,
      };
    },
    handleClose() {
      this.form = this.defaultForm();
    },
    async handleSave() {
      try {
        await this.$refs.form.validate();
      } catch { return; }
      this.saving = true;
      try {
        if (this.isEdit) {
          await updateInteractiveTemplate(this.form);
        } else {
          await addInteractiveTemplate(this.form);
        }
        this.$message.success(this.isEdit ? 'Updated' : 'Created');
        this.dialogVisible = false;
        this.$emit('saved');
      } catch (e) {
        this.$message.error(e.response?.data?.msg || e.message);
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
.size-hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RfidInteractiveTemplateDialog.vue
git commit -m "feat(rfid): add RfidInteractiveTemplateDialog component"
```

---

## Task 8: Web — Update RfidManagement.vue

**Files:**
- Modify: `main/manager-web/src/views/RfidManagement.vue`

- [ ] **Step 1: Import the new dialog and API methods**

Add to the imports section:

```javascript
import RfidInteractiveTemplateDialog from '@/components/RfidInteractiveTemplateDialog.vue';
import { getInteractiveTemplatePage, deleteInteractiveTemplate } from '@/apis/module/rfid';
```

Register the component in `components: { ... }`.

- [ ] **Step 2: Add data properties**

Add to `data()`:

```javascript
// Interactive Templates tab
interactiveTemplates: [],
interactiveTemplatesTotal: 0,
interactiveTemplatesPage: 1,
interactiveTemplatesLimit: 10,
interactiveTemplateDialogVisible: false,
interactiveTemplateEditData: null,
interactiveTemplatesLoading: false,
```

- [ ] **Step 3: Add "Interactive Templates" tab**

Add a new `<el-tab-pane label="Interactive Templates" name="interactiveTemplates">` with a table showing columns:
- Template Code
- Display Name
- Bundle URL (truncated with `el-tooltip`)
- Bundle Version
- Bundle Size (formatted as KB)
- Active (`el-tag`)
- Actions (Edit / Delete buttons)

Include Add button in the tab header area, and pagination at the bottom.

- [ ] **Step 4: Add the interactive card badge to Card Mappings table**

In the card mappings table's "Content Type" column, add before the "Unmapped" fallback tag:

```vue
<el-tag v-else-if="scope.row.interactiveTemplateId" type="primary" size="small">
  <i class="el-icon-magic-stick"></i> Interactive
</el-tag>
```

- [ ] **Step 5: Add stats counter**

In the stats bar, add a new stat box:

```vue
<div class="stat-item">
  <div class="stat-value">{{ interactiveTemplatesTotal }}</div>
  <div class="stat-label">Interactive Templates</div>
</div>
```

- [ ] **Step 6: Add methods**

```javascript
async loadInteractiveTemplates() {
  this.interactiveTemplatesLoading = true;
  try {
    const res = await getInteractiveTemplatePage({
      page: this.interactiveTemplatesPage,
      limit: this.interactiveTemplatesLimit,
    });
    this.interactiveTemplates = res.data.list || [];
    this.interactiveTemplatesTotal = res.data.total || 0;
  } catch (e) {
    this.$message.error('Failed to load interactive templates');
  } finally {
    this.interactiveTemplatesLoading = false;
  }
},

handleAddInteractiveTemplate() {
  this.interactiveTemplateEditData = null;
  this.interactiveTemplateDialogVisible = true;
},

handleEditInteractiveTemplate(row) {
  this.interactiveTemplateEditData = { ...row };
  this.interactiveTemplateDialogVisible = true;
},

async handleDeleteInteractiveTemplate(row) {
  try {
    await this.$confirm('Delete this template?', 'Confirm');
    await deleteInteractiveTemplate([row.id]);
    this.$message.success('Deleted');
    this.loadInteractiveTemplates();
  } catch {}
},
```

- [ ] **Step 7: Load data on tab switch**

In the tab change handler, add:

```javascript
if (tab === 'interactiveTemplates') this.loadInteractiveTemplates();
```

- [ ] **Step 8: Add dialog to template**

```vue
<RfidInteractiveTemplateDialog
  :visible.sync="interactiveTemplateDialogVisible"
  :edit-data="interactiveTemplateEditData"
  @saved="loadInteractiveTemplates"
/>
```

- [ ] **Step 9: Commit**

```bash
git add src/views/RfidManagement.vue
git commit -m "feat(rfid): add Interactive Templates tab to admin dashboard"
```

---

## Task 9: Web — Update RfidCardDialog for Interactive Type

**Files:**
- Modify: `main/manager-web/src/components/RfidCardDialog.vue`

- [ ] **Step 1: Add interactive type button**

In the type-selector div (around line 27-42), add a 4th button:

```vue
<div class="type-option" :class="{ active: form.actionType === 'interactive' }" @click="setActionType('interactive')">
  <i class="el-icon-magic-stick"></i>
  <span>Interactive</span>
</div>
```

- [ ] **Step 2: Add template selector**

Add a conditional dropdown that appears when `actionType === 'interactive'`:

```vue
<el-form-item label="Template" v-if="form.actionType === 'interactive'" prop="interactiveTemplateId">
  <el-select v-model="form.interactiveTemplateId" placeholder="Select template" filterable clearable>
    <el-option
      v-for="t in interactiveTemplates"
      :key="t.id"
      :label="t.displayName"
      :value="t.id"
    >
      <span>{{ t.displayName }}</span>
      <span style="float: right; color: #909399; font-size: 12px">{{ t.templateCode }}</span>
    </el-option>
  </el-select>
</el-form-item>
```

- [ ] **Step 3: Add data & props**

Add `interactiveTemplates` prop (Array, default `[]`), or fetch from API in the dialog's `watch.visible`.

Add `interactiveTemplateId: null` to the form's default state.

- [ ] **Step 4: Update `setActionType` method**

In the `setActionType` method, add the interactive case:

```javascript
case 'interactive':
  this.form.questionPackId = null;
  this.form.contentPackId = null;
  this.form.cardType = 'content'; // default card_type
  break;
```

- [ ] **Step 5: Pass `interactiveTemplateId` on save**

Ensure the save method includes `interactiveTemplateId` in the payload. When `actionType !== 'interactive'`, set `interactiveTemplateId: null`.

- [ ] **Step 6: Handle edit mode detection**

In the edit mode auto-detection logic (where it sets `actionType` based on existing data), add:

```javascript
if (data.interactiveTemplateId) {
  this.form.actionType = 'interactive';
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/RfidCardDialog.vue
git commit -m "feat(rfid): add Interactive action type to card mapping dialog"
```

---

## Task 10: Integration Test

- [ ] **Step 1: End-to-end test via dashboard**

1. Open admin dashboard → RFID Management
2. Go to "Interactive Templates" tab
3. Create a template: code=`math_quiz`, name="Math Fun", bundle URL, version=1, size=204800
4. Go to "Card Mappings" tab
5. Create new card: UID=`AABB1122`, type=Interactive, select "Math Fun" template
6. Verify the card shows "Interactive" badge in the table
7. Go to "Lookup & Test" tab
8. Look up UID `AABB1122`
9. Verify response contains `contentType: "interactive"`, `template: "math_quiz"`, `assets` object

- [ ] **Step 2: Test gateway (if device available)**

Scan the RFID card on a device and verify the ESP32 receives the `card_interactive` payload with correct `age_group` (from kid profile, minimum 4).

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(rfid): complete card_interactive support across all systems"
```
