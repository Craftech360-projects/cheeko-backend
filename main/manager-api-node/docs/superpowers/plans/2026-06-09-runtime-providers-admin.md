# Runtime Providers Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin APIs and a Vue admin page to list, edit, and activate LLM/STT/TTS runtime provider rows.

**Architecture:** Extend the existing LiveKit provider service and routes because it already owns runtime provider activation. Add a focused Vue page under the super-admin Parameter Dictionary dropdown that calls the new endpoints and masks API keys by default.

**Tech Stack:** Express, Prisma, Jest/Supertest, Vue 2, Element UI.

---

### Task 1: Backend Provider Management API

**Files:**
- Modify: `src/services/livekitProviders.service.js`
- Modify: `src/routes/livekitProviders.routes.js`
- Test: `tests/unit/livekitProviders.service.test.js`

- [ ] **Step 1: Write failing service tests**

Test listing all providers, updating one row, and activating one row while deactivating other rows of the same type.

- [ ] **Step 2: Run service tests to verify RED**

Run: `npm test -- tests/unit/livekitProviders.service.test.js --runInBand`
Expected: FAIL because new service methods are not exported.

- [ ] **Step 3: Implement minimal service methods**

Add `listProviders`, `updateProvider`, and `activateProvider` using Prisma delegates `llm_providers`, `stt_providers`, and `tts_providers`.

- [ ] **Step 4: Add route handlers**

Add `GET /providers`, `PUT /providers/:type/:id`, and `PUT /providers/:type/:id/active` behind `requireAdmin`.

- [ ] **Step 5: Run service tests to verify GREEN**

Run: `npm test -- tests/unit/livekitProviders.service.test.js --runInBand`
Expected: PASS.

### Task 2: Manager Web API Client

**Files:**
- Create: `src/apis/module/runtimeProviders.js`
- Modify: `src/apis/api.js`

- [ ] **Step 1: Add API wrapper**

Add methods for listing providers, updating providers, and setting active provider.

- [ ] **Step 2: Export the module**

Expose it as `Api.runtimeProviders`.

### Task 3: Manager Web Admin Page

**Files:**
- Create: `src/views/RuntimeProviders.vue`
- Modify: `src/router/index.js`
- Modify: `src/components/HeaderBar.vue`

- [ ] **Step 1: Create page**

Use Element UI tabs for LLM, STT, and TTS. Show all rows, active badges, editable fields, and masked API keys with View/Hide toggles.

- [ ] **Step 2: Add route**

Add `/runtime-providers` and include it in protected routes.

- [ ] **Step 3: Add menu entry**

Add Runtime Providers to the super-admin Parameter Dictionary dropdown.

### Task 4: Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run backend target tests**

Run: `npm test -- tests/unit/livekitProviders.service.test.js --runInBand`
Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build`
Expected: PASS.
