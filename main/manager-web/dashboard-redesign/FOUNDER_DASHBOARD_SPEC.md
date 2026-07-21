# Founder Dashboard — Approved Design & Implementation Spec

**Status:** Design approved by Ravi (20 Jul 2026); full page suite approved 21 Jul 2026 (see §8). Ready for implementation.
**Design mockups:** open [`founder-dashboard-design.html`](./founder-dashboard-design.html) in a browser — it contains the full visual design (three explored directions, the approved one, family search/profile, mobile views, and a data-availability map). All numbers in the mockups are illustrative sample data.

**Approved direction:** Option A "Morning Pulse" as the new post-login landing page, **plus** Family search + Family 360 profile, **plus** mobile-responsive layouts with PWA/add-to-home-screen — shipped together as Phase 1. Phase 2 is "The Daily Brief" (Option C, reuses the same aggregates + the existing email-report pipeline). Phase 3 folds a live "online now" strip (from Option B) into the Overview header.

---

## 1. Context — what exists today

- Frontend: `main/manager-web` — Vue 2.6 + Element UI 2.15 + Vuex 3, flyio HTTP wrapper (`src/apis/httpRequest.js`), no chart library (current "charts" are hand-rolled CSS bars / inline SVG in `GameAnalytics.vue` and `TokenAnalytics.vue`).
- Backend: `main/manager-api-node` — Express + Prisma → PostgreSQL (DigitalOcean prod / Supabase local). No SQL views; all aggregation is JS-side.
- Analytics is fragmented across 4 pages (Home KPI strip, GameAnalytics, TokenAnalytics, ActiveDevices). The top-bar nav has 10 pills + a 6-item dropdown and horizontally scrolls — at capacity.
- Useful existing endpoints (already wired in `src/apis/module/`): `analytics.js` (dashboard summary, sessions-per-day, game accuracy, difficulty, TTFT, top devices), `activeDevices.js` (per-day actives + per-device rfid/chat/games/radio drill-down), `admin.js` (system stats, per-device analytics + progress families), `emailReport.js`.

## 2. Phase 1 scope

### 2.1 New page: `/overview` (route name `Overview`) — the founder landing page

After login, admins land here (change the post-login redirect + logo link; non-admins keep current behavior). Layout per mockup, top to bottom:

1. **Header row** — greeting, date (IST), period toggle `Today / 7 days / 30 days` (applies to the whole page).
2. **KPI row (5 stat cards, each with a 14-day sparkline and vs-prior-period delta):**
   - Active toys today (of fleet total) — `GET /analytics/today/device-count` + `GET /admin/stats/overview` (totalDevices)
   - Play time (hrs) — **new** fleet usage endpoint (see §3.1)
   - Sessions — `GET /analytics/dashboard/sessions-per-day`
   - New families (7d) — `GET /admin/stats/users` (already returns registrations/day; currently rendered nowhere)
   - AI cost (₹) — `GET /usage/analytics/totals` / `daily-summary`
3. **"Where kids spend time"** — stacked area, minutes/day by feature (AI talk / cards / games / radio), last 14–30 days — **new** endpoint §3.1. Beside it, **"Today's split"** — 100% bar + per-feature minutes.
4. **"What kids love" row (3 cards):**
   - Cards kids love — top packs by taps with WoW delta — **new** endpoint §3.2
   - Games: played vs finished — plays + completion % (completion drop is our best "dislike" signal) — **new** endpoint §3.2
   - What kids are talking about — topic chips + 1-2 sample summaries — **new** endpoint §3.3 (can ship v1 without this card if the job slips)
5. **"Needs attention" strip (3 alert cards):** quiet toys (7+ days) §3.4, TTFT spike (existing `/analytics/dashboard/ttft-trend`), firmware laggards (`ai_device.app_version` vs latest `ai_ota`).

Every card click-throughs to the existing deep pages (GameAnalytics, TokenAnalytics, ActiveDevices, AllDevices).

### 2.2 Nav regroup

Replace the flat pill list in `src/components/HeaderBar.vue` with 6 groups (desktop: grouped top nav or slim sidebar per mockup; the mockup shows a sidebar — either is acceptable, sidebar preferred):

| Group | Contains (existing routes) |
|---|---|
| Overview | `/overview` (new) |
| Engagement | `/game-analytics`, `/active-devices` |
| Content & Games | `/content-library`, `/rfid-management`, `/bulk-import` |
| Conversations | chat history views (existing per-agent drill-downs) |
| Families | `/user-management`, `/kid-profiles`, `/home` (agents) + new Family 360 |
| Costs | `/token-analytics` |
| Operate | `/all-devices`, `/ota-management`, params/dict/server/template/email-reports/runtime-providers |

No existing page is deleted or restyled in Phase 1 — they just move one level down.

### 2.3 Family search + Family 360 (`/families`)

- Search box matching **parents, kids, device MACs/aliases** in one dropdown (grouped results) — **new** unified endpoint §3.5. The header already has `GlobalSearchDropdown.vue` to extend or replace.
- Selecting a result opens the profile: kid header (name/age/grade/interests/languages, quota from `user_question_quota`), toy status (`device_runtime_state`: online, battery, firmware; TTFT from `device_token_usage`), KPI row (play this week + sparkline, streak from `analytics_streaks`/`analytics_user_progress`, sessions, cost), time-split bar, "loves" leaderboard (taps/plays per pack/game for this MAC), recent conversation summaries (`voice_session_summaries`) with link to full transcript (existing chat drill-down).
- **PII rule (existing convention): never render parent emails — display names only.**
- One aggregator endpoint recommended (§3.6) so the profile is a single call.

### 2.4 Mobile + PWA

- New pages (`/overview`, `/families`) are fully responsive: sidebar → bottom tab bar (Home / Engage / Families / Alerts) under 768px; KPI row → 2×2 grid; tables → cards. See phone mockups in the design HTML.
- Existing admin pages stay desktop-first (they're work tools).
- Enable PWA: `workbox-webpack-plugin` is already in `devDependencies` — add `manifest.json` + icons so the dashboard is installable (add to home screen, opens full-screen).
- `HeaderBar.vue` currently has `min-width: 900px` — the new shell must not inherit that constraint.

## 3. New backend endpoints (manager-api-node)

All admin-auth (`requireAdmin` / `requireSuperAdmin`, consistent with `/admin/stats/*`). **Two hard-won rules from `ACTIVE_DEVICES_ANALYTICS_PLAN.md` apply to every query here:**
1. **All date bucketing in IST**: `(ts AT TIME ZONE 'Asia/Kolkata')::date` — a UTC query once returned 0 taps for a day that had 34.
2. **Join RFID taps on `mac_address`, never `device_id`** (`device_id` is NULL on ~67% of tap rows). Show unresolved taps as "Unresolved", and consider a "unique cards" figure (rapid repeat taps inflate counts).

### 3.1 `GET /analytics/fleet/usage-daily?start=&end=`
Fleet-wide daily sums from `device_usage_daily`: `[{ date, usage_seconds, ai_talk_seconds, card_seconds, game_seconds, radio_seconds, active_devices }]`. (~30 lines of Prisma `groupBy`; powers the stacked area, play-time KPI, and today's split.)

### 3.2 `GET /analytics/fleet/content-leaderboard?days=7`
- Packs: from `rfid_card_tap_log` grouped by `content_pack_name` (fallback "Unresolved"): taps, unique devices, unique cards, WoW delta.
- Games: from `device_games_played` (plays, avg score, avg duration) joined with completion from `analytics_game_sessions.completion_status` where available.
- Radio/media: `device_radio_played` by station; music/story most-played from `analytics_media_playback`.

### 3.3 `GET /analytics/fleet/topics?days=7` + nightly job
Aggregate `voice_session_summaries.summary` across the fleet: nightly cron (reuse the existing cron infra from email reports) extracts top topics + a few quotable snippets → store in a small `fleet_topics_daily` table (or JSON in `sys_params`). Endpoint serves the latest. v1 may be keyword-frequency only (free); optional small LLM pass later. **Never include kid-identifying info beyond device alias/first name.**

### 3.4 `GET /analytics/fleet/quiet-devices?days=7`
Devices with activity in the prior 30 days but none in the last N: from `ai_device.last_connected_at` + `device_usage_daily`. Return MAC, alias, kid first name, parent display name, days quiet, last activity.

### 3.5 `GET /admin/search?q=`
Unified search across `parent_profile.display_name`, `kid_profile.name/nickname`, `ai_device.mac_address/alias`, `sys_user.username`. Return grouped `{ kids: [], parents: [], devices: [] }` (≤5 each) with enough context to render the dropdown (parent name, toy count, online flag).

### 3.6 `GET /admin/family/:macOrKidId/profile`
Aggregator composing: kid + parent (display name only), devices w/ runtime state, week/month usage rollups (`device_usage_daily`, `device_card_taps_daily`, `device_ai_interactions_daily`), streak (`analytics_user_progress`), per-MAC pack/game leaderboard, last 3 `voice_session_summaries`, quota (`user_question_quota`), 7-day token cost (`device_token_usage`).

## 4. Frontend tech decisions

- **Charts: `echarts@5`, imported directly** (no vue-echarts wrapper — v6/v7 needs Vue 2.7/composition-api; this app is Vue 2.6). Build one thin `src/components/charts/BaseChart.vue` (init on mount, `setOption` on prop change, resize observer, dispose on destroy) + typed presets: `SparkLine`, `StackedArea`, `TrendLine`. Tree-shake via `echarts/core` imports to keep bundle size sane.
- **Shared components to create:** `StatCard.vue` (label / value / delta / sparkline slot), `LeaderboardCard.vue`, `AlertCard.vue`, `SectionCard.vue`. (Today the stat-card pattern is copy-pasted across 5 views — stop the bleeding on the new pages.)
- **Design tokens:** reuse `src/styles/theme.scss` (`--primary: #FF9100` etc.). Chart categorical palette (colorblind-validated, fixed order — always assign by feature, never cycle):

| Series | Light surface | Dark surface |
|---|---|---|
| AI conversations | `#eb6834` | `#d95926` |
| Story & rhyme cards | `#2a78d6` | `#3987e5` |
| Games | `#008300` | `#008300` |
| Radio | `#4a3aa7` | `#9085e9` |
| Status good / warning / serious / critical | `#0ca30c` / `#fab219` / `#ec835a` / `#d03b3b` (always icon + label, never color alone) | same |

- Deltas: green up / red down text (`#006300` on light), always with a "vs last week/Sunday" qualifier.
- Numbers in tables/axes: `font-variant-numeric: tabular-nums`.

## 5. Honest data gaps (do not fake these)

- **No explicit like/dislike signal exists anywhere in the schema.** The dashboard uses proxies and labels them as such: repeat taps/plays = "love", completion drop / early quits = "losing interest". If we want the real thing later: log a reaction event (played-again / stopped-early / "more!") from the voice agent — one table + one hook.
- **No sentiment scoring on transcripts** (transcripts themselves exist in `voice_session_messages`). Optional later, riding the nightly topics job.
- Imagine/S3 images expire after ~1 day (lifecycle) — don't promise image history on profiles.

## 6. Suggested build order (each step is independently shippable)

1. `echarts` + `BaseChart`/`StatCard` components; new `/overview` route with KPI row wired to **existing** endpoints (device counts, sessions, cost, registrations).
2. §3.1 fleet usage endpoint → stacked area + today's split + play-time KPI.
3. §3.2 leaderboards → "What kids love" row. §3.4 quiet devices → alerts strip.
4. Nav regroup + make `/overview` the admin landing page.
5. §3.5 search + §3.6 profile → `/families`.
6. Mobile responsive pass + PWA manifest.
7. (Phase 2) The Brief: template over the same aggregates + hook into the existing email-report cron. (Phase 3) live strip via `/admin/stats/active` polling.

## 7. QA checklist (Phase 1)

- [ ] All date filters verified against IST boundary cases (activity at ~23:30 IST lands on the right day).
- [ ] Tap joins by MAC; unresolved packs grouped as "Unresolved", not dropped.
- [ ] No parent emails anywhere in new UI or new API responses.
- [ ] `/overview` and `/families` usable at 375px width; bottom tab bar works; PWA installs.
- [ ] Non-admin users don't see fleet analytics (same guards as `/admin/stats/*`).
- [ ] Charts render with 0 rows (empty states designed, not blank).
- [ ] Local dev (Supabase) vs prod (DigitalOcean) data differences understood — empty local ≠ bug.

---

## 8. Full-suite addendum — remaining pages (approved 21 Jul 2026)

The complete page suite in the same Morning Pulse language was approved. Mockups for every page below are in `founder-dashboard-design.html` → **Part 2**. Each page is independently shippable, uses the shared components from §4, and follows §3's rules (admin auth, IST date bucketing, tap joins on `mac_address`).

### 8.1 `/engagement`
KPIs: active yesterday (DAU), weekly actives (WAU), monthly actives + % of fleet, stickiness (DAU/MAU), avg session length. Charts: 30-day DAU line with 7-day average; returning-vs-new split against last week's active cohort; 7×24 sessions-by-hour heatmap (IST); quiet-toys watchlist preview (full list = existing Active Devices page).

### 8.2 `/content`
KPIs: card taps, cards-in-use vs catalog size, game plays, avg completion, story/music plays. Pack leaderboard: taps, unique toys, **repeat rate (taps per toy — primary "like" proxy)**, WoW delta, 14-day sparkline — with an "Unresolved" row always shown, never dropped. Games table: plays, completion bar + status badge (completion drop = primary "dislike" proxy). Stories/music/radio most-played lists. "Losing steam" list = anything declining 2+ consecutive weeks.

### 8.3 `/conversations`
KPIs: AI-talk hours, talk sessions, avg turns/session, topics detected, moderation flags (with messages-screened count). Fleet topic chips with WoW arrows; session-summaries feed; transcript side panel (reuses the Active Devices chat drawer). Privacy: first names only, super-admin gate, no parent contacts.

### 8.4 `/costs`
**Zero new backend work** — served entirely by `/usage/analytics/*`. KPIs: month-to-date ₹, projected month vs budget, ₹ per active toy per day, ₹ per session, avg TTFT. Daily stacked input/output cost bars; token mix split; top toys by spend table. Required cleanup: move the hard-coded Gemini pricing + INR FX rate out of `device.service.js` into `sys_params` (budget value lives there too, editable in Settings).

### 8.5 `/operate` (Fleet & Ops landing)
KPIs: fleet size, online now, latest-firmware coverage %, avg battery + chronic-low count, device errors (7d). Firmware version distribution vs latest `ai_ota`; OTA rollout progress (staged/canary status); "needs a human" watchlist; recent device events feed from `device_sync_event` + `device_analytics_event`. Existing All Devices / OTA Management pages unchanged beneath.

### 8.6 New endpoints (beyond §3)

| Endpoint | Returns | Sources |
|---|---|---|
| `GET /analytics/fleet/actives` | DAU/WAU/MAU + stickiness, returning-vs-new split, 7×24 hourly histogram (IST) | `device_usage_daily`, `analytics_game_sessions` |
| `GET /analytics/fleet/summaries` | Paged feed: kid first name, duration, turns, tags, summary, transcript ref | `voice_session_summaries` |
| Moderation flag counter | Flags/day + messages screened | moderation pipeline; add a small `moderation_events` table at the gateway if flags aren't persisted yet |
| `GET /admin/fleet/health` | Online count, firmware distribution, battery stats + chronic-low list, error/event counts (7d), OTA progress | `device_runtime_state`, `ai_ota`, `ai_device`, `device_sync_event` |

### 8.7 Suite build order (after Phase 1 §6)
Engagement → Content & Games → Conversations (needs the §3.3 nightly job) → Costs (free) → Fleet & Ops. The Daily Brief (Phase 2) and the Overview live strip (Phase 3) come after the suite.
