# Known Issues — PR #141 (Founder Dashboard rewrite)

**Status:** Merged to `main` as-is; every item below is **outstanding**. Merged deliberately
as "merge now, fix later" per maintainer decision — this file is the backlog.

Date merged: 2026-08-06. Review: one read-only pass over the backend diff
(`founderDashboard.service.js`, `admin.routes.js`, `prisma-migrations.js`, `prisma.config.ts`,
the two new scripts). The 4,700-line `App.tsx` / `App.css` rewrite was **not** line-reviewed —
only its wiring to the changed API shapes was checked.

Blast radius is contained: `main/founder-dashboard-web` is the only consumer of the changed
`/admin/founder/*` response shapes (verified by repo-wide grep), and it ships in the same PR.
No schema migrations. But merging to `main` **does** trigger the CircleCI production deploy
(`.circleci/config.yml`, branch filter `main | production | media-server-sql`), so the manager
API is live with these changes.

---

## P0 — Do immediately (visible breakage on the live dashboard)

### 1. Seed the `sys_params` rows the new config path expects
- **Where:** `main/manager-api-node/src/services/founderDashboard.service.js`
  (`loadMonthlyBudget`, `loadQuestionAllowance`, `loadCostRates`).
- **What:** The PR moved hardcoded constants into `sys_params`, but **no migration seeds them**.
- **Impact:**
  - `founder_monthly_budget_inr` unset → `monthlyBudget` and `budgetUsedPercent` return `null`.
    The monthly budget was previously hardcoded `15500`, so the Costs page budget tile and the
    Mission Control spend gauge go blank the moment this deploys.
  - `monthly_question_allowance` unset → family profile quota renders "used" with no denominator
    (`allowance` / `remaining` are `null`).
  - `gemini_price_*` unset → falls back to the previous hardcoded rates, so **cost figures are
    unaffected**. Only the budget and allowance tiles break.
- **Fix:** Insert the four/six rows into `sys_params` (`param_code` / `param_value`), or add a
  seed migration. Codes:
  ```
  founder_monthly_budget_inr              15500
  monthly_question_allowance              <the real ceiling>
  gemini_price_input_text_inr_per_million     46
  gemini_price_input_audio_inr_per_million   276
  gemini_price_input_cached_inr_per_million  <unknown — see #2>
  gemini_price_output_text_inr_per_million   184
  gemini_price_output_audio_inr_per_million 1104
  ```

### 2. Cached input tokens are billed at ₹0 — spend is understated
- **Where:** `DEFAULT_RATES_INR_PER_MILLION.inputCached = 0` in `founderDashboard.service.js`.
- **What:** Deliberate, and documented in a comment: no verified cached-token rate was supplied,
  so the PR refuses to guess one. `device_token_usage_session.input_cached_tokens` is real and
  populated, so every cached token is currently costed at zero.
- **Impact:** Every AI-cost figure on the dashboard is low by however much cached input is
  consumed. `scripts/verify-founder-data.js` already reports this as an INFO line.
- **Fix:** Get the real Gemini cached-input rate and set
  `gemini_price_input_cached_inr_per_million`.

---

## P1 — Data correctness (numbers on screen do not mean what their label says)

### 3. `thisWeek.sessions` on the family profile is not a session count
- **Where:** `getFamilyProfile` — `sessions: weekUsage.length`.
- **What:** `weekUsage` is rows from `device_usage_daily`, which is one row per (mac, day).
  A family active every day shows "7 sessions" regardless of how many sessions they had.
- **Fix:** Count `analytics_game_sessions` / `voice_session_summaries` over the same window, or
  relabel the field to `activeDays`.

### 4. "Quiet toys" has two different definitions in two places
- **Where:** `getFounderEngagement` (quiet list + `quietDeviceTotal`) vs `getFounderBrief`
  (`quietCount`, feeds a "three things to know" bullet).
- **What:** Engagement filters candidate macs against the registered `ai_device` fleet;
  Brief counts straight out of `device_usage_daily` history with no such filter.
- **Impact:** A mac with usage history that is no longer a registered device inflates the Brief's
  count but not the Engagement page's. The two screens disagree about the same metric.
- **Fix:** Extract one helper and call it from both. `scripts/verify-founder-data.js` only checks
  the Engagement definition, so this divergence is currently unverified.

### 5. `getFamilyProfile` progress rekeyed from `kid_id` to `mac_address` with no test
- **Where:** `analytics_user_progress` query, was `{ kid_id: kid.id }`, now
  `{ mac_address: { in: macAddresses } }`.
- **What:** `analytics_user_progress.kid_id` still exists in the schema. A kid with no linked
  device now gets `[]` where they previously got kid-keyed rows. The response fields also changed
  (`modeType` / `totalTimeSeconds` dropped; `totalDurationSeconds`, `totalGamesPlayed`,
  `currentStreak`, `lastActivityAt` added).
- **Fix:** Confirm `kid_id` is genuinely unpopulated in production (which is presumably why this
  changed) and either backfill it or delete the column. Add a unit test either way.

---

## P2 — Deliberate exposure, wants an explicit sign-off

### 6. New endpoint returns full child conversation transcripts
- **Where:** `GET /admin/founder/conversations/:sessionId/transcript` →
  `getConversationTranscript` (up to 200 messages from `voice_session_messages`).
- **What:** Correctly gated behind `requireAuth + requireSuperAdmin`, and it *replaces* a
  placeholder that shipped fabricated dialogue attached to a real device — so this is a net
  improvement in honesty. But it is a new, real exposure of children's conversation content.
- **Note the tension:** the same PR deliberately *removes* parent email/phone/avatar from
  `listAllFamilies` and `getFamilyProfile` on privacy grounds.
- **Action:** Decide consciously whether super-admin transcript access is intended, and whether
  it should be audit-logged. If not, revert the route.

---

## P3 — Performance, will bite as the fleet grows

### 7. Query count and row volume per dashboard load roughly doubled
- **What:** Every founder endpoint now also queries its previous equal-length window for the
  delta arrows. On top of that:
  - `getFounderEngagement` adds a 60-day `device_usage_daily` history scan.
  - `getFounderContent` adds a 21-day trend window across taps, radio and sessions, plus a
    `groupBy` for previous-window per-pack taps.
  - `getFamilyProfile` takes went 20 → 200 for card taps and games played.
  - `getFounderOperate` takes went 20 → 50 for sync and analytics events.
  - `getFounderLive` pulls every `device_token_usage_session` row for the calendar month.
- **What is still unbounded:** `rfid_card_tap_log.findMany` and
  `device_token_usage_session.findMany` over the selected range have no `take`. Pre-existing
  pattern, now applied over more windows.
- **Impact:** None at current fleet size. Becomes a problem when tap volume or session count
  grows an order of magnitude.
- **Fix when it hurts:** push the aggregation into SQL (`groupBy` / raw aggregate) instead of
  pulling rows into Node, and cache the previous-window figures.

---

## P4 — Unreviewed surface

### 8. The frontend rewrite was not line-reviewed
- **What:** `App.tsx` +2,939 / −1,636 and `App.css` +1,766 / −1,143, in single files, with no
  test coverage. Only the API wiring was checked: response types match the new backend shapes,
  `families/list` is called with `?page=1&limit=200` (server caps at 200), and the new
  `/founder/live`, `/founder/brief` and transcript endpoints are consumed correctly.
- **Not checked:** rendering logic, null handling for every newly-nullable KPI
  (`monthlyBudget`, `budgetUsedPercent`, `avgBattery`, `latestFirmwarePercent`, `moderationFlags`,
  `dauMauRatio`, `returnedRate`, `movingAverage`'s first 6 nulls), responsive layout, accessibility.
- **Fix:** Click through every tab on staging with a near-empty database, which is the case that
  exercises all the new `null` paths at once.

---

## Verification

`main/manager-api-node/scripts/verify-founder-data.js` (new in this PR) computes each dashboard
figure independently from the tables and diffs it against the live API. It is read-only, has a
Proxy guard that throws on any Prisma write method, and never boots `server.js` (so it cannot
trigger `migrate deploy`) — safe to point at production.

```bash
cd main/manager-api-node
FOUNDER_TOKEN=xxx node scripts/verify-founder-data.js --api https://<host>/toy --range 7d
```

Run it against production after the `sys_params` seed in #1. It already asserts most of the
invariants this PR claims to fix; items #3 and #4 above are the gaps in its coverage.

## Not issues (checked, fine)

- `prisma.config.ts` — `env()` throws when unset, so branching on `process.env.DIRECT_URL` is a
  real fix, not a risk. `import 'dotenv/config'` does not override already-set env vars.
- `prisma-migrations.js` — timeout 60s → 300s is a genuine safety improvement: killing
  `migrate deploy` mid-run leaves an unfinished `_prisma_migrations` row that blocks every later
  deploy with P3009. The new P3009/P3015 diagnostics are accurate.
- `scripts/sync-content-library-unique.js` — standalone, not wired into boot; only deletes with
  the explicit `--delete-duplicates` flag, default run reports only.
- No schema migrations in this PR.
