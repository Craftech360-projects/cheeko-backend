# Manager-Web Admin Dashboard — Redesign & Performance Plan

**Date:** 2026-09-03 · **Scope:** `main/manager-web` (Vue 2 + Element UI) against `main/manager-api-node`
**Companion doc:** `FOUNDER_DASHBOARD_SPEC.md` (approved by Ravi, Jul 2026) — this plan adopts its IA and builds the missing parts: full feature parity map, API audit, performance root-causes, and the migration order.

---

## 1. Why the dashboard feels slow — root causes (evidence-backed)

Measured call bursts when opening a page (all verified in code):

| Page | Calls on open | Cause |
|---|---|---|
| AllDevices | **1 + N** (N = every device) | loads `limit:1000` then fires `getDeviceMode` **per device row** (AllDevices.vue:821-836); repeats after every unbind/refresh |
| home | ~14 | 10 per-agent `getAgentBindDevices` just to count devices (home.vue:602-627) + stats |
| RfidManagement | 12, then **+11 per save/delete** | 4 unpaginated dropdown lists + 7 stats probes re-run after every mutation (RfidManagement.vue:1543-1601) |
| GameAnalytics / TokenAnalytics | 7 / 3 | re-fired entirely on every date change, never cached |
| Every navigation | +1 (or full reload) | HeaderBar remounts each route (rendered inside 21 views, not the shell) → `getUserInfo` per click; duplicate tab click triggers `window.location.reload()` (router/index.js:253-257) |
| Header search | 9 per keystroke | GlobalSearchDropdown.vue:312-476 fires 9 parallel 100-row requests, regex-filters client-side |

Cross-cutting causes:

1. **No shared layout** — every view embeds `<HeaderBar/>` itself; App.vue is a bare `<router-view/>`; no `keep-alive`, so every tab switch replays the page's full mount burst.
2. **No caching anywhere** — HTTP layer is an unmaintained flyio callback wrapper (`httpRequest.js`) with zero dedup/cancel/cache and a **10× recursive 2-second retry applied even to POST/DELETE** (duplicate-mutation risk on flaky networks). Vuex holds only token/userInfo.
3. **N+1 patterns** — device counts and device modes are fetched per-row instead of returned by the list endpoints.
4. **Mixed pagination idioms** — 8 pages use a hand-rolled copy-pasted paginator, others use `el-pagination`, two pages load-everything and client-paginate (AllDevices caps at 1000 rows silently).
5. **Monolith components** — RfidManagement.vue is 4,074 lines = 9 pages in one file; RfidContentPackDialog.vue 1,451; DeviceManagement 1,302; analytics pages hand-roll their own CSS/SVG charts (duplicated).
6. **Bundle** — full Element UI JS+CSS import (no `babel-plugin-component`); service worker `StaleWhileRevalidate` with `maxEntries: 50` can serve a stale chunk after each deploy and evicts constantly.
7. **Backend** — admin token auth does 2 DB queries per request with no caching; no response caching on hot aggregates.

**Net effect:** a few hundred devices turns one AllDevices visit into ~1,000 requests; normal tab-switching re-fetches everything; a double-click on a nav pill reloads the entire SPA. The lag is architectural, not incidental — which is good news: the fixes are structural and straightforward.

---

## 2. Feature inventory — what exists, why, and its verdict

Legend: **Keep** = redesign in place · **Merge** = fold into another surface · **Archive** = hide behind a flag/feature-gate, don't delete (understand why it exists first) · **Drop** = stub/dead, remove from UI.

### 2.1 Characters (AI agents)
| Feature (page) | Why it exists | APIs | Verdict |
|---|---|---|---|
| Agent list + KPI strip (`home.vue`) | Characters are the product: each family's toy plays one AI persona. Create/manage personas; jump to role config, devices, voice, chat history | `agent.getUserAgentList`, `agent.getTodayDeviceCount/MonthDeviceCount`, `agent.getTodayActiveDevices/MonthActiveDevices` (popover), `admin.getSystemStats`, `agent.deleteAgent`, N× `device.getAgentBindDevices` | **Keep** — becomes the "Characters" group landing. Fix: device count must come from the list endpoint (kill N+1), "Total Users" footer label lies (it's the current page) |
| Role config (`roleConfig.vue`) | Per-character persona tuning (name, system prompt, memory) that the LiveKit worker reads per session | `agent.getDeviceConfig`, `agent.updateAgentConfig`, `agent.getAgentTemplate` | **Keep** — page under Characters |
| Templates (`TemplateManagement.vue`) | Reusable personas so new characters don't start blank; can be applied to many agents at once | `agent.getAgentTemplate` + CRUD + `applyTemplateToAgents` | **Keep** — sub-page of Characters |
| Chat history (`ChatHistoryDialog`) | Debug what a kid actually said/heard; transcripts stored per agent session | `agent./chat-history/*` | **Keep** — feeds the new `/conversations` page (spec §8.3) |
| Voice prints (`VoicePrint.vue`) | Xiaozhi-ESP32 heritage (speaker ID). **No consumer found in livekit-server or mqtt-gateway** — the TTS timbre side is alive, voice-print recognition is not | `agent.getAgentVoicePrintList` + CRUD | **Archive** — hide menu entry; keep route working until confirmed unused |

### 2.2 Families & users
| Feature | Why it exists | APIs | Verdict |
|---|---|---|---|
| User management (`UserManagement.vue`) | Support desk: find a family by phone, reset password, enable/disable, delete, view kids | `admin.getUserList`, `user.changeUserStatus`, `admin.resetUserPassword/deleteUser/getUserKidProfiles` | **Keep** — under Families. Add: real bulk endpoints (currently N parallel deletes) |
| Kid profiles (`KidProfiles.vue`) | Personalization is **child-scoped, not device-scoped** (a toy carried to another family carries nothing) — memory, quiz banks, progress all key on child | `admin.getUserKidProfiles` + admin CRUD, or `profile.*` parent-mode | **Keep** — under Families; becomes part of Family 360 (spec §2.3) |

### 2.3 Devices
| Feature | Why it exists | APIs | Verdict |
|---|---|---|---|
| Fleet devices (`AllDevices.vue`) | Admin window into every toy: live mode, OTA switch, and the **settings-sync viewer** (what the parent app set vs what the device acked — `device_settings`/`device_runtime_state`/`device_sync_event`) | `admin.getAllDevices(limit:1000)`, N× `device.getDeviceMode`, 5-8 calls per settings dialog, `admin.updateDeviceSettingsByMac` | **Keep** — Operate group landing. Fix N+1 (mode belongs in list endpoint), replace `limit:1000` with server pagination |
| Per-agent devices (`DeviceManagement.vue`) | Bind toy↔character (bind codes, manual add), curate Music/Story playlists from Content Library, unbind | `device.getAgentBindDevices/getDeviceByMac/unbindDevice`, `content.getLibraryList/Categories`, playlists CRUD, `dict.getDictDataByType('FIRMWARE_TYPE')` | **Keep** — becomes the Device detail page (drill-down from fleet), not a top-level page |
| Daily activity (`ActiveDevices.vue`) | Ops question "who used Cheeko today and what did they do": taps, images (S3 imagine), games, radio, chat per device/day. Doc-imposed rules: join taps on `mac_address` (device_id NULL on 67% of rows), bucket dates in IST, never render parent emails | `activeDevices.getActiveDevices`, per-tab `getDeviceRfid/Images/Games/Radio/Chat` | **Keep** — Engagement group; its chat drawer is reused by `/conversations` |

### 2.4 Content & RFID (the heart of the product)
| Feature | Why it exists | APIs | Verdict |
|---|---|---|---|
| RFID management (`RfidManagement.vue`, 9 tabs) | Physical NFC cards are the kid's primary content-selection UX. Two approved tracks: **static packs** (story/rhyme audio+images, max 10 items — device memory limit) and **dynamic Q&A** (AI, with caching + prompt overrides). Tabs: Q&A packs, Content packs, Product SKUs, Card mappings, AI cards (character cards), Custom cards (parent-recorded, per-device), Bulk ranges (UID ranges), Card analytics (taps), Lookup & test (+ live NFC reader via local `nfc_bridge.py`) | ~54 functions across `rfid.js` (927 lines): `get*Page` per entity, `loadDropdownData` (4 full lists), `loadStats` (7 probes), `getCardTapSummary`, `lookup*` tests, upload endpoint | **Keep every capability, rebuild the shell.** Split into router sub-pages under Content & Games. Kill the mutation refetch storm; dropdowns only loaded by the dialogs that need them; delete dead "questions" tab code (`RfidQuestionDialog` registered but never rendered) |
| Bulk import (`BulkImport.vue`) | Factory-scale card provisioning: one XLSX ("Content" + "Card Mappings" sheets) → hundreds of cards; also exports mappings | raw `fetch()` bypassing the API layer: `bulk-import/preview|execute|export` | **Keep** — move into the RFID area as a step, fix the hand-rolled auth duplication |
| Content library (`ContentLibrary.vue`) | The non-RFID catalog (music/stories/textbooks incl. LVGL `.bin` images) used by playlists and playback | `content.getLibraryList/search/Categories/Statistics`, CRUD + S3 upload | **Keep** — Content & Games group |
| Content types (recent work) | Sep 2026 commits added content-type filtering + creation from pack editor, folder import of audio+image pairs, real previews | content-pack endpoints + `/content-pack/upload` | **Keep** — must survive the redesign intact |

### 2.5 Learning & analytics
| Feature | Why it exists | APIs | Verdict |
|---|---|---|---|
| Quiz progress (`QuizProgress.vue`) | Admin parity with the toy's daily-quiz state (Quizzy defect D6: "admin console and the toy can disagree"): per-device level, **Set level**, **Reset day** overrides | `quiz.getDeviceProgress/getAnalytics/setLevel/resetDay` | **Keep** — Content & Games group. It's the only page with race guards — keep that pattern |
| Game analytics (`GameAnalytics.vue`) | Learning engagement: sessions, accuracy, difficulty, TTFT (latency regressions), top devices | 7 `analytics.*` dashboard endpoints | **Keep** — merges into `/engagement` (spec §8.1) + `/content` (§8.2); replace hand-built charts with echarts |
| Token analytics (`TokenAnalytics.vue`) | AI cost control — LLM/TTS spend per device/day (LiveKit agents report usage) | `usage.getOverallTotals/DailySummary/PerDeviceDailyUsage` | **Keep** — becomes `/costs` (spec §8.4, zero new backend needed) |
| Email reports (`EmailReportSettings.vue`) | Daily ops summary by email; Phase-2 "Daily Brief" reuses this pipeline | `emailReport.getConfig/updateConfig/history/sendTestEmail/generateReport/previewReport` | **Keep** — Operate group; add an explicit Save button (silent 1s autosave is invisible) |

### 2.6 Operate / configuration
| Feature | Why it exists | APIs | Verdict |
|---|---|---|---|
| OTA management (`OtaManagement.vue`) | Fleet firmware for ESP32 (device boots call `/toy/ota/` — a Spring-compatible path kept deliberately) | `ota.getOtaList/saveOta/updateOta/deleteOta/getDownloadUrl/setForceUpdate`, dict FIRMWARE_TYPE | **Keep** — Operate. Fix: "Connected Devices Overview" reads `localStorage.agentId` (usually absent → shows zeros) |
| Runtime providers (`RuntimeProviders.vue`) | Swap AI vendors (LLM/STT/TTS/moderation/image) without redeploying workers — LiveKit worker fetches active providers at room start | `runtimeProviders.getProviders/activateProvider/updateProvider` | **Keep** — Operate. Fix copy ("3 services" → 5); add the missing create-provider flow |
| Dict management (`DictManagement.vue`) | Label/dropdown config — **still load-bearing** (FIRMWARE_TYPE labels in 2 pages); Spring-port shim | `dict.*` | **Keep** — Operate → Settings |
| Params management (`ParamsManagement.vue`) | Spring heritage key-value store; **no reader found in the Node API outside its own routes** | `admin.getParamsList` + CRUD | **Archive** — keep under Settings behind super-admin, stop surfacing it |
| Server-side manager (`ServerSideManager.vue`) | **Stub** — backend returns a hardcoded 2-entry list and `emit-action` only logs | `admin.getWsServerList/sendWsServerAction` | **Drop** from the menu (route stays until backend is real). Contains dead ParamDialog imports |
| Voice/TTS models (`AddModelDialog`, `ModelEditDialog`, `TtsModel`) | Model + voice wiring per agent (recent SmallestAI voice-id work) | `models.*` (26 endpoints), `ttsVoice.*` | **Keep** — Characters group |

### 2.7 Cross-cutting
- **Global search** (9 calls/keystroke) → replace with the spec's `GET /admin/search` unified endpoint (already spec'd §3.5; note `admin.routes.js` already ships `/founder/families/search` — use it).
- **Auth** — token in localStorage JSON; login/captcha/SMS flows standard. Keep.
- **CacheViewer.vue** — CDN debug overlay; dev-only.
- **Dead code to remove during rebuild:** `RfidQuestionDialog` + questions-tab branches, ServerSideManager's unused imports, `home.vue handleKidProfilesRow`, DeviceManagement's duplicate dict fetch from eagerly-mounted dialog.

---

## 3. API server reality check (manager-api-node)

- **~450 endpoints** across 26 route files under `/toy`. The dashboard uses roughly 120. Another ~100 are the Firebase parent-app (`/api/mobile/*`) — off-limits to this redesign but the reason several admin views exist (settings sync, kid profiles).
- **Device/worker-facing paths must never be renamed:** `/toy/ota/`, `/toy/device/ota/check`, `/toy/admin/rfid/card/tap|lookup|download`, `/toy/agent/config/:mac`, `/toy/config/*`, deviceSync. The ESP32 firmware depends on exact shapes (prd.md).
- **Already-built but unused by the old UI:** the entire founder surface `GET /admin/founder/overview|engagement|content|conversations|costs|operate|brief|live`, `families/search|list|:id/profile`, `conversations/:sessionId/transcript` (founderDashboard.service.js, 2,325 lines). **The backend for the approved spec's landing pages already exists.**
- **Gaps to close (new endpoints, small):**
  1. `GET /agent/list` → include `deviceCount` per agent (kills home.vue's N+1).
  2. `GET /admin/device/all` → include `mode` per device (kills AllDevices' N+1) + server-side pagination.
  3. Bulk ops: `POST /admin/users/bulk-delete|bulk-status`, `POST /admin/device/unbind-batch` (currently N parallel calls with mixed-failure counting).
  4. `GET /admin/search?q=` unified search (spec §3.5) or wire the existing families/search into the header.
  5. Token-auth caching: `verifyCustomToken` does 2 DB queries per request — add a short-TTL in-memory LRU (60s) keyed by token; safe, big win under bursts.
- **Do not retry non-idempotent POST/DELETE** — the frontend HTTP layer must stop recursive retries on writes (backend rate limit is 5000/15min; retry storms eat it).

---

## 4. The redesign

### 4.1 Information architecture (adopts the approved spec §2.2)

Sidebar layout (desktop) replacing the 16-pill scrolling header; bottom tab bar on mobile for the new pages.

```
Overview          /overview          ← new landing (Morning Pulse, data already in /admin/founder/*)
Characters        /home (agents), /role-config, /templates, models & voices, /conversations
Families          /families (new search + 360), /user-management, /kid-profiles
Engagement        /engagement (merges GameAnalytics + ActiveDevices entry), /active-devices
Content & Games   /rfid (sub-nav: Packs / Cards / SKUs / Custom / Ranges / Analytics / Test),
                  /bulk-import, /content-library, /quiz-progress
Costs             /costs (was TokenAnalytics)
Operate           /all-devices (fleet), /ota-management, /runtime-providers, /email-reports,
                  Settings: /dict-management, /params-management (gated), server tools (hidden)
```

Rules preserved from the approved spec: **no existing page is deleted**; IST date bucketing; RFID joins on `mac_address`; never render parent emails; unresolved taps shown as "Unresolved".

### 4.2 Theme & look (suggestion)

- **Keep the brand:** `#FF9100` orange primary, existing `theme.scss` tokens — they're good and already spec'd. Refine, don't repaint: denser tables (compact mode), one card style (`SectionCard`), consistent 8px spacing scale, `tabular-nums` on all numbers, sidebar + content max-width.
- **Element UI stays (Vue 2 constraint) but gets one coherent skin:** override `element-variables.scss` to map Element's palette onto the brand tokens; build `DataTable`, `PageHeader`, `StatCard`, `SearchBar`, `ConfirmDialog` wrappers so pages stop hand-rolling. This alone removes the "complicated" feel — most pages currently have their own table chrome, paginator, and button styles.
- **Charts:** echarts 5 via `echarts/core` tree-shaken imports behind a thin `BaseChart.vue` (per spec §4) — kills the duplicated hand-built SVG/div charts.
- **Fonts/numbers:** Inter or keep system stack; always status = icon + label (colorblind rule from spec).

### 4.3 Stack / package decisions (suggestion)

| Concern | Today | Recommendation | Why |
|---|---|---|---|
| Framework | Vue 2.6 (EOL) | **Stay on Vue 2 for this redesign**; plan Vue 3 + Element Plus as a later, separate migration | Spec assumes Vue 2; a framework rewrite + UX rebuild at once is how features get lost. The React `founder-dashboard-web` is a 4.5k-line single-file prototype — don't run two codebases; fold its ideas (quiz screen) into this one |
| HTTP | flyio (unmaintained, callback API) | **axios** instance + interceptors: auth header, 401 → re-login, response envelope unwrap, **in-flight dedup (GET), AbortController on filter changes, TTL cache (GET 30-60s), no auto-retry on POST/DELETE, single retry with backoff on GET** | Replaces ~200 lines of fragile wrapper + stops retry storms |
| Charts | hand-built div/SVG | **echarts 5** (`echarts/core` imports) | spec §4 |
| Dates | ad-hoc, hardcoded IST strings | **dayjs + timezone plugin** | IST bucketing everywhere consistently |
| Element UI | full import | keep, add **`babel-plugin-component`** on-demand import | cuts vendor chunk substantially |
| State | Vuex 3 (auth only) | Vuex modules: `dict`, `user`, `lookups` (agents/options caches) | shared dropdowns load once |
| Search | 9 parallel calls | backend `/admin/search` (or reuse `/founder/families/search`) + single debounced call | kills the keystroke storm |
| SW | Workbox SWR, maxEntries 50 | raise `maxEntries`, drop `skipWaiting`-without-reload, or disable SW for admin app | stale-chunk risk after deploys |

### 4.4 Shared frontend architecture

```
src/
├── layouts/AdminLayout.vue        ← sidebar + header + <keep-alive include="..."> router-view
├── apis/http.js                   ← axios instance (dedup/cache/cancel), per-domain modules stay
├── components/
│   ├── DataTable/  StatCard/  PageHeader/  SearchBar/  ConfirmDialog/
│   ├── charts/BaseChart.vue  charts/presets.js
│   └── rfid/  (RfidPackDialog, RfidCardDialog, RfidContentPackDialog split per concern)
├── store/modules/{dict,user,lookups}.js
└── views/ (regrouped as §4.1; each ≤ ~500 lines, split dialogs into own files)
```

Key behaviors:
- **Single layout owns HeaderBar** → `getUserInfo` fetched once per session (store), not per navigation.
- **`keep-alive` on list pages** → returning to a tab restores state; refetch only on explicit refresh or after a mutation touching that entity (targeted, not whole-page).
- **Mutation protocol:** after create/update/delete, update the affected row in cache (or refetch only that page's list) — never re-fire dropdown + stats bundles.
- **Every list server-paginated** (backend already supports `page/limit` nearly everywhere).
- **Search debounced 300ms, request-cancelled on new keystroke.**

### 4.5 Performance fix list (fast path — can land before the visual redesign)

Frontend (1-2 days each, independent):
1. Remove the NavigationDuplicated `reload()` monkey-patch (router/index.js:253-257).
2. Move HeaderBar into a layout; fetch `getUserInfo` once into store.
3. AllDevices: drop `limit:1000` → server pagination; **stop the per-device `getDeviceMode` loop** (backend change #2 in §3) — this alone removes ~N requests.
4. home.vue: drop per-agent `getAgentBindDevices` (backend change #1) — removes ~10 requests.
5. RfidManagement: make `loadDropdownData` lazy per dialog; make stats lazy/periodic; stop re-running both on every mutation — removes ~11 requests per save.
6. GlobalSearch: single unified endpoint + cancel-on-new-keystroke — removes 8 of 9 calls per keystroke.
7. Replace HTTP layer with axios (dedup + no write retries); add `babel-plugin-component`; bump SW `maxEntries`/rethink `skipWaiting`.

Backend (small, listed §3): deviceCount & mode aggregation, bulk endpoints, token-lookup LRU cache. No breaking changes; additive only.

### 4.6 Build order (each step independently shippable, feature parity checked at each step)

| Phase | Work | Parity gate |
|---|---|---|
| **0. Perf hot-fixes** | §4.5 list | Request counts per page: home ≤4, AllDevices ≤3, RFID save ≤2, zero reloads |
| **1. Shell** | AdminLayout + sidebar nav regroup (spec §2.2), axios layer, store modules, shared components | All 24 routes reachable; zero feature removed |
| **2. Overview landing** | `/overview` wired to existing `/admin/founder/*` endpoints + echarts | Spec §2.1 QA checklist |
| **3. Characters & Families** | Rebuild home/role-config/templates/models; `/families` search + 360 (backend exists) | CRUD parity: agent create/delete/config, template apply, user enable/disable/reset |
| **4. Content & RFID** | Split RfidManagement into sub-routed pages; keep every tab incl. custom cards, folder import, NFC test console (bridge URL → config); bulk import folded in | Side-by-side field audit against current 9 tabs; tap analytics unchanged |
| **5. Engagement & Costs** | `/engagement`, `/costs`, `/conversations` (spec §8.1/8.4/8.3) | IST boundary QA (spec §7) |
| **6. Operate** | Fleet devices (fix N+1), OTA, providers, email reports, settings pages | Settings-sync dialog parity (8 calls → 1 aggregator later) |
| **7. Cleanup** | Archive VoicePrint/Params/SafeServer behind flag; delete dead code; SW/PWA pass | grep audit: zero dead imports; bundle report |

### 4.7 Explicit non-goals / safety rails
- Don't touch device/worker-facing API paths or shapes; don't remove mobile endpoints.
- Don't drop RFID "Track 1 / Track 2" semantics (static packs vs dynamic Q&A) — the two-track model came from a documented refactor and the device depends on it.
- Never display parent emails (PII rule, established convention).
- Don't fake data the schema doesn't have (spec §5 honesty rules: "love" = repeat taps proxy, etc.).

---

## 5. Net-new features (what the redesign adds)

Tagged: **[spec]** = already in the approved FOUNDER_DASHBOARD_SPEC (backend mostly exists) · **[new]** = suggested by this audit, grounded in a pain found in the code. Ordered by value/effort.

### Tier A — ship with the redesign
1. **Unified search + command palette (Cmd+K)** **[spec + new]** — one search box across parents, kids, device MACs/aliases, RFID UIDs, pack codes (backend: `GET /admin/search` spec §3.5; `/founder/families/search` already exists). Selecting a result jumps straight to the entity (family profile, device 360, card in RFID). The palette doubles as navigation ("go to OTA").
2. **Overview landing ("Morning Pulse")** **[spec]** — KPI row with sparklines, where-kids-spend-time, what-kids-love, needs-attention strip. All data already served by `/admin/founder/overview|engagement|content|costs`.
3. **Family 360 profile** **[spec]** — one page per family: kid header, toy status (online/battery/firmware), usage streaks, loves leaderboard, recent conversations. Replaces the current hunt across UserManagement → KidProfiles → ActiveDevices → AllDevices.
4. **Device 360 detail page** **[new]** — today a device's story is split across AllDevices row actions (Settings Sync dialog = 8 calls, Analytics dialog, Kid Profile, playlists on another page). One detail page (`/devices/:mac`) with header (identity, online, battery, firmware, kid), tabs: Settings & Sync / Playlists / Analytics / Taps / Chat. Backend: one aggregator endpoint (mirror of spec §3.6 family aggregator) to replace the 8-call burst.
5. **Real bulk operations** **[new]** — batch endpoints + UI for: unbind devices, user enable/disable/delete (currently N parallel calls with mixed-failure counting and a fullscreen spinner), RFID card register/delete (partially exists). Results table shows per-row success/failure instead of one giant toast.
6. **"Needs update" card worklist** **[new]** — Card Analytics already computes "Updates Required" and "Unknown Taps", but they're dead-end KPIs. Make them actionable: click → filtered tap-log/cards list → one-click re-map or push refresh. This is the ops loop the tap protocol was built for (docs: 100% tap analytics + background content refresh).
7. **Draft → Publish workflow for packs** **[new]** — the schema already has active/draft status; the UI just shows a switch. Make it explicit: edit in Draft with a preview (exactly what the device will download), then Publish; badge distinguishes them everywhere. Prevents the current footgun where "Active" edits go live to toys mid-edit.
8. **Guided empty states** **[new]** — several pages render silent empty tables when entered without context (`/device-management` with no `agentId`, VoicePrint with no agent). Every empty state names the next action ("Pick a character from Characters", "Register UIDs or run Bulk Import").

### Tier B — cheap, high-polish
9. **Copy-to-clipboard on all identifiers** + monospace font for UIDs/MACs/pack codes **[new]** — admins compare and paste these constantly; today they're regular table text.
10. **CSV export on every list** **[new]** — card-mapping export exists in BulkImport; generalize to tap logs, token usage, device lists (client-side CSV from current page; server export where volume demands).
11. **Recents / pinned entities** **[new]** — localStorage-backed "recently viewed" (agents, devices, families) in the sidebar; costs almost nothing, saves the most common navigation.
12. **RFID test console upgrades** **[new]** — move the hardcoded `ws://localhost:8765` NFC bridge URL into settings/env with a connection state chip; "test this card" action from any card row (pre-fills lookup); keep the live tap feed.
13. **Ops health widget** **[new]** — Operate landing already gets fleet KPIs; add the API's own `/health` deps (db, gemini, elevenlabs) as status chips so "dashboard says fine but toys are dumb" moments are diagnosable in one place.
14. **The Daily Brief (email digest)** **[spec, Phase 2]** — reuses the email-report pipeline over the new aggregates.

### Explicitly NOT suggested (simplicity-first)
No RBAC editor (auth model is token+role, two levels — an editor would be speculative), no custom dashboard builder, no real-time websocket fan-out beyond the spec's Phase-3 live strip, no dark mode in v1 (tokens enable it later), no i18n framework until there's a second locale requirement.

---

## 6. UI redesign — how it becomes user-friendly (concrete)

The "complicated" feeling comes from inconsistency: every page has its own table chrome, paginator, button placement, and dialog style; the RFID page stacks 9 pages into tabs; destructive actions range from a confirm to a scary paragraph to nothing. The fix is a small set of enforced patterns:

### 6.1 Layout system
- **Persistent collapsible sidebar** (7 groups, §4.1) + slim topbar (global search, environment badge dev/prod, user menu). HeaderBar lives here once — not copied into 21 views.
- **Breadcrumbs** on drill-down pages (Operate → Devices → `AA:BB:CC…`), each crumb clickable.
- **Page header pattern** on every page: title + one-line description + primary action right-aligned. No more hunting for "Add".
- 8pt spacing grid, content max-width, `tabular-nums` for all numbers.

### 6.2 Five page archetypes (every page is one of these — this is the core of the redesign)
1. **List page** (users, devices, packs, cards, firmware…): filter bar (search + filters + bulk actions) → dense table (sticky header, row-hover action menu instead of 6 inline icon buttons) → server pagination footer. One shared `DataTable` component: identical look, sorting, empty/loading/error states, CSV export, column config.
2. **Detail page** (device 360, family 360, agent): identity header card (status badges) → tabbed sections → recent-activity feed. Deep-linkable tabs (`/devices/:mac/analytics`).
3. **Dashboard** (overview, costs, engagement): KPI row → chart cards → worklist/alert strip. `StatCard` + `BaseChart` everywhere; no more hand-built SVG.
4. **Editor** (pack editor, role config, templates): sectioned form, sticky save bar, **unsaved-changes guard**, live preview of what the device will play/ask, validation inline. The 1,451-line pack dialog becomes a routed editor page with room to breathe (max-10-items rule surfaced as "7 of 10 used").
5. **Wizard** (bulk import — already 3 steps; new card creation becomes: choose type → choose/link content → confirm & write). Steps show progress and let you go back without losing data.

### 6.3 RFID area restructuring (the worst UX offender)
- 9 tabs → **sub-routed pages** under Content & Games with a left sub-nav (URL per tab, deep-linkable, browser back works): Packs (Q&A + Content as two types of one list), Card Mappings, AI Cards, Custom Cards, Bulk Ranges, Tap Analytics, Test Console.
- Master–detail where it helps: card list left, mapping detail right (today: full-page dialog per edit).
- The mutation refetch storm dies: saving a pack updates that pack's row, not 11 requests.
- AI-card type currently **inferred by substring-matching the notes field** ("cheeko"/"magic"/"astro") — replace with an explicit type/badge (small backend field or documented label), because silent inference is how admins get confused.

### 6.4 Interaction states (consistency rules)
- **Loading:** skeletons shaped like the content, not blank tables or fullscreen spinners.
- **Empty:** illustration-light state with the next action (Tier A #8).
- **Destructive actions:** typed confirmation for irreversible ones (delete user, unbind device), plain confirm + 5s undo toast for recoverable ones (delete card row). One `ConfirmDialog` component; today severity varies per page.
- **Toggles** (OTA force-update, device mode, active): optimistic flip with error rollback; the current OTA force-update confirm is inverted-feeling and gets rewritten.
- **Toasts** unified (no `alert()`); failures always surfaced — several analytics pages currently swallow errors silently.
- **Time:** relative everywhere ("2h ago") with IST absolute on hover; date pickers default to IST boundaries (documented gotcha from ACTIVE_DEVICES_ANALYTICS_PLAN).
- **Buttons:** one primary action per view; secondary as ghost buttons; icon-only only for universal icons with tooltips.

### 6.5 Known misleading UI to fix during rebuild
- home.vue "Total Users/Devices" shows the current page's counts → wire to `admin.getSystemStats`.
- OTA "Connected Devices Overview" reads `localStorage.agentId` (usually absent → zeros) → fleet-wide stats from `admin.getSystemStats` or `/admin/fleet/health`.
- RuntimeProviders copy says "3 services" for 5 types; health indicator math off → fix copy.
- EmailReportSettings silently autosaves 1s after any change → explicit Save with saved-state indicator + Preview moved next to it.
- Client-side search fields that only filter already-loaded rows get labeled "Filter" (not "Search") or wired to server search — the label lies today.
- `window.location.reload()` on double nav-click removed; loading states replace full-page white flashes.

### 6.6 Visual theme
- Brand stays: `#FF9100` orange primary, existing `theme.scss` tokens, Element UI skinned via `element-variables.scss` override — one accent per nav group used sparingly (icon/left-border only).
- Status badge system: success/warning/serious/critical, always icon + label (colorblind-safe, per spec §4 palette).
- Compact table density default with comfortable toggle; Inter or system font stack.
- Charts: echarts with the spec's fixed categorical palette (AI talk `#eb6834`, cards `#2a78d6`, games `#008300`, radio `#4a3aa7`) — always assigned by feature, never cycled.
- Dark mode: deferred (tokens already structured for it).

### 6.7 Mobile
- New pages (Overview, Families, Costs) fully responsive: sidebar → bottom tab bar, KPI rows → 2×2, tables → cards (spec §2.4 + PWA manifest).
- CRUD work pages stay desktop-first — they're work tools; don't burn effort reflowing 40-column tables.

---

## 7. Open decisions for the user
1. **Confirm the target is manager-web** (per the approved spec) and pause the separate React `founder-dashboard-web` prototype to avoid two codebases.
2. **Theme ambition:** skin Element UI in place (recommended, low risk) vs. custom design system.
3. **Archive list sign-off:** VoicePrint, Params Management, ServerSide manager — hide now or after parity rebuild?
4. **Vue 3 migration:** defer to a post-redesign phase (recommended) or fold in now (slower, riskier).
